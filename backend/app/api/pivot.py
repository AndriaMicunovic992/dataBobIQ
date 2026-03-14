from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.schemas.pivot import PivotRequest, PivotResponse
from app.services.pivot_engine import execute_pivot

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pivot"])


@router.post("/pivot", response_model=PivotResponse)
async def run_pivot(body: PivotRequest) -> PivotResponse:
    """Execute a server-side pivot/aggregation query via DuckDB.

    Accepts a pivot configuration and returns aggregated results (10–500 rows).
    All computation happens in DuckDB; no full dataset is loaded into Python memory.
    """
    logger.info(
        "Pivot request dataset_id=%s row_dims=%s measures=%d",
        body.dataset_id,
        body.row_dimensions,
        len(body.measures),
    )
    try:
        response = execute_pivot(
            request=body,
            dataset_id=body.dataset_id,
            scenario_ids=body.scenario_ids or None,
        )
    except Exception as exc:
        logger.exception("Pivot query failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Pivot query failed: {exc}") from exc

    return response
