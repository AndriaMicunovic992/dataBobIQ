from __future__ import annotations

import json
import logging
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
You are a financial data schema mapping expert. Your job is to analyze uploaded
ERP/accounting dataset columns and map them to a canonical financial schema.
Be precise, confident, and conservative — only map when you are reasonably sure.
"""

_MAX_SAMPLE_ROWS = 5
_MAX_COLUMNS_IN_PROMPT = 40


def _build_prompt(
    columns: list[dict],
    sample_rows: list[dict],
    fact_type_id: str,
    fact_type_def: dict | None,
) -> str:
    """Build a structured XML prompt for Claude."""
    col_xml_parts: list[str] = []
    for i, col in enumerate(columns[:_MAX_COLUMNS_IN_PROMPT]):
        samples = col.get("sample_values", [])[:3]
        samples_str = ", ".join(repr(v) for v in samples)
        col_xml_parts.append(
            f"  <column index=\"{i}\">\n"
            f"    <source_name>{col['source_name']}</source_name>\n"
            f"    <data_type>{col['data_type']}</data_type>\n"
            f"    <column_role>{col['column_role']}</column_role>\n"
            f"    <unique_count>{col.get('unique_count', '?')}</unique_count>\n"
            f"    <sample_values>{samples_str}</sample_values>\n"
            f"  </column>"
        )

    sample_rows_xml: list[str] = []
    for i, row in enumerate(sample_rows[:_MAX_SAMPLE_ROWS]):
        row_str = json.dumps(row, default=str, ensure_ascii=False)
        sample_rows_xml.append(f"  <row index=\"{i}\">{row_str}</row>")

    canonical_fields_xml = ""
    if fact_type_def:
        core = fact_type_def.get("core", {})
        expected = fact_type_def.get("expected", {})
        all_fields: list[dict] = (
            core.get("measures", [])
            + core.get("dimensions", [])
            + expected.get("measures", [])
            + expected.get("dimensions", [])
        )
        field_lines = []
        for f in all_fields:
            aliases = ", ".join(f.get("aliases", [])[:5])
            field_lines.append(
                f"  <field name=\"{f['name']}\" type=\"{f.get('type','text')}\" "
                f"description=\"{f.get('description','')}\" aliases=\"{aliases}\" />"
            )
        canonical_fields_xml = "\n".join(field_lines)

    prompt = f"""\
<task>Map the uploaded dataset columns to the canonical '{fact_type_id}' financial schema.</task>

<source_columns>
{chr(10).join(col_xml_parts)}
</source_columns>

<sample_data>
{chr(10).join(sample_rows_xml)}
</sample_data>

<canonical_schema fact_type="{fact_type_id}">
{canonical_fields_xml}
</canonical_schema>

<instructions>
1. For each source column that clearly maps to a canonical field, provide the mapping.
2. Only map columns you are confident about. Unmapped columns are fine.
3. Detect the sign convention: are expense amounts stored as negative numbers, positive, or mixed?
4. If there is an account hierarchy (account_group, account_type, p_and_l_line), list detected hierarchy levels.
5. Return ONLY valid JSON matching this exact schema — no explanation, no markdown:

{{
  "mappings": [
    {{"source": "<source_name>", "target": "<canonical_name>", "confidence": 0.0}}
  ],
  "sign_convention": "expenses_negative | expenses_positive | mixed | unknown",
  "detected_hierarchy": ["level1_field", "level2_field"],
  "notes": "optional free-text observations"
}}
</instructions>
"""
    return prompt


def _parse_response(text: str) -> dict:
    """Extract JSON from Claude's response."""
    text = text.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Attempt to find first { ... } block
        start = text.find("{")
        end = text.rfind("}") + 1
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end])
            except json.JSONDecodeError:
                pass
    logger.warning("Could not parse Claude mapping response as JSON")
    return {
        "mappings": [],
        "sign_convention": "unknown",
        "detected_hierarchy": [],
        "notes": "Parse error",
    }


async def ai_suggest_mapping(
    columns: list[dict],
    sample_rows: list[dict],
    fact_type_id: str,
    fact_type_def: dict | None,
) -> dict:
    """Call Claude Haiku to suggest column → canonical mappings.

    Returns a dict with shape:
        {
            mappings: [{source, target, confidence}],
            sign_convention: str,
            detected_hierarchy: list[str],
            notes: str,
        }

    Falls back to an empty mapping dict if no API key is configured or
    the call fails.
    """
    api_key = settings.anthropic_api_key_agent or settings.anthropic_api_key_chat
    if not api_key:
        logger.info("No Anthropic API key configured; skipping AI mapping")
        return {
            "mappings": [],
            "sign_convention": "unknown",
            "detected_hierarchy": [],
            "notes": "No API key configured",
        }

    try:
        import anthropic  # type: ignore[import-untyped]
    except ImportError:
        logger.warning("anthropic package not installed; skipping AI mapping")
        return {
            "mappings": [],
            "sign_convention": "unknown",
            "detected_hierarchy": [],
            "notes": "anthropic package not installed",
        }

    client = anthropic.AsyncAnthropic(api_key=api_key)
    prompt = _build_prompt(columns, sample_rows, fact_type_id, fact_type_def)

    try:
        response = await client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=2048,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_text = response.content[0].text if response.content else ""
        result = _parse_response(raw_text)
        logger.info(
            "AI mapping: %d mappings suggested for %d columns (fact_type=%s)",
            len(result.get("mappings", [])),
            len(columns),
            fact_type_id,
        )
        return result
    except Exception:
        logger.exception("Claude mapping call failed")
        return {
            "mappings": [],
            "sign_convention": "unknown",
            "detected_hierarchy": [],
            "notes": "API call failed",
        }
