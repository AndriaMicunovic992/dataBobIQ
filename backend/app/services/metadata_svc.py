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


async def get_model_metadata(model_id: str, db: AsyncSession) -> MetadataResponse:
    """Build the full metadata response for a model.

    For each active dataset, queries DuckDB for:
    - Dimension columns: distinct values (capped at _MAX_DISTINCT_VALUES)
    - Measure columns: min, max, sum stats

    When the same canonical_name is claimed by columns in multiple datasets
    (legacy state from before cross-dataset dedup), only the earliest-created
    dataset's claim is surfaced as a dimension/measure — later datasets'
    duplicate columns are hidden from the picker so users see a clean list.
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

    # Track canonical names already surfaced, so that when two datasets both
    # claim the same canonical name (legacy mess from before dedup), only the
    # earliest-created dataset's column appears in the picker. The underlying
    # parquet column still exists on disk for both datasets — we just don't
    # double-list it.
    claimed_field_names: set[str] = set()

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

        dimensions: list[DimensionInfo] = []
        measures: list[MeasureInfo] = []

        # Group columns by role
        dim_cols = [c for c in columns if c.column_role in ("attribute", "time", "key")]
        measure_cols = [c for c in columns if c.column_role == "measure"]

        for col in dim_cols:
            col_name = col.canonical_name or col.source_name
            # Skip if this canonical name was already claimed by an earlier
            # dataset — prevents duplicate entries in the field picker.
            if col.canonical_name and col_name in claimed_field_names:
                logger.info(
                    "Hiding duplicate dim '%s' from dataset %s (already claimed)",
                    col_name, dataset.id[:8],
                )
                continue
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
            if col.canonical_name:
                claimed_field_names.add(col_name)

        for col in measure_cols:
            col_name = col.canonical_name or col.source_name
            if col.canonical_name and col_name in claimed_field_names:
                logger.info(
                    "Hiding duplicate measure '%s' from dataset %s (already claimed)",
                    col_name, dataset.id[:8],
                )
                continue
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
            if col.canonical_name:
                claimed_field_names.add(col_name)

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
