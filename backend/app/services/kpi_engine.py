from __future__ import annotations

import logging
import re
from graphlib import TopologicalSorter
from typing import Any

from app.duckdb_engine import execute_query

logger = logging.getLogger(__name__)

_SAFE_IDENTIFIER_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

# Supported aggregations for base_measure KPIs
_ALLOWED_AGGS = {"sum", "avg", "count", "min", "max", "count_distinct"}


def _quote(name: str) -> str:
    if not _SAFE_IDENTIFIER_RE.match(name):
        raise ValueError(f"Unsafe identifier: {name!r}")
    return f'"{name}"'


def _build_filter_sql(filter_dict: dict) -> tuple[str, list[Any]]:
    """Convert {field: value_or_list} to SQL WHERE fragment."""
    parts: list[str] = []
    params: list[Any] = []
    for field, spec in filter_dict.items():
        col = _quote(field)
        if isinstance(spec, list):
            phs = ", ".join("?" * len(spec))
            parts.append(f"{col} IN ({phs})")
            params.extend(spec)
        else:
            parts.append(f"{col} = ?")
            params.append(spec)
    return " AND ".join(parts), params


def compile_base_measure(
    kpi: dict,
    group_by: list[str] | None,
    filters: dict | None,
    dataset_view: str,
) -> tuple[str, list[Any]]:
    """Compile a base_measure KPI definition to a DuckDB SELECT.

    kpi["expression"] shape::
        {
            aggregation: "sum",
            field: "amount",
            filter: {account_type: ["revenue"]},  # additional KPI-level filters
        }

    Returns (sql, params).
    """
    expr = kpi.get("expression", {})
    if isinstance(expr, str):
        raise ValueError(f"base_measure KPI {kpi.get('kpi_id')} has string expression; expected dict")

    agg = expr.get("aggregation", "sum").lower()
    if agg not in _ALLOWED_AGGS:
        raise ValueError(f"Unsupported aggregation {agg!r} for KPI {kpi.get('kpi_id')}")

    field = expr.get("field", "amount")
    col = _quote(field)

    if agg == "count_distinct":
        agg_expr = f"COUNT(DISTINCT {col})"
    else:
        agg_expr = f"{agg.upper()}({col})"

    # Merge global filters + KPI-specific filters
    all_filters: dict[str, Any] = {}
    if filters:
        all_filters.update(filters)
    kpi_filter = expr.get("filter", {})
    if kpi_filter:
        all_filters.update(kpi_filter)

    filter_parts: list[str] = []
    params: list[Any] = []
    if all_filters:
        clause, p = _build_filter_sql(all_filters)
        filter_parts.append(clause)
        params.extend(p)

    where_sql = f"WHERE {' AND '.join(filter_parts)}" if filter_parts else ""

    # SELECT and GROUP BY
    group_cols = group_by or []
    select_dims = ", ".join(_quote(g) for g in group_cols)
    select_part = f"{select_dims}, " if select_dims else ""
    group_by_sql = f"GROUP BY {select_dims}" if select_dims else ""

    kpi_id = kpi.get("kpi_id", "value")
    sql = (
        f"SELECT {select_part}{agg_expr} AS {_quote(kpi_id)} "
        f"FROM {dataset_view} {where_sql} {group_by_sql}"
    )
    return sql, params


def resolve_evaluation_order(kpi_definitions: list[dict]) -> list[str]:
    """Topological sort of KPI dependency graph.

    Returns ordered list of kpi_ids (dependencies evaluated first).
    """
    graph: dict[str, set[str]] = {}
    kpi_ids = {k["kpi_id"] for k in kpi_definitions}

    for kpi in kpi_definitions:
        kid = kpi["kpi_id"]
        deps = set(kpi.get("depends_on") or [])
        # Only include deps that are in the KPI set (external refs ignored)
        graph[kid] = deps & kpi_ids

    ts = TopologicalSorter(graph)
    return list(ts.static_order())


def _evaluate_derived(
    expression: str,
    resolved: dict[str, float],
) -> float | None:
    """Evaluate a derived KPI expression using simpleeval.

    Falls back to 0 if simpleeval is not installed.
    """
    try:
        from simpleeval import EvalWithCompoundTypes, simple_eval  # type: ignore[import-untyped]
        return float(simple_eval(expression, names=resolved))
    except ImportError:
        logger.warning("simpleeval not installed; evaluating derived expression with eval()")
        try:
            return float(eval(expression, {"__builtins__": {}}, resolved))  # noqa: S307
        except Exception as exc:
            logger.error("Expression eval failed for %r: %s", expression, exc)
            return None
    except Exception as exc:
        logger.error("simpleeval failed for expression %r: %s", expression, exc)
        return None


def _format_value(value: float | None, fmt: dict | None) -> str | None:
    if value is None or fmt is None:
        return None
    fmt_type = fmt.get("type", "number")
    decimals = fmt.get("decimals", 2)
    try:
        if fmt_type == "currency":
            return f"{value:,.{decimals}f}"
        if fmt_type == "percentage":
            return f"{value:.{decimals}f}%"
        return f"{value:,.{decimals}f}"
    except Exception:
        return str(value)


def evaluate_kpis(
    kpi_definitions: list[dict],
    model_id: str,
    dataset_view: str,
    group_by: list[str] | None = None,
    filters: dict | None = None,
    scenario_id: str | None = None,
) -> list[dict]:
    """Evaluate a list of KPI definitions.

    Returns a list of KPIValue-like dicts:
        [{kpi_id, label, value, formatted, format, ...}]
    """
    if not kpi_definitions:
        return []

    # Order evaluations topologically so derived KPIs see their dependencies
    ordered_ids = resolve_evaluation_order(kpi_definitions)
    kpi_map = {k["kpi_id"]: k for k in kpi_definitions}

    resolved: dict[str, float] = {}  # kpi_id → scalar value (for derived)
    results: list[dict] = []

    for kpi_id in ordered_ids:
        kpi = kpi_map.get(kpi_id)
        if kpi is None:
            continue

        kpi_type = kpi.get("kpi_type", "base_measure")
        fmt = kpi.get("format")
        label = kpi.get("label", kpi_id)
        value: float | None = None
        error: str | None = None

        try:
            if kpi_type == "base_measure":
                sql, params = compile_base_measure(kpi, group_by, filters, dataset_view)
                rows = execute_query(sql, params if params else None)
                if rows:
                    raw = rows[0].get(kpi_id)
                    value = float(raw) if raw is not None else None
                resolved[kpi_id] = value or 0.0

            elif kpi_type == "derived":
                expr = kpi.get("expression", "")
                if not isinstance(expr, str):
                    raise ValueError(f"derived KPI {kpi_id} expression must be a string")
                value = _evaluate_derived(expr, resolved)
                resolved[kpi_id] = value or 0.0

            else:
                error = f"Unknown kpi_type: {kpi_type!r}"

        except Exception as exc:
            logger.exception("Failed to evaluate KPI %s: %s", kpi_id, exc)
            error = str(exc)
            resolved[kpi_id] = 0.0

        results.append({
            "kpi_id": kpi_id,
            "label": label,
            "value": value,
            "formatted": _format_value(value, fmt),
            "format": fmt,
            "error": error,
        })

    return results
