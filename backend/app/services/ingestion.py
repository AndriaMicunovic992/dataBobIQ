from __future__ import annotations

import logging
from typing import Any

from app.config import settings
from app.database import AsyncSessionLocal
from app.duckdb_engine import register_dataset
from app.services.calendar_svc import seed_calendar
from app.services.column_mapper import ai_suggest_mapping
from app.services.fact_classifier import classify_upload
from app.services.materializer import extract_dimensions, materialize_to_parquet
from app.services.parser import parse_file
from app.services.storage import ensure_data_dirs, get_parquet_path

logger = logging.getLogger(__name__)


async def _update_dataset_status(
    dataset_id: str,
    status: str,
    extra: dict[str, Any] | None = None,
) -> None:
    """Update a dataset's status field (and optionally other fields) in PostgreSQL."""
    from sqlalchemy import select

    from app.models.metadata import Dataset

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
        dataset = result.scalar_one_or_none()
        if dataset is None:
            logger.warning("Dataset %s not found when updating status to %s", dataset_id, status)
            return
        dataset.status = status
        if extra:
            for k, v in extra.items():
                setattr(dataset, k, v)
        await db.commit()
        logger.debug("Dataset %s status → %s", dataset_id, status)


async def _save_columns(dataset_id: str, columns: list[dict]) -> None:
    """Persist parsed column metadata to database."""
    from sqlalchemy import delete, select

    from app.models.metadata import DatasetColumn

    logger.info("Saving %d columns for dataset %s", len(columns), dataset_id)
    async with AsyncSessionLocal() as db:
        # Remove any existing columns
        await db.execute(delete(DatasetColumn).where(DatasetColumn.dataset_id == dataset_id))
        await db.flush()
        for i, col in enumerate(columns):
            dc = DatasetColumn(
                dataset_id=dataset_id,
                source_name=col["source_name"],
                display_name=col.get("display_name", col["source_name"]),
                data_type=col["data_type"],
                column_role=col["column_role"],
                unique_count=col.get("unique_count"),
                sample_values=col.get("sample_values"),
            )
            db.add(dc)
        await db.flush()
        await db.commit()
        # Verify
        verify = await db.execute(
            select(DatasetColumn).where(DatasetColumn.dataset_id == dataset_id)
        )
        saved = verify.scalars().all()
        logger.info("Verified %d columns saved for dataset %s", len(saved), dataset_id)


async def _save_mapping_config(dataset_id: str, mapping_config: dict) -> None:
    """Persist AI mapping config to dataset record and update column canonical names."""
    from sqlalchemy import select

    from app.models.metadata import Dataset, DatasetColumn

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
        dataset = result.scalar_one_or_none()
        if dataset:
            dataset.mapping_config = mapping_config
            dataset.ai_analyzed = True

            # Apply AI-suggested canonical names to DatasetColumn records
            mappings = mapping_config.get("mappings", [])
            if mappings:
                col_result = await db.execute(
                    select(DatasetColumn).where(DatasetColumn.dataset_id == dataset_id)
                )
                db_columns = col_result.scalars().all()
                col_by_source = {c.source_name: c for c in db_columns}
                for m in mappings:
                    src = m.get("source", "")
                    tgt = m.get("target", "")
                    if src in col_by_source and tgt:
                        col_by_source[src].canonical_name = tgt

            await db.commit()


async def process_upload(model_id: str, dataset_id: str, file_path: str) -> None:
    """Background task: parse → classify → AI map → save mapping for review.

    Status progression:
        queued → parsing → parsed → mapping → mapped_pending_review
        On error: → error (with ai_notes set)
    """
    logger.info("Starting ingestion pipeline for dataset %s (model %s)", dataset_id, model_id)

    try:
        # ---- 1. Parse ----
        await _update_dataset_status(dataset_id, "parsing")
        df, columns = parse_file(file_path)
        row_count = len(df)
        logger.info("Parsed %d rows, %d columns for dataset %s", row_count, len(columns), dataset_id)
        await _update_dataset_status(dataset_id, "parsed", {"row_count": row_count})
        await _save_columns(dataset_id, columns)

        # Sample rows for AI
        sample_rows = df.head(10).to_dicts()

        # ---- 2. Classify ----
        fact_type_id, confidence, mapping_hints = classify_upload(columns, sample_rows)
        logger.info(
            "Classified dataset %s as '%s' (confidence=%.3f)",
            dataset_id, fact_type_id, confidence,
        )

        # Check if AI keys are available
        api_key = settings.anthropic_api_key_agent or settings.anthropic_api_key_chat
        if not api_key:
            # Phase 1 simple mode: skip AI mapping, use classifier hints
            logger.info("No AI key configured; using classifier hints for dataset %s", dataset_id)
            mapping_config = {
                "mappings": [
                    {"source": src, "target": tgt, "confidence": 0.7}
                    for src, tgt in mapping_hints.items()
                ],
                "sign_convention": "unknown",
                "detected_hierarchy": [],
                "notes": "Auto-classified (no AI key)",
            }
            await _save_mapping_config(dataset_id, mapping_config)
            await _update_dataset_status(
                dataset_id,
                "mapped_pending_review",
                {"fact_type": fact_type_id},
            )
            return

        # ---- 3. AI Mapping ----
        await _update_dataset_status(dataset_id, "mapping", {"fact_type": fact_type_id})

        from app.fact_types.registry import get_fact_type
        ft = get_fact_type(fact_type_id)
        fact_type_def = None
        if ft:
            # Build a simple dict for the prompt
            fact_type_def = {
                "core": {
                    "measures": [
                        {"name": c.name, "type": c.type, "description": c.description, "aliases": c.aliases}
                        for c in ft.core_measures
                    ],
                    "dimensions": [
                        {"name": c.name, "type": c.type, "description": c.description, "aliases": c.aliases}
                        for c in ft.core_dimensions
                    ],
                },
                "expected": {
                    "measures": [
                        {"name": c.name, "type": c.type, "description": c.description, "aliases": c.aliases}
                        for c in ft.expected_measures
                    ],
                    "dimensions": [
                        {"name": c.name, "type": c.type, "description": c.description, "aliases": c.aliases}
                        for c in ft.expected_dimensions
                    ],
                },
            }

        mapping_config = await ai_suggest_mapping(
            columns=columns,
            sample_rows=sample_rows,
            fact_type_id=fact_type_id,
            fact_type_def=fact_type_def,
        )

        await _save_mapping_config(dataset_id, mapping_config)
        await _update_dataset_status(dataset_id, "mapped_pending_review")
        logger.info("Dataset %s ready for mapping review", dataset_id)

    except Exception as exc:
        logger.exception("Ingestion pipeline failed for dataset %s: %s", dataset_id, exc)
        await _update_dataset_status(
            dataset_id,
            "error",
            {"ai_notes": {"error": str(exc)}},
        )


async def confirm_mapping_and_materialize(dataset_id: str, mapping_config: dict) -> None:
    """After user confirms column mapping: materialize the dataset.

    Status: mapped_pending_review → materializing → active
    """
    from sqlalchemy import select

    from app.models.metadata import Dataset, DatasetColumn

    logger.info("Starting materialization for dataset %s", dataset_id)

    try:
        await _update_dataset_status(dataset_id, "materializing")

        # Load dataset record
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Dataset).where(Dataset.id == dataset_id)
            )
            dataset = result.scalar_one_or_none()
            if dataset is None:
                raise ValueError(f"Dataset {dataset_id} not found")

            model_id = dataset.model_id
            data_layer = dataset.data_layer or "actuals"

            # Load columns for type casting
            col_result = await db.execute(
                select(DatasetColumn).where(DatasetColumn.dataset_id == dataset_id)
            )
            db_columns = col_result.scalars().all()
            column_meta = [
                {
                    "source_name": c.source_name,
                    "canonical_name": c.canonical_name,
                    "display_name": c.display_name,
                    "data_type": c.data_type,
                    "column_role": c.column_role,
                    "shared_dim": c.shared_dim,
                }
                for c in db_columns
            ]

        if not model_id:
            raise ValueError(f"Dataset {dataset_id} has no model_id")

        data_dir = settings.data_dir
        ensure_data_dirs(data_dir, model_id)

        # Re-parse the original file to get the raw DataFrame
        upload_dir = settings.upload_dir
        import os
        # Find the uploaded file by scanning uploads dir for dataset_id prefix
        raw_path: str | None = None
        for fname in os.listdir(upload_dir):
            if fname.startswith(dataset_id):
                raw_path = os.path.join(upload_dir, fname)
                break

        if raw_path is None:
            raise FileNotFoundError(f"Uploaded file not found for dataset {dataset_id}")

        from app.services.parser import parse_file as parse
        df, _ = parse(raw_path)

        # Materialize
        parquet_path = materialize_to_parquet(
            df=df,
            mapping_config=mapping_config,
            dataset_id=dataset_id,
            model_id=model_id,
            data_dir=data_dir,
            column_meta=column_meta,
            data_layer=data_layer,
        )

        # Extract dimensions
        dim_paths = extract_dimensions(
            df=df,
            mapping_config=mapping_config,
            model_id=model_id,
            data_dir=data_dir,
            column_meta=column_meta,
        )

        # Register in DuckDB
        register_dataset(dataset_id, parquet_path)

        # Seed calendar dimension if not already present
        try:
            cal_id = await _ensure_calendar_dataset(model_id, data_dir)
        except Exception:
            cal_id = None
            logger.warning("Failed to seed calendar for model %s", model_id, exc_info=True)

        # Detect relationships with other active datasets (including calendar)
        try:
            await _detect_and_save_relationships(dataset_id, model_id, column_meta)
        except Exception:
            logger.warning("Relationship detection failed for dataset %s", dataset_id, exc_info=True)

        # Also detect relationships FROM the calendar to this new dataset
        if cal_id:
            try:
                cal_col_meta = [
                    {"source_name": c["source_name"], "canonical_name": None,
                     "column_role": c["column_role"], "data_type": c["data_type"]}
                    for c in _CALENDAR_COLUMNS
                ]
                await _detect_and_save_relationships(cal_id, model_id, cal_col_meta)
            except Exception:
                logger.warning("Calendar relationship detection failed", exc_info=True)

        # Persist final state
        import os as _os
        row_count_actual = len(df)
        await _update_dataset_status(
            dataset_id,
            "active",
            {
                "parquet_path": parquet_path,
                "row_count": row_count_actual,
                "mapping_config": mapping_config,
            },
        )

        logger.info(
            "Materialization complete: dataset %s → %s (%d rows, %d dims)",
            dataset_id, parquet_path, row_count_actual, len(dim_paths),
        )

    except Exception as exc:
        logger.exception("Materialization failed for dataset %s: %s", dataset_id, exc)
        await _update_dataset_status(
            dataset_id,
            "error",
            {"ai_notes": {"error": f"Materialization failed: {exc}"}},
        )


async def _detect_and_save_relationships(
    dataset_id: str, model_id: str, column_meta: list[dict]
) -> None:
    """After materialization, detect join keys with other active datasets."""
    from sqlalchemy import delete, select

    from app.models.metadata import Dataset, DatasetColumn, DatasetRelationship
    from app.services.relationship_detector import detect_relationships

    async with AsyncSessionLocal() as db:
        # Load other active datasets in the same model
        result = await db.execute(
            select(Dataset).where(
                Dataset.model_id == model_id,
                Dataset.status == "active",
                Dataset.id != dataset_id,
            )
        )
        other_datasets_orm = result.scalars().all()
        if not other_datasets_orm:
            logger.info("No other active datasets to compare for relationships")
            return

        # Build column info for each other dataset
        other_datasets = []
        for ds in other_datasets_orm:
            col_result = await db.execute(
                select(DatasetColumn).where(DatasetColumn.dataset_id == ds.id)
            )
            cols = col_result.scalars().all()
            other_datasets.append({
                "id": ds.id,
                "columns": [
                    {
                        "source_name": c.source_name,
                        "canonical_name": c.canonical_name,
                        "column_role": c.column_role,
                        "data_type": c.data_type,
                    }
                    for c in cols
                ],
            })

        # Run detection
        relationships = detect_relationships(dataset_id, column_meta, other_datasets)

        if not relationships:
            logger.info("No relationships detected for dataset %s", dataset_id)
            return

        # Remove old relationships involving this dataset
        await db.execute(
            delete(DatasetRelationship).where(
                (DatasetRelationship.source_dataset_id == dataset_id)
                | (DatasetRelationship.target_dataset_id == dataset_id)
            )
        )

        # Save new relationships
        for rel in relationships:
            dr = DatasetRelationship(
                model_id=model_id,
                source_dataset_id=rel["source_dataset_id"],
                target_dataset_id=rel["target_dataset_id"],
                source_column=rel["source_column"],
                target_column=rel["target_column"],
                relationship_type=rel["relationship_type"],
                coverage_pct=rel["coverage_pct"],
            )
            db.add(dr)

        await db.commit()
        logger.info("Saved %d relationships for dataset %s", len(relationships), dataset_id)


# Stable deterministic ID for the calendar dataset within a model.
_CALENDAR_ID_NAMESPACE = "dim_date"


def _calendar_dataset_id(model_id: str) -> str:
    """Generate a deterministic dataset ID for the calendar dimension."""
    import hashlib
    return hashlib.sha256(f"{model_id}:{_CALENDAR_ID_NAMESPACE}".encode()).hexdigest()[:36]


_CALENDAR_COLUMNS = [
    {"source_name": "date_key", "display_name": "Date Key", "data_type": "integer", "column_role": "key"},
    {"source_name": "date", "display_name": "Date", "data_type": "date", "column_role": "time"},
    {"source_name": "year", "display_name": "Year", "data_type": "integer", "column_role": "time"},
    {"source_name": "quarter", "display_name": "Quarter", "data_type": "integer", "column_role": "time"},
    {"source_name": "month", "display_name": "Month", "data_type": "integer", "column_role": "time"},
    {"source_name": "month_name", "display_name": "Month Name", "data_type": "string", "column_role": "time"},
    {"source_name": "fiscal_year", "display_name": "Fiscal Year", "data_type": "integer", "column_role": "time"},
    {"source_name": "fiscal_quarter", "display_name": "Fiscal Quarter", "data_type": "integer", "column_role": "time"},
    {"source_name": "day_of_week", "display_name": "Day of Week", "data_type": "integer", "column_role": "attribute"},
    {"source_name": "day_name", "display_name": "Day Name", "data_type": "string", "column_role": "attribute"},
    {"source_name": "is_weekend", "display_name": "Is Weekend", "data_type": "boolean", "column_role": "attribute"},
    {"source_name": "week_of_year", "display_name": "Week of Year", "data_type": "integer", "column_role": "attribute"},
    {"source_name": "year_month", "display_name": "Year-Month", "data_type": "string", "column_role": "time"},
]


async def _ensure_calendar_dataset(model_id: str, data_dir: str) -> str:
    """Seed the calendar Parquet file, create a Dataset record, and register in DuckDB.

    Idempotent — skips if the dataset already exists.
    Returns the calendar dataset ID.
    """
    from sqlalchemy import select
    from app.models.metadata import Dataset, DatasetColumn
    from app.services.storage import get_dimension_path

    cal_id = _calendar_dataset_id(model_id)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Dataset).where(Dataset.id == cal_id))
        existing = result.scalar_one_or_none()
        if existing is not None:
            # Already created — re-seed Parquet (picks up new columns) and
            # ensure DuckDB view exists.
            parquet_path = seed_calendar(model_id, data_dir)
            register_dataset(cal_id, parquet_path)

            # Add any missing DatasetColumn records (e.g. year_month added later)
            col_result = await db.execute(
                select(DatasetColumn.source_name).where(DatasetColumn.dataset_id == cal_id)
            )
            existing_cols = {r[0] for r in col_result.all()}
            for col_def in _CALENDAR_COLUMNS:
                if col_def["source_name"] not in existing_cols:
                    dc = DatasetColumn(
                        dataset_id=cal_id,
                        source_name=col_def["source_name"],
                        display_name=col_def["display_name"],
                        data_type=col_def["data_type"],
                        column_role=col_def["column_role"],
                    )
                    db.add(dc)
                    logger.info("Added missing calendar column %s", col_def["source_name"])
            await db.commit()
            return cal_id

    # Seed the Parquet file
    parquet_path = seed_calendar(model_id, data_dir)

    # Register in DuckDB
    register_dataset(cal_id, parquet_path)

    # Create Dataset record
    async with AsyncSessionLocal() as db:
        ds = Dataset(
            id=cal_id,
            model_id=model_id,
            name="Calendar (dim_date)",
            source_filename="dim_date (system)",
            fact_type="dimension",
            row_count=4018,  # ~11 years of days
            status="active",
            data_layer="dimension",
            ai_analyzed=False,
            parquet_path=parquet_path,
        )
        db.add(ds)
        await db.flush()

        for col_def in _CALENDAR_COLUMNS:
            dc = DatasetColumn(
                dataset_id=cal_id,
                source_name=col_def["source_name"],
                display_name=col_def["display_name"],
                data_type=col_def["data_type"],
                column_role=col_def["column_role"],
            )
            db.add(dc)

        await db.commit()
        logger.info("Created calendar dataset %s for model %s", cal_id, model_id)

    return cal_id
