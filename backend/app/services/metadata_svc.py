from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.duckdb_engine import execute_query, view_name_for, register_dataset, _registered_datasets
from app.schemas.datasets import DatasetMetadata, DimensionInfo, MeasureInfo, MetadataResponse

logger = logging.getLogger(__name__)

_MAX_DISTINCT_VALUES = 100  # cap on dimension value lists returned to frontend


def _resolve_actual_view_col(
    col, view_columns: set[str], mapping_renames: dict[str, str]
) -> str:
    """Determine the column name that actually exists in the DuckDB view.

    Priority:
    1. canonical_name (if set and exists in the view)
    2. source_name (if exists in the view)
    3. mapping_config target for source_name (handles case where dedup cleared
       canonical_name but materialization already renamed the column)
    4. Fallback to canonical_name or source_name (best guess)
    """
    canonical = col.canonical_name
    source = col.source_name

    if canonical and canonical in view_columns:
        return canonical
    if source in view_columns:
        return source
    if source in mapping_renames and mapping_renames[source] in view_columns:
        return mapping_renames[source]
    return canonical or source


async def get_model_metadata(model_id: str, db: AsyncSession) -> MetadataResponse:
    """Build the full metadata response for a model.

    For each active dataset, queries DuckDB for:
    - Dimension columns: distinct values (capped at _MAX_DISTINCT_VALUES)
    - Measure columns: min, max, sum stats
    """
    from app.models.metadata import Dataset, DatasetColumn, KPIDefinition, Scenario

    # Fetch active datasets
    ds_result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.columns))
        .where(Dataset.model_id == model_id, Dataset.status == "active")
        .order_by(Dataset.created_at.asc())
    )
    datasets = ds_result.scalars().unique().all()

    # Fetch scenarios
    sc_result = await db.execute(
        select(Scenario)
        .options(selectinload(Scenario.rules))
        .where(Scenario.model_id == model_id)
    )
    scenarios = sc_result.scalars().unique().all()

    # Fetch KPIs
    kpi_result = await db.execute(
        select(KPIDefinition).where(KPIDefinition.model_id == model_id)
    )
    kpis = kpi_result.scalars().all()

    dataset_metas: list[DatasetMetadata] = []

    for dataset in datasets:
        # Ensure DuckDB view is registered for this dataset
        if dataset.id not in _registered_datasets and dataset.parquet_path:
            try:
                register_dataset(dataset.id, dataset.parquet_path)
                logger.info("Lazily registered DuckDB view for dataset %s", dataset.id)
            except Exception:
                logger.warning("Could not register dataset %s for metadata", dataset.id, exc_info=True)

        view_name = view_name_for(dataset.id)
        columns = dataset.columns or []

        # Get actual DuckDB view column names to resolve mismatches
        try:
            view_columns = {r["column_name"] for r in execute_query(
                f"SELECT column_name FROM (DESCRIBE {view_name})"
            )}
        except Exception:
            logger.warning("Could not DESCRIBE %s", view_name, exc_info=True)
            view_columns = set()

        # Build mapping_config rename lookup for this dataset
        mapping_renames: dict[str, str] = {}
        if dataset.mapping_config:
            for m in dataset.mapping_config.get("mappings", []):
                src, tgt = m.get("source", ""), m.get("target", "")
                if src and tgt and src != tgt:
                    mapping_renames[src] = tgt

        dimensions: list[DimensionInfo] = []
        measures: list[MeasureInfo] = []

        # Group columns by role
        dim_cols = [c for c in columns if c.column_role in ("attribute", "time", "key")]
        measure_cols = [c for c in columns if c.column_role == "measure"]

        for col in dim_cols:
            col_name = _resolve_actual_view_col(col, view_columns, mapping_renames) if view_columns else (col.canonical_name or col.source_name)
            try:
                val_rows = execute_query(
                    f'SELECT DISTINCT "{col_name}" AS v FROM {view_name} '
                    f'WHERE "{col_name}" IS NOT NULL ORDER BY "{col_name}" '
                    f'LIMIT {_MAX_DISTINCT_VALUES}'
                )
                values = [str(r["v"]) for r in val_rows]
                cardinality = col.unique_count or len(values)
            except Exception:
                logger.warning(
                    "Could not fetch values for %s.%s", view_name, col_name, exc_info=True
                )
                values = []
                cardinality = col.unique_count or 0

            dimensions.append(DimensionInfo(
                field=col_name,
                label=col.display_name,
                source=col.shared_dim,
                cardinality=cardinality,
                values=values,
            ))

        for col in measure_cols:
            col_name = _resolve_actual_view_col(col, view_columns, mapping_renames) if view_columns else (col.canonical_name or col.source_name)
            stats: dict[str, Any] | None = None
            try:
                stat_rows = execute_query(
                    f'SELECT MIN("{col_name}") AS mn, MAX("{col_name}") AS mx, '
                    f'SUM("{col_name}") AS sm FROM {view_name}'
                )
                if stat_rows:
                    r = stat_rows[0]
                    stats = {
                        "min": r.get("mn"),
                        "max": r.get("mx"),
                        "sum": r.get("sm"),
                    }
            except Exception:
                logger.warning(
                    "Could not fetch stats for %s.%s", view_name, col_name, exc_info=True
                )

            measures.append(MeasureInfo(
                field=col_name,
                label=col.display_name,
                type=col.data_type,
                stats=stats,
            ))

        dataset_metas.append(DatasetMetadata(
            id=dataset.id,
            name=dataset.name,
            fact_type=dataset.fact_type,
            row_count=dataset.row_count,
            measures=measures,
            dimensions=dimensions,
        ))

    return MetadataResponse(
        model_id=model_id,
        datasets=dataset_metas,
        scenarios=[
            {
                "id": s.id,
                "name": s.name,
                "dataset_id": s.dataset_id,
                "rule_count": len(s.rules) if s.rules else 0,
            }
            for s in scenarios
        ],
        kpis=[
            {
                "kpi_id": k.kpi_id,
                "label": k.label,
                "status": k.status,
                "kpi_type": k.kpi_type,
            }
            for k in kpis
        ],
    )
