from __future__ import annotations

import logging
from datetime import date, timedelta
from pathlib import Path

import polars as pl

from app.services.storage import ensure_data_dirs, get_dimension_path, write_parquet

logger = logging.getLogger(__name__)

_MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _quarter(month: int) -> int:
    return (month - 1) // 3 + 1


def _fiscal_year(d: date, fiscal_year_start_month: int) -> int:
    """Return the fiscal year for a given date.

    If fiscal year starts in January, fiscal year == calendar year.
    If fiscal year starts in any other month, fiscal year is the calendar year
    of the *start* of that fiscal year.
    """
    if fiscal_year_start_month == 1:
        return d.year
    if d.month >= fiscal_year_start_month:
        return d.year
    return d.year - 1


def _fiscal_quarter(d: date, fiscal_year_start_month: int) -> int:
    """Return the fiscal quarter (1–4)."""
    offset_month = (d.month - fiscal_year_start_month) % 12
    return offset_month // 3 + 1


def seed_calendar(
    model_id: str,
    data_dir: str,
    start_year: int = 2020,
    end_year: int = 2030,
    fiscal_year_start_month: int = 1,
) -> str:
    """Create a dim_date Parquet with one row per calendar day.

    Columns
    -------
    date_key        int     YYYYMMDD integer key
    date            date    Calendar date
    year            int     Calendar year
    quarter         int     Calendar quarter (1–4)
    month           int     Month number (1–12)
    month_name      str     Full month name
    fiscal_year     int     Fiscal year
    fiscal_quarter  int     Fiscal quarter (1–4)
    day_of_week     int     ISO weekday (1=Monday … 7=Sunday)
    day_name        str     Day name (Monday … Sunday)
    is_weekend      bool    True for Saturday/Sunday
    week_of_year    int     ISO week number

    Returns the absolute path of the written Parquet file.
    """
    ensure_data_dirs(data_dir, model_id)

    start = date(start_year, 1, 1)
    end = date(end_year, 12, 31)
    delta = end - start
    n = delta.days + 1

    logger.info(
        "Seeding dim_date for model_id=%s (%d–%d, %d rows)",
        model_id, start_year, end_year, n,
    )

    dates: list[date] = [start + timedelta(days=i) for i in range(n)]

    date_keys = [int(d.strftime("%Y%m%d")) for d in dates]
    years = [d.year for d in dates]
    quarters = [_quarter(d.month) for d in dates]
    months = [d.month for d in dates]
    month_names = [_MONTH_NAMES[d.month - 1] for d in dates]
    fiscal_years = [_fiscal_year(d, fiscal_year_start_month) for d in dates]
    fiscal_quarters = [_fiscal_quarter(d, fiscal_year_start_month) for d in dates]
    day_of_weeks = [d.isoweekday() for d in dates]
    day_names = [_DAY_NAMES[d.weekday()] for d in dates]
    is_weekends = [d.weekday() >= 5 for d in dates]
    week_of_years = [d.isocalendar()[1] for d in dates]
    year_months = [d.strftime("%Y-%m") for d in dates]

    df = pl.DataFrame({
        "date_key": pl.Series(date_keys, dtype=pl.Int32),
        "date": pl.Series(dates, dtype=pl.Date),
        "year": pl.Series(years, dtype=pl.Int32),
        "quarter": pl.Series(quarters, dtype=pl.Int32),
        "month": pl.Series(months, dtype=pl.Int32),
        "month_name": pl.Series(month_names, dtype=pl.String),
        "fiscal_year": pl.Series(fiscal_years, dtype=pl.Int32),
        "fiscal_quarter": pl.Series(fiscal_quarters, dtype=pl.Int32),
        "day_of_week": pl.Series(day_of_weeks, dtype=pl.Int32),
        "day_name": pl.Series(day_names, dtype=pl.String),
        "is_weekend": pl.Series(is_weekends, dtype=pl.Boolean),
        "week_of_year": pl.Series(week_of_years, dtype=pl.Int32),
        "year_month": pl.Series(year_months, dtype=pl.String),
    })

    path = get_dimension_path(data_dir, model_id, "dim_date")
    write_parquet(df, path)
    logger.info("dim_date written to %s (%d rows)", path, len(df))
    return path
