"""Auto-detect join relationships between datasets in the same model.

After a new dataset is materialized, this service compares its columns against
all other active datasets in the model.  Two columns are considered a potential
join key when they share a significant overlap of distinct values (measured by
coverage percentage).

Detection is content-driven: any column that is not a measure (sum/avg-able
amount) is a candidate, regardless of its name or role. The 30% coverage
threshold filters spurious matches.
"""
from __future__ import annotations

import logging
from typing import Any

from app.duckdb_engine import execute_query, view_name_for

logger = logging.getLogger(__name__)

# Minimum overlap of distinct values to consider a relationship
_MIN_COVERAGE_PCT = 0.30  # 30%

# Data types that are never join keys (they are measured values, not identifiers)
_EXCLUDED_DATA_TYPES = {"currency", "boolean"}

# Roles that are never join keys
_EXCLUDED_ROLES = {"measure"}

# Minimum distinct values for a column to be a meaningful join candidate
_MIN_CARDINALITY = 2


def _is_join_candidate(col: dict[str, Any]) -> bool:
    """Decide whether a column can participate in relationship detection.

    A column qualifies when it is not a measure (by role or data type) and
    has at least _MIN_CARDINALITY distinct values. We intentionally allow
    text, integer, and date columns so cross-language naming conventions
    and unmapped columns still get matched on value overlap.
    """
    if col.get("column_role") in _EXCLUDED_ROLES:
        return False
    if col.get("data_type") in _EXCLUDED_DATA_TYPES:
        return False
    unique_count = col.get("unique_count") or 0
    if unique_count and unique_count < _MIN_CARDINALITY:
        return False
    return True


def detect_relationships(
    new_dataset_id: str,
    new_columns: list[dict[str, Any]],
    other_datasets: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Compare columns of a newly materialized dataset against other active datasets.

    Parameters
    ----------
    new_dataset_id:
        The dataset that was just materialized.
    new_columns:
        List of column metadata dicts for the new dataset.
        Each must have ``source_name``, ``canonical_name``, ``column_role``, ``data_type``.
    other_datasets:
        List of dicts with ``id`` and ``columns`` (same shape) for each other
        active dataset in the model.

    Returns
    -------
    list of relationship dicts:
        ``{source_dataset_id, target_dataset_id, source_column, target_column,
          relationship_type, coverage_pct}``
    """
    results: list[dict[str, Any]] = []
    new_view = view_name_for(new_dataset_id)

    new_dim_cols = [c for c in new_columns if _is_join_candidate(c)]
    logger.info(
        "Relationship detection for %s: %d candidate columns = %s",
        new_dataset_id[:8],
        len(new_dim_cols),
        [
            (c.get("canonical_name") or c.get("source_name"),
             c.get("column_role"), c.get("data_type"))
            for c in new_dim_cols
        ],
    )

    for other_ds in other_datasets:
        other_id = other_ds["id"]
        other_view = view_name_for(other_id)
        other_cols = other_ds.get("columns", [])

        other_dim_cols = [c for c in other_cols if _is_join_candidate(c)]
        logger.info(
            "  vs %s: %d candidate columns = %s",
            other_id[:8],
            len(other_dim_cols),
            [
                (c.get("canonical_name") or c.get("source_name"),
                 c.get("column_role"), c.get("data_type"))
                for c in other_dim_cols
            ],
        )

        for nc in new_dim_cols:
            nc_name = nc.get("canonical_name") or nc["source_name"]
            for oc in other_dim_cols:
                oc_name = oc.get("canonical_name") or oc["source_name"]

                # With key-only filtering the candidate set is small, so we
                # skip the name heuristic and check actual value overlap for
                # every pair.  This catches cross-language column names
                # (e.g. "Projektnummer" ↔ "projectnumber").
                try:
                    coverage = _compute_coverage(
                        new_view, nc_name, other_view, oc_name
                    )
                except Exception:
                    logger.warning(
                        "Could not compute coverage %s.%s <-> %s.%s",
                        new_view, nc_name, other_view, oc_name,
                        exc_info=True,
                    )
                    continue

                logger.info(
                    "    coverage %s.%s <-> %s.%s = %.2f%%",
                    new_view, nc_name, other_view, oc_name, coverage * 100,
                )

                if coverage >= _MIN_COVERAGE_PCT:
                    rel_type = _infer_relationship_type(
                        new_view, nc_name, other_view, oc_name
                    )
                    results.append({
                        "source_dataset_id": new_dataset_id,
                        "target_dataset_id": other_id,
                        "source_column": nc_name,
                        "target_column": oc_name,
                        "relationship_type": rel_type,
                        "coverage_pct": round(coverage, 4),
                    })
                    logger.info(
                        "Detected relationship: %s.%s -> %s.%s (%s, %.1f%% coverage)",
                        new_dataset_id[:8], nc_name,
                        other_id[:8], oc_name,
                        rel_type, coverage * 100,
                    )

    return results


_DATE_TYPES = {"date", "datetime", "timestamp"}

# Column names commonly used for period/date fields that should match calendar columns
_PERIOD_NAMES = {"period", "periode", "fiscal_period", "month", "year_month", "yyyymm", "yearmonth"}
_CALENDAR_PERIOD_NAMES = {"year_month", "date", "date_key", "fiscal_period", "period", "month"}


def _names_could_match(
    nc_canonical: str, nc_source: str,
    oc_canonical: str, oc_source: str,
    nc_type: str | None = None,
    oc_type: str | None = None,
) -> bool:
    """Quick check whether two column names plausibly refer to the same thing."""
    names = {
        nc_canonical.lower().strip(),
        nc_source.lower().strip(),
    }
    others = {
        oc_canonical.lower().strip(),
        oc_source.lower().strip(),
    }

    # Exact match on any name variant
    if names & others:
        return True

    # Check if any word (length >= 3) is shared
    words_a = set()
    for n in names:
        words_a.update(w for w in n.replace("_", " ").split() if len(w) >= 3)
    words_b = set()
    for n in others:
        words_b.update(w for w in n.replace("_", " ").split() if len(w) >= 3)

    if words_a & words_b:
        return True

    # Both are date/time typed — likely calendar join candidates
    if nc_type and oc_type:
        if nc_type.lower() in _DATE_TYPES and oc_type.lower() in _DATE_TYPES:
            return True

    # Period-name heuristic: one side has a period/date column name and the other
    # has a calendar-typical column name → likely a calendar join candidate.
    # This catches "period" (string) ↔ "year_month" (string) matches that the
    # date-type check misses.
    if names & _PERIOD_NAMES and others & _CALENDAR_PERIOD_NAMES:
        return True
    if others & _PERIOD_NAMES and names & _CALENDAR_PERIOD_NAMES:
        return True

    return False


def _compute_coverage(
    view_a: str, col_a: str,
    view_b: str, col_b: str,
) -> float:
    """Compute the fraction of distinct values in view_a.col_a that exist in view_b.col_b.

    Values are cast to VARCHAR, trimmed, and empty strings treated as NULL so
    cross-source joins aren't broken by trailing whitespace or blank cells.
    """
    sql = f"""
        WITH a_vals AS (
            SELECT DISTINCT NULLIF(TRIM(CAST("{col_a}" AS VARCHAR)), '') AS v
            FROM {view_a}
            WHERE "{col_a}" IS NOT NULL
        ),
        b_vals AS (
            SELECT DISTINCT NULLIF(TRIM(CAST("{col_b}" AS VARCHAR)), '') AS v
            FROM {view_b}
            WHERE "{col_b}" IS NOT NULL
        )
        SELECT
            (SELECT COUNT(*) FROM a_vals WHERE v IS NOT NULL) AS total_a,
            (SELECT COUNT(*) FROM b_vals WHERE v IS NOT NULL) AS total_b,
            (SELECT COUNT(*) FROM a_vals
             WHERE v IS NOT NULL AND v IN (SELECT v FROM b_vals WHERE v IS NOT NULL)) AS overlap
    """
    rows = execute_query(sql)
    if not rows:
        return 0.0
    r = rows[0]
    total_a = r.get("total_a", 0)
    total_b = r.get("total_b", 0)
    overlap = r.get("overlap", 0)
    if total_a == 0 and total_b == 0:
        return 0.0
    # Coverage = overlap / min(total_a, total_b) — how much of the smaller set matches
    denom = min(total_a, total_b) if min(total_a, total_b) > 0 else max(total_a, total_b)
    return overlap / denom


def _infer_relationship_type(
    view_a: str, col_a: str,
    view_b: str, col_b: str,
) -> str:
    """Infer whether the relationship is many_to_one, one_to_many, or many_to_many."""
    try:
        # Check if col_a is unique in view_a
        sql_a = f"""
            SELECT COUNT(*) AS total, COUNT(DISTINCT "{col_a}") AS dist
            FROM {view_a} WHERE "{col_a}" IS NOT NULL
        """
        r_a = execute_query(sql_a)[0]
        a_unique = r_a["total"] == r_a["dist"]

        sql_b = f"""
            SELECT COUNT(*) AS total, COUNT(DISTINCT "{col_b}") AS dist
            FROM {view_b} WHERE "{col_b}" IS NOT NULL
        """
        r_b = execute_query(sql_b)[0]
        b_unique = r_b["total"] == r_b["dist"]

        if a_unique and not b_unique:
            return "one_to_many"
        elif not a_unique and b_unique:
            return "many_to_one"
        elif a_unique and b_unique:
            return "one_to_one"
        else:
            return "many_to_many"
    except Exception:
        return "many_to_one"
