from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


def _xml_escape(text: str) -> str:
    """Escape special characters for XML attributes and content."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _format_number(value: float | int | None) -> str:
    """Format a number in a human-readable way (e.g. 12.5M, -890K)."""
    if value is None:
        return "?"
    abs_val = abs(value)
    sign = "-" if value < 0 else ""
    if abs_val >= 1_000_000:
        return f"{sign}{abs_val / 1_000_000:.1f}M"
    elif abs_val >= 1_000:
        return f"{sign}{abs_val / 1_000:.0f}K"
    else:
        return f"{value:.0f}"


async def build_ai_context(
    model_id: str,
    dataset_id: str,
    db_session: AsyncSession,
) -> str:
    """Build a rich XML <data_context> string for Claude system prompts.

    The context gives the AI full awareness of the semantic layer:
    - Datasets with dimensions (cardinality, top values) and measures (summary stats)
    - Sign conventions
    - KPI definitions
    - Knowledge entries
    - Glossary (derived from knowledge definitions)
    - Active scenarios

    Target: <4000 tokens for a typical model.
    """
    from app.models.metadata import (
        Dataset,
        DatasetColumn,
        KnowledgeEntry,
        KPIDefinition,
        Scenario,
        ScenarioRule,
    )
    from app.duckdb_engine import execute_query, view_name_for

    parts: list[str] = ["<data_context>"]

    # ------------------------------------------------------------------ #
    # All active datasets in this model                                    #
    # ------------------------------------------------------------------ #
    ds_result = await db_session.execute(
        select(Dataset).where(Dataset.model_id == model_id, Dataset.status == "active")
    )
    datasets = ds_result.scalars().all()

    for ds in datasets:
        tag = "dataset" if ds.fact_type != "custom" else "custom_dataset"
        parts.append(
            f'  <{tag} name="{_xml_escape(ds.name)}" fact_type="{ds.fact_type}" '
            f'rows="{ds.row_count or "?"}">'
        )

        # Fetch columns
        col_result = await db_session.execute(
            select(DatasetColumn).where(DatasetColumn.dataset_id == ds.id)
        )
        columns = col_result.scalars().all()

        # Match the frontend metadata_svc convention: any non-measure role
        # (attribute / time / key / dimension) is presented as a dimension to
        # the AI. Otherwise fact-table dimensions parsed as "attribute" never
        # reach the model and the agent reports "I can't see the dataset".
        dimensions = [
            c for c in columns
            if c.column_role in ("attribute", "time", "key", "dimension")
        ]
        measures = [c for c in columns if c.column_role == "measure"]

        # Dimensions with cardinality and top values
        if dimensions:
            parts.append("    <dimensions>")
            for dim in dimensions:
                display_name = dim.canonical_name or dim.source_name
                attrs = f'name="{_xml_escape(display_name)}" cardinality="{dim.unique_count or "?"}"'
                # Try to fetch top values from DuckDB (lightweight query)
                top_vals = ""
                try:
                    view = view_name_for(ds.id)
                    col_name = dim.canonical_name or dim.source_name
                    rows = execute_query(
                        f'SELECT DISTINCT "{col_name}" AS v FROM {view} '
                        f'WHERE "{col_name}" IS NOT NULL '
                        f'ORDER BY "{col_name}" LIMIT 8'
                    )
                    vals = [str(r["v"]) for r in rows]
                    if vals:
                        top_vals = ", ".join(vals)
                except Exception as exc:
                    logger.warning(
                        "Failed to fetch dimension values for %s.%s: %s",
                        ds.name, display_name, exc,
                    )
                if top_vals:
                    attrs += f' top_values="{_xml_escape(top_vals)}"'
                parts.append(f"      <dim {attrs}/>")
            parts.append("    </dimensions>")

        # Measures with summary stats
        if measures:
            parts.append("    <measures>")
            for meas in measures:
                display_name = meas.canonical_name or meas.source_name
                stats = ""
                try:
                    view = view_name_for(ds.id)
                    col_name = meas.canonical_name or meas.source_name
                    rows = execute_query(
                        f'SELECT SUM("{col_name}") AS s, MIN("{col_name}") AS mn, '
                        f'MAX("{col_name}") AS mx FROM {view}'
                    )
                    if rows:
                        r = rows[0]
                        stats = (
                            f'sum={_format_number(r.get("s"))}, '
                            f'min={_format_number(r.get("mn"))}, '
                            f'max={_format_number(r.get("mx"))}'
                        )
                except Exception as exc:
                    logger.warning(
                        "Failed to fetch measure stats for %s.%s: %s",
                        ds.name, display_name, exc,
                    )
                attrs = f'name="{_xml_escape(display_name)}" type="{meas.data_type}"'
                if stats:
                    attrs += f' stats="{stats}"'
                parts.append(f'      <measure {attrs}/>')
            parts.append("    </measures>")

        # Sign convention from mapping config
        if ds.mapping_config:
            sign = ds.mapping_config.get("sign_convention")
            if sign:
                parts.append(f"    <sign_convention>{_xml_escape(str(sign))}</sign_convention>")

        parts.append(f"  </{tag}>")

    # ------------------------------------------------------------------ #
    # KPI definitions                                                      #
    # ------------------------------------------------------------------ #
    kpi_result = await db_session.execute(
        select(KPIDefinition).where(KPIDefinition.model_id == model_id)
    )
    kpis = kpi_result.scalars().all()

    if kpis:
        parts.append("  <kpi_definitions>")
        for kpi in kpis:
            deps = ", ".join(kpi.depends_on or [])
            parts.append(
                f'    <kpi id="{kpi.kpi_id}" label="{_xml_escape(kpi.label)}" '
                f'type="{kpi.kpi_type}" depends_on="{deps}"/>'
            )
        parts.append("  </kpi_definitions>")

    # ------------------------------------------------------------------ #
    # Knowledge entries                                                    #
    # ------------------------------------------------------------------ #
    knowledge_result = await db_session.execute(
        select(KnowledgeEntry)
        .where(KnowledgeEntry.model_id == model_id)
        .order_by(KnowledgeEntry.created_at.desc())
        .limit(20)
    )
    knowledge = knowledge_result.scalars().all()

    if knowledge:
        parts.append("  <knowledge>")
        for entry in knowledge:
            plain = _xml_escape(entry.plain_text)
            parts.append(
                f'    <entry type="{entry.entry_type}" '
                f'confidence="{entry.confidence or "confirmed"}">'
                f"{plain}"
                f"</entry>"
            )
        parts.append("  </knowledge>")

    # ------------------------------------------------------------------ #
    # Glossary (derived from knowledge definitions)                        #
    # ------------------------------------------------------------------ #
    definitions = [e for e in (knowledge or []) if e.entry_type == "definition"]
    if definitions:
        parts.append("  <glossary>")
        for defn in definitions:
            content = defn.content or {}
            term = content.get("term", defn.plain_text.split("=")[0].strip() if "=" in defn.plain_text else "")
            applies_to = content.get("applies_to", {})
            if isinstance(applies_to, dict) and applies_to:
                col = applies_to.get("column", "")
                val = applies_to.get("value", "")
                maps_to = f'{col} = "{val}"' if col and val else ""
            else:
                maps_to = ""
            if term:
                attrs = f'phrase="{_xml_escape(str(term))}"'
                if maps_to:
                    attrs += f' maps_to=\'{_xml_escape(maps_to)}\''
                aliases = content.get("aliases", [])
                if aliases:
                    attrs += f' aliases="{_xml_escape(", ".join(str(a) for a in aliases))}"'
                parts.append(f"    <term {attrs}/>")
        parts.append("  </glossary>")

    # ------------------------------------------------------------------ #
    # Active scenarios                                                     #
    # ------------------------------------------------------------------ #
    scenario_result = await db_session.execute(
        select(Scenario).where(Scenario.model_id == model_id)
    )
    scenarios = scenario_result.scalars().all()

    if scenarios:
        parts.append(f'  <scenarios count="{len(scenarios)}">')
        for sc in scenarios:
            base_year = ""
            if sc.base_config and isinstance(sc.base_config, dict):
                base_year = str(sc.base_config.get("base_year", ""))
            rule_count = len(sc.rules) if sc.rules else 0
            attrs = f'id="{sc.id}" name="{_xml_escape(sc.name)}" rules="{rule_count}"'
            if base_year:
                attrs += f' base_year="{base_year}"'
            parts.append(f"    <scenario {attrs}/>")
        parts.append("  </scenarios>")

    parts.append("</data_context>")
    return "\n".join(parts)


def build_schema_context(columns: list[dict], sample_rows: list[dict]) -> str:
    """Build a lightweight XML schema context for one-shot analysis (no DB needed)."""
    parts: list[str] = ["<schema_context>", "  <columns>"]
    for col in columns:
        samples = ", ".join(repr(v) for v in (col.get("sample_values") or [])[:3])
        parts.append(
            f"    <column name=\"{col['source_name']}\" "
            f"type=\"{col.get('data_type', 'text')}\" "
            f"role=\"{col.get('column_role', 'attribute')}\" "
            f"unique_count=\"{col.get('unique_count', '?')}\" "
            f"samples=\"{samples}\" />"
        )
    parts.append("  </columns>")

    parts.append("  <sample_rows>")
    import json
    for i, row in enumerate(sample_rows[:5]):
        row_str = json.dumps(row, default=str, ensure_ascii=False)
        parts.append(f"    <row index=\"{i}\">{row_str}</row>")
    parts.append("  </sample_rows>")

    parts.append("</schema_context>")
    return "\n".join(parts)
