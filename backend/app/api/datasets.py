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
from app.models.metadata import Dataset, DatasetColumn, DatasetRelationship, Model
from app.schemas.datasets import DatasetColumnUpdate, DatasetResponse, RelationshipCreate, RelationshipResponse, RelationshipUpdate
from app.services.ingestion import confirm_mapping_and_materialize, process_upload
from app.services.parser import list_excel_sheets

logger = logging.getLogger(__name__)

router = APIRouter(tags=["datasets"])


_EXCEL_SUFFIXES = (".xlsx", ".xls", ".xlsm", ".xlsb", ".ods")


@router.post(
    "/models/{model_id}/datasets/upload",
    response_model=list[DatasetResponse],
    status_code=202,
)
async def upload_dataset(
    model_id: str,
    file: UploadFile,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> list[DatasetResponse]:
    """Upload a file and kick off ingestion.

    Excel workbooks produce one Dataset per sheet. CSV/TSV produce a single
    Dataset. Returns the list of created datasets (always length >= 1).
    """
    # Verify model exists
    result = await db.execute(select(Model).where(Model.id == model_id))
    model = result.scalar_one_or_none()
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    if not file.filename:
        raise HTTPException(status_code=422, detail="Filename is required")

    safe_filename = Path(file.filename).name
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)

    # Save the file once with a per-upload prefix so all sibling sheet
    # datasets can share the same physical file.
    upload_id = str(uuid.uuid4())
    dest_path = upload_dir / f"{upload_id}_{safe_filename}"

    try:
        contents = await file.read()
        dest_path.write_bytes(contents)
        logger.info(
            "Saved upload path=%s bytes=%d",
            dest_path,
            len(contents),
        )
    except Exception as exc:
        logger.exception("Failed to save uploaded file: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save uploaded file") from exc

    # Decide which sheets to ingest. For Excel, enumerate sheets and create
    # one dataset per sheet. Non-Excel uploads get a single dataset with
    # sheet_name=None.
    suffix = Path(safe_filename).suffix.lower()
    if suffix in _EXCEL_SUFFIXES:
        sheet_names = list_excel_sheets(str(dest_path))
        if not sheet_names:
            # Enumeration failed — fall back to default sheet.
            logger.warning("No sheets enumerated for %s; falling back to default", dest_path)
            sheet_names = [None]
    else:
        sheet_names = [None]

    multi = sum(1 for s in sheet_names if s is not None) > 1
    base_name = Path(safe_filename).stem or safe_filename
    logger.info(
        "Creating %d dataset(s) for %s; multi=%s sheets=%s",
        len(sheet_names), safe_filename, multi, sheet_names,
    )

    created: list[Dataset] = []
    for sheet in sheet_names:
        dataset_id = str(uuid.uuid4())
        if sheet is None:
            ds_name = safe_filename
        else:
            ds_name = sheet if multi else safe_filename
        dataset = Dataset(
            id=dataset_id,
            model_id=model_id,
            name=ds_name,
            source_filename=safe_filename,
            sheet_name=sheet,
            source_file_path=str(dest_path),
            fact_type="unknown",
            row_count=0,
            status="queued",
            data_layer="actuals",
            ai_analyzed=False,
        )
        db.add(dataset)
        created.append(dataset)

    await db.commit()
    for ds in created:
        await db.refresh(ds)

    for ds in created:
        background_tasks.add_task(
            process_upload,
            model_id=model_id,
            dataset_id=ds.id,
            file_path=str(dest_path),
            sheet_name=ds.sheet_name,
        )
    logger.info(
        "Queued ingestion for %d dataset(s) from %s", len(created), safe_filename
    )

    # Reload with columns relationship (empty at this point) in original order.
    ids = [ds.id for ds in created]
    result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.columns))
        .where(Dataset.id.in_(ids))
    )
    by_id = {d.id: d for d in result.unique().scalars().all()}
    return [DatasetResponse.model_validate(by_id[i]) for i in ids]


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
    datasets = result.scalars().unique().all()
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
    dataset = result.unique().scalar_one_or_none()
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
    dataset = result.unique().scalar_one_or_none()
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
    body: dict,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> DatasetResponse:
    """Confirm the AI-proposed column mapping and trigger materialization.

    The body can either be the full mapping_config dict, or ``{"confirm_all": true}``
    to accept the existing AI-proposed mapping stored on the dataset.
    """
    result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.columns))
        .where(Dataset.id == dataset_id)
    )
    dataset = result.unique().scalar_one_or_none()
    if dataset is None:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")

    if dataset.status not in ("mapped_pending_review", "queued", "analyzed"):
        raise HTTPException(
            status_code=409,
            detail=f"Dataset is in status '{dataset.status}'; cannot confirm mapping now",
        )

    # If caller sent confirm_all=true, use the existing mapping_config
    if body.get("confirm_all") and dataset.mapping_config:
        mapping_config = dataset.mapping_config
    else:
        mapping_config = body

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
    dataset = result.unique().scalar_one()
    return DatasetResponse.model_validate(dataset)


@router.patch("/datasets/{dataset_id}/columns/{column_id}", response_model=DatasetResponse)
async def update_column(
    dataset_id: str,
    column_id: str,
    body: DatasetColumnUpdate,
    db: AsyncSession = Depends(get_db),
) -> DatasetResponse:
    """Update a column's role or canonical name."""
    result = await db.execute(
        select(DatasetColumn).where(
            DatasetColumn.id == column_id,
            DatasetColumn.dataset_id == dataset_id,
        )
    )
    column = result.scalar_one_or_none()
    if column is None:
        raise HTTPException(status_code=404, detail=f"Column {column_id} not found")

    update_data = body.model_dump(exclude_unset=True)

    # Enforce model-level uniqueness of canonical_name: if the user sets a
    # canonical name that's already claimed by another column in the same
    # model, reject the request.
    new_canonical = update_data.get("canonical_name")
    if new_canonical:
        ds_for_check = (await db.execute(
            select(Dataset).where(Dataset.id == dataset_id)
        )).scalar_one_or_none()
        if ds_for_check and ds_for_check.model_id:
            conflict = (await db.execute(
                select(DatasetColumn)
                .join(Dataset, DatasetColumn.dataset_id == Dataset.id)
                .where(
                    Dataset.model_id == ds_for_check.model_id,
                    DatasetColumn.canonical_name == new_canonical,
                    DatasetColumn.id != column_id,
                )
            )).scalar_one_or_none()
            if conflict:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Canonical name '{new_canonical}' is already used by "
                        f"column '{conflict.source_name}' in this model. "
                        f"Unmap that column first."
                    ),
                )

    for field, value in update_data.items():
        setattr(column, field, value)

    await db.commit()
    logger.info("Updated column %s on dataset %s: %s", column_id, dataset_id, update_data)

    # If column_role changed, re-detect relationships for this dataset
    if "column_role" in update_data:
        ds_for_rel = (await db.execute(
            select(Dataset).where(Dataset.id == dataset_id)
        )).scalar_one_or_none()
        if ds_for_rel and ds_for_rel.status == "active" and ds_for_rel.model_id:
            try:
                all_cols = (await db.execute(
                    select(DatasetColumn).where(DatasetColumn.dataset_id == dataset_id)
                )).scalars().all()
                col_meta = [
                    {
                        "source_name": c.source_name,
                        "canonical_name": c.canonical_name,
                        "column_role": c.column_role,
                        "data_type": c.data_type,
                    }
                    for c in all_cols
                ]
                from app.services.ingestion import _detect_and_save_relationships
                await _detect_and_save_relationships(dataset_id, ds_for_rel.model_id, col_meta)
                logger.info("Re-detected relationships after role change for dataset %s", dataset_id)
            except Exception:
                logger.warning("Relationship re-detection failed for %s", dataset_id, exc_info=True)

    # Return full dataset with columns
    ds_result = await db.execute(
        select(Dataset)
        .options(selectinload(Dataset.columns))
        .where(Dataset.id == dataset_id)
    )
    dataset = ds_result.unique().scalar_one()
    return DatasetResponse.model_validate(dataset)


@router.get(
    "/models/{model_id}/relationships",
    response_model=list[RelationshipResponse],
)
async def list_relationships(
    model_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[RelationshipResponse]:
    """List all detected relationships between datasets in a model."""
    result = await db.execute(
        select(DatasetRelationship).where(DatasetRelationship.model_id == model_id)
    )
    rels = result.scalars().all()
    return [RelationshipResponse.model_validate(r) for r in rels]


@router.post(
    "/models/{model_id}/relationships",
    response_model=RelationshipResponse,
    status_code=201,
)
async def create_relationship(
    model_id: str,
    body: RelationshipCreate,
    db: AsyncSession = Depends(get_db),
) -> RelationshipResponse:
    """Create a new relationship between two dataset columns."""
    result = await db.execute(select(Model).where(Model.id == model_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    rel = DatasetRelationship(
        id=str(uuid.uuid4()),
        model_id=model_id,
        source_dataset_id=body.source_dataset_id,
        target_dataset_id=body.target_dataset_id,
        source_column=body.source_column,
        target_column=body.target_column,
        relationship_type=body.relationship_type,
    )
    db.add(rel)
    await db.commit()
    await db.refresh(rel)
    logger.info("Created relationship id=%s for model=%s", rel.id, model_id)
    return RelationshipResponse.model_validate(rel)


@router.patch(
    "/relationships/{relationship_id}",
    response_model=RelationshipResponse,
)
async def update_relationship(
    relationship_id: str,
    body: RelationshipUpdate,
    db: AsyncSession = Depends(get_db),
) -> RelationshipResponse:
    """Update an existing relationship."""
    result = await db.execute(
        select(DatasetRelationship).where(DatasetRelationship.id == relationship_id)
    )
    rel = result.scalar_one_or_none()
    if rel is None:
        raise HTTPException(status_code=404, detail="Relationship not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(rel, field, value)

    await db.commit()
    await db.refresh(rel)
    logger.info("Updated relationship id=%s: %s", relationship_id, update_data)
    return RelationshipResponse.model_validate(rel)


@router.delete("/relationships/{relationship_id}", status_code=204)
async def delete_relationship(
    relationship_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a relationship."""
    result = await db.execute(
        select(DatasetRelationship).where(DatasetRelationship.id == relationship_id)
    )
    rel = result.scalar_one_or_none()
    if rel is None:
        raise HTTPException(status_code=404, detail="Relationship not found")
    await db.delete(rel)
    await db.commit()
