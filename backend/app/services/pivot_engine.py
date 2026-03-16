from __future__ import annotations

import logging
import re
import time
from typing import Any

from app.duckdb_engine import execute_query, get_duckdb_conn, view_name_for
from app.schemas.pivot import ColumnInfo, MeasureDef, PivotRequest, PivotResponse

logger = logging.getLogger(__name__)

# Allowlist for SQL identifiers to prevent injection when we must inline column names
_SAFE_IDENTIFIER_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

# Maximum distinct values fetched for column pivot to prevent query explosion
_MAX_PIVOT_COLUMNS = 50


def _validate_identifier(name: str) -> str:
    """Validate that a column/table identifier is safe (allowlisted pattern).

    Raises ValueError for unsafe names.
    """
    if not _SAFE_IDENTIFIER_RE.match(name):
        raise ValueError(f"Unsafe SQL identifier: {name!r}")
    return name


def _quote(name: str) -> str:
    """Double-quote a validated identifier."""
    return f'"{_validate_identifier(name)}"'


def _build_filter_clause(filters: dict[str, list[str]]) -> tuple[str, list[Any]]:
    """Build a WHERE clause from a filters dict {column: [values]}.

    Returns (sql_fragment, positional_params).
    DuckDB supports positional ? parameters.
    """
    parts: list[str] = []
    params: list[Any] = []

    for col, values in filters.items():
        if not values:
            continue
        col_quoted = _quote(col)
        if len(values) == 1:
            parts.append(f"{col_quoted} = ?")
            params.append(values[0])
        else:
            placeholders = ", ".join("?" * len(values))
            parts.append(f"{col_quoted} IN ({placeholders})")
            params.extend(values)

    clause = " AND ".join(parts)
    return clause, params


def _agg_expr(measure: MeasureDef) -> str:
    """Build an aggregation SQL expression (column name is validated)."""
    col = _quote(measure.field)
    agg = measure.aggregation.upper()
    allowed_aggs = {"SUM", "AVG", "COUNT", "MIN", "MAX"}
    if agg not in allowed_aggs:
        raise ValueError(f"Unsupported aggregation: {measure.aggregation!r}")
    return f"{agg}({col})"


def _get_pivot_values(dataset_id: str, column_dimension: str, filters: dict) -> list[str]:
    """Fetch distinct values of the column_dimension field for pivoting."""
    col = _quote(column_dimension)
    view = view_name_for(dataset_id)
    filter_clause, params = _build_filter_clause(filters)
    where = f"WHERE {filter_clause}" if filter_clause else ""
    sql = f"SELECT DISTINCT {col} FROM {view} {where} ORDER BY {col} LIMIT {_MAX_PIVOT_COLUMNS}"
    rows = execute_query(sql, params if params else None)
    return [str(r[column_dimension]) for r in rows if r[column_dimension] is not None]


def _build_join_clauses(
    dataset_id: str,
    join_dimensions: dict[str, str] | None,
    relationships: list | None,
) -> tuple[str, dict[str, str]]:
    """Build LEFT JOIN clauses for cross-dataset dimensions.

    Returns (join_sql, alias_map) where alias_map maps dimension field → table alias
    so we can qualify column references in SELECT/GROUP BY.
    """
    if not join_dimensions or not relationships:
        return "", {}

    join_parts: list[str] = []
    alias_map: dict[str, str] = {}  # dim field → alias
    joined_datasets: dict[str, str] = {}  # dataset_id → alias

    for dim_field, dim_ds_id in join_dimensions.items():
        if dim_ds_id in joined_datasets:
            alias_map[dim_field] = joined_datasets[dim_ds_id]
            continue

        # Find a relationship connecting the fact table to this dataset
        rel = None
        for r in relationships:
            if r.source_dataset_id == dataset_id and r.target_dataset_id == dim_ds_id:
                rel = r
                break
            if r.target_dataset_id == dataset_id and r.source_dataset_id == dim_ds_id:
                rel = r
                break

        if not rel:
            logger.warning(
                "No relationship found to join dataset %s for dimension %s — skipping",
                dim_ds_id, dim_field,
            )
            continue

        alias = f"j{len(joined_datasets)}"
        joined_datasets[dim_ds_id] = alias
        alias_map[dim_field] = alias

        target_view = view_name_for(dim_ds_id)
        fact_view = view_name_for(dataset_id)

        # Determine join columns
        if rel.source_dataset_id == dataset_id:
            fact_col = _quote(rel.source_column)
            lookup_col = _quote(rel.target_column)
        else:
            fact_col = _quote(rel.target_column)
            lookup_col = _quote(rel.source_column)

        join_parts.append(
            f"LEFT JOIN {target_view} AS {alias} ON f.{fact_col} = {alias}.{lookup_col}"
        )

    return " ".join(join_parts), alias_map


def build_pivot_sql(
    request: PivotRequest,
    dataset_id: str,
    scenario_ids: list[str] | None = None,
    relationships: list | None = None,
) -> tuple[str, list[Any]]:
    """Build DuckDB SQL for a pivot query.

    When column_dimension is None, produces a flat GROUP BY aggregation.
    When column_dimension is set, uses conditional aggregation (CASE WHEN).

    Returns (sql, positional_params).
    """
    view = view_name_for(dataset_id)
    filters: dict[str, list[str]] = request.filters or {}
    filter_clause, filter_params = _build_filter_clause(filters)
    params: list[Any] = list(filter_params)

    # Build JOINs for cross-dataset dimensions
    join_sql, alias_map = _build_join_clauses(
        dataset_id, request.join_dimensions, relationships,
    )
    # When we have JOINs, alias the fact table as "f"
    use_aliases = bool(alias_map)

    # --- SELECT expressions ---
    select_parts: list[str] = []
    column_infos: list[ColumnInfo] = []

    # Row dimensions — qualify with alias if from a joined dataset
    for dim in request.row_dimensions:
        col_name = _validate_identifier(dim)
        if dim in alias_map:
            select_parts.append(f'{alias_map[dim]}."{col_name}"')
        elif use_aliases:
            select_parts.append(f'f."{col_name}"')
        else:
            select_parts.append(_quote(dim))
        column_infos.append(ColumnInfo(field=dim, type="dimension"))

    # Measures — flat aggregation (always from fact table)
    def _qualify_measure(m: MeasureDef) -> str:
        col_name = _validate_identifier(m.field)
        prefix = "f." if use_aliases else ""
        col = f'{prefix}"{col_name}"'
        agg = m.aggregation.upper()
        allowed_aggs = {"SUM", "AVG", "COUNT", "MIN", "MAX"}
        if agg not in allowed_aggs:
            raise ValueError(f"Unsupported aggregation: {m.aggregation!r}")
        return f"{agg}({col})"

    if not request.column_dimension:
        for m in request.measures:
            expr = _qualify_measure(m)
            label = m.label or f"{m.field}_{m.aggregation}"
            select_parts.append(f"{expr} AS {_quote(label)}")
            column_infos.append(ColumnInfo(field=label, type="measure"))
    else:
        # Conditional aggregation pivot
        col_dim = request.column_dimension
        pivot_values = _get_pivot_values(dataset_id, col_dim, filters)
        for pval in pivot_values:
            for m in request.measures:
                agg = m.aggregation.upper()
                col_name = _validate_identifier(m.field)
                prefix = "f." if use_aliases else ""
                col = f'{prefix}"{col_name}"'
                col_dim_name = _validate_identifier(col_dim)
                col_dim_q = f'{prefix}"{col_dim_name}"'
                expr = f"{agg}(CASE WHEN {col_dim_q} = ? THEN {col} END)"
                params.append(pval)
                label = f"{pval}__{m.field}"
                select_parts.append(f"{expr} AS {_quote(label)}")
                column_infos.append(ColumnInfo(field=label, type="measure"))

    # --- GROUP BY (must match SELECT expressions for dimensions) ---
    group_by_parts: list[str] = []
    for dim in request.row_dimensions:
        col_name = _validate_identifier(dim)
        if dim in alias_map:
            group_by_parts.append(f'{alias_map[dim]}."{col_name}"')
        elif use_aliases:
            group_by_parts.append(f'f."{col_name}"')
        else:
            group_by_parts.append(_quote(dim))

    # --- WHERE ---
    where_sql = f"WHERE {filter_clause}" if filter_clause else ""

    # --- FROM clause with optional JOINs ---
    scenario_cte = ""
    if use_aliases:
        from_clause = f"{view} AS f {join_sql}"
    else:
        from_clause = view

    if scenario_ids:
        # Build UNION ALL of base + scenarios, each stamped with data_layer
        # Then we take COALESCE(scenario_val, actual_val) aggregated
        # Simplified: just query actuals for now; scenario merge handled by scenario_engine
        logger.debug("Scenario merging for pivot requested but using base view only for SQL build")

    # --- ORDER BY ---
    order_parts: list[str] = []
    if request.sort_by:
        field = request.sort_by.get("field", "")
        direction = request.sort_by.get("direction", "asc").upper()
        if direction not in ("ASC", "DESC"):
            direction = "ASC"
        if field and _SAFE_IDENTIFIER_RE.match(field):
            order_parts.append(f"{_quote(field)} {direction}")

    order_sql = f"ORDER BY {', '.join(order_parts)}" if order_parts else ""

    # --- ROLLUP totals ---
    if request.include_totals and group_by_parts:
        group_by_sql = f"GROUP BY ROLLUP ({', '.join(group_by_parts)})"
    elif group_by_parts:
        group_by_sql = f"GROUP BY {', '.join(group_by_parts)}"
    else:
        group_by_sql = ""

    # --- LIMIT / OFFSET ---
    limit_sql = f"LIMIT {request.limit} OFFSET {request.offset}"

    sql = (
        f"SELECT {', '.join(select_parts)} "
        f"FROM {from_clause} "
        f"{where_sql} "
        f"{group_by_sql} "
        f"{order_sql} "
        f"{limit_sql}"
    ).strip()

    return sql, params


def _count_sql(dataset_id: str, filters: dict[str, list[str]]) -> tuple[str, list[Any]]:
    """Build a COUNT(*) query for total row count (before LIMIT)."""
    view = view_name_for(dataset_id)
    filter_clause, params = _build_filter_clause(filters)
    where = f"WHERE {filter_clause}" if filter_clause else ""
    sql = f"SELECT COUNT(*) AS total FROM {view} {where}"
    return sql, list(params)


def execute_pivot(
    request: PivotRequest,
    dataset_id: str,
    scenario_ids: list[str] | None = None,
    relationships: list | None = None,
) -> PivotResponse:
    """Build and execute the pivot query, returning a PivotResponse."""
    t0 = time.perf_counter()

    # Build SELECT
    sql, params = build_pivot_sql(request, dataset_id, scenario_ids, relationships)
    logger.debug("Pivot SQL: %s | params=%s", sql, params)

    rows = execute_query(sql, params if params else None)

    # Count total (without LIMIT)
    count_sql, count_params = _count_sql(dataset_id, request.filters or {})
    count_rows = execute_query(count_sql, count_params if count_params else None)
    total_count = count_rows[0]["total"] if count_rows else 0

    # Determine column order from first row or query structure
    if rows:
        columns = [ColumnInfo(field=k, type="dimension" if k in request.row_dimensions else "measure") for k in rows[0]]
    else:
        columns = []

    # Convert rows to list-of-lists for transport efficiency
    col_names = [c.field for c in columns]
    row_lists = [[row.get(c) for c in col_names] for row in rows]

    # Totals row (last row if ROLLUP used and all dims are None)
    totals: list[Any] | None = None
    if request.include_totals and row_lists:
        # ROLLUP produces a grand total row where GROUP BY columns are NULL
        last = rows[-1] if rows else {}
        if all(last.get(d) is None for d in request.row_dimensions):
            totals = row_lists[-1]
            row_lists = row_lists[:-1]

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    logger.info(
        "Pivot executed: %d rows returned, %d total, %dms",
        len(row_lists), total_count, elapsed_ms,
    )

    return PivotResponse(
        columns=columns,
        rows=row_lists,
        totals=totals,
        row_count=len(row_lists),
        total_row_count=total_count,
        query_ms=elapsed_ms,
    )
