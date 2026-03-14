from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

from app.config import settings
from app.duckdb_engine import execute_query

logger = logging.getLogger(__name__)

_MAX_TOOL_ROUNDS = 8  # guard against infinite tool loops

# ------------------------------------------------------------------ #
# Tool definitions                                                     #
# ------------------------------------------------------------------ #

_DATA_TOOLS = [
    {
        "name": "query_data",
        "description": (
            "Execute a DuckDB SQL SELECT query against the dataset. "
            "The dataset is available as the view ds_<dataset_id>. "
            "Always use parameterized queries; never construct raw SQL from user input."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sql": {
                    "type": "string",
                    "description": "DuckDB SQL SELECT statement. Use the view name provided.",
                },
                "view_name": {
                    "type": "string",
                    "description": "The DuckDB view to query (e.g. ds_<dataset_id>).",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum rows to return (default 100, max 1000).",
                    "default": 100,
                },
            },
            "required": ["sql"],
        },
    },
    {
        "name": "list_dimension_values",
        "description": "List distinct values for a dimension column in the dataset.",
        "input_schema": {
            "type": "object",
            "properties": {
                "column": {"type": "string", "description": "Column name to list values for."},
                "filter": {
                    "type": "object",
                    "description": "Optional {column: value} filter to apply.",
                },
                "limit": {"type": "integer", "default": 50},
            },
            "required": ["column"],
        },
    },
    {
        "name": "save_knowledge",
        "description": "Save a discovered business insight or data mapping to the knowledge base.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entry_type": {
                    "type": "string",
                    "description": "Category: account_mapping | kpi_definition | business_rule | data_note",
                },
                "plain_text": {"type": "string", "description": "Human-readable description."},
                "content": {"type": "object", "description": "Structured JSON content."},
                "confidence": {"type": "string", "enum": ["confirmed", "inferred", "uncertain"]},
            },
            "required": ["entry_type", "plain_text"],
        },
    },
    {
        "name": "list_knowledge",
        "description": "Retrieve saved knowledge entries for the current model.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entry_type": {"type": "string", "description": "Filter by entry_type (optional)."},
                "limit": {"type": "integer", "default": 20},
            },
        },
    },
]

_SCENARIO_TOOLS = [
    {
        "name": "query_data",
        "description": "Execute a DuckDB SQL SELECT against the dataset view.",
        "input_schema": {
            "type": "object",
            "properties": {
                "sql": {"type": "string"},
                "limit": {"type": "integer", "default": 100},
            },
            "required": ["sql"],
        },
    },
    {
        "name": "list_dimension_values",
        "description": "List distinct values for a dimension column.",
        "input_schema": {
            "type": "object",
            "properties": {
                "column": {"type": "string"},
                "limit": {"type": "integer", "default": 50},
            },
            "required": ["column"],
        },
    },
    {
        "name": "create_scenario",
        "description": "Create a new what-if scenario.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "description": {"type": "string"},
            },
            "required": ["name"],
        },
    },
    {
        "name": "add_scenario_rule",
        "description": "Add a rule to an existing scenario.",
        "input_schema": {
            "type": "object",
            "properties": {
                "scenario_id": {"type": "string"},
                "name": {"type": "string"},
                "rule_type": {
                    "type": "string",
                    "enum": ["multiplier", "offset", "set_value"],
                },
                "target_field": {"type": "string", "default": "amount"},
                "adjustment": {
                    "type": "object",
                    "description": "{factor: 1.1} or {offset: -300000} or {value: 0}",
                },
                "filter_expr": {"type": "object"},
                "period_from": {"type": "string"},
                "period_to": {"type": "string"},
            },
            "required": ["scenario_id", "name", "rule_type", "adjustment"],
        },
    },
    {
        "name": "list_scenarios",
        "description": "List all scenarios for the current model.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "compare_scenarios",
        "description": "Compare actual vs scenario values by group.",
        "input_schema": {
            "type": "object",
            "properties": {
                "scenario_id": {"type": "string"},
                "group_by": {"type": "array", "items": {"type": "string"}},
                "value_field": {"type": "string", "default": "amount"},
            },
            "required": ["scenario_id"],
        },
    },
    {
        "name": "get_kpi_values",
        "description": "Evaluate KPIs for the model.",
        "input_schema": {
            "type": "object",
            "properties": {
                "kpi_ids": {"type": "array", "items": {"type": "string"}},
                "scenario_id": {"type": "string"},
            },
            "required": ["kpi_ids"],
        },
    },
    {
        "name": "list_knowledge",
        "description": "Retrieve saved knowledge entries.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entry_type": {"type": "string"},
                "limit": {"type": "integer", "default": 20},
            },
        },
    },
]


# ------------------------------------------------------------------ #
# Tool executor                                                        #
# ------------------------------------------------------------------ #

async def _execute_tool(
    tool_name: str,
    tool_input: dict,
    dataset_id: str,
    model_id: str,
) -> tuple[Any, str | None]:
    """Execute a chat tool call. Returns (result, event_type).

    event_type is used for SSE event naming (e.g. 'scenario_rules', 'knowledge_saved').
    """
    view = f"ds_{dataset_id}"

    if tool_name == "query_data":
        sql = tool_input.get("sql", "")
        limit = min(int(tool_input.get("limit", 100)), 1000)
        # Safety: only allow SELECT statements
        if not sql.strip().upper().startswith("SELECT"):
            return {"error": "Only SELECT statements are allowed"}, None
        # Replace view name placeholder if needed
        sql_safe = sql.replace("{{view}}", view).replace("{view}", view)
        # Append LIMIT if not present
        if "LIMIT" not in sql_safe.upper():
            sql_safe = f"{sql_safe.rstrip(';')} LIMIT {limit}"
        try:
            rows = execute_query(sql_safe)
            return {"rows": rows, "row_count": len(rows)}, None
        except Exception as exc:
            return {"error": str(exc)}, None

    elif tool_name == "list_dimension_values":
        col = tool_input.get("column", "")
        limit = min(int(tool_input.get("limit", 50)), 500)
        # Validate identifier
        import re
        if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', col):
            return {"error": f"Invalid column name: {col!r}"}, None
        sql = f'SELECT DISTINCT "{col}" FROM {view} WHERE "{col}" IS NOT NULL ORDER BY "{col}" LIMIT {limit}'
        try:
            rows = execute_query(sql)
            values = [r[col] for r in rows]
            return {"column": col, "values": values, "count": len(values)}, None
        except Exception as exc:
            return {"error": str(exc)}, None

    elif tool_name == "save_knowledge":
        return {
            "saved": True,
            "entry_type": tool_input.get("entry_type"),
            "plain_text": tool_input.get("plain_text"),
            "content": tool_input.get("content", {}),
            "confidence": tool_input.get("confidence", "inferred"),
            "_model_id": model_id,
            "_dataset_id": dataset_id,
        }, "knowledge_saved"

    elif tool_name == "list_knowledge":
        # Return placeholder; real implementation queries DB
        return {"entries": [], "note": "Knowledge retrieval requires DB session"}, None

    elif tool_name == "create_scenario":
        return {
            "scenario_created": True,
            "name": tool_input.get("name"),
            "description": tool_input.get("description"),
            "_model_id": model_id,
            "_dataset_id": dataset_id,
        }, "scenario_created"

    elif tool_name == "add_scenario_rule":
        return {
            "rule_added": True,
            **tool_input,
        }, "scenario_rules"

    elif tool_name == "list_scenarios":
        return {"scenarios": [], "note": "Scenario listing requires DB session"}, None

    elif tool_name == "compare_scenarios":
        from app.services.scenario_engine import compute_variance
        scenario_id = tool_input.get("scenario_id", "")
        group_by = tool_input.get("group_by", [])
        value_field = tool_input.get("value_field", "amount")
        try:
            result = compute_variance(dataset_id, scenario_id, group_by, value_field)
            return result, None
        except Exception as exc:
            return {"error": str(exc)}, None

    elif tool_name == "get_kpi_values":
        return {"kpi_values": [], "note": "KPI evaluation requires model KPI definitions"}, None

    else:
        return {"error": f"Unknown tool: {tool_name}"}, None


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

    system_prompt = f"""\
You are a CFO AI assistant helping explore financial data and build what-if scenarios.
You have access to DuckDB-powered analytics tools. The dataset is available as the view
ds_{dataset_id}. Always use parameterized, safe SQL. Be concise and data-driven.

{context}
"""

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
                    tool_name, tool_input, dataset_id, model_id
                )

                yield json.dumps({
                    "event": special_event or "tool_result",
                    "data": {"tool": tool_name, "result": result},
                })

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

        yield json.dumps({"event": "done", "data": None})

    except Exception as exc:
        logger.exception("Chat stream error: %s", exc)
        yield json.dumps({"event": "error", "data": str(exc)})
