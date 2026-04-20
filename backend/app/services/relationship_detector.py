"""Auto-detect join relationships between datasets in the same model.

After a user designates columns as "key" (via the column PATCH endpoint),
this service compares key columns across datasets to find value overlaps.

Only columns whose role was explicitly set to "key" BY THE USER participate
in auto-detection.  Parser heuristics and AI schema mapping set
role_source="system"; the PATCH endpoint sets role_source="user".
"""
from __future__ import annotations

import logging
from typing import Any

from app.duckdb_engine import execute_query, view_name_for

logger = logging.getLogger(__name__)

_MIN_COVERAGE_PCT = 0.30


def _is_join_candidate(col: dict[str, Any]) -> bool:
    """A column participates in auto-detection only when the USER set it as key."""
    if col.get("column_role") != "key":
        return False
    if col.get("role_source") != "user":
        return False
    return True


def detect_relationships(
    new_dataset_id: str,
    new_columns: list[dict[str, Any]],
    other_datasets: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Compare key columns of a dataset against other active datasets.

    Only columns with column_role="key" AND role_source="user" are considered.
    """
    results: list[dict[str, Any]] = []
    new_view = view_name_for(new_dataset_id)

    new_key_cols = [c for c in new_columns if _is_join_candidate(c)]
    logger.info(
        "Relationship detection for %s: %d user-key columns = %s",
        new_dataset_id[:8],
        len(new_key_cols),
        [
            (c.get("canonical_name") or c.get("source_name"), c.get("column_role"))
            for c in new_key_cols
        ],
    )

    if not new_key_cols:
        logger.info("No user-designated key columns — skipping auto-detection")
        return results

    for other_ds in other_datasets:
        other_id = other_ds["id"]
        other_view = view_name_for(other_id)
        other_cols = other_ds.get("columns", [])

        other_key_cols = [c for c in other_cols if _is_join_candidate(c)]
        if not other_key_cols:
            continue

        logger.info(
            "  vs %s: %d user-key columns = %s",
            other_id[:8],
            len(other_key_cols),
            [
                (c.get("canonical_name") or c.get("source_name"), c.get("column_role"))
                for c in other_key_cols
            ],
        )

        for nc in new_key_cols:
            nc_name = nc.get("canonical_name") or nc["source_name"]
            for oc in other_key_cols:
                oc_name = oc.get("canonical_name") or oc["source_name"]

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


def _compute_coverage(
    view_a: str, col_a: str,
    view_b: str, col_b: str,
) -> float:
    """Fraction of distinct values in view_a.col_a that exist in view_b.col_b."""
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
    denom = min(total_a, total_b) if min(total_a, total_b) > 0 else max(total_a, total_b)
    return overlap / denom


def _infer_relationship_type(
    view_a: str, col_a: str,
    view_b: str, col_b: str,
) -> str:
    """Infer whether the relationship is many_to_one, one_to_many, or many_to_many."""
    try:
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
