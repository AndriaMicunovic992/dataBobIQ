from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


async def build_ai_context(
    model_id: str,
    dataset_id: str,
    db_session: AsyncSession,
) -> str:
    """Build an XML context string for Claude with metadata, semantic layer, and knowledge.

    The context is injected into the system prompt so Claude has full awareness of:
    - The model's datasets, columns, fact type, and schema
    - Any KPI definitions
    - Saved knowledge entries
    - The canonical field mapping

    Returns an XML string.
    """
    from app.models.metadata import (
        Dataset,
        DatasetColumn,
        KnowledgeEntry,
        KPIDefinition,
    )

    parts: list[str] = ["<context>"]

    # ------------------------------------------------------------------ #
    # Dataset info                                                         #
    # ------------------------------------------------------------------ #
    result = await db_session.execute(
        select(Dataset).where(Dataset.id == dataset_id)
    )
    dataset = result.scalar_one_or_none()

    if dataset:
        parts.append(f"  <dataset id=\"{dataset.id}\" name=\"{dataset.name}\" "
                     f"fact_type=\"{dataset.fact_type}\" "
                     f"row_count=\"{dataset.row_count}\" "
                     f"data_layer=\"{dataset.data_layer}\">")

        # Columns
        col_result = await db_session.execute(
            select(DatasetColumn).where(DatasetColumn.dataset_id == dataset_id)
        )
        columns = col_result.scalars().all()

        if columns:
            parts.append("    <columns>")
            for col in columns:
                canonical = col.canonical_name or ""
                parts.append(
                    f"      <column source=\"{col.source_name}\" "
                    f"canonical=\"{canonical}\" "
                    f"type=\"{col.data_type}\" "
                    f"role=\"{col.column_role}\" "
                    f"unique_count=\"{col.unique_count or '?'}\" />"
                )
            parts.append("    </columns>")

        # Mapping config summary
        if dataset.mapping_config:
            mappings = dataset.mapping_config.get("mappings", [])
            if mappings:
                parts.append("    <column_mappings>")
                for m in mappings:
                    parts.append(
                        f"      <map source=\"{m.get('source', '')}\" "
                        f"target=\"{m.get('target', '')}\" "
                        f"confidence=\"{m.get('confidence', '?')}\" />"
                    )
                sign = dataset.mapping_config.get("sign_convention", "unknown")
                parts.append(f"      <sign_convention>{sign}</sign_convention>")
                parts.append("    </column_mappings>")

        parts.append("  </dataset>")
    else:
        parts.append(f"  <dataset id=\"{dataset_id}\" status=\"not_found\" />")

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
                f"    <kpi id=\"{kpi.kpi_id}\" label=\"{kpi.label}\" "
                f"type=\"{kpi.kpi_type}\" depends_on=\"{deps}\" />"
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
        parts.append("  <knowledge_base>")
        for entry in knowledge:
            plain = entry.plain_text.replace("<", "&lt;").replace(">", "&gt;")
            parts.append(
                f"    <entry type=\"{entry.entry_type}\" "
                f"source=\"{entry.source}\" "
                f"confidence=\"{entry.confidence or 'confirmed'}\">"
                f"{plain}"
                f"</entry>"
            )
        parts.append("  </knowledge_base>")

    parts.append("</context>")
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
