from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any

import polars as pl

from app.services.storage import ensure_data_dirs, get_dimension_path, get_parquet_path, write_parquet

logger = logging.getLogger(__name__)

# System columns always added to materialized Parquet
_SYSTEM_COLS = ["row_id", "source_key", "data_layer"]

# Polars type → canonical cast target
_TYPE_CAST_MAP: dict[str, type] = {
    "text": pl.String,
    "integer": pl.Int64,
    "numeric": pl.Float64,
    "currency": pl.Float64,
    "date": pl.Date,
    "boolean": pl.Boolean,
}

# Dimension columns: low cardinality text/date, will have distinct tables extracted
_DIM_ROLES = {"attribute", "time", "key"}


def _safe_col_name(name: str) -> str:
    """Sanitise a column name for Parquet: replace spaces with underscores, lowercase."""
    return name.strip().lower().replace(" ", "_").replace("-", "_")


def _apply_mapping(df: pl.DataFrame, mapping_config: dict) -> pl.DataFrame:
    """Rename source columns to canonical names based on mappings.

    mapping_config expected shape::

        {
            "mappings": [{"source": "...", "target": "...", "confidence": 0.9}],
            "sign_convention": "expenses_negative",
            "detected_hierarchy": [...],
        }

    Handles duplicate target names gracefully: keeps the highest-confidence
    mapping and drops redundant source columns to avoid Polars DuplicateError.
    """
    mappings: list[dict] = mapping_config.get("mappings", [])
    # Sort by confidence desc so the best mapping wins for duplicate targets
    mappings_sorted = sorted(mappings, key=lambda m: m.get("confidence", 0), reverse=True)

    rename_map: dict[str, str] = {}
    seen_targets: set[str] = set()
    drop_cols: list[str] = []

    for m in mappings_sorted:
        src = m.get("source", "")
        tgt = m.get("target", "")
        if not src or not tgt or src not in df.columns:
            continue
        if src == tgt:
            # Identity mapping — no rename needed, but mark target as taken
            seen_targets.add(tgt)
            continue
        if tgt in seen_targets:
            # Another column already claims this target — drop this one
            logger.warning(
                "Dropping column '%s': target '%s' already claimed by another mapping", src, tgt
            )
            drop_cols.append(src)
            continue
        seen_targets.add(tgt)
        rename_map[src] = tgt

    # Check for collisions: a rename target matches an existing column
    # that isn't itself being renamed away
    columns_being_renamed = set(rename_map.keys())
    for src, tgt in list(rename_map.items()):
        if tgt in df.columns and tgt not in columns_being_renamed:
            logger.warning(
                "Dropping column '%s': rename target '%s' collides with existing column", src, tgt
            )
            drop_cols.append(src)
            del rename_map[src]

    if drop_cols:
        df = df.drop([c for c in drop_cols if c in df.columns])
    if rename_map:
        df = df.rename(rename_map)
        logger.debug("Renamed %d columns via mapping", len(rename_map))

    return df


def _cast_columns(df: pl.DataFrame, column_meta: list[dict]) -> pl.DataFrame:
    """Cast columns to their declared types based on metadata."""
    cast_exprs: list[pl.Expr] = []
    col_set = set(df.columns)

    for meta in column_meta:
        # Use canonical_name if mapped, otherwise source_name
        col_name = meta.get("canonical_name") or meta.get("source_name", "")
        if col_name not in col_set:
            continue
        data_type = meta.get("data_type", "text")
        target_dtype = _TYPE_CAST_MAP.get(data_type)
        if target_dtype:
            try:
                cast_exprs.append(pl.col(col_name).cast(target_dtype, strict=False))
            except Exception:
                logger.warning("Could not cast %s to %s", col_name, data_type)
                cast_exprs.append(pl.col(col_name))
        else:
            cast_exprs.append(pl.col(col_name))

    # Include remaining columns that weren't in metadata
    meta_names = {m.get("canonical_name") or m.get("source_name", "") for m in column_meta}
    for col in df.columns:
        if col not in meta_names:
            cast_exprs.append(pl.col(col))

    return df.select(cast_exprs)


def _add_system_columns(df: pl.DataFrame, dataset_id: str, data_layer: str = "actuals") -> pl.DataFrame:
    """Add row_id, source_key, data_layer system columns."""
    n = len(df)
    return df.with_columns([
        pl.Series("row_id", list(range(n)), dtype=pl.Int64),
        pl.lit(dataset_id).alias("source_key"),
        pl.lit(data_layer).alias("data_layer"),
    ])


def materialize_to_parquet(
    df: pl.DataFrame,
    mapping_config: dict,
    dataset_id: str,
    model_id: str,
    data_dir: str,
    column_meta: list[dict] | None = None,
    data_layer: str = "actuals",
) -> str:
    """Transform raw DataFrame → canonical Parquet.

    Steps:
    1. Apply column renames from mapping_config
    2. Cast columns to declared data types
    3. Add system columns (row_id, source_key, data_layer)
    4. Write to processed/<dataset_id>.parquet

    Returns the absolute Parquet path.
    """
    ensure_data_dirs(data_dir, model_id)

    logger.info(
        "Materializing dataset_id=%s model_id=%s rows=%d cols=%d",
        dataset_id, model_id, len(df), len(df.columns),
    )

    # Step 1: rename
    df = _apply_mapping(df, mapping_config)

    # Step 2: cast
    if column_meta:
        df = _cast_columns(df, column_meta)

    # Step 3: system columns
    df = _add_system_columns(df, dataset_id, data_layer)

    # Step 4: write
    out_path = get_parquet_path(data_dir, model_id, dataset_id)
    row_count = write_parquet(df, out_path)
    logger.info("Materialized %d rows → %s", row_count, out_path)
    return out_path


def extract_dimensions(
    df: pl.DataFrame,
    mapping_config: dict,
    model_id: str,
    data_dir: str,
    column_meta: list[dict] | None = None,
) -> dict[str, str]:
    """Extract distinct dimension tables from the materialized DataFrame.

    For each attribute/time column (or any column with shared_dim set),
    writes a deduplicated Parquet to the dimensions/ folder.

    Returns {dim_name: parquet_path}.
    """
    ensure_data_dirs(data_dir, model_id)
    dim_paths: dict[str, str] = {}

    # Determine which columns to extract dimensions from
    dim_columns: list[tuple[str, str]] = []  # (col_name_in_df, dim_name)

    if column_meta:
        for meta in column_meta:
            col_name = meta.get("canonical_name") or meta.get("source_name", "")
            if col_name not in df.columns:
                continue
            shared_dim = meta.get("shared_dim")
            role = meta.get("column_role", "attribute")
            if shared_dim:
                dim_columns.append((col_name, shared_dim))
            elif role in _DIM_ROLES:
                dim_name = f"dim_{_safe_col_name(col_name)}"
                dim_columns.append((col_name, dim_name))
    else:
        # Fallback: extract all string columns with low cardinality
        for col in df.columns:
            if col in _SYSTEM_COLS:
                continue
            series = df[col]
            if series.dtype == pl.String and series.n_unique() < 500:
                dim_name = f"dim_{_safe_col_name(col)}"
                dim_columns.append((col, dim_name))

    for col_name, dim_name in dim_columns:
        if col_name not in df.columns:
            continue
        try:
            dim_df = df.select(pl.col(col_name)).unique().sort(col_name)
            path = get_dimension_path(data_dir, model_id, dim_name)
            write_parquet(dim_df, path)
            dim_paths[dim_name] = path
            logger.info("Extracted dimension %s (%d values) → %s", dim_name, len(dim_df), path)
        except Exception:
            logger.warning("Failed to extract dimension %s", dim_name, exc_info=True)

    return dim_paths
