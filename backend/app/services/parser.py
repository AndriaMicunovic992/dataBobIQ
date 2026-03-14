from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import polars as pl

logger = logging.getLogger(__name__)

# Polars dtypes considered numeric
_NUMERIC_DTYPES = (
    pl.Float32, pl.Float64,
    pl.Int8, pl.Int16, pl.Int32, pl.Int64,
    pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64,
)
_DATE_DTYPES = (pl.Date, pl.Datetime, pl.Duration)

# Heuristic thresholds
_LOW_CARD_MAX_RATIO = 0.05   # unique / total ≤ 5% → attribute
_MEASURE_MIN_UNIQUE = 10      # numeric with more than 10 unique values → measure
_SAMPLE_SIZE = 5              # values to include in sample_values


def _infer_role(col_name: str, series: pl.Series, total_rows: int) -> str:
    """Heuristically infer column_role."""
    dtype = series.dtype

    if isinstance(dtype, _DATE_DTYPES):
        return "time"

    if isinstance(dtype, _NUMERIC_DTYPES):
        unique_count = series.n_unique()
        # Columns named like *id*, *key*, *code*, *number* → key even if numeric
        lower = col_name.lower()
        if any(tok in lower for tok in ("_id", "id_", " id", "key", "_nr", "number", "code")):
            return "key"
        if unique_count >= _MEASURE_MIN_UNIQUE:
            return "measure"
        return "attribute"

    # String / categorical columns
    unique_count = series.n_unique()
    lower = col_name.lower()
    if any(tok in lower for tok in ("_id", "id_", " id", "key", "_nr", "number", "code")):
        return "key"
    if total_rows > 0 and (unique_count / total_rows) <= _LOW_CARD_MAX_RATIO:
        return "attribute"
    return "attribute"


def _polars_dtype_to_str(dtype: pl.PolarsDataType) -> str:
    """Map a Polars dtype to a canonical string for metadata."""
    if isinstance(dtype, pl.Datetime):
        return "date"
    if isinstance(dtype, pl.Date):
        return "date"
    if dtype in (pl.Float32, pl.Float64):
        return "numeric"
    if dtype in (pl.Int8, pl.Int16, pl.Int32, pl.Int64,
                 pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64):
        return "integer"
    if dtype == pl.Boolean:
        return "boolean"
    # String / Categorical / Utf8View all map to text
    return "text"


def _detect_currency(col_name: str, series: pl.Series) -> bool:
    """Heuristic: name contains currency keywords and data is numeric."""
    lower = col_name.lower()
    currency_tokens = (
        "amount", "betrag", "value", "wert", "saldo",
        "revenue", "cost", "price", "preis", "umsatz",
        "total", "sum", "summe",
    )
    return any(t in lower for t in currency_tokens) and isinstance(series.dtype, _NUMERIC_DTYPES)


def _normalize_schema(df: pl.DataFrame) -> pl.DataFrame:
    """Replace Utf8View and other non-standard dtypes with canonical equivalents."""
    casts: list[pl.Expr] = []
    for col_name, dtype in zip(df.columns, df.dtypes):
        # Utf8View → String
        if dtype == pl.Utf8View or str(dtype) == "Utf8View":
            casts.append(pl.col(col_name).cast(pl.String))
        # Large String → String
        elif dtype == pl.LargeUtf8 or str(dtype) == "LargeUtf8":
            casts.append(pl.col(col_name).cast(pl.String))
        else:
            casts.append(pl.col(col_name))
    if casts:
        df = df.select(casts)
    return df


def _sample_values(series: pl.Series, n: int = _SAMPLE_SIZE) -> list[Any]:
    """Return up to n non-null sample values as Python scalars."""
    non_null = series.drop_nulls()
    taken = non_null.head(n).to_list()
    return taken


def parse_file(file_path: str) -> tuple[pl.DataFrame, list[dict]]:
    """Parse xlsx/csv into DataFrame + column metadata list.

    Column metadata items::

        {
            source_name: str,
            display_name: str,
            data_type: str,        # text|numeric|integer|date|boolean|currency
            column_role: str,      # key|measure|time|attribute
            unique_count: int,
            sample_values: list,
        }

    Uses calamine engine for Excel. Detects types via Polars dtype inspection.
    Normalises Utf8View → String before processing.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    suffix = path.suffix.lower()
    logger.info("Parsing file %s (type=%s)", file_path, suffix)

    if suffix in (".xlsx", ".xls", ".xlsm", ".xlsb", ".ods"):
        try:
            df = pl.read_excel(
                file_path,
                engine="calamine",
                infer_schema_length=1000,
            )
        except Exception:
            logger.warning("calamine failed, falling back to openpyxl for %s", file_path)
            df = pl.read_excel(
                file_path,
                engine="openpyxl",
                infer_schema_length=1000,
            )
    elif suffix == ".csv":
        df = pl.read_csv(
            file_path,
            infer_schema_length=1000,
            ignore_errors=True,
            try_parse_dates=True,
        )
    elif suffix == ".tsv":
        df = pl.read_csv(
            file_path,
            separator="\t",
            infer_schema_length=1000,
            ignore_errors=True,
            try_parse_dates=True,
        )
    else:
        raise ValueError(f"Unsupported file type: {suffix}")

    # Normalise schema
    df = _normalize_schema(df)

    total_rows = len(df)
    logger.info("Parsed %d rows × %d columns", total_rows, len(df.columns))

    column_metadata: list[dict] = []
    for col_name in df.columns:
        series = df[col_name]
        dtype = series.dtype
        unique_count = series.n_unique()

        # Determine data_type string
        data_type = _polars_dtype_to_str(dtype)
        if data_type in ("numeric", "integer") and _detect_currency(col_name, series):
            data_type = "currency"

        column_role = _infer_role(col_name, series, total_rows)
        # Override: if data_type is currency, force measure
        if data_type == "currency":
            column_role = "measure"

        display_name = col_name.replace("_", " ").strip().title()

        meta: dict = {
            "source_name": col_name,
            "display_name": display_name,
            "data_type": data_type,
            "column_role": column_role,
            "unique_count": unique_count,
            "sample_values": _sample_values(series),
        }
        column_metadata.append(meta)

    return df, column_metadata
