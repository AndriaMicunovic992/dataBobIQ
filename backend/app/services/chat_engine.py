from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

from app.config import settings
from app.duckdb_engine import execute_query, view_name_for

logger = logging.getLogger(__name__)

_MAX_TOOL_ROUNDS = 8  # guard against infinite tool loops

# ------------------------------------------------------------------ #
# Tool definitions                                                     #
# ------------------------------------------------------------------ #

_DATA_TOOLS = [
    {
        "name": "query_data",
        "description": (
            "Query any dataset to explore its structure and values.\n\n"
            "Use to understand what data exists before saving knowledge. "
            "Set dataset_name to query a specific table."
        ),
        "input_schema": {
            "type": "object",
            "required": ["group_by", "value_column"],
            "properties": {
                "dataset_name": {"type": "string"},
                "group_by": {"type": "array", "items": {"type": "string"}},
                "value_column": {"type": "string"},
                "aggregation": {"type": "string", "enum": ["sum", "avg", "min", "max", "count"]},
                "filters": {"type": "object", "additionalProperties": {"type": "array", "items": {"type": "string"}}},
                "date_trunc": {
                    "type": "object",
                    "description": (
                        "Truncate date/timestamp columns to a coarser granularity before grouping. "
                        "Keys are column names that appear in group_by, values are granularity: "
                        "month, quarter, year, week, day. "
                        "Example: {\"period\": \"month\"} groups a date column by month."
                    ),
                    "additionalProperties": {"type": "string", "enum": ["day", "week", "month", "quarter", "year"]},
                },
                "order_by": {
                    "type": "string",
                    "description": (
                        "Column to order results by. Prefix with '-' for descending. "
                        "Default: descending by aggregated value. "
                        "Example: 'period' for chronological, '-sum_amount' for largest first."
                    ),
                },
            },
        },
    },
    {
        "name": "list_dimension_values",
        "description": (
            "Look up unique values for a column to understand the data.\n\n"
            "Use to discover what values exist before saving definitions. "
            "Set dataset_name for a specific table."
        ),
        "input_schema": {
            "type": "object",
            "required": ["column_name"],
            "properties": {
                "dataset_name": {"type": "string"},
                "column_name": {"type": "string"},
                "search": {"type": "string"},
            },
        },
    },
    {
        "name": "save_knowledge",
        "description": (
            "Save a piece of domain knowledge permanently.\n\n"
            "RULES:\n"
            "1. VERIFY with query_data or list_dimension_values before saving\n"
            "2. For complex entries, CONFIRM with the user first\n"
            "3. Make content PRECISE: include exact column names, operators, values\n"
            "4. Set confidence to 'suggested' by default (user confirms in Knowledge panel)\n\n"
            "CONTENT STRUCTURE BY TYPE:\n\n"
            "definition: {\n"
            "  term: 'revenue',\n"
            "  aliases: ['sales', 'Umsatz'],\n"
            "  applies_to: {column: 'account_type', operator: 'eq', value: 'revenue'},\n"
            "  includes_sign_convention: true,\n"
            "  sign_convention: 'positive values'\n"
            "}\n\n"
            "relationship: {\n"
            "  from_table: 'GL Entries', to_table: 'Chart of Accounts',\n"
            "  join_fields: [{from_field: 'hauptkonto', to_field: 'konto_nr', match_type: 'exact'}],\n"
            "  join_possible: true,\n"
            "  description: 'Direct FK join'\n"
            "}\n\n"
            "calculation: {\n"
            "  name: 'Gross Margin',\n"
            "  formula_display: '(Revenue - COGS) / Revenue * 100',\n"
            "  components: [\n"
            "    {id: 'rev', label: 'Revenue', aggregation: 'sum', value_column: 'amount',\n"
            "     filters: [{column: 'account_type', operator: 'eq', value: 'revenue'}]},\n"
            "    {id: 'cogs', label: 'COGS', aggregation: 'sum', value_column: 'amount',\n"
            "     filters: [{column: 'p_and_l_line', operator: 'eq', value: 'COGS'}]}\n"
            "  ]\n"
            "}\n\n"
            "note: {\n"
            "  subject: 'Company 99',\n"
            "  description: 'Internal elimination entity - exclude from external reports',\n"
            "  affects: {tables: ['GL Entries'], columns: ['entity']}\n"
            "}"
        ),
        "input_schema": {
            "type": "object",
            "required": ["entry_type", "content", "plain_text"],
            "properties": {
                "entry_type": {
                    "type": "string",
                    "enum": ["definition", "relationship", "calculation", "note", "transformation"],
                },
                "content": {
                    "type": "object",
                    "description": "Structured content. Shape depends on entry_type. See description for schemas.",
                },
                "plain_text": {
                    "type": "string",
                    "description": "One-line human-readable summary.",
                },
                "confidence": {
                    "type": "string",
                    "enum": ["confirmed", "suggested"],
                    "description": "Default: 'suggested'. Set 'confirmed' only when user explicitly validated.",
                },
            },
        },
    },
    {
        "name": "list_knowledge",
        "description": (
            "List existing knowledge entries. Check at the start of conversations "
            "to see what's already documented and avoid duplicates."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entry_type": {
                    "type": "string",
                    "enum": ["definition", "relationship", "calculation", "note", "transformation"],
                },
                "search": {"type": "string"},
            },
        },
    },
    {
        "name": "suggest_mapping",
        "description": (
            "Propose improved column mappings for a dataset.\n\n"
            "Use when you identify that a column should map to a different canonical name "
            "than the AI auto-detection chose."
        ),
        "input_schema": {
            "type": "object",
            "required": ["dataset_id", "mappings"],
            "properties": {
                "dataset_id": {"type": "string"},
                "mappings": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "source_column": {"type": "string"},
                            "target_field": {"type": "string"},
                            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                            "reasoning": {"type": "string"},
                        },
                    },
                },
            },
        },
    },
]

_SCENARIO_TOOLS = [
    {
        "name": "query_data",
        "description": (
            "Query the user's financial data with grouping and aggregation. "
            "Returns max 50 grouped rows.\n\n"
            "WHEN TO USE: When the user asks about totals, breakdowns, comparisons, "
            "or trends. Also use to VERIFY filter values before creating scenario rules.\n\n"
            "HOW TO USE:\n"
            "- Always include group_by — ungrouped queries return a single total\n"
            "- Use filters from the <glossary> to translate business terms to column values\n"
            "- Set dataset_name to query a specific table (defaults to main financial dataset)\n"
            "- For monthly/quarterly/yearly breakdowns, use date_trunc on date columns "
            "(e.g. date_trunc: {\"period\": \"month\"}). ALWAYS use date_trunc when the user "
            "asks for time-based aggregation — never group by raw date columns.\n\n"
            "COMMON MISTAKES:\n"
            "- Filtering on a column that doesn't exist — check <dimensions> first\n"
            "- Filtering on numeric account codes when a grouping column exists — always prefer "
            "grouping columns (account_group, reporting_h2) over raw codes (hauptkonto)\n"
            "- Forgetting to cast filter values to strings — all filter values are string arrays\n"
            "- Grouping by a raw date column instead of using date_trunc — produces too many rows"
        ),
        "input_schema": {
            "type": "object",
            "required": ["group_by", "value_column"],
            "properties": {
                "dataset_name": {
                    "type": "string",
                    "description": "Name of a specific dataset to query. Must match a name from <data_context>. Omit to query the main dataset.",
                },
                "group_by": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Columns to group by. Use dimension names from <data_context>.",
                },
                "value_column": {
                    "type": "string",
                    "description": "Numeric column to aggregate. Usually 'amount' for financial data.",
                },
                "aggregation": {
                    "type": "string",
                    "enum": ["sum", "avg", "min", "max", "count"],
                    "description": "Aggregation function. Default: sum.",
                },
                "filters": {
                    "type": "object",
                    "description": (
                        "Filter criteria. Each key is a column name, value is a list of allowed values. "
                        "All values must be strings. Example: {\"account_type\": [\"revenue\"]}"
                    ),
                    "additionalProperties": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "date_trunc": {
                    "type": "object",
                    "description": (
                        "Truncate date/timestamp columns to a coarser granularity before grouping. "
                        "Keys are column names that appear in group_by, values are granularity: "
                        "month, quarter, year, week, day. "
                        "Example: {\"period\": \"month\"} groups a date column by month."
                    ),
                    "additionalProperties": {"type": "string", "enum": ["day", "week", "month", "quarter", "year"]},
                },
                "order_by": {
                    "type": "string",
                    "description": (
                        "Column to order results by. Prefix with '-' for descending. "
                        "Default: descending by aggregated value. "
                        "Example: 'period' for chronological, '-sum_amount' for largest first."
                    ),
                },
            },
        },
    },
    {
        "name": "list_dimension_values",
        "description": (
            "Look up unique values for a dimension column. Returns up to 100 values "
            "with optional semantic labels (display names).\n\n"
            "WHEN TO USE:\n"
            "- Before creating scenario rules, to verify filter values exist\n"
            "- When the user asks 'what categories exist?'\n"
            "- When the <glossary> doesn't have a mapping for the user's term\n\n"
            "Use the search parameter to filter large value lists."
        ),
        "input_schema": {
            "type": "object",
            "required": ["column_name"],
            "properties": {
                "dataset_name": {
                    "type": "string",
                    "description": "Specific dataset to query. Omit for main dataset.",
                },
                "column_name": {
                    "type": "string",
                    "description": "Column to inspect.",
                },
                "search": {
                    "type": "string",
                    "description": "Substring filter (case-insensitive). Use to find specific values in large dimensions.",
                },
            },
        },
    },
    {
        "name": "create_scenario",
        "description": (
            "Create a new what-if scenario with one or more rules.\n\n"
            "CRITICAL RULES:\n"
            "1. ALWAYS include base_config with base_year\n"
            "2. EVERY rule MUST have a filter — NEVER apply to all rows\n"
            "3. Submit ALL rules in the rules array — don't split across calls\n"
            "4. For expense/cost offsets: NEGATE the amount\n"
            "   'Increase costs by 300K' -> offset: -300000 (costs are negative)\n"
            "   'Reduce costs by 300K' -> offset: +300000\n"
            "5. Multipliers handle sign automatically (1.10 x negative = more negative)\n\n"
            "BEFORE CALLING: Check list_scenarios for existing scenarios. "
            "If a relevant one exists, use add_scenario_rule instead.\n\n"
            "AFTER CALLING: Call compare_scenarios to show the user the impact."
        ),
        "input_schema": {
            "type": "object",
            "required": ["name", "base_config", "rules"],
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Descriptive scenario name, e.g. 'Revenue +10% (2026)'",
                },
                "base_config": {
                    "type": "object",
                    "required": ["base_year"],
                    "description": "Baseline configuration.",
                    "properties": {
                        "source": {
                            "type": "string",
                            "enum": ["actuals", "scenario"],
                            "description": "What to use as baseline. Default: actuals.",
                        },
                        "base_year": {
                            "type": "integer",
                            "description": "REQUIRED. The year to use as baseline, e.g. 2025.",
                        },
                        "source_scenario_id": {
                            "type": "string",
                            "description": "When source=scenario, the ID of the scenario to chain from.",
                        },
                    },
                },
                "color": {
                    "type": "string",
                    "description": "Hex color for charts. E.g. '#7c4dff'",
                },
                "rules": {
                    "type": "array",
                    "description": (
                        "One or more rules. Submit ALL rules in one call. "
                        "Each rule can optionally specify a dataset_id to target a specific dataset. "
                        "When omitted, the engine auto-resolves which dataset contains the "
                        "target_field and filter columns using the model's knowledge base and "
                        "dataset schemas."
                    ),
                    "items": {
                        "type": "object",
                        "required": ["name", "rule_type", "target_field"],
                        "properties": {
                            "name": {
                                "type": "string",
                                "description": "Human-readable rule name, e.g. 'Revenue growth 10%'",
                            },
                            "dataset_id": {
                                "type": "string",
                                "description": (
                                    "Optional. Target dataset ID for this rule. "
                                    "Omit to let the engine auto-resolve from the model's datasets."
                                ),
                            },
                            "rule_type": {
                                "type": "string",
                                "enum": ["multiplier", "offset"],
                            },
                            "target_field": {
                                "type": "string",
                                "description": "Which measure to modify. Usually 'amount'.",
                            },
                            "adjustment": {
                                "type": "object",
                                "description": "{factor: 1.10} for multiplier, {offset: -300000} for offset.",
                            },
                            "filter_expr": {
                                "type": "object",
                                "description": (
                                    "REQUIRED. Filter to specific rows. Keys are column names, "
                                    "values are arrays of allowed values. "
                                    "Example: {\"account_type\": [\"revenue\"]}"
                                ),
                                "additionalProperties": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                },
                            },
                            "period_from": {
                                "type": "string",
                                "description": "Start period YYYY-MM, e.g. '2026-01'",
                            },
                            "period_to": {
                                "type": "string",
                                "description": "End period YYYY-MM, e.g. '2026-12'",
                            },
                            "distribution": {
                                "type": "string",
                                "enum": ["proportional", "equal"],
                                "description": (
                                    "How to distribute offset across periods. "
                                    "'proportional' (default): weighted by baseline value. "
                                    "'equal': flat even split."
                                ),
                            },
                        },
                    },
                },
            },
        },
    },
    {
        "name": "add_scenario_rule",
        "description": (
            "Add one or more rules to an EXISTING scenario.\n\n"
            "Use this when the user says 'also add...', 'additionally...', "
            "'modify the scenario to include...'. Always call list_scenarios "
            "first to get the scenario_id."
        ),
        "input_schema": {
            "type": "object",
            "required": ["scenario_id", "rules"],
            "properties": {
                "scenario_id": {
                    "type": "string",
                    "description": "ID of the existing scenario.",
                },
                "rules": {
                    "type": "array",
                    "description": "Rules to add. Same schema as create_scenario rules.",
                    "items": {
                        "type": "object",
                        "required": ["name", "rule_type", "target_field"],
                        "properties": {
                            "name": {"type": "string"},
                            "rule_type": {"type": "string", "enum": ["multiplier", "offset"]},
                            "target_field": {"type": "string"},
                            "adjustment": {"type": "object"},
                            "filter_expr": {"type": "object"},
                            "period_from": {"type": "string"},
                            "period_to": {"type": "string"},
                            "distribution": {"type": "string", "enum": ["proportional", "equal"]},
                        },
                    },
                },
            },
        },
    },
    {
        "name": "list_scenarios",
        "description": (
            "List existing scenarios for the current model.\n\n"
            "ALWAYS call this BEFORE creating a new scenario to check if a "
            "relevant one already exists. Returns scenario IDs, names, rule counts, "
            "and base configurations."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "compare_scenarios",
        "description": (
            "Compare actuals vs one or more scenarios. Returns variance by dimension group.\n\n"
            "Call this AFTER creating or modifying a scenario to show the user the impact. "
            "Include meaningful group_by dimensions (period, account_group, cost_center)."
        ),
        "input_schema": {
            "type": "object",
            "required": ["scenario_ids", "group_by", "value_field"],
            "properties": {
                "scenario_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Scenario IDs to compare against actuals.",
                },
                "group_by": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Dimensions to group variance by.",
                },
                "value_field": {
                    "type": "string",
                    "description": "Measure to compare. Usually 'amount'.",
                },
                "filters": {
                    "type": "object",
                    "description": "Optional additional filters.",
                },
            },
        },
    },
    {
        "name": "get_kpi_values",
        "description": (
            "Evaluate P&L KPIs (Revenue, Gross Profit, EBITDA, margins).\n\n"
            "Use when the user asks about margins, profitability, or financial metrics. "
            "Pass scenario_id to see how a scenario affects KPIs."
        ),
        "input_schema": {
            "type": "object",
            "required": ["kpi_ids"],
            "properties": {
                "kpi_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "KPI identifiers: revenue, cogs, gross_profit, gross_margin, opex, ebitda, ebitda_margin",
                },
                "group_by": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional: group KPI values by dimension.",
                },
                "scenario_id": {
                    "type": "string",
                    "description": "Optional: compare KPI values with a scenario.",
                },
            },
        },
    },
    {
        "name": "list_knowledge",
        "description": (
            "List knowledge entries (definitions, relationships, calculations, notes).\n\n"
            "ALWAYS check this before creating scenario rules to find the correct "
            "filter columns and values for business terms like 'revenue' or 'COGS'.\n\n"
            "Also use when the user asks 'what do you know?' or 'what's in the knowledge base?'"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "entry_type": {
                    "type": "string",
                    "enum": ["definition", "relationship", "calculation", "note", "transformation"],
                    "description": "Optional: filter by type.",
                },
                "search": {
                    "type": "string",
                    "description": "Optional: search text.",
                },
            },
        },
    },
]


# ------------------------------------------------------------------ #
# Tool executor                                                        #
# ------------------------------------------------------------------ #

def _validate_identifier(name: str) -> bool:
    """Check that a column/table name is a safe SQL identifier."""
    import re
    return bool(re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', name))


_VALID_DATE_TRUNC = {"day", "week", "month", "quarter", "year"}


def _build_query_sql(view: str, tool_input: dict) -> str:
    """Build a DuckDB SQL query from structured query_data parameters."""
    group_by = tool_input.get("group_by", [])
    value_column = tool_input.get("value_column", "amount")
    aggregation = tool_input.get("aggregation", "sum").upper()
    filters = tool_input.get("filters", {})
    date_trunc = tool_input.get("date_trunc", {})

    # Validate identifiers
    for col in group_by:
        if not _validate_identifier(col):
            raise ValueError(f"Invalid column name: {col!r}")
    if not _validate_identifier(value_column):
        raise ValueError(f"Invalid value column: {value_column!r}")
    if aggregation not in ("SUM", "AVG", "MIN", "MAX", "COUNT"):
        raise ValueError(f"Invalid aggregation: {aggregation!r}")
    for col, gran in date_trunc.items():
        if not _validate_identifier(col):
            raise ValueError(f"Invalid date_trunc column: {col!r}")
        if gran not in _VALID_DATE_TRUNC:
            raise ValueError(f"Invalid date_trunc granularity: {gran!r}")

    # Build SELECT and GROUP BY expressions, applying DATE_TRUNC where requested.
    select_exprs: list[str] = []
    group_exprs: list[str] = []
    for col in group_by:
        if col in date_trunc:
            gran = date_trunc[col]
            expr = f"DATE_TRUNC('{gran}', \"{col}\") AS \"{col}\""
            group_ref = f"DATE_TRUNC('{gran}', \"{col}\")"
        else:
            expr = f'"{col}"'
            group_ref = f'"{col}"'
        select_exprs.append(expr)
        group_exprs.append(group_ref)

    agg_expr = f'{aggregation}("{value_column}") AS {aggregation.lower()}_{value_column}'
    select_exprs.append(agg_expr)
    sql = f"SELECT {', '.join(select_exprs)} FROM {view}"

    # WHERE clause from filters
    where_parts: list[str] = []
    for col_name, values in filters.items():
        if not _validate_identifier(col_name):
            raise ValueError(f"Invalid filter column: {col_name!r}")
        if isinstance(values, list) and values:
            escaped = ", ".join(f"'{v.replace(chr(39), chr(39)+chr(39))}'" for v in values)
            where_parts.append(f'"{col_name}" IN ({escaped})')
    if where_parts:
        sql += " WHERE " + " AND ".join(where_parts)

    # GROUP BY + ORDER BY
    if group_exprs:
        sql += f" GROUP BY {', '.join(group_exprs)}"

        order_by_raw = tool_input.get("order_by")
        if order_by_raw and isinstance(order_by_raw, str):
            desc = order_by_raw.startswith("-")
            col = order_by_raw.lstrip("-")
            agg_alias = f"{aggregation.lower()}_{value_column}"
            if col == agg_alias:
                sql += f" ORDER BY {agg_alias} {'DESC' if desc else 'ASC'}"
            elif _validate_identifier(col):
                sql += f' ORDER BY "{col}" {"DESC" if desc else "ASC"}'
        elif date_trunc:
            trunc_cols = [c for c in group_by if c in date_trunc]
            if trunc_cols:
                sql += f' ORDER BY "{trunc_cols[0]}" ASC'
            else:
                sql += f" ORDER BY {aggregation.lower()}_{value_column} DESC"
        else:
            sql += f" ORDER BY {aggregation.lower()}_{value_column} DESC"

    sql += " LIMIT 50"
    return sql


def _sanitize_value(val: Any) -> Any:
    """Convert non-JSON-serializable types (date, datetime, Decimal) to strings."""
    import datetime
    import decimal
    if isinstance(val, (datetime.date, datetime.datetime, datetime.time)):
        return val.isoformat()
    if isinstance(val, decimal.Decimal):
        return float(val)
    return val


def _sanitize_rows(rows: list[dict]) -> list[dict]:
    """Ensure all values in query result rows are JSON-serializable."""
    return [{k: _sanitize_value(v) for k, v in row.items()} for row in rows]


def _sanitize_rows_dict(d: dict) -> dict:
    """Recursively sanitize a nested dict/list structure for JSON serialization."""
    if isinstance(d, dict):
        return {k: _sanitize_rows_dict(v) for k, v in d.items()}
    if isinstance(d, list):
        return [_sanitize_rows_dict(item) for item in d]
    return _sanitize_value(d)


def _resolve_view_for_tool(
    tool_input: dict,
    default_dataset_id: str,
    dataset_map: dict[str, str] | None,
) -> str:
    """Resolve the DuckDB view name from tool_input's dataset_name or fall back to default."""
    ds_name = tool_input.get("dataset_name")
    if ds_name and dataset_map:
        # Try exact match first, then case-insensitive
        ds_id = dataset_map.get(ds_name)
        if not ds_id:
            lower_map = {k.lower(): v for k, v in dataset_map.items()}
            ds_id = lower_map.get(ds_name.lower())
        if ds_id:
            return view_name_for(ds_id)
        logger.warning("dataset_name %r not found in map, using default", ds_name)
    return view_name_for(default_dataset_id)


def _get_view_columns(view: str) -> list[str]:
    """Return column names for a DuckDB view (for error messages)."""
    try:
        rows = execute_query(f"SELECT column_name FROM (DESCRIBE {view})")
        return [r["column_name"] for r in rows]
    except Exception:
        return []


async def _execute_tool(
    tool_name: str,
    tool_input: dict,
    dataset_id: str,
    model_id: str,
    dataset_map: dict[str, str] | None = None,
) -> tuple[Any, str | None]:
    """Execute a chat tool call. Returns (result, event_type).

    event_type is used for SSE event naming (e.g. 'scenario_rules', 'knowledge_saved').
    """
    view = _resolve_view_for_tool(tool_input, dataset_id, dataset_map)

    if tool_name == "query_data":
        # Support both structured params (new) and raw SQL (legacy fallback)
        if "sql" in tool_input:
            # Legacy raw SQL path
            sql = tool_input["sql"]
            limit = min(int(tool_input.get("limit", 100)), 1000)
            if not sql.strip().upper().startswith("SELECT"):
                return {"error": "Only SELECT statements are allowed"}, None
            sql_safe = sql.replace("{{view}}", view).replace("{view}", view)
            if "LIMIT" not in sql_safe.upper():
                sql_safe = f"{sql_safe.rstrip(';')} LIMIT {limit}"
        else:
            # New structured query path
            try:
                sql_safe = _build_query_sql(view, tool_input)
            except ValueError as exc:
                cols = _get_view_columns(view)
                return {"error": str(exc), "available_columns": cols}, None
        try:
            rows = _sanitize_rows(execute_query(sql_safe))
            return {"rows": rows, "row_count": len(rows)}, None
        except Exception as exc:
            cols = _get_view_columns(view)
            return {"error": str(exc), "available_columns": cols}, None

    elif tool_name == "list_dimension_values":
        col = tool_input.get("column_name") or tool_input.get("column", "")
        search = tool_input.get("search", "")
        limit = min(int(tool_input.get("limit", 100)), 500)
        if not _validate_identifier(col):
            cols = _get_view_columns(view)
            return {"error": f"Invalid column name: {col!r}", "available_columns": cols}, None
        where_parts = [f'"{col}" IS NOT NULL']
        if search:
            escaped_search = search.replace("'", "''")
            where_parts.append(f'LOWER(CAST("{col}" AS VARCHAR)) LIKE \'%{escaped_search.lower()}%\'')
        where_clause = " AND ".join(where_parts)
        sql = f'SELECT DISTINCT "{col}" FROM {view} WHERE {where_clause} ORDER BY "{col}" LIMIT {limit}'
        try:
            rows = execute_query(sql)
            values = [_sanitize_value(r[col]) for r in rows]
            return {"column": col, "values": values, "count": len(values)}, None
        except Exception as exc:
            cols = _get_view_columns(view)
            return {"error": str(exc), "available_columns": cols}, None

    elif tool_name == "save_knowledge":
        from app.database import AsyncSessionLocal
        from app.models.metadata import KnowledgeEntry
        entry_type = tool_input.get("entry_type", "note")
        plain_text = tool_input.get("plain_text", "")
        content = tool_input.get("content", {})
        confidence = tool_input.get("confidence", "suggested")
        if not plain_text:
            return {"error": "plain_text is required"}, None
        try:
            async with AsyncSessionLocal() as db:
                entry = KnowledgeEntry(
                    model_id=model_id,
                    dataset_id=dataset_id,
                    entry_type=entry_type,
                    plain_text=plain_text,
                    content=content if isinstance(content, dict) else {"description": content},
                    confidence=confidence,
                    source="ai_agent",
                )
                db.add(entry)
                await db.commit()
                await db.refresh(entry)
                return {
                    "saved": True,
                    "id": entry.id,
                    "entry_type": entry.entry_type,
                    "plain_text": entry.plain_text,
                    "confidence": entry.confidence,
                }, "knowledge_saved"
        except Exception as exc:
            logger.exception("Failed to save knowledge entry: %s", exc)
            return {"error": f"Failed to save: {exc}"}, None

    elif tool_name == "list_knowledge":
        from app.database import AsyncSessionLocal
        from app.models.metadata import KnowledgeEntry
        from sqlalchemy import select as sa_select
        try:
            async with AsyncSessionLocal() as db:
                query = (
                    sa_select(KnowledgeEntry)
                    .where(KnowledgeEntry.model_id == model_id)
                    .order_by(KnowledgeEntry.created_at.desc())
                    .limit(30)
                )
                entry_type_filter = tool_input.get("entry_type")
                if entry_type_filter:
                    query = query.where(KnowledgeEntry.entry_type == entry_type_filter)
                search_text = tool_input.get("search")
                if search_text:
                    query = query.where(KnowledgeEntry.plain_text.ilike(f"%{search_text}%"))
                result = await db.execute(query)
                entries = result.scalars().all()
                return {
                    "entries": [
                        {
                            "id": e.id,
                            "entry_type": e.entry_type,
                            "plain_text": e.plain_text,
                            "content": e.content,
                            "confidence": e.confidence,
                            "source": e.source,
                        }
                        for e in entries
                    ],
                    "count": len(entries),
                }, None
        except Exception as exc:
            logger.exception("Failed to list knowledge: %s", exc)
            return {"error": f"Failed to list knowledge: {exc}"}, None

    elif tool_name == "suggest_mapping":
        return {
            "mapping_suggested": True,
            "dataset_id": tool_input.get("dataset_id"),
            "mappings": tool_input.get("mappings", []),
            "_model_id": model_id,
        }, "mapping_suggested"

    elif tool_name == "create_scenario":
        from app.database import AsyncSessionLocal
        from app.models.metadata import Scenario, ScenarioRule
        name = tool_input.get("name", "Untitled Scenario")
        base_config = tool_input.get("base_config", {})
        rules_input = tool_input.get("rules", [])
        color = tool_input.get("color")
        try:
            async with AsyncSessionLocal() as db:
                scenario = Scenario(
                    model_id=model_id,
                    name=name,
                    base_config=base_config,
                    color=color,
                )
                db.add(scenario)
                await db.flush()  # get scenario.id

                for i, r in enumerate(rules_input):
                    # Normalize rule format from agent (type/factor) to DB (rule_type/adjustment)
                    rule_type = r.get("rule_type") or r.get("type", "multiplier")
                    adjustment = r.get("adjustment", {})
                    if not adjustment:
                        if "factor" in r:
                            adjustment = {"factor": r["factor"]}
                        elif "offset" in r:
                            adjustment = {"offset": r["offset"]}
                        elif "value" in r:
                            adjustment = {"value": r["value"]}
                    rule = ScenarioRule(
                        scenario_id=scenario.id,
                        name=r.get("name", f"Rule {i + 1}"),
                        rule_type=rule_type,
                        target_field=r.get("target_field", "amount"),
                        adjustment=adjustment,
                        filter_expr=r.get("filter_expr") or r.get("filters"),
                        period_from=r.get("period_from"),
                        period_to=r.get("period_to"),
                        priority=i,
                    )
                    db.add(rule)

                await db.commit()
                await db.refresh(scenario)

                # Trigger recompute (off event loop to avoid blocking SSE)
                try:
                    from app.services.scenario_engine import recompute_scenario as recompute_svc
                    from app.config import settings as app_settings
                    from sqlalchemy import select as sa_select
                    from app.models.metadata import Dataset
                    ds_result = await db.execute(
                        sa_select(Dataset.id).where(
                            Dataset.model_id == model_id, Dataset.status == "active"
                        )
                    )
                    ds_ids = [row[0] for row in ds_result.all()]
                    # Re-fetch rules
                    from sqlalchemy.orm import selectinload
                    sc = await db.execute(
                        sa_select(Scenario)
                        .where(Scenario.id == scenario.id)
                        .options(selectinload(Scenario.rules))
                    )
                    sc_obj = sc.scalar_one()
                    rule_dicts = [
                        {
                            "name": rl.name, "rule_type": rl.rule_type,
                            "target_field": rl.target_field, "adjustment": rl.adjustment,
                            "filter_expr": rl.filter_expr, "period_from": rl.period_from,
                            "period_to": rl.period_to, "distribution": rl.distribution,
                        }
                        for rl in sc_obj.rules
                    ]
                    await asyncio.to_thread(
                        recompute_svc,
                        scenario_id=scenario.id, rules=rule_dicts,
                        model_id=model_id, data_dir=app_settings.data_dir,
                        dataset_ids=ds_ids,
                        base_config=sc_obj.base_config,
                    )
                except Exception as exc:
                    logger.warning("Recompute after create_scenario failed: %s", exc)

                return {
                    "scenario_created": True,
                    "scenario_id": scenario.id,
                    "name": scenario.name,
                    "rules_count": len(rules_input),
                }, "scenario_created"
        except Exception as exc:
            logger.exception("Failed to create scenario: %s", exc)
            return {"error": f"Failed to create scenario: {exc}"}, None

    elif tool_name == "add_scenario_rule":
        from app.database import AsyncSessionLocal
        from app.models.metadata import Scenario, ScenarioRule
        from sqlalchemy import select as sa_select
        from sqlalchemy.orm import selectinload
        scenario_id_input = tool_input.get("scenario_id", "")
        rules_input = tool_input.get("rules", [])
        if not scenario_id_input:
            return {"error": "scenario_id is required"}, None
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    sa_select(Scenario).where(Scenario.id == scenario_id_input)
                )
                scenario = result.scalar_one_or_none()
                if not scenario:
                    return {"error": f"Scenario {scenario_id_input} not found"}, None

                for i, r in enumerate(rules_input):
                    rule_type = r.get("rule_type") or r.get("type", "multiplier")
                    adjustment = r.get("adjustment", {})
                    if not adjustment:
                        if "factor" in r:
                            adjustment = {"factor": r["factor"]}
                        elif "offset" in r:
                            adjustment = {"offset": r["offset"]}
                        elif "value" in r:
                            adjustment = {"value": r["value"]}
                    rule = ScenarioRule(
                        scenario_id=scenario_id_input,
                        name=r.get("name", f"Rule {i + 1}"),
                        rule_type=rule_type,
                        target_field=r.get("target_field", "amount"),
                        adjustment=adjustment,
                        filter_expr=r.get("filter_expr") or r.get("filters"),
                        period_from=r.get("period_from"),
                        period_to=r.get("period_to"),
                        priority=i,
                    )
                    db.add(rule)
                await db.commit()

                # Trigger recompute (off event loop to avoid blocking SSE)
                try:
                    from app.services.scenario_engine import recompute_scenario as recompute_svc
                    from app.config import settings as app_settings
                    from app.models.metadata import Dataset
                    ds_result = await db.execute(
                        sa_select(Dataset.id).where(
                            Dataset.model_id == scenario.model_id,
                            Dataset.status == "active",
                        )
                    )
                    ds_ids = [row[0] for row in ds_result.all()]
                    sc = await db.execute(
                        sa_select(Scenario)
                        .where(Scenario.id == scenario_id_input)
                        .options(selectinload(Scenario.rules))
                    )
                    sc_obj = sc.scalar_one()
                    rule_dicts = [
                        {
                            "name": rl.name, "rule_type": rl.rule_type,
                            "target_field": rl.target_field, "adjustment": rl.adjustment,
                            "filter_expr": rl.filter_expr, "period_from": rl.period_from,
                            "period_to": rl.period_to, "distribution": rl.distribution,
                        }
                        for rl in sc_obj.rules
                    ]
                    await asyncio.to_thread(
                        recompute_svc,
                        scenario_id=scenario_id_input, rules=rule_dicts,
                        model_id=scenario.model_id, data_dir=app_settings.data_dir,
                        dataset_ids=ds_ids,
                        base_config=sc_obj.base_config,
                    )
                except Exception as exc:
                    logger.warning("Recompute after add_scenario_rule failed: %s", exc)

                return {
                    "rules_added": True,
                    "scenario_id": scenario_id_input,
                    "rules_count": len(rules_input),
                }, "scenario_rules"
        except Exception as exc:
            logger.exception("Failed to add scenario rules: %s", exc)
            return {"error": f"Failed to add rules: {exc}"}, None

    elif tool_name == "list_scenarios":
        from app.database import AsyncSessionLocal
        from app.models.metadata import Scenario
        from sqlalchemy import select as sa_select
        from sqlalchemy.orm import selectinload
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    sa_select(Scenario)
                    .where(Scenario.model_id == model_id)
                    .options(selectinload(Scenario.rules))
                    .order_by(Scenario.created_at.desc())
                )
                scenarios = result.scalars().all()
                return {
                    "scenarios": [
                        {
                            "id": s.id,
                            "name": s.name,
                            "rules_count": len(s.rules) if s.rules else 0,
                            "base_config": s.base_config,
                            "color": s.color,
                        }
                        for s in scenarios
                    ],
                    "count": len(scenarios),
                }, None
        except Exception as exc:
            logger.exception("Failed to list scenarios: %s", exc)
            return {"error": f"Failed to list scenarios: {exc}"}, None

    elif tool_name == "compare_scenarios":
        from app.services.scenario_engine import compute_variance
        from app.config import settings as app_settings
        scenario_ids = tool_input.get("scenario_ids", [])
        # Support single ID for backwards compat
        if not scenario_ids:
            sid = tool_input.get("scenario_id", "")
            scenario_ids = [sid] if sid else []
        group_by = tool_input.get("group_by", [])
        value_field = tool_input.get("value_field", "amount")
        try:
            results = []
            for sid in scenario_ids:
                result = compute_variance(
                    dataset_id, sid, group_by, value_field,
                    model_id=model_id,
                    data_dir=app_settings.data_dir,
                )
                results.append(_sanitize_rows_dict({"scenario_id": sid, **result}))
            return {"comparisons": results} if len(results) > 1 else results[0], None
        except Exception as exc:
            return {"error": str(exc)}, None

    elif tool_name == "get_kpi_values":
        return {"kpi_values": [], "note": "KPI evaluation requires model KPI definitions"}, None

    else:
        return {"error": f"Unknown tool: {tool_name}"}, None


# ------------------------------------------------------------------ #
# Agent system prompts                                                  #
# ------------------------------------------------------------------ #

_DATA_AGENT_SYSTEM_PROMPT = """\
You are the Data Understanding Agent for dataBobIQ, a CFO companion platform.

YOUR ROLE: Help the user document and understand their financial data. You are like \
a senior data engineer who just joined the company — methodical, precise, and curious. \
Your job is to build a knowledge base that makes the Scenario Agent effective.

{data_context}

BEHAVIORAL RULES:
1. VERIFY BEFORE YOU SAVE
   Never save knowledge based on assumptions alone. Before saving a definition,
   relationship, or calculation, query the actual data to confirm.

   BAD: User says "revenue is account 800000" -> immediately save
   GOOD: User says "revenue is account 800000" -> query to check if that account
   exists and has positive values -> confirm with user -> then save

2. ASK ONE THING AT A TIME
   When you have multiple questions, prioritize. Ask the most important one first.
   Wait for the answer before asking the next. Never dump 5 questions at once.

   Exception: after initial upload (onboarding), you may ask 3-4 numbered questions
   since the user expects an overview.

3. SAVE STRUCTURED KNOWLEDGE
   When you save knowledge, the content object must be PRECISE and COMPLETE:
   - Definitions: include the exact column name, operator, and value
   - Relationships: include both table names, join columns, and whether SQL join works
   - Calculations: include every component with its source table, aggregation, and filters

   BAD content: {{"term": "revenue", "description": "sales income"}}
   GOOD content: {{"term": "revenue", "aliases": ["sales", "Umsatz"],
     "applies_to": {{"column": "account_type", "operator": "eq", "value": "revenue"}}}}

4. EXPLORE BEFORE CONCLUDING
   When encountering a new dataset, use query_data and list_dimension_values to
   understand what's actually in the data before making claims about it.

5. CONFIRM BEFORE SAVING
   For anything non-obvious, summarize your understanding and ask the user to confirm
   before saving. "So personnel costs are accounts 400000-499999, stored as negative
   values. Is that correct?"

6. NOTICE PATTERNS AND ANOMALIES
   If you see unexpected patterns (all values zero for a period, suspiciously round
   numbers, duplicate accounts), mention them. The user may not know about data quality
   issues.

KNOWLEDGE TYPES AND WHEN TO USE EACH:
- "definition": When the user explains what a business term means and how to filter for it.
  Example: "Revenue means account_type = 'revenue'" or "COGS is reporting_h2 = 'Warenaufwand'"
- "relationship": When you discover or the user explains how two tables connect.
  Example: "GL entries join to chart of accounts on hauptkonto = konto_nr"
- "calculation": When the user defines a derived metric with a specific formula.
  Example: "Gross margin = (Revenue - COGS) / Revenue * 100"
- "note": When something is important context but doesn't fit other types.
  Example: "Company 99 is an internal elimination entity — exclude from reports"
- "transformation": When there's a data reshaping rule.
  Example: "Monthly hours need to be divided by working days to get FTE"

ONBOARDING FLOW (when message is "__ONBOARDING_START__"):
1. Brief intro: "I've analyzed your uploaded data. Here's what I found."
2. Summarize: tables, row counts, detected fact type, key columns
3. State what you're confident about: "The account column links to your chart of accounts"
4. Ask 3-4 SPECIFIC questions about things you couldn't determine:
   - Sign conventions: "Are expenses stored as negative values?"
   - Hierarchy: "Which column groups accounts into categories like Personnel, Material, Revenue?"
   - Relationships: "How does [table A] relate to [table B]?"
   - Business terms: "What do your team call the main cost categories?"
5. Number the questions so the user can reply to specific ones

QUERY STRATEGY — PUSH EVERYTHING TO DuckDB:
The analytics engine (DuckDB) is powerful. Always make the query do the work — never
fetch raw rows and aggregate them yourself in text.
- For time-based breakdowns, use date_trunc on date columns (e.g. date_trunc: {{"period": "month"}})
- Check <dimensions> for column types: type="date" columns support date_trunc

TOOL USAGE PATTERNS:
query_data: Use BEFORE saving knowledge to verify claims. Also use when the user asks
"what does X look like" or "show me the data for Y."
- Always include a group_by — don't just aggregate everything
- Limit to relevant columns — don't dump entire tables
- Use date_trunc for time-based grouping (monthly, quarterly, yearly)

list_dimension_values: Use when you need to see what values exist in a column.
- Use with search parameter when looking for specific values
- Use to verify filter values before saving definitions

save_knowledge: Use after verifying and (for complex items) confirming with the user.
- Always include a clear plain_text summary
- Structure the content object fully — don't leave fields empty
- Default confidence to "suggested" so the user can confirm in the Knowledge panel

list_knowledge: Use at the start of a conversation to see what's already been documented.
- Avoids saving duplicate entries
- Helps you build on existing knowledge rather than starting from scratch

suggest_mapping: Use when you identify better column mappings than the AI auto-detection.
- Only for the confirmed fact type's canonical columns

LANGUAGE: Match the user's language. If they write in German, respond in German.
If the data has German column names, use them naturally in your responses.
"""

_SCENARIO_AGENT_SYSTEM_PROMPT = """\
You are the Scenario Agent for dataBobIQ, a CFO companion platform.

YOUR ROLE: Help the CFO explore financial data and build what-if scenarios. You think \
like a financial planning analyst — structured around P&L concepts, precise about \
numbers, and always sanity-checking your work.

{data_context}

BEHAVIORAL RULES:
1. THINK IN P&L STRUCTURE
   When the user asks about their data, frame your answer around financial concepts:
   revenue, COGS, gross profit, operating expenses, EBITDA. Don't just return raw
   numbers — provide context. "Revenue was 12.5M in 2025, down 3% from 2024."

2. ALWAYS FILTER SCENARIO RULES
   NEVER create a scenario rule without a filter. Every rule must target specific
   rows. "Increase revenue by 10%" means ONLY revenue rows get the multiplier —
   not costs, not expenses, not everything.

   Before creating any rule:
   a) Check <knowledge> and <glossary> for the correct filter column and values
   b) If not found, call list_dimension_values to find the right filter
   c) If still unclear, ASK the user: "Which column and value identifies revenue in your data?"

3. VERIFY FILTER EFFECTIVENESS
   After identifying a filter, use query_data to check:
   - How many rows does it match? (If 0 -> filter is wrong)
   - Does it match ALL rows? (If yes -> filter is probably wrong for a subset rule)
   - What's the total amount? (Sanity check: does it look like revenue?)

4. RESPECT SIGN CONVENTIONS
   Check <knowledge> for sign conventions. Common patterns:
   - Expenses as negative: "increase costs by 300K" -> offset = -300000
   - Revenue as positive: "increase revenue by 300K" -> offset = +300000
   - Multipliers handle sign automatically: 1.10 x negative = more negative

5. SCENARIO MANAGEMENT
   Before creating a new scenario:
   a) Call list_scenarios to check what exists
   b) If the user says "also..." or "add..." -> add to EXISTING scenario
   c) Only create new when explicitly asked

   Every new scenario MUST have base_config with base_year.
   If user hasn't specified: "Which year should I use as the baseline?"

6. SHOW YOUR WORK
   When answering data questions:
   - State what you queried
   - Show the key numbers
   - Provide context (comparisons, percentages, trends)

   When creating scenarios:
   - Explain each rule you're creating
   - Show the impact preview
   - Flag any warnings (zero rows matched, all rows matched)

7. MULTI-TABLE AWARENESS & MODEL-LEVEL SCENARIOS
   Scenarios are MODEL-LEVEL — they span ALL datasets in the model, not just
   one table. When creating scenario rules:
   - Each rule can optionally include a dataset_id to target a specific dataset
   - When omitted, the engine auto-resolves which dataset contains the
     target field and filter columns
   - Use knowledge entries (especially "relationship" type) to understand how
     datasets connect — e.g. GL Entries joined to Chart of Accounts
   - For cross-table scenarios, create multiple rules targeting different datasets
   - Use dataset_name parameter in query_data to explore specific tables
   - Don't assume all measures come from the same table

8. KNOWLEDGE-DRIVEN SCENARIO BUILDING
   ALWAYS consult the knowledge base before building scenarios:
   - "definition" entries tell you which columns/values map to business terms
     (e.g. "revenue" = account_type: "revenue")
   - "relationship" entries tell you how datasets join together
   - "calculation" entries define KPI formulas with their component filters
   - "note" entries contain business context (e.g. "Company 99 is internal elimination")
   - "transformation" entries describe data transformations
   Use this knowledge to build accurate filters and understand data relationships.

9. SUBMIT ALL RULES AT ONCE
   When creating multiple rules for a scenario, submit them ALL in a single
   create_scenario call. Never split rules across multiple calls.

QUERY STRATEGY — PUSH EVERYTHING TO DuckDB:
The analytics engine (DuckDB) is extremely powerful. ALWAYS make the query do the work.
NEVER fetch raw rows and aggregate them in your text response.

- Time-based questions ("monthly revenue", "quarterly costs", "yearly trend"):
  Use date_trunc on the date column. Example: group_by: ["period"], date_trunc: {{"period": "month"}}
  This returns one row per month with the correct aggregate — not hundreds of raw rows.
- Comparisons ("revenue vs COGS", "this year vs last"): Use filters and group_by to get
  exactly the comparison rows you need. Don't fetch everything and filter in text.
- Top-N questions ("biggest expense categories"): Use group_by and the default ORDER BY
  (descending by aggregated value) — the first rows are the top items.
- The query already limits to 50 rows. If you still get too many rows, add filters or
  use coarser date_trunc granularity.

Check <dimensions> to see column types. Columns with type="date" or type="timestamp"
support date_trunc. Columns with role="time" are date/period columns.

TOOL USAGE PATTERNS:
query_data: Primary tool for answering "how much", "what's the total", "compare X and Y"
- Always group by relevant dimensions
- Use filters from the glossary/knowledge for business terms
- Set dataset_name when querying non-default tables
- Use date_trunc for ANY time-based aggregation (monthly, quarterly, yearly)
- Use order_by when you need chronological or custom ordering

list_dimension_values: Use to find filter values before creating rules
- Check what values exist before assuming
- Use search parameter for large dimension tables

create_scenario: Create new scenario with rules
- Scenarios are model-level: no dataset_id required on the scenario itself
- ALWAYS include base_config with base_year
- Include ALL rules in the rules array
- Each rule must have a filter (unless deliberately applying to all)
- Each rule can optionally include dataset_id to target a specific dataset
- When dataset_id is omitted, the engine auto-resolves from the model's datasets

add_scenario_rule: Add rules to an existing scenario
- Pass scenario_id from list_scenarios
- Used when user says "also add..." or "modify..."

list_scenarios: Check existing scenarios before creating new ones
- Always call this first when user mentions scenarios
- Helps avoid duplicates

compare_scenarios: Show actual vs scenario variance
- Use after creating/modifying a scenario to show impact
- Include meaningful group_by (period, department, account_group)

get_kpi_values: Evaluate P&L KPIs
- Use when user asks about margins, EBITDA, etc.
- Pass scenario_id to see how a scenario affects KPIs

list_knowledge: Check for business term definitions
- ALWAYS check before creating scenario rules
- Find the correct filter columns and values for terms like "revenue", "COGS", etc.
- Use relationship knowledge to understand cross-dataset joins

DECISION TREE FOR SCENARIO CREATION:
User says "increase revenue by 10% for 2026":
1. Call list_knowledge -> find definition for "revenue"
   -> Found: account_type = "revenue"
2. Call list_scenarios -> check if relevant scenario exists
   -> No matching scenario
3. Call query_data with filter {{account_type: ["revenue"]}} group_by [fiscal_period]
   -> Confirms filter works: 12 periods, total = 12.5M
4. Create scenario:
   name: "Revenue +10% (2026)"
   base_config: {{source: "actuals", base_year: 2025}}
   rules: [{{
     name: "Revenue growth 10%",
     type: "multiplier",
     factor: 1.10,
     filters: {{account_type: ["revenue"]}},
     period_from: "2026-01",
     period_to: "2026-12",
     distribution: "proportional"
   }}]
5. After creation -> call compare_scenarios to show impact

COMMON MISTAKES TO AVOID:
- Creating a rule with no filter (affects entire P&L)
- Using the wrong sign for offsets on expenses
- Forgetting to set base_year
- Creating a new scenario when user meant to add to existing one
- Guessing filter values instead of checking with list_dimension_values
- Not checking existing knowledge before looking up filters

LANGUAGE: Match the user's language. If discussing German data, use German terms
naturally but explain in whichever language the user is using.
"""


# ------------------------------------------------------------------ #
# Main streaming chat function                                         #
# ------------------------------------------------------------------ #

async def stream_chat(
    message: str,
    dataset_id: str,
    model_id: str,
    history: list[dict],
    context: str,
    agent_mode: str = "data",
    dataset_map: dict[str, str] | None = None,
) -> AsyncGenerator[str, None]:
    """SSE streaming chat with Claude tool-use loop.

    Yields JSON-encoded SSE data strings. Caller wraps them in SSE format.

    Event types:
        text_delta          — partial text from Claude
        tool_executing      — tool is about to be called
        tool_result         — tool execution result
        scenario_rules      — scenario rule was added
        knowledge_saved     — knowledge was saved
        done                — conversation turn complete
        error               — unrecoverable error
    """
    api_key = settings.anthropic_api_key_chat or settings.anthropic_api_key_agent
    if not api_key:
        yield json.dumps({"event": "error", "data": "No Anthropic API key configured"})
        return

    try:
        import anthropic  # type: ignore[import-untyped]
    except ImportError:
        yield json.dumps({"event": "error", "data": "anthropic package not installed"})
        return

    tools = _SCENARIO_TOOLS if agent_mode == "scenario" else _DATA_TOOLS

    prompt_template = _SCENARIO_AGENT_SYSTEM_PROMPT if agent_mode == "scenario" else _DATA_AGENT_SYSTEM_PROMPT
    system_prompt = prompt_template.format(data_context=context)

    # Build message history
    messages: list[dict] = []
    for h in history:
        messages.append({"role": h.get("role", "user"), "content": h.get("content", "")})
    messages.append({"role": "user", "content": message})

    client = anthropic.AsyncAnthropic(api_key=api_key)

    try:
        for _round in range(_MAX_TOOL_ROUNDS):
            # Stream response
            full_text = ""
            tool_uses: list[dict] = []
            stop_reason: str | None = None

            async with client.messages.stream(
                model="claude-sonnet-4-5",
                max_tokens=4096,
                system=system_prompt,
                tools=tools,
                messages=messages,
            ) as stream:
                async for event in stream:
                    event_type = getattr(event, "type", None)

                    if event_type == "content_block_delta":
                        delta = getattr(event, "delta", None)
                        if delta and getattr(delta, "type", None) == "text_delta":
                            chunk = delta.text
                            full_text += chunk
                            yield json.dumps({"event": "text_delta", "data": chunk})

                    elif event_type == "content_block_start":
                        block = getattr(event, "content_block", None)
                        if block and getattr(block, "type", None) == "tool_use":
                            tool_uses.append({
                                "id": block.id,
                                "name": block.name,
                                "input": "",  # will be assembled from deltas
                            })

                    elif event_type == "content_block_stop":
                        pass  # tool input assembled below

                    elif event_type == "message_delta":
                        delta = getattr(event, "delta", None)
                        if delta:
                            stop_reason = getattr(delta, "stop_reason", stop_reason)

                # Get the final message for tool inputs
                final_msg = await stream.get_final_message()
                stop_reason = final_msg.stop_reason

                # Extract tool use blocks
                tool_uses = []
                for block in (final_msg.content or []):
                    if getattr(block, "type", None) == "tool_use":
                        tool_uses.append({
                            "id": block.id,
                            "name": block.name,
                            "input": block.input or {},
                        })

            if stop_reason != "tool_use" or not tool_uses:
                break

            # Execute tools
            tool_results: list[dict] = []
            for tu in tool_uses:
                tool_name = tu["name"]
                tool_input = tu["input"] if isinstance(tu["input"], dict) else {}

                yield json.dumps({
                    "event": "tool_executing",
                    "data": {"tool": tool_name, "input": tool_input},
                })

                result, special_event = await _execute_tool(
                    tool_name, tool_input, dataset_id, model_id,
                    dataset_map=dataset_map,
                )

                yield json.dumps({
                    "event": special_event or "tool_result",
                    "data": {"tool": tool_name, "result": result},
                }, default=str)

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tu["id"],
                    "content": json.dumps(result, default=str),
                })

            # Append assistant response + tool results to message history
            messages.append({
                "role": "assistant",
                "content": final_msg.content,
            })
            messages.append({
                "role": "user",
                "content": tool_results,
            })

        # Signal completion. The SSE generator wrapper also emits [DONE],
        # but this structured event lets the frontend set streaming=false
        # with a proper type check before the connection closes.
        yield json.dumps({"event": "done", "data": None})

    except Exception as exc:
        logger.exception("Chat stream error: %s", exc)
        yield json.dumps({"event": "error", "data": str(exc)})
