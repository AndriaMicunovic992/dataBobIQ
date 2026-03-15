from __future__ import annotations

import logging
import threading
from typing import Any

import duckdb

logger = logging.getLogger(__name__)

# Thread-local storage for DuckDB connections.
# Each worker thread gets its own in-process DuckDB connection so that
# concurrent FastAPI requests never share state.
_local = threading.local()


def get_duckdb_conn() -> duckdb.DuckDBPyConnection:
    """Return (or create) a thread-local DuckDB connection."""
    if not hasattr(_local, "conn") or _local.conn is None:
        logger.debug("Creating new thread-local DuckDB connection (thread=%s)", threading.current_thread().name)
        _local.conn = duckdb.connect(database=":memory:", read_only=False)
    return _local.conn


def view_name_for(dataset_id: str) -> str:
    """Return the quoted DuckDB view name for a dataset.

    UUIDs contain hyphens which are invalid in unquoted identifiers, so the
    view name must always be double-quoted.
    """
    return f'"ds_{dataset_id}"'


def register_dataset(dataset_id: str, parquet_path: str) -> None:
    """Register a Parquet file as a DuckDB view named ``ds_<dataset_id>``.

    The view is created (or replaced) so that subsequent queries can reference
    the dataset by its stable view name without re-specifying the file path.
    """
    quoted = view_name_for(dataset_id)
    sql = (
        f"CREATE OR REPLACE VIEW {quoted} AS "
        f"SELECT * FROM read_parquet('{parquet_path}')"
    )
    conn = get_duckdb_conn()
    conn.execute(sql)
    logger.info("Registered dataset view %s -> %s", quoted, parquet_path)


def unregister_dataset(dataset_id: str) -> None:
    """Drop the DuckDB view for the given dataset, if it exists."""
    quoted = view_name_for(dataset_id)
    conn = get_duckdb_conn()
    try:
        conn.execute(f"DROP VIEW IF EXISTS {quoted}")
        logger.info("Unregistered dataset view %s", quoted)
    except Exception:
        logger.warning("Failed to drop view %s", quoted, exc_info=True)


def execute_query(sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Execute a read-only SQL query and return results as a list of dicts.

    Parameters
    ----------
    sql:
        The SQL statement to execute.  Should be a SELECT (or equivalent
        read-only) statement.
    params:
        Optional named parameters passed to DuckDB's execute method.
        DuckDB supports positional (``?``) and named (``:name``) placeholders.

    Returns
    -------
    list[dict]:
        Each row as a mapping of column name → value.
    """
    conn = get_duckdb_conn()
    try:
        if params:
            relation = conn.execute(sql, params)
        else:
            relation = conn.execute(sql)

        columns = [desc[0] for desc in relation.description]
        rows = relation.fetchall()
        return [dict(zip(columns, row)) for row in rows]
    except Exception:
        logger.error("DuckDB query failed.\nSQL: %s\nParams: %s", sql, params, exc_info=True)
        raise
