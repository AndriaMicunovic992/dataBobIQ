"""Initial tables — create all dataBobIQ metadata tables.

Revision ID: 0001
Revises:
Create Date: 2026-03-14 00:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------
revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # models
    # ------------------------------------------------------------------
    op.create_table(
        "models",
        sa.Column(
            "id",
            sa.String(),
            server_default=sa.text("gen_random_uuid()::text"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="active"),
        sa.Column("settings", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    # ------------------------------------------------------------------
    # datasets
    # ------------------------------------------------------------------
    op.create_table(
        "datasets",
        sa.Column(
            "id",
            sa.String(),
            server_default=sa.text("gen_random_uuid()::text"),
            nullable=False,
        ),
        sa.Column("model_id", sa.String(), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("source_filename", sa.String(512), nullable=True),
        sa.Column(
            "fact_type",
            sa.String(100),
            nullable=False,
            server_default="financial_transactions",
        ),
        sa.Column("mapping_config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("parquet_path", sa.String(512), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(50), nullable=False, server_default="pending"),
        sa.Column("data_layer", sa.String(50), nullable=False, server_default="raw"),
        sa.Column("ai_analyzed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("ai_notes", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "agent_context_notes",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["model_id"], ["models.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_datasets_model_id", "datasets", ["model_id"])

    # ------------------------------------------------------------------
    # dataset_columns
    # ------------------------------------------------------------------
    op.create_table(
        "dataset_columns",
        sa.Column(
            "id",
            sa.String(),
            server_default=sa.text("gen_random_uuid()::text"),
            nullable=False,
        ),
        sa.Column("dataset_id", sa.String(), nullable=False),
        sa.Column("source_name", sa.String(255), nullable=False),
        sa.Column("canonical_name", sa.String(255), nullable=True),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("data_type", sa.String(50), nullable=False, server_default="string"),
        sa.Column(
            "column_role", sa.String(50), nullable=False, server_default="dimension"
        ),
        sa.Column("column_tier", sa.String(50), nullable=True),
        sa.Column("shared_dim", sa.String(100), nullable=True),
        sa.Column("unique_count", sa.Integer(), nullable=True),
        sa.Column("sample_values", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("ai_suggestion", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dataset_id", "source_name", name="uq_column_dataset_source"),
    )
    op.create_index("ix_dataset_columns_dataset_id", "dataset_columns", ["dataset_id"])

    # ------------------------------------------------------------------
    # scenarios
    # ------------------------------------------------------------------
    op.create_table(
        "scenarios",
        sa.Column(
            "id",
            sa.String(),
            server_default=sa.text("gen_random_uuid()::text"),
            nullable=False,
        ),
        sa.Column("model_id", sa.String(), nullable=True),
        sa.Column("dataset_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("base_config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("color", sa.String(20), nullable=True),
        sa.Column("overrides_path", sa.String(512), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["model_id"], ["models.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scenarios_model_id", "scenarios", ["model_id"])
    op.create_index("ix_scenarios_dataset_id", "scenarios", ["dataset_id"])

    # ------------------------------------------------------------------
    # scenario_rules
    # ------------------------------------------------------------------
    op.create_table(
        "scenario_rules",
        sa.Column(
            "id",
            sa.String(),
            server_default=sa.text("gen_random_uuid()::text"),
            nullable=False,
        ),
        sa.Column("scenario_id", sa.String(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("rule_type", sa.String(50), nullable=False),
        sa.Column("target_field", sa.String(100), nullable=False, server_default="amount"),
        sa.Column(
            "adjustment",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("filter_expr", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("period_from", sa.String(20), nullable=True),
        sa.Column("period_to", sa.String(20), nullable=True),
        sa.Column(
            "distribution", sa.String(50), nullable=False, server_default="proportional"
        ),
        sa.Column("affected_rows", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["scenario_id"], ["scenarios.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scenario_rules_scenario_id", "scenario_rules", ["scenario_id"])

    # ------------------------------------------------------------------
    # kpi_definitions
    # ------------------------------------------------------------------
    op.create_table(
        "kpi_definitions",
        sa.Column(
            "id",
            sa.String(),
            server_default=sa.text("gen_random_uuid()::text"),
            nullable=False,
        ),
        sa.Column("model_id", sa.String(), nullable=False),
        sa.Column("kpi_id", sa.String(100), nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("kpi_type", sa.String(50), nullable=False),
        sa.Column("expression", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "depends_on",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            server_default="[]",
        ),
        sa.Column("format", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("status", sa.String(50), nullable=False, server_default="active"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["model_id"], ["models.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("model_id", "kpi_id", name="uq_kpi_model_kpi_id"),
    )
    op.create_index("ix_kpi_definitions_model_id", "kpi_definitions", ["model_id"])

    # ------------------------------------------------------------------
    # knowledge_entries
    # ------------------------------------------------------------------
    op.create_table(
        "knowledge_entries",
        sa.Column(
            "id",
            sa.String(),
            server_default=sa.text("gen_random_uuid()::text"),
            nullable=False,
        ),
        sa.Column("model_id", sa.String(), nullable=False),
        sa.Column("dataset_id", sa.String(), nullable=True),
        sa.Column("entry_type", sa.String(100), nullable=False),
        sa.Column("plain_text", sa.Text(), nullable=False),
        sa.Column(
            "content",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "confidence", sa.String(50), nullable=True, server_default="confirmed"
        ),
        sa.Column("source", sa.String(50), nullable=False, server_default="user"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["model_id"], ["models.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["dataset_id"], ["datasets.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_knowledge_entries_model_id", "knowledge_entries", ["model_id"])
    op.create_index(
        "ix_knowledge_entries_dataset_id", "knowledge_entries", ["dataset_id"]
    )

    # ------------------------------------------------------------------
    # semantic_columns
    # ------------------------------------------------------------------
    op.create_table(
        "semantic_columns",
        sa.Column(
            "id",
            sa.String(),
            server_default=sa.text("gen_random_uuid()::text"),
            nullable=False,
        ),
        sa.Column("dataset_id", sa.String(), nullable=False),
        sa.Column("column_name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "synonyms",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
            server_default="[]",
        ),
        sa.Column("value_source", sa.String(100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dataset_id", "column_name", name="uq_semantic_column"),
    )
    op.create_index("ix_semantic_columns_dataset_id", "semantic_columns", ["dataset_id"])

    # ------------------------------------------------------------------
    # semantic_value_labels
    # ------------------------------------------------------------------
    op.create_table(
        "semantic_value_labels",
        sa.Column(
            "id",
            sa.String(),
            server_default=sa.text("gen_random_uuid()::text"),
            nullable=False,
        ),
        sa.Column("semantic_column_id", sa.String(), nullable=False),
        sa.Column("raw_value", sa.String(512), nullable=False),
        sa.Column("display_label", sa.String(512), nullable=False),
        sa.Column("category", sa.String(100), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["semantic_column_id"], ["semantic_columns.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "semantic_column_id", "raw_value", name="uq_semantic_value_label"
        ),
    )
    op.create_index(
        "ix_semantic_value_labels_semantic_column_id",
        "semantic_value_labels",
        ["semantic_column_id"],
    )

    # ------------------------------------------------------------------
    # dataset_relationships
    # ------------------------------------------------------------------
    op.create_table(
        "dataset_relationships",
        sa.Column(
            "id",
            sa.String(),
            server_default=sa.text("gen_random_uuid()::text"),
            nullable=False,
        ),
        sa.Column("model_id", sa.String(), nullable=False),
        sa.Column("source_dataset_id", sa.String(), nullable=False),
        sa.Column("target_dataset_id", sa.String(), nullable=False),
        sa.Column("source_column", sa.String(255), nullable=False),
        sa.Column("target_column", sa.String(255), nullable=False),
        sa.Column(
            "relationship_type",
            sa.String(50),
            nullable=False,
            server_default="many_to_one",
        ),
        sa.Column("coverage_pct", sa.Float(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["model_id"], ["models.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["source_dataset_id"], ["datasets.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["target_dataset_id"], ["datasets.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_dataset_relationships_model_id", "dataset_relationships", ["model_id"]
    )


def downgrade() -> None:
    # Drop in reverse dependency order
    op.drop_table("dataset_relationships")
    op.drop_table("semantic_value_labels")
    op.drop_table("semantic_columns")
    op.drop_table("knowledge_entries")
    op.drop_table("kpi_definitions")
    op.drop_table("scenario_rules")
    op.drop_table("scenarios")
    op.drop_table("dataset_columns")
    op.drop_table("datasets")
    op.drop_table("models")
