from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.database import Base

logger = logging.getLogger(__name__)


def _new_uuid() -> str:
    return str(uuid.uuid4())


class Model(Base):
    """Top-level workspace container — one per financial model / company."""

    __tablename__ = "models"
    __allow_unmapped__ = True

    id: str = Column(String, primary_key=True, default=_new_uuid)
    name: str = Column(String(255), nullable=False)
    description: str | None = Column(Text, nullable=True)
    status: str = Column(String(50), nullable=False, default="active")
    settings: dict[str, Any] | None = Column(JSONB, nullable=True)
    created_at: datetime = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: datetime | None = Column(
        DateTime(timezone=True), nullable=True, onupdate=func.now()
    )

    datasets: list[Dataset] = relationship(
        "Dataset", back_populates="model", cascade="all, delete-orphan", uselist=True
    )
    scenarios: list[Scenario] = relationship(
        "Scenario", back_populates="model", cascade="all, delete-orphan", uselist=True
    )
    kpi_definitions: list[KPIDefinition] = relationship(
        "KPIDefinition", back_populates="model", cascade="all, delete-orphan", uselist=True
    )
    knowledge_entries: list[KnowledgeEntry] = relationship(
        "KnowledgeEntry", back_populates="model", cascade="all, delete-orphan", uselist=True
    )
    dataset_relationships: list[DatasetRelationship] = relationship(
        "DatasetRelationship",
        back_populates="model",
        cascade="all, delete-orphan",
        foreign_keys="DatasetRelationship.model_id",
        uselist=True,
    )


class Dataset(Base):
    """Represents an uploaded ERP/accounting export file."""

    __tablename__ = "datasets"
    __allow_unmapped__ = True

    id: str = Column(String, primary_key=True, default=_new_uuid)
    model_id: str | None = Column(
        String, ForeignKey("models.id", ondelete="CASCADE"), nullable=True
    )
    name: str = Column(String(255), nullable=False)
    source_filename: str | None = Column(String(512), nullable=True)
    fact_type: str = Column(String(100), nullable=False, default="financial_transactions")
    mapping_config: dict[str, Any] | None = Column(JSONB, nullable=True)
    parquet_path: str | None = Column(String(512), nullable=True)
    row_count: int = Column(Integer, nullable=False, default=0)
    status: str = Column(
        String(50),
        nullable=False,
        default="pending",
        # valid: pending|queued|parsing|parsed|mapping|mapped_pending_review|materializing|active|error
    )
    data_layer: str = Column(String(50), nullable=False, default="raw")
    ai_analyzed: bool = Column(Boolean, nullable=False, default=False)
    ai_notes: dict[str, Any] | None = Column(JSONB, nullable=True)
    agent_context_notes: dict[str, Any] | None = Column(JSONB, nullable=True)
    created_at: datetime = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: datetime | None = Column(
        DateTime(timezone=True), nullable=True, onupdate=func.now()
    )

    model: Model | None = relationship("Model", back_populates="datasets")
    columns: list[DatasetColumn] = relationship(
        "DatasetColumn", back_populates="dataset", cascade="all, delete-orphan", uselist=True
    )
    scenarios: list[Scenario] = relationship(
        "Scenario", back_populates="dataset", cascade="all, delete-orphan", uselist=True
    )
    knowledge_entries: list[KnowledgeEntry] = relationship(
        "KnowledgeEntry", back_populates="dataset", uselist=True
    )
    semantic_columns: list[SemanticColumn] = relationship(
        "SemanticColumn", back_populates="dataset", cascade="all, delete-orphan", uselist=True
    )


class DatasetColumn(Base):
    """Metadata for a single column in a Dataset."""

    __tablename__ = "dataset_columns"
    __allow_unmapped__ = True
    __table_args__ = (
        UniqueConstraint("dataset_id", "source_name", name="uq_column_dataset_source"),
    )

    id: str = Column(String, primary_key=True, default=_new_uuid)
    dataset_id: str = Column(
        String, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False
    )
    source_name: str = Column(String(255), nullable=False)
    canonical_name: str | None = Column(String(255), nullable=True)
    display_name: str = Column(String(255), nullable=False)
    data_type: str = Column(String(50), nullable=False, default="string")
    column_role: str = Column(String(50), nullable=False, default="dimension")
    column_tier: str | None = Column(String(50), nullable=True)
    shared_dim: str | None = Column(String(100), nullable=True)
    unique_count: int | None = Column(Integer, nullable=True)
    sample_values: list[Any] | None = Column(JSONB, nullable=True)
    ai_suggestion: dict[str, Any] | None = Column(JSONB, nullable=True)

    dataset: Dataset = relationship("Dataset", back_populates="columns")


class Scenario(Base):
    """A what-if scenario with delta overlay rules."""

    __tablename__ = "scenarios"
    __allow_unmapped__ = True

    id: str = Column(String, primary_key=True, default=_new_uuid)
    model_id: str | None = Column(
        String, ForeignKey("models.id", ondelete="CASCADE"), nullable=True
    )
    dataset_id: str = Column(
        String, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False
    )
    name: str = Column(String(255), nullable=False)
    description: str | None = Column(Text, nullable=True)
    base_config: dict[str, Any] | None = Column(JSONB, nullable=True)
    color: str | None = Column(String(20), nullable=True)
    overrides_path: str | None = Column(String(512), nullable=True)
    created_at: datetime = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: datetime | None = Column(
        DateTime(timezone=True), nullable=True, onupdate=func.now()
    )

    model: Model | None = relationship("Model", back_populates="scenarios")
    dataset: Dataset = relationship("Dataset", back_populates="scenarios")
    rules: list[ScenarioRule] = relationship(
        "ScenarioRule", back_populates="scenario", cascade="all, delete-orphan", uselist=True
    )


class ScenarioRule(Base):
    """A single delta override rule within a scenario."""

    __tablename__ = "scenario_rules"
    __allow_unmapped__ = True

    id: str = Column(String, primary_key=True, default=_new_uuid)
    scenario_id: str = Column(
        String, ForeignKey("scenarios.id", ondelete="CASCADE"), nullable=False
    )
    priority: int = Column(Integer, nullable=False, default=0)
    name: str = Column(String(255), nullable=False)
    rule_type: str = Column(String(50), nullable=False)  # multiplier|offset|set_value
    target_field: str = Column(String(100), nullable=False, default="amount")
    adjustment: dict[str, Any] = Column(JSONB, nullable=False, default=dict)
    filter_expr: dict[str, Any] | None = Column(JSONB, nullable=True)
    period_from: str | None = Column(String(20), nullable=True)
    period_to: str | None = Column(String(20), nullable=True)
    distribution: str = Column(String(50), nullable=False, default="proportional")
    affected_rows: int | None = Column(Integer, nullable=True)
    created_at: datetime = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    scenario: Scenario = relationship("Scenario", back_populates="rules")


class KPIDefinition(Base):
    """A KPI definition with expression, dependencies, and formatting."""

    __tablename__ = "kpi_definitions"
    __allow_unmapped__ = True
    __table_args__ = (UniqueConstraint("model_id", "kpi_id", name="uq_kpi_model_kpi_id"),)

    id: str = Column(String, primary_key=True, default=_new_uuid)
    model_id: str = Column(
        String, ForeignKey("models.id", ondelete="CASCADE"), nullable=False
    )
    kpi_id: str = Column(String(100), nullable=False)
    label: str = Column(String(255), nullable=False)
    kpi_type: str = Column(String(50), nullable=False)  # base_measure|derived
    expression: dict[str, Any] | str | None = Column(JSONB, nullable=True)
    depends_on: list[str] | None = Column(JSONB, nullable=True, default=list)
    format: dict[str, Any] | None = Column(JSONB, nullable=True)
    is_default: bool = Column(Boolean, nullable=False, default=False)
    status: str = Column(String(50), nullable=False, default="active")
    sort_order: int = Column(Integer, nullable=False, default=0)
    created_at: datetime = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    model: Model = relationship("Model", back_populates="kpi_definitions")


class KnowledgeEntry(Base):
    """Business context and semantic notes attached to a model or dataset."""

    __tablename__ = "knowledge_entries"
    __allow_unmapped__ = True

    id: str = Column(String, primary_key=True, default=_new_uuid)
    model_id: str = Column(
        String, ForeignKey("models.id", ondelete="CASCADE"), nullable=False
    )
    dataset_id: str | None = Column(
        String, ForeignKey("datasets.id", ondelete="SET NULL"), nullable=True
    )
    entry_type: str = Column(String(100), nullable=False)
    plain_text: str = Column(Text, nullable=False)
    content: dict[str, Any] = Column(JSONB, nullable=False, default=dict)
    confidence: str | None = Column(String(50), nullable=True, default="confirmed")
    source: str = Column(String(50), nullable=False, default="user")
    created_at: datetime = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: datetime | None = Column(
        DateTime(timezone=True), nullable=True, onupdate=func.now()
    )

    model: Model = relationship("Model", back_populates="knowledge_entries")
    dataset: Dataset | None = relationship("Dataset", back_populates="knowledge_entries")


class SemanticColumn(Base):
    """Human-readable semantic metadata for a dataset column."""

    __tablename__ = "semantic_columns"
    __allow_unmapped__ = True
    __table_args__ = (
        UniqueConstraint("dataset_id", "column_name", name="uq_semantic_column"),
    )

    id: str = Column(String, primary_key=True, default=_new_uuid)
    dataset_id: str = Column(
        String, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False
    )
    column_name: str = Column(String(255), nullable=False)
    description: str | None = Column(Text, nullable=True)
    synonyms: list[str] | None = Column(JSONB, nullable=True, default=list)
    value_source: str | None = Column(String(100), nullable=True)
    created_at: datetime = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    dataset: Dataset = relationship("Dataset", back_populates="semantic_columns")
    value_labels: list[SemanticValueLabel] = relationship(
        "SemanticValueLabel",
        back_populates="semantic_column",
        cascade="all, delete-orphan",
        uselist=True,
    )


class SemanticValueLabel(Base):
    """Display label mapping for a raw dimension value."""

    __tablename__ = "semantic_value_labels"
    __allow_unmapped__ = True
    __table_args__ = (
        UniqueConstraint(
            "semantic_column_id", "raw_value", name="uq_semantic_value_label"
        ),
    )

    id: str = Column(String, primary_key=True, default=_new_uuid)
    semantic_column_id: str = Column(
        String, ForeignKey("semantic_columns.id", ondelete="CASCADE"), nullable=False
    )
    raw_value: str = Column(String(512), nullable=False)
    display_label: str = Column(String(512), nullable=False)
    category: str | None = Column(String(100), nullable=True)
    sort_order: int = Column(Integer, nullable=False, default=0)

    semantic_column: SemanticColumn = relationship(
        "SemanticColumn", back_populates="value_labels"
    )


class DatasetRelationship(Base):
    """Join relationship between two datasets within the same model."""

    __tablename__ = "dataset_relationships"
    __allow_unmapped__ = True

    id: str = Column(String, primary_key=True, default=_new_uuid)
    model_id: str = Column(
        String, ForeignKey("models.id", ondelete="CASCADE"), nullable=False
    )
    source_dataset_id: str = Column(
        String, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False
    )
    target_dataset_id: str = Column(
        String, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False
    )
    source_column: str = Column(String(255), nullable=False)
    target_column: str = Column(String(255), nullable=False)
    relationship_type: str = Column(String(50), nullable=False, default="many_to_one")
    coverage_pct: float | None = Column(Float, nullable=True)
    created_at: datetime = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    model: Model = relationship(
        "Model",
        back_populates="dataset_relationships",
        foreign_keys=[model_id],
    )
