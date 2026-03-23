from __future__ import annotations

import logging
import os
import threading
from typing import Any

import duckdb

logger = logging.getLogger(__name__)

# Thread-local storage for DuckDB connections.
# Each worker thread gets its own in-process DuckDB connection so that
# concurrent FastAPI requests never share state.
_local = threading.local()

# Global registry of dataset_id → parquet_path so new threads can auto-register.
_registered_datasets: dict[str, str] = {}
_registry_lock = threading.Lock()


def get_duckdb_conn() -> duckdb.DuckDBPyConnection:
    """Return (or create) a thread-local DuckDB connection.

    On first access from a new thread, re-registers all known dataset views
    so they are available for queries.
    """
    if not hasattr(_local, "conn") or _local.conn is None:
        logger.debug("Creating new thread-local DuckDB connection (thread=%s)", threading.current_thread().name)
        _local.conn = duckdb.connect(database=":memory:", read_only=False)
        _local.registered = set()
    # Ensure all known datasets are registered in this thread's connection
    # Take a snapshot of missing datasets under the lock to avoid race conditions
    with _registry_lock:
        missing = set(_registered_datasets.keys()) - getattr(_local, "registered", set())
        missing_items = {ds_id: _registered_datasets[ds_id] for ds_id in missing}
    for ds_id, path in missing_items.items():
        if not os.path.exists(path):
            logger.warning(
                "Parquet file missing for dataset %s: %s (thread=%s)",
                ds_id, path, threading.current_thread().name,
            )
            continue
        quoted = view_name_for(ds_id)
        try:
            _local.conn.execute(
                f"CREATE OR REPLACE VIEW {quoted} AS "
                f"SELECT * FROM read_parquet('{path}')"
            )
            _local.registered.add(ds_id)
        except Exception:
            logger.warning(
                "Failed to auto-register view %s from %s on thread %s",
                quoted, path, threading.current_thread().name, exc_info=True,
            )
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
    Also records the mapping globally so new threads auto-register the view.
    """
    if not os.path.exists(parquet_path):
        raise FileNotFoundError(
            f"Cannot register dataset {dataset_id}: "
            f"parquet file not found at {parquet_path}"
        )

    with _registry_lock:
        _registered_datasets[dataset_id] = parquet_path

    quoted = view_name_for(dataset_id)
    sql = (
        f"CREATE OR REPLACE VIEW {quoted} AS "
        f"SELECT * FROM read_parquet('{parquet_path}')"
    )
    conn = get_duckdb_conn()
    conn.execute(sql)
    if not hasattr(_local, "registered"):
        _local.registered = set()
    _local.registered.add(dataset_id)
    logger.info("Registered dataset view %s -> %s", quoted, parquet_path)


def unregister_dataset(dataset_id: str) -> None:
    """Drop the DuckDB view for the given dataset, if it exists."""
    with _registry_lock:
        _registered_datasets.pop(dataset_id, None)

    quoted = view_name_for(dataset_id)
    conn = get_duckdb_conn()
    try:
        conn.execute(f"DROP VIEW IF EXISTS {quoted}")
        if hasattr(_local, "registered"):
            _local.registered.discard(dataset_id)
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
