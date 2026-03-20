from __future__ import annotations

import logging
import re
from typing import Any

import polars as pl

from app.config import settings
from app.duckdb_engine import execute_query, get_duckdb_conn, register_dataset, view_name_for
from app.services.storage import get_parquet_path, get_scenario_path, write_parquet

logger = logging.getLogger(__name__)

_SAFE_IDENTIFIER_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def _cast_filter_value(value: Any, dtype: pl.DataType) -> Any:
    """Cast a filter value to match the target Polars column dtype.

    JSONB storage may convert numbers to strings; this ensures is_in()
    and equality checks work regardless.
    """
    if dtype.is_integer():
        if isinstance(value, list):
            return [int(v) for v in value]
        return int(value)
    if dtype.is_float():
        if isinstance(value, list):
            return [float(v) for v in value]
        return float(value)
    if dtype == pl.Boolean:
        if isinstance(value, list):
            return [bool(v) for v in value]
        return bool(value)
    # For strings and other types, convert to string
    if dtype == pl.Utf8 or dtype == pl.String:
        if isinstance(value, list):
            return [str(v) for v in value]
        return str(value)
    return value


def _build_filter_mask(filter_expr: dict, df: pl.DataFrame) -> pl.Expr:
    """Build a Polars boolean mask from a filter_expr dict, casting types to match columns."""
    mask: pl.Expr = pl.lit(True)
    for field, spec in filter_expr.items():
        if field not in df.columns:
            logger.warning("Filter field %s not in dataset, skipping", field)
            continue
        col_dtype = df.schema[field]
        try:
            casted = _cast_filter_value(spec, col_dtype)
        except (ValueError, TypeError) as exc:
            logger.warning("Cannot cast filter for %s (%s -> %s): %s", field, spec, col_dtype, exc)
            continue
        if isinstance(casted, list):
            mask = mask & pl.col(field).is_in(casted)
        else:
            mask = mask & (pl.col(field) == casted)
    return mask


def _quote(name: str) -> str:
    if not _SAFE_IDENTIFIER_RE.match(name):
        raise ValueError(f"Unsafe SQL identifier: {name!r}")
    return f'"{name}"'


def _build_filter_sql(filter_expr: dict | None) -> tuple[str, list[Any]]:
    """Convert a filter_expr dict to a SQL WHERE fragment with positional params.

    filter_expr shape: {field: value} or {field: [values]} or {field: {"op": op, "value": val}}
    """
    if not filter_expr:
        return "", []

    parts: list[str] = []
    params: list[Any] = []

    for field, spec in filter_expr.items():
        col = _quote(field)
        if isinstance(spec, list):
            placeholders = ", ".join("?" * len(spec))
            parts.append(f"{col} IN ({placeholders})")
            params.extend(spec)
        elif isinstance(spec, dict):
            op = spec.get("op", "=")
            val = spec.get("value")
            parts.append(f"{col} {op} ?")
            params.append(val)
        else:
            parts.append(f"{col} = ?")
            params.append(spec)

    return " AND ".join(parts), params


def apply_rule(
    dataset_id: str,
    scenario_id: str,
    rule: dict,
    model_id: str,
    data_dir: str,
) -> int:
    """Apply a single scenario rule to the baseline dataset.

    Reads the baseline Parquet, applies the rule, writes/appends to the
    scenario Parquet. Returns the number of affected rows.

    Rule dict shape (mirrors ScenarioRule ORM)::
        {
            rule_type: "multiplier" | "offset" | "set_value",
            target_field: "amount",
            adjustment: {"factor": 1.10} | {"offset": -300000} | {"value": 0},
            filter_expr: {col: val, ...},
            period_from: "2024-01",
            period_to: "2024-12",
        }
    """
    parquet_path = get_parquet_path(data_dir, model_id, dataset_id)
    df = pl.read_parquet(parquet_path)

    target_field = rule.get("target_field", "amount")
    rule_type = rule.get("rule_type", "multiplier")
    adjustment = rule.get("adjustment", {})
    filter_expr = rule.get("filter_expr") or {}
    period_from = rule.get("period_from")
    period_to = rule.get("period_to")

    # Build boolean mask using polars expressions
    mask = _build_filter_mask(filter_expr, df)

    # Period filter (if period column exists)
    if period_from or period_to:
        period_col = None
        for candidate in ("period", "date", "posting_date", "fiscal_period"):
            if candidate in df.columns:
                period_col = candidate
                break
        if period_col:
            if period_from:
                mask = mask & (pl.col(period_col).cast(pl.String) >= period_from)
            if period_to:
                mask = mask & (pl.col(period_col).cast(pl.String) <= period_to)

    # Count affected rows
    matching = df.filter(mask)
    affected = len(matching)

    if affected == 0:
        logger.info("Rule matched 0 rows for scenario %s, skipping write", scenario_id)
        return 0

    # Apply transformation
    if target_field not in df.columns:
        logger.warning("Target field %s not in dataset; no changes applied", target_field)
        return 0

    if rule_type == "multiplier":
        factor = adjustment.get("factor", 1.0)
        df = df.with_columns(
            pl.when(mask)
            .then(pl.col(target_field) * factor)
            .otherwise(pl.col(target_field))
            .alias(target_field)
        )
    elif rule_type == "offset":
        offset_val = adjustment.get("offset", 0.0)
        df = df.with_columns(
            pl.when(mask)
            .then(pl.col(target_field) + offset_val)
            .otherwise(pl.col(target_field))
            .alias(target_field)
        )
    elif rule_type == "set_value":
        new_val = adjustment.get("value", 0.0)
        df = df.with_columns(
            pl.when(mask)
            .then(pl.lit(new_val))
            .otherwise(pl.col(target_field))
            .alias(target_field)
        )
    else:
        logger.warning("Unknown rule_type %r; no changes applied", rule_type)
        return 0

    # Mark rows with scenario data_layer
    df = df.with_columns(
        pl.when(mask)
        .then(pl.lit(f"scenario:{scenario_id}"))
        .otherwise(pl.col("data_layer"))
        .alias("data_layer")
    )

    # Write scenario override Parquet (only the matching rows)
    override_df = df.filter(mask)
    scenario_path = get_scenario_path(data_dir, model_id, scenario_id)
    write_parquet(override_df, scenario_path)
    logger.info(
        "Applied rule (type=%s) to scenario %s: %d rows affected → %s",
        rule_type, scenario_id, affected, scenario_path,
    )
    return affected


def _resolve_dataset_for_rule(
    rule: dict,
    dataset_ids: list[str],
    model_id: str,
    data_dir: str,
) -> str | None:
    """Resolve which dataset a rule applies to.

    Priority:
    1. Explicit rule.dataset_id
    2. Find the first dataset whose Parquet contains the target_field column
    3. Fall back to first dataset
    """
    explicit = rule.get("dataset_id")
    if explicit:
        return explicit

    target_field = rule.get("target_field", "amount")
    filter_fields = list((rule.get("filter_expr") or {}).keys())
    check_fields = [target_field] + filter_fields

    for ds_id in dataset_ids:
        try:
            path = get_parquet_path(data_dir, model_id, ds_id)
            schema = pl.read_parquet_schema(path)
            cols = set(schema.keys()) if isinstance(schema, dict) else {f.name for f in schema}
            if target_field in cols:
                # Bonus: check filter fields match too
                if all(f in cols for f in filter_fields):
                    return ds_id
        except Exception:
            continue

    # Fallback: first dataset
    return dataset_ids[0] if dataset_ids else None


def _apply_rules_to_df(
    df: pl.DataFrame,
    rules: list[dict],
    scenario_id: str,
) -> tuple[pl.DataFrame, int]:
    """Apply a list of rules to a DataFrame in order. Returns (modified_df, total_affected)."""
    total_affected = 0

    for rule in rules:
        target_field = rule.get("target_field", "amount")
        rule_type = rule.get("rule_type", "multiplier")
        adjustment = rule.get("adjustment", {})
        filter_expr = rule.get("filter_expr") or {}

        mask = _build_filter_mask(filter_expr, df)

        affected = df.filter(mask).height
        total_affected += affected

        if target_field not in df.columns:
            logger.warning("Target field %s not in dataset; skipping rule", target_field)
            continue

        if rule_type == "multiplier":
            factor = adjustment.get("factor", 1.0)
            df = df.with_columns(
                pl.when(mask)
                .then(pl.col(target_field) * factor)
                .otherwise(pl.col(target_field))
                .alias(target_field)
            )
        elif rule_type == "offset":
            offset_val = adjustment.get("offset", 0.0)
            df = df.with_columns(
                pl.when(mask)
                .then(pl.col(target_field) + offset_val)
                .otherwise(pl.col(target_field))
                .alias(target_field)
            )
        elif rule_type == "set_value":
            new_val = adjustment.get("value", 0.0)
            df = df.with_columns(
                pl.when(mask)
                .then(pl.lit(new_val))
                .otherwise(pl.col(target_field))
                .alias(target_field)
            )

    df = df.with_columns(pl.lit(f"scenario:{scenario_id}").alias("data_layer"))
    return df, total_affected


def recompute_scenario(
    scenario_id: str,
    rules: list[dict],
    model_id: str,
    data_dir: str,
    dataset_ids: list[str] | None = None,
    dataset_id: str | None = None,
) -> int:
    """Recompute all scenario overrides from scratch.

    Supports multi-dataset scenarios: each rule may target a different dataset
    via its ``dataset_id`` key.  When a rule has no explicit dataset_id the
    engine auto-resolves by inspecting which dataset contains the target field
    and filter columns.

    For backward compat a single ``dataset_id`` can still be passed — it is
    used as the fallback when resolution fails.

    Returns total affected row count.
    """
    # Build the list of available dataset IDs
    all_ds_ids: list[str] = list(dataset_ids or [])
    if dataset_id and dataset_id not in all_ds_ids:
        all_ds_ids.insert(0, dataset_id)

    if not all_ds_ids:
        raise ValueError("No dataset_ids provided for scenario recompute")

    # Group rules by their resolved dataset
    from collections import defaultdict
    ds_rules: dict[str, list[dict]] = defaultdict(list)
    for rule in rules:
        resolved = _resolve_dataset_for_rule(rule, all_ds_ids, model_id, data_dir)
        if resolved:
            ds_rules[resolved].append(rule)
        else:
            logger.warning("Could not resolve dataset for rule %r; skipping", rule.get("name"))

    total_affected = 0
    result_frames: list[pl.DataFrame] = []

    for ds_id, ds_rule_list in ds_rules.items():
        parquet_path = get_parquet_path(data_dir, model_id, ds_id)
        try:
            df = pl.read_parquet(parquet_path)
        except Exception as exc:
            logger.warning("Cannot read parquet for dataset %s: %s", ds_id, exc)
            continue

        df, affected = _apply_rules_to_df(df, ds_rule_list, scenario_id)
        total_affected += affected
        result_frames.append(df)

    if not result_frames:
        logger.warning("No data produced for scenario %s", scenario_id)
        return 0

    # Concatenate all dataset results (they may have different schemas)
    # Use diagonal concat to handle differing columns across datasets
    if len(result_frames) == 1:
        combined = result_frames[0]
    else:
        combined = pl.concat(result_frames, how="diagonal")

    scenario_path = get_scenario_path(data_dir, model_id, scenario_id)
    write_parquet(combined, scenario_path)

    # Register in DuckDB
    register_dataset(f"sc_{scenario_id}", scenario_path)

    logger.info(
        "Recomputed scenario %s: %d rules across %d datasets, %d total affected rows",
        scenario_id, len(rules), len(ds_rules), total_affected,
    )
    return total_affected


def build_scenario_merge_sql(
    dataset_id: str,
    scenario_ids: list[str],
    group_by: list[str],
    value_field: str = "amount",
    filters: dict | None = None,
) -> tuple[str, list[Any]]:
    """Build a COALESCE-based merge SQL that overlays scenario values on actuals.

    Returns (sql, params).
    """
    params: list[Any] = []
    base_view = view_name_for(dataset_id)
    val_col = _quote(value_field)

    filter_parts: list[str] = []
    if filters:
        for field, spec in filters.items():
            col = _quote(field)
            if isinstance(spec, list):
                placeholders = ", ".join("?" * len(spec))
                filter_parts.append(f"{col} IN ({placeholders})")
                params.extend(spec)
            else:
                filter_parts.append(f"{col} = ?")
                params.append(spec)

    where_sql = f"WHERE {' AND '.join(filter_parts)}" if filter_parts else ""

    group_cols = ", ".join(_quote(g) for g in group_by)
    select_group = f"{group_cols}, " if group_cols else ""

    # Build CTE per scenario view
    cte_parts: list[str] = []
    scenario_selects: list[str] = []

    # Base actuals CTE
    actuals_cte = (
        f"actuals AS ("
        f"SELECT {select_group}SUM({val_col}) AS actual_{value_field} "
        f"FROM {base_view} {where_sql} "
        f"{'GROUP BY ' + group_cols if group_cols else ''})"
    )
    cte_parts.append(actuals_cte)

    for sc_id in scenario_ids:
        sc_view = view_name_for(f"sc_{sc_id}")  # -> "ds_sc_{uuid}" (quoted)
        sc_alias = f"sc_{sc_id.replace('-', '_')}"
        sc_cte = (
            f"{sc_alias} AS ("
            f"SELECT {select_group}SUM({val_col}) AS scenario_{value_field} "
            f"FROM {sc_view} {where_sql} "
            f"{'GROUP BY ' + group_cols if group_cols else ''})"
        )
        cte_parts.append(sc_cte)
        params.extend(params[: len(params) // (len(scenario_ids) + 1)])  # duplicate filter params

    # Final SELECT with COALESCE
    if scenario_ids:
        first_sc = f"sc_{scenario_ids[0].replace('-', '_')}"
        coalesce_expr = f"COALESCE({first_sc}.scenario_{value_field}, actuals.actual_{value_field})"
        join_clauses = ""
        for sc_id in scenario_ids:
            sc_alias = f"sc_{sc_id.replace('-', '_')}"
            on_clause = " AND ".join(f"actuals.{_quote(g)} = {sc_alias}.{_quote(g)}" for g in group_by) if group_by else "TRUE"
            join_clauses += f" LEFT JOIN {sc_alias} ON {on_clause}"

        select_cols = f"{', '.join('actuals.' + _quote(g) for g in group_by)}, " if group_by else ""
        sql = (
            f"WITH {', '.join(cte_parts)} "
            f"SELECT {select_cols}"
            f"actuals.actual_{value_field}, "
            f"{coalesce_expr} AS scenario_{value_field} "
            f"FROM actuals{join_clauses}"
        )
    else:
        sql = f"WITH {actuals_cte} SELECT * FROM actuals"

    return sql, params


def _ensure_scenario_view(scenario_id: str, model_id: str) -> None:
    """Make sure the DuckDB view for a scenario exists, re-registering from parquet if needed."""
    view_key = f"sc_{scenario_id}"
    view_name = view_name_for(view_key)
    conn = get_duckdb_conn()
    try:
        conn.execute(f"SELECT 1 FROM {view_name} LIMIT 0")
    except Exception:
        # View doesn't exist — try to register from parquet file on disk
        scenario_path = get_scenario_path(settings.data_dir, model_id, scenario_id)
        import os
        if os.path.exists(scenario_path):
            register_dataset(view_key, scenario_path)
            logger.info("Re-registered scenario view %s from %s", view_name, scenario_path)
        else:
            raise ValueError(
                f"Scenario {scenario_id} has no computed data. "
                f"Please recompute the scenario first."
            )


def compute_variance(
    dataset_id: str,
    scenario_id: str,
    group_by: list[str],
    value_field: str = "amount",
    filters: dict | None = None,
    model_id: str = "",
    data_dir: str = "",
) -> dict:
    """Compute actual vs scenario variance.

    Returns a dict with groups, totals, and delta information.
    """
    # Ensure scenario view is registered (may have been lost on server restart)
    _ensure_scenario_view(scenario_id, model_id)

    sql, params = build_scenario_merge_sql(
        dataset_id, [scenario_id], group_by, value_field, filters
    )

    rows = execute_query(sql, params if params else None)

    actual_key = f"actual_{value_field}"
    scenario_key = f"scenario_{value_field}"

    total_actual = 0.0
    total_scenario = 0.0
    groups: list[dict] = []

    for row in rows:
        actual = float(row.get(actual_key) or 0)
        scenario_val = float(row.get(scenario_key) or actual)
        delta = scenario_val - actual
        delta_pct = (delta / abs(actual) * 100) if actual != 0 else None

        total_actual += actual
        total_scenario += scenario_val

        group_vals = {g: row.get(g) for g in group_by}
        groups.append({
            "group": group_vals,
            "actual": actual,
            "scenario": scenario_val,
            "delta": delta,
            "delta_pct": delta_pct,
        })

    total_delta = total_scenario - total_actual
    total_delta_pct = (total_delta / abs(total_actual) * 100) if total_actual != 0 else None

    return {
        "groups": groups,
        "total_actual": total_actual,
        "total_scenario": total_scenario,
        "total_delta": total_delta,
        "total_delta_pct": total_delta_pct,
    }


def execute_waterfall(
    dataset_id: str,
    scenario_id: str,
    breakdown_field: str,
    value_field: str = "amount",
    filters: dict | None = None,
    model_id: str = "",
) -> list[dict]:
    """Execute a waterfall/bridge chart query comparing actuals to scenario.

    Returns a list of steps: {name, actual, scenario, delta, running_total, is_total}.
    """
    variance = compute_variance(
        dataset_id=dataset_id,
        scenario_id=scenario_id,
        group_by=[breakdown_field],
        value_field=value_field,
        filters=filters,
        model_id=model_id,
    )

    groups = variance["groups"]
    running = 0.0
    steps: list[dict] = []

    # Opening bar: actuals total
    steps.append({
        "name": "Actuals",
        "value": variance["total_actual"],
        "running_total": variance["total_actual"],
        "is_total": True,
        "delta_pct": None,
    })

    # One bar per group
    for g in groups:
        delta = g["delta"]
        running += delta
        steps.append({
            "name": str(g["group"].get(breakdown_field, "")),
            "value": delta,
            "running_total": variance["total_actual"] + running,
            "is_total": False,
            "delta_pct": g["delta_pct"],
        })

    # Closing bar: scenario total
    steps.append({
        "name": "Scenario",
        "value": variance["total_scenario"],
        "running_total": variance["total_scenario"],
        "is_total": True,
        "delta_pct": variance["total_delta_pct"],
    })

    return steps
