from __future__ import annotations

import logging
from typing import Any

from app.fact_types.registry import ColumnDef, FactTypeDefinition, load_fact_types

logger = logging.getLogger(__name__)

# Minimum confidence to claim a match
_MIN_CONFIDENCE = 0.25


def _normalize(s: str) -> str:
    """Lowercase + strip common separators for fuzzy matching."""
    return s.lower().replace(" ", "_").replace("-", "_").replace(".", "_")


def _alias_score(source_name: str, col_def: ColumnDef) -> float:
    """Score 0–1 for how well source_name matches a ColumnDef's aliases.

    Exact alias match → 1.0
    Source name contains alias → 0.6
    Alias contains source name → 0.4
    No match → 0.0
    """
    norm_source = _normalize(source_name)
    for alias in col_def.aliases:
        norm_alias = _normalize(alias)
        if norm_source == norm_alias:
            return 1.0
        if norm_alias in norm_source:
            return 0.6
        if norm_source in norm_alias:
            return 0.4
    return 0.0


def match_fact_type(
    columns: list[dict],
    fact_type: FactTypeDefinition,
) -> tuple[float, dict]:
    """Score how well the provided columns match a FactTypeDefinition.

    Returns
    -------
    (confidence, mapping_hints)
        confidence: 0.0–1.0
        mapping_hints: {source_column_name: canonical_name}
    """
    all_core = fact_type.core_measures + fact_type.core_dimensions
    all_expected = fact_type.expected_measures + fact_type.expected_dimensions

    mapping_hints: dict[str, str] = {}
    matched_core: set[str] = set()
    matched_expected: set[str] = set()

    source_names = [c["source_name"] for c in columns]

    # --- Match each source column to the best canonical field ---
    for col in columns:
        src = col["source_name"]
        best_score = 0.0
        best_canonical: str | None = None

        for col_def in all_core + all_expected:
            s = _alias_score(src, col_def)
            if s > best_score:
                best_score = s
                best_canonical = col_def.name

        if best_canonical and best_score >= 0.4:
            mapping_hints[src] = best_canonical
            # Track if core or expected
            for c in all_core:
                if c.name == best_canonical:
                    matched_core.add(best_canonical)
            for c in all_expected:
                if c.name == best_canonical:
                    matched_expected.add(best_canonical)

    if not all_core:
        return 0.0, mapping_hints

    # --- Compute confidence ---
    # Core fields are mandatory: fraction matched carries 70% of score
    core_ratio = len(matched_core) / len(all_core)
    # Expected fields: fraction matched carries 30%
    expected_ratio = (
        len(matched_expected) / len(all_expected) if all_expected else 1.0
    )

    confidence = round(0.70 * core_ratio + 0.30 * expected_ratio, 4)
    logger.debug(
        "Fact type %s: core_ratio=%.2f expected_ratio=%.2f confidence=%.4f",
        fact_type.id,
        core_ratio,
        expected_ratio,
        confidence,
    )
    return confidence, mapping_hints


def classify_upload(
    columns: list[dict],
    sample_rows: list[dict],
) -> tuple[str, float, dict]:
    """Match upload columns against all registered fact types.

    Returns
    -------
    (fact_type_id, confidence_score, mapping_hints)
        Falls back to 'financial_transactions' with low confidence if no
        good match is found.
    """
    registry = load_fact_types()

    if not registry:
        logger.warning("Fact type registry is empty; defaulting to financial_transactions")
        return "financial_transactions", 0.0, {}

    best_type_id = "financial_transactions"
    best_confidence = 0.0
    best_hints: dict[str, str] = {}

    for fact_type_id, fact_type in registry.items():
        confidence, hints = match_fact_type(columns, fact_type)
        if confidence > best_confidence:
            best_confidence = confidence
            best_type_id = fact_type_id
            best_hints = hints

    # If confidence is too low, still default to financial_transactions
    if best_confidence < _MIN_CONFIDENCE and "financial_transactions" in registry:
        logger.info(
            "Low confidence (%.4f) for all fact types; defaulting to financial_transactions",
            best_confidence,
        )
        ft = registry["financial_transactions"]
        _, hints = match_fact_type(columns, ft)
        return "financial_transactions", best_confidence, hints

    logger.info(
        "Classified upload as '%s' with confidence %.4f",
        best_type_id,
        best_confidence,
    )
    return best_type_id, best_confidence, best_hints
