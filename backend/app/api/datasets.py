from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.duckdb_engine import unregister_dataset
from app.models.metadata import Dataset, DatasetColumn, Model
from app.schemas.datasets import DatasetResponse
from app.services.ingestion import confirm_mapping_and_materialize, process_upload

logger = logging.getLogger(__name__)

router = APIRouter(tags=["datasets"])


@router.post(
    "/models/{model_id}/datasets/upload",
    response_model=DatasetResponse,
    status_code=202,
)
async def upload_dataset(
    model_id: str,
    file: UploadFile,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> DatasetResponse:
    """Upload a file, persist it to disk, create a dataset record, and kick off ingestion."""
    # Verify model exists
    result = await db.execute(select(Model).where(Model.id == model_id))
    model = result.scalar_one_or_none()
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    if not file.filename:
        raise HTTPException(status_code=422, detail="Filename is required")

    dataset_id = str(uuid.uuid4())
    safe_filename = Path(file.filename).name
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest_path = upload_dir / f"{dataset_id}_{safe_filename}"

    try:
        contents = await file.read()
        dest_path.write_bytes(contents)
        logger.info(
            "Saved upload dataset_id=%s path=%s bytes=%d",
            dataset_id,
            dest_path,
            len(contents),
        )
    except Exception as exc:
        logger.exception("Failed to save uploaded file: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save uploaded file") from exc

    dataset = Dataset(
        id=dataset_id,
        model_id=model_id,
        name=safe_filename,
        source_filename=safe_filename,
        fact_type="unknown",
        row_count=0,
        status="queued",
        data_layer="actuals",
        ai_analyzed=False,
    )
    db.add(dataset)
    await db.commit()
    await db.refresh(dataset)

    background_tasks.add_task(
        process_upload,
        model_id=model_id,
        dataset_id=dataset_id,
        file_path=str(dest_path),
    )
    logger.info("Queued ingestion for dataset_id=%s", dataset_id)

    # Reload with columns relationship (empty at this point)
    result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.columns))
        .where(Dataset.id == dataset_id)
    )
    dataset = result.scalar_one()
    return DatasetResponse.model_validate(dataset)


@router.get("/models/{model_id}/datasets", response_model=list[DatasetResponse])
async def list_datasets(
    model_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[DatasetResponse]:
    """List all datasets belonging to a model."""
    result = await db.execute(select(Model).where(Model.id == model_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.columns))
        .where(Dataset.model_id == model_id)
        .order_by(Dataset.created_at.desc())
    )
    datasets = result.scalars().all()
    return [DatasetResponse.model_validate(d) for d in datasets]


@router.get("/datasets/{dataset_id}", response_model=DatasetResponse)
async def get_dataset(
    dataset_id: str,
    db: AsyncSession = Depends(get_db),
) -> DatasetResponse:
    """Return a dataset with its column definitions."""
    result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.columns))
        .where(Dataset.id == dataset_id)
    )
    dataset = result.scalar_one_or_none()
    if dataset is None:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")
    return DatasetResponse.model_validate(dataset)


@router.delete("/datasets/{dataset_id}", status_code=204)
async def delete_dataset(
    dataset_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a dataset, its columns, and its Parquet files."""
    result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.columns))
        .where(Dataset.id == dataset_id)
    )
    dataset = result.scalar_one_or_none()
    if dataset is None:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")

    # Remove from DuckDB views
    try:
        unregister_dataset(dataset_id)
    except Exception as exc:
        logger.warning("Could not unregister dataset %s from DuckDB: %s", dataset_id, exc)

    # Remove Parquet files from disk
    if dataset.model_id:
        from app.services.storage import get_parquet_path

        parquet_path = Path(
            get_parquet_path(settings.data_dir, dataset.model_id, dataset_id)
        )
        if parquet_path.exists():
            try:
                parquet_path.unlink()
                logger.info("Removed parquet file %s", parquet_path)
            except Exception as exc:
                logger.warning("Could not remove parquet file %s: %s", parquet_path, exc)

    await db.delete(dataset)
    await db.commit()
    logger.info("Deleted dataset id=%s", dataset_id)


@router.post("/datasets/{dataset_id}/confirm-mapping", response_model=DatasetResponse)
async def confirm_mapping(
    dataset_id: str,
    mapping_config: dict,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> DatasetResponse:
    """Confirm the AI-proposed column mapping and trigger materialization."""
    result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.columns))
        .where(Dataset.id == dataset_id)
    )
    dataset = result.scalar_one_or_none()
    if dataset is None:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")

    if dataset.status not in ("mapped_pending_review", "queued", "analyzed"):
        raise HTTPException(
            status_code=409,
            detail=f"Dataset is in status '{dataset.status}'; cannot confirm mapping now",
        )

    dataset.status = "materializing"
    dataset.mapping_config = mapping_config
    await db.commit()
    await db.refresh(dataset)

    background_tasks.add_task(
        confirm_mapping_and_materialize,
        dataset_id=dataset_id,
        mapping_config=mapping_config,
    )
    logger.info("Triggered materialization for dataset_id=%s", dataset_id)

    result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.columns))
        .where(Dataset.id == dataset_id)
    )
    dataset = result.scalar_one()
    return DatasetResponse.model_validate(dataset)
