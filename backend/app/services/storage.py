from __future__ import annotations

import logging
import os
from pathlib import Path

import polars as pl

logger = logging.getLogger(__name__)


def write_parquet(df: pl.DataFrame, path: str) -> int:
    """Write DataFrame to Parquet. Returns row count."""
    out_path = Path(path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(str(out_path), compression="snappy")
    row_count = len(df)
    logger.info("Wrote %d rows to %s", row_count, path)
    return row_count


def read_parquet(path: str, columns: list[str] | None = None) -> pl.DataFrame:
    """Read Parquet into DataFrame."""
    logger.debug("Reading parquet from %s (columns=%s)", path, columns)
    return pl.read_parquet(path, columns=columns)


def ensure_data_dirs(data_dir: str, model_id: str) -> dict[str, str]:
    """Create dir structure. Returns {raw, processed, dimensions, scenarios} paths."""
    base = Path(data_dir) / model_id
    dirs: dict[str, str] = {
        "raw": str(base / "raw"),
        "processed": str(base / "processed"),
        "dimensions": str(base / "dimensions"),
        "scenarios": str(base / "scenarios"),
    }
    for dir_path in dirs.values():
        Path(dir_path).mkdir(parents=True, exist_ok=True)
        logger.debug("Ensured directory: %s", dir_path)
    return dirs


def get_parquet_path(data_dir: str, model_id: str, dataset_id: str) -> str:
    """Return processed Parquet path for dataset."""
    return str(Path(data_dir) / model_id / "processed" / f"{dataset_id}.parquet")


def get_dimension_path(data_dir: str, model_id: str, dim_name: str) -> str:
    """Return Parquet path for dimension table."""
    return str(Path(data_dir) / model_id / "dimensions" / f"{dim_name}.parquet")


def get_scenario_path(data_dir: str, model_id: str, scenario_id: str) -> str:
    """Return Parquet path for scenario overrides."""
    return str(Path(data_dir) / model_id / "scenarios" / f"{scenario_id}.parquet")
