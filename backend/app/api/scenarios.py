from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.metadata import Model, Scenario, ScenarioRule
from app.schemas.scenarios import (
    ScenarioCreate,
    ScenarioResponse,
    ScenarioRuleCreate,
    ScenarioRuleResponse,
    ScenarioUpdate,
)
from app.services.scenario_engine import (
    recompute_scenario as recompute_scenario_svc,
    compute_variance,
    execute_waterfall,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["scenarios"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _recompute_from_db(scenario: Scenario, db: AsyncSession) -> int:
    """Helper to recompute scenario from its rules."""
    rules = [
        {"name": r.name, "rule_type": r.rule_type, "target_field": r.target_field,
         "adjustment": r.adjustment, "filter_expr": r.filter_expr,
         "period_from": r.period_from, "period_to": r.period_to,
         "distribution": r.distribution}
        for r in scenario.rules
    ]
    return recompute_scenario_svc(
        dataset_id=scenario.dataset_id,
        scenario_id=scenario.id,
        rules=rules,
    )


async def _get_scenario_or_404(scenario_id: str, db: AsyncSession) -> Scenario:
    result = await db.execute(
        select(Scenario)
        .options(selectinload(Scenario.rules))
        .where(Scenario.id == scenario_id)
    )
    scenario = result.scalar_one_or_none()
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Scenario {scenario_id} not found")
    return scenario


# ---------------------------------------------------------------------------
# Scenario CRUD
# ---------------------------------------------------------------------------


@router.post("/models/{model_id}/scenarios", response_model=ScenarioResponse, status_code=201)
async def create_scenario(
    model_id: str,
    body: ScenarioCreate,
    db: AsyncSession = Depends(get_db),
) -> ScenarioResponse:
    """Create a new scenario for a model."""
    result = await db.execute(select(Model).where(Model.id == model_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    scenario = Scenario(model_id=model_id, **body.model_dump(exclude={"rules"}))
    db.add(scenario)
    await db.flush()

    if body.rules:
        for rule_data in body.rules:
            rule = ScenarioRule(scenario_id=scenario.id, **rule_data.model_dump())
            db.add(rule)

    await db.commit()
    await db.refresh(scenario)
    logger.info("Created scenario id=%s model_id=%s", scenario.id, model_id)
    return ScenarioResponse.model_validate(scenario)


@router.get("/models/{model_id}/scenarios", response_model=list[ScenarioResponse])
async def list_scenarios(
    model_id: str,
    db: AsyncSession = Depends(get_db),
) -> list[ScenarioResponse]:
    """List all scenarios for a model."""
    result = await db.execute(select(Model).where(Model.id == model_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    result = await db.execute(
        select(Scenario)
        .options(selectinload(Scenario.rules))
        .where(Scenario.model_id == model_id)
        .order_by(Scenario.created_at.desc())
    )
    scenarios = result.scalars().all()
    return [ScenarioResponse.model_validate(s) for s in scenarios]


@router.get("/scenarios/{scenario_id}", response_model=ScenarioResponse)
async def get_scenario(
    scenario_id: str,
    db: AsyncSession = Depends(get_db),
) -> ScenarioResponse:
    """Return a single scenario with its rules."""
    scenario = await _get_scenario_or_404(scenario_id, db)
    return ScenarioResponse.model_validate(scenario)


@router.put("/scenarios/{scenario_id}", response_model=ScenarioResponse)
async def update_scenario(
    scenario_id: str,
    body: ScenarioUpdate,
    db: AsyncSession = Depends(get_db),
) -> ScenarioResponse:
    """Update scenario metadata (name, description)."""
    scenario = await _get_scenario_or_404(scenario_id, db)

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(scenario, field, value)

    await db.commit()
    await db.refresh(scenario)
    logger.info("Updated scenario id=%s", scenario_id)
    return ScenarioResponse.model_validate(scenario)


@router.delete("/scenarios/{scenario_id}", status_code=204)
async def delete_scenario(
    scenario_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a scenario and all its override rules."""
    scenario = await _get_scenario_or_404(scenario_id, db)
    await db.delete(scenario)
    await db.commit()
    logger.info("Deleted scenario id=%s", scenario_id)


# ---------------------------------------------------------------------------
# Rule management
# ---------------------------------------------------------------------------


@router.post(
    "/scenarios/{scenario_id}/rules",
    response_model=ScenarioRuleResponse,
    status_code=201,
)
async def add_rule(
    scenario_id: str,
    body: ScenarioRuleCreate,
    db: AsyncSession = Depends(get_db),
) -> ScenarioRuleResponse:
    """Add a delta-override rule to a scenario and trigger recompute."""
    scenario = await _get_scenario_or_404(scenario_id, db)

    rule = ScenarioRule(scenario_id=scenario.id, **body.model_dump())
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    logger.info("Added rule id=%s to scenario id=%s", rule.id, scenario_id)

    try:
        _recompute_from_db(scenario, db)
    except Exception as exc:
        logger.warning("Recompute after add_rule failed for scenario %s: %s", scenario_id, exc)

    return ScenarioRuleResponse.model_validate(rule)


@router.delete("/scenarios/{scenario_id}/rules/{rule_id}", status_code=204)
async def delete_rule(
    scenario_id: str,
    rule_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a rule from a scenario and trigger recompute."""
    result = await db.execute(
        select(ScenarioRule).where(
            ScenarioRule.id == rule_id, ScenarioRule.scenario_id == scenario_id
        )
    )
    rule = result.scalar_one_or_none()
    if rule is None:
        raise HTTPException(
            status_code=404,
            detail=f"Rule {rule_id} not found in scenario {scenario_id}",
        )

    await db.delete(rule)
    await db.commit()
    logger.info("Deleted rule id=%s from scenario id=%s", rule_id, scenario_id)

    scenario = await _get_scenario_or_404(scenario_id, db)
    try:
        _recompute_from_db(scenario, db)
    except Exception as exc:
        logger.warning("Recompute after delete_rule failed for scenario %s: %s", scenario_id, exc)


# ---------------------------------------------------------------------------
# Compute / analytics
# ---------------------------------------------------------------------------


@router.post("/scenarios/{scenario_id}/recompute", status_code=200)
async def recompute_scenario(
    scenario_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Force recompute of a scenario's overlaid Parquet."""
    await _get_scenario_or_404(scenario_id, db)

    scenario = await _get_scenario_or_404(scenario_id, db)
    try:
        affected = _recompute_from_db(scenario, db)
    except Exception as exc:
        logger.exception("Recompute failed for scenario %s: %s", scenario_id, exc)
        raise HTTPException(status_code=500, detail=f"Recompute failed: {exc}") from exc

    logger.info("Recomputed scenario id=%s, affected=%d", scenario_id, affected)
    return {"status": "ok", "scenario_id": scenario_id, "affected_rows": affected}


@router.get("/scenarios/{scenario_id}/variance")
async def get_variance(
    scenario_id: str,
    group_by: str = Query(..., description="Comma-separated dimension columns to group by"),
    value_field: str = Query(..., description="Measure column to aggregate"),
    filters: str | None = Query(None, description="JSON-encoded filter dict"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Compute actuals-vs-scenario variance for given dimensions.

    Returns rows with base_value, scenario_value, and absolute/relative variance.
    """
    await _get_scenario_or_404(scenario_id, db)

    group_by_list = [col.strip() for col in group_by.split(",") if col.strip()]
    parsed_filters: dict[str, Any] = {}
    if filters:
        try:
            parsed_filters = json.loads(filters)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid filters JSON: {exc}") from exc

    scenario = await _get_scenario_or_404(scenario_id, db)
    try:
        result = compute_variance(
            dataset_id=scenario.dataset_id,
            scenario_id=scenario_id,
            group_by=group_by_list,
            value_field=value_field,
            filters=parsed_filters if parsed_filters else None,
        )
    except Exception as exc:
        logger.exception("Variance query failed for scenario %s: %s", scenario_id, exc)
        raise HTTPException(status_code=500, detail=f"Variance computation failed: {exc}") from exc

    return result


@router.get("/scenarios/{scenario_id}/waterfall")
async def get_waterfall(
    scenario_id: str,
    breakdown_field: str = Query(..., description="Dimension column to break down by"),
    value_field: str = Query(..., description="Measure column to aggregate"),
    filters: str | None = Query(None, description="JSON-encoded filter dict"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Compute waterfall/bridge data showing contribution of each breakdown segment.

    Returns ordered rows suitable for rendering a waterfall chart.
    """
    await _get_scenario_or_404(scenario_id, db)

    parsed_filters: dict[str, Any] = {}
    if filters:
        try:
            parsed_filters = json.loads(filters)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid filters JSON: {exc}") from exc

    scenario = await _get_scenario_or_404(scenario_id, db)
    try:
        rows = execute_waterfall(
            dataset_id=scenario.dataset_id,
            scenario_id=scenario_id,
            breakdown_field=breakdown_field,
            value_field=value_field,
            filters=parsed_filters if parsed_filters else None,
        )
    except Exception as exc:
        logger.exception("Waterfall query failed for scenario %s: %s", scenario_id, exc)
        raise HTTPException(status_code=500, detail=f"Waterfall computation failed: {exc}") from exc

    return {"scenario_id": scenario_id, "steps": rows}
