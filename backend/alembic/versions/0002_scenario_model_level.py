"""Make scenarios model-level: nullable dataset_id, add dataset_id to rules.

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-17 00:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------
revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Make Scenario.dataset_id nullable — scenarios are now model-level
    op.alter_column(
        "scenarios",
        "dataset_id",
        existing_type=sa.String(),
        nullable=True,
    )

    # Add dataset_id to scenario_rules so each rule can target a specific dataset
    op.add_column(
        "scenario_rules",
        sa.Column("dataset_id", sa.String(), sa.ForeignKey("datasets.id", ondelete="CASCADE"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("scenario_rules", "dataset_id")
    op.alter_column(
        "scenarios",
        "dataset_id",
        existing_type=sa.String(),
        nullable=False,
    )
