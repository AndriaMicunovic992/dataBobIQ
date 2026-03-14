from __future__ import annotations

import json
import logging

from app.config import settings
from app.services.ai_context import build_schema_context

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
You are a financial data analyst. Analyze the provided dataset schema and return
structured insights about the data — relationships between columns, likely calculated
fields, data quality observations, and recommended KPI opportunities.
Respond ONLY with valid JSON matching the schema specified. No markdown, no explanation.
"""


def _build_analysis_prompt(
    dataset_id: str,
    context_xml: str,
) -> str:
    return f"""\
{context_xml}

<task>
Analyze this financial dataset and return a JSON object with these fields:

{{
  "inferred_fact_type": "financial_transactions | budget | payroll | other",
  "column_relationships": [
    {{"type": "hierarchy", "columns": ["parent_col", "child_col"], "note": "..."}},
    {{"type": "join_key", "columns": ["col_a", "col_b"], "note": "..."}}
  ],
  "likely_calculations": [
    {{"name": "gross_profit", "expression": "revenue - cogs", "note": "..."}}
  ],
  "data_quality_notes": ["note 1", "note 2"],
  "recommended_kpis": [
    {{"kpi_id": "revenue", "label": "Revenue", "expression": "SUM(amount) WHERE account_type = revenue"}}
  ],
  "sign_convention": "expenses_negative | expenses_positive | mixed | unknown",
  "notes": "any other observations"
}}
</task>
"""


def _parse_json_response(text: str) -> dict:
    """Extract and parse JSON from Claude's response."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        end = -1 if lines[-1].strip() == "```" else len(lines)
        text = "\n".join(lines[1:end])
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}") + 1
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end])
            except json.JSONDecodeError:
                pass
    logger.warning("Could not parse schema agent response as JSON")
    return {
        "inferred_fact_type": "unknown",
        "column_relationships": [],
        "likely_calculations": [],
        "data_quality_notes": ["Failed to parse AI response"],
        "recommended_kpis": [],
        "sign_convention": "unknown",
        "notes": "Parse error",
    }


async def analyze_schema(
    dataset_id: str,
    columns: list[dict],
    sample_rows: list[dict],
) -> dict:
    """One-shot Claude analysis of a dataset schema.

    Returns a structured dict with relationships, calculations, quality notes, and
    KPI recommendations. Falls back to an empty result if no API key is configured.
    """
    api_key = settings.anthropic_api_key_agent or settings.anthropic_api_key_chat
    if not api_key:
        logger.info("No Anthropic API key; skipping schema analysis")
        return {
            "inferred_fact_type": "unknown",
            "column_relationships": [],
            "likely_calculations": [],
            "data_quality_notes": [],
            "recommended_kpis": [],
            "sign_convention": "unknown",
            "notes": "No API key configured",
        }

    try:
        import anthropic  # type: ignore[import-untyped]
    except ImportError:
        logger.warning("anthropic package not installed; skipping schema analysis")
        return {
            "inferred_fact_type": "unknown",
            "column_relationships": [],
            "likely_calculations": [],
            "data_quality_notes": [],
            "recommended_kpis": [],
            "sign_convention": "unknown",
            "notes": "anthropic package not installed",
        }

    context_xml = build_schema_context(columns, sample_rows)
    prompt = _build_analysis_prompt(dataset_id, context_xml)

    client = anthropic.AsyncAnthropic(api_key=api_key)
    try:
        response = await client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=3000,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_text = response.content[0].text if response.content else ""
        result = _parse_json_response(raw_text)
        logger.info(
            "Schema analysis complete for dataset %s: fact_type=%s, %d KPIs suggested",
            dataset_id,
            result.get("inferred_fact_type"),
            len(result.get("recommended_kpis", [])),
        )
        return result
    except Exception:
        logger.exception("Schema agent API call failed for dataset %s", dataset_id)
        return {
            "inferred_fact_type": "unknown",
            "column_relationships": [],
            "likely_calculations": [],
            "data_quality_notes": ["AI analysis failed"],
            "recommended_kpis": [],
            "sign_convention": "unknown",
            "notes": "API call failed",
        }
