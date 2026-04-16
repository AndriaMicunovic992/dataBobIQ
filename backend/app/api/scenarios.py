from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import get_db
from app.models.metadata import (
    Dataset,
    DatasetColumn,
    DatasetRelationship,
    Model,
    Scenario,
    ScenarioRule,
)
from app.schemas.scenarios import (
    ScenarioCreate,
    ScenarioHeadline,
    ScenarioResponse,
    ScenarioRuleCreate,
    ScenarioRuleResponse,
    ScenarioRuleUpdate,
    ScenarioSummariesResponse,
    ScenarioSummary,
    ScenarioUpdate,
    SparklinePoint,
)
from app.services.scenario_engine import (
    recompute_scenario as recompute_scenario_svc,
    compute_variance,
    execute_waterfall,
)

# Canonical-name preference order for picking a "headline" measure and a
# sparkline time dimension when the caller hasn't said which to use. These
# are heuristics for the Phase 1 summaries endpoint.
_HEADLINE_MEASURE_CANDIDATES = ("amount", "revenue", "net_amount", "value", "total")
_TIME_DIM_CANDIDATES = ("year_month", "fiscal_period", "period", "month", "year")

logger = logging.getLogger(__name__)

router = APIRouter(tags=["scenarios"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_model_dataset_ids(model_id: str, db: AsyncSession) -> list[str]:
    """Return all active dataset IDs for a model."""
    result = await db.execute(
        select(Dataset.id).where(
            Dataset.model_id == model_id,
            Dataset.status == "active",
        )
    )
    return [row[0] for row in result.all()]


async def _resolve_scenario_dataset_id(scenario: Scenario, db: AsyncSession) -> str:
    """Return scenario.dataset_id, falling back to the first active dataset of its model."""
    if scenario.dataset_id:
        return scenario.dataset_id
    dataset_ids = await _get_model_dataset_ids(scenario.model_id, db)
    if not dataset_ids:
        raise HTTPException(status_code=404, detail="No active datasets found for this model")
    return dataset_ids[0]


async def _recompute_from_db(scenario: Scenario, db: AsyncSession) -> int:
    """Helper to recompute scenario from its rules across all model datasets."""
    rules = [
        {
            "name": r.name,
            "rule_type": r.rule_type,
            "target_field": r.target_field,
            "dataset_id": r.dataset_id,
            "adjustment": r.adjustment,
            "filter_expr": r.filter_expr,
            "period_from": r.period_from,
            "period_to": r.period_to,
            "distribution": r.distribution,
        }
        for r in scenario.rules
    ]
    dataset_ids = await _get_model_dataset_ids(scenario.model_id, db)
    return await asyncio.to_thread(
        recompute_scenario_svc,
        scenario_id=scenario.id,
        rules=rules,
        model_id=scenario.model_id,
        data_dir=settings.data_dir,
        dataset_ids=dataset_ids,
        dataset_id=scenario.dataset_id,
        base_config=scenario.base_config,
    )


async def _get_scenario_or_404(scenario_id: str, db: AsyncSession) -> Scenario:
    result = await db.execute(
        select(Scenario)
        .options(selectinload(Scenario.rules))
        .where(Scenario.id == scenario_id)
    )
    scenario = result.unique().scalar_one_or_none()
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
    """Create a new scenario for a model.

    Scenarios are model-level and can span all datasets. The dataset_id field
    on the scenario is optional; individual rules can target specific datasets
    via their own dataset_id field (auto-resolved when omitted).
    """
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

    # Re-fetch with eager-loaded rules to avoid MissingGreenlet on serialization
    result = await db.execute(
        select(Scenario)
        .options(selectinload(Scenario.rules))
        .where(Scenario.id == scenario.id)
    )
    scenario = result.unique().scalar_one()
    logger.info("Created scenario id=%s model_id=%s", scenario.id, model_id)

    # Trigger recompute if rules were provided at creation time
    if scenario.rules:
        try:
            await _recompute_from_db(scenario, db)
        except Exception as exc:
            logger.warning("Recompute after create failed for scenario %s: %s", scenario.id, exc)

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
    scenarios = result.scalars().unique().all()
    return [ScenarioResponse.model_validate(s) for s in scenarios]


# ---------------------------------------------------------------------------
# Agent Workspace: per-model scenario summaries
#
# Returns everything the "scenario cockpit" needs in one round-trip:
# name, color, rule count, a headline delta vs. actuals, and a 12-period
# sparkline. The frontend reads this to paint the ScenarioCard grid on the
# AgentWorkspace home view.
#
# Headline measure and sparkline time dimension are picked heuristically
# from the model's active dataset columns. If a scenario hasn't been
# computed yet (no overlay parquet), we surface it with a null headline
# rather than forcing an auto-recompute — keeping the endpoint cheap.
# ---------------------------------------------------------------------------


def _pick_summary_columns(columns: list[DatasetColumn]) -> tuple[str | None, str | None]:
    """From a dataset's columns, pick a headline measure and a time dimension.

    Prefers canonical names from the candidate lists, falls back to the
    first measure / first date-like dimension. Returns (measure, time_dim)
    — either may be None if nothing suitable exists.
    """
    measures = [c for c in columns if c.column_role == "measure"]
    dims = [c for c in columns if c.column_role == "dimension"]

    def _pick(cols: list[DatasetColumn], candidates: tuple[str, ...]) -> str | None:
        by_canonical = {(c.canonical_name or "").lower(): c for c in cols if c.canonical_name}
        for cand in candidates:
            hit = by_canonical.get(cand)
            if hit:
                return hit.canonical_name or hit.source_name
        return None

    measure = _pick(measures, _HEADLINE_MEASURE_CANDIDATES)
    if measure is None and measures:
        measure = measures[0].canonical_name or measures[0].source_name

    time_dim = _pick(dims, _TIME_DIM_CANDIDATES)
    if time_dim is None:
        # Last-resort fallback: any dimension whose name hints at time
        for d in dims:
            name = (d.canonical_name or d.source_name or "").lower()
            if any(token in name for token in ("month", "period", "year", "date", "quarter")):
                time_dim = d.canonical_name or d.source_name
                break

    return measure, time_dim


def _compute_scenario_summary(
    scenario: Scenario,
    dataset_id: str,
    measure: str | None,
    time_dim: str | None,
    model_id: str,
    data_dir: str,
) -> tuple[ScenarioHeadline | None, list[SparklinePoint]]:
    """Run compute_variance for one scenario and shape the output.

    Swallows failures and returns (None, []) so one broken scenario can't
    wreck the whole cockpit payload.
    """
    if measure is None or time_dim is None:
        return None, []

    try:
        variance = compute_variance(
            dataset_id=dataset_id,
            scenario_id=scenario.id,
            group_by=[time_dim],
            value_field=measure,
            filters=None,
            model_id=model_id,
            data_dir=data_dir,
        )
    except Exception as exc:
        logger.info(
            "summaries: skipping headline for scenario %s (%s)", scenario.id, exc
        )
        return None, []

    headline = ScenarioHeadline(
        measure=measure,
        baseline=float(variance.get("total_actual") or 0.0),
        scenario=float(variance.get("total_scenario") or 0.0),
        delta=float(variance.get("total_delta") or 0.0),
        delta_pct=variance.get("total_delta_pct"),
    )

    # Turn the variance groups into a time-ordered sparkline. We sort by the
    # period label itself, which works for ISO-ish strings (2026-01, 2026Q1,
    # 2026, etc.) and for integers.
    groups = variance.get("groups") or []
    points: list[SparklinePoint] = []
    for g in groups:
        period_val = (g.get("group") or {}).get(time_dim)
        if period_val is None:
            continue
        points.append(
            SparklinePoint(
                period=str(period_val),
                baseline=float(g.get("actual") or 0.0),
                scenario=float(g.get("scenario") or 0.0),
            )
        )
    points.sort(key=lambda p: p.period)
    # Cap at a reasonable sparkline length.
    if len(points) > 24:
        points = points[-24:]

    return headline, points


@router.get(
    "/models/{model_id}/scenarios/summaries",
    response_model=ScenarioSummariesResponse,
)
async def list_scenario_summaries(
    model_id: str,
    db: AsyncSession = Depends(get_db),
) -> ScenarioSummariesResponse:
    """Return a cockpit-ready summary for every scenario in a model.

    Used by the Agent Workspace home view to render scenario cards without
    the frontend firing one pivot request per scenario.
    """
    # 1. Validate model exists
    result = await db.execute(select(Model).where(Model.id == model_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail=f"Model {model_id} not found")

    # 2. Load all scenarios with their rules
    result = await db.execute(
        select(Scenario)
        .options(selectinload(Scenario.rules))
        .where(Scenario.model_id == model_id)
        .order_by(Scenario.created_at.desc())
    )
    scenarios = result.scalars().unique().all()

    # 3. Pick the target dataset + its columns. Headline and sparkline both
    #    live on the first active dataset. Multi-dataset models will still
    #    get working cards, but the heuristic measure will come from only
    #    one dataset in Phase 1.
    ds_result = await db.execute(
        select(Dataset)
        .where(Dataset.model_id == model_id, Dataset.status == "active")
        .order_by(Dataset.id)
    )
    active_datasets = list(ds_result.scalars().all())

    measure: str | None = None
    time_dim: str | None = None
    primary_dataset_id: str | None = None

    if active_datasets:
        primary = active_datasets[0]
        primary_dataset_id = primary.id
        col_result = await db.execute(
            select(DatasetColumn).where(DatasetColumn.dataset_id == primary.id)
        )
        cols = list(col_result.scalars().all())
        measure, time_dim = _pick_summary_columns(cols)

    # 4. For each scenario compute headline + sparkline (off the event loop)
    summaries: list[ScenarioSummary] = []
    for scenario in scenarios:
        headline: ScenarioHeadline | None = None
        sparkline: list[SparklinePoint] = []

        target_dataset_id = scenario.dataset_id or primary_dataset_id
        if target_dataset_id and measure and time_dim:
            headline, sparkline = await asyncio.to_thread(
                _compute_scenario_summary,
                scenario,
                target_dataset_id,
                measure,
                time_dim,
                model_id,
                settings.data_dir,
            )

        summaries.append(
            ScenarioSummary(
                id=scenario.id,
                name=scenario.name,
                color=scenario.color,
                rule_count=len(scenario.rules or []),
                created_at=scenario.created_at,
                headline=headline,
                sparkline=sparkline,
            )
        )

    return ScenarioSummariesResponse(
        model_id=model_id,
        measure=measure,
        period_field=time_dim,
        scenarios=summaries,
    )


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
    await _get_scenario_or_404(scenario_id, db)

    rule = ScenarioRule(scenario_id=scenario_id, **body.model_dump())
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    logger.info("Added rule id=%s to scenario id=%s", rule.id, scenario_id)

    # Re-fetch scenario with all rules (including the just-added one)
    scenario = await _get_scenario_or_404(scenario_id, db)
    try:
        affected = await _recompute_from_db(scenario, db)
        logger.info("Recompute after add_rule: scenario %s, affected=%d, rules=%d", scenario_id, affected, len(scenario.rules))
    except Exception as exc:
        logger.exception("Recompute after add_rule failed for scenario %s: %s", scenario_id, exc)

    return ScenarioRuleResponse.model_validate(rule)


@router.put(
    "/scenarios/{scenario_id}/rules/{rule_id}",
    response_model=ScenarioRuleResponse,
)
async def update_rule(
    scenario_id: str,
    rule_id: str,
    body: ScenarioRuleUpdate,
    db: AsyncSession = Depends(get_db),
) -> ScenarioRuleResponse:
    """Update a rule's fields and trigger recompute."""
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

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(rule, field, value)

    await db.commit()
    await db.refresh(rule)
    logger.info("Updated rule id=%s in scenario id=%s", rule_id, scenario_id)

    scenario = await _get_scenario_or_404(scenario_id, db)
    try:
        await _recompute_from_db(scenario, db)
    except Exception as exc:
        logger.warning("Recompute after update_rule failed for scenario %s: %s", scenario_id, exc)

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
        await _recompute_from_db(scenario, db)
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
        affected = await _recompute_from_db(scenario, db)
    except Exception as exc:
        logger.exception("Recompute failed for scenario %s: %s", scenario_id, exc)
        raise HTTPException(status_code=500, detail=f"Recompute failed: {exc}") from exc

    logger.info("Recomputed scenario id=%s, affected=%d", scenario_id, affected)
    return {"status": "ok", "scenario_id": scenario_id, "affected_rows": affected}


async def _get_model_relationships(model_id: str, db: AsyncSession) -> list:
    """Fetch all dataset relationships for a model."""
    result = await db.execute(
        select(DatasetRelationship).where(DatasetRelationship.model_id == model_id)
    )
    return list(result.scalars().all())


@router.get("/scenarios/{scenario_id}/variance")
async def get_variance(
    scenario_id: str,
    group_by: str = Query(..., description="Comma-separated dimension columns to group by"),
    value_field: str = Query(..., description="Measure column to aggregate"),
    filters: str | None = Query(None, description="JSON-encoded filter dict"),
    join_dimensions: str | None = Query(None, description="JSON-encoded {field: dataset_id} map for cross-dataset dims"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Compute actuals-vs-scenario variance for given dimensions.

    Returns rows with base_value, scenario_value, and absolute/relative variance.
    Supports cross-dataset dimensions via join_dimensions parameter.
    """
    group_by_list = [col.strip() for col in group_by.split(",") if col.strip()]
    parsed_filters: dict[str, Any] = {}
    if filters:
        try:
            parsed_filters = json.loads(filters)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid filters JSON: {exc}") from exc

    parsed_join_dims: dict[str, str] | None = None
    if join_dimensions:
        try:
            parsed_join_dims = json.loads(join_dimensions)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid join_dimensions JSON: {exc}") from exc

    scenario = await _get_scenario_or_404(scenario_id, db)
    dataset_id = await _resolve_scenario_dataset_id(scenario, db)

    # Fetch relationships if cross-dataset JOINs are needed
    relationships = None
    if parsed_join_dims:
        relationships = await _get_model_relationships(scenario.model_id, db)

    for attempt in range(2):
        try:
            result = await asyncio.to_thread(
                compute_variance,
                dataset_id=dataset_id,
                scenario_id=scenario_id,
                group_by=group_by_list,
                value_field=value_field,
                filters=parsed_filters if parsed_filters else None,
                model_id=scenario.model_id,
                data_dir=settings.data_dir,
                join_dimensions=parsed_join_dims,
                relationships=relationships,
            )
            return result
        except (ValueError, Exception) as exc:
            if attempt == 0 and "no computed data" in str(exc).lower():
                logger.info("Scenario %s missing parquet, auto-recomputing...", scenario_id)
                try:
                    await _recompute_from_db(scenario, db)
                    continue
                except Exception as recomp_exc:
                    raise HTTPException(status_code=500, detail=f"Auto-recompute failed: {recomp_exc}") from recomp_exc
            logger.exception("Variance query failed for scenario %s: %s", scenario_id, exc)
            raise HTTPException(status_code=500, detail=f"Variance computation failed: {exc}") from exc

    raise HTTPException(status_code=500, detail="Variance computation failed after auto-recompute")


@router.get("/scenarios/{scenario_id}/waterfall")
async def get_waterfall(
    scenario_id: str,
    breakdown_field: str = Query(..., description="Dimension column to break down by"),
    value_field: str = Query(..., description="Measure column to aggregate"),
    filters: str | None = Query(None, description="JSON-encoded filter dict"),
    join_dimensions: str | None = Query(None, description="JSON-encoded {field: dataset_id} map for cross-dataset dims"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Compute waterfall/bridge data showing contribution of each breakdown segment.

    Returns ordered rows suitable for rendering a waterfall chart.
    Supports cross-dataset dimensions via join_dimensions parameter.
    """
    parsed_filters: dict[str, Any] = {}
    if filters:
        try:
            parsed_filters = json.loads(filters)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid filters JSON: {exc}") from exc

    parsed_join_dims: dict[str, str] | None = None
    if join_dimensions:
        try:
            parsed_join_dims = json.loads(join_dimensions)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid join_dimensions JSON: {exc}") from exc

    scenario = await _get_scenario_or_404(scenario_id, db)
    dataset_id = await _resolve_scenario_dataset_id(scenario, db)

    # Fetch relationships if cross-dataset JOINs are needed
    relationships = None
    if parsed_join_dims:
        relationships = await _get_model_relationships(scenario.model_id, db)

    for attempt in range(2):
        try:
            rows = await asyncio.to_thread(
                execute_waterfall,
                dataset_id=dataset_id,
                scenario_id=scenario_id,
                breakdown_field=breakdown_field,
                value_field=value_field,
                filters=parsed_filters if parsed_filters else None,
                model_id=scenario.model_id,
                data_dir=settings.data_dir,
                join_dimensions=parsed_join_dims,
                relationships=relationships,
            )
            break
        except (ValueError, Exception) as exc:
            if attempt == 0 and "no computed data" in str(exc).lower():
                logger.info("Scenario %s missing parquet, auto-recomputing...", scenario_id)
                try:
                    await _recompute_from_db(scenario, db)
                    continue
                except Exception as recomp_exc:
                    raise HTTPException(status_code=500, detail=f"Auto-recompute failed: {recomp_exc}") from recomp_exc
            logger.exception("Waterfall query failed for scenario %s: %s", scenario_id, exc)
            raise HTTPException(status_code=500, detail=f"Waterfall computation failed: {exc}") from exc

    return {"scenario_id": scenario_id, "steps": rows}
