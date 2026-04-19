"""add sheet_name and source_file_path to datasets

Revision ID: 0004
Revises: 0003
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("datasets", sa.Column("sheet_name", sa.String(255), nullable=True))
    op.add_column("datasets", sa.Column("source_file_path", sa.String(1024), nullable=True))


def downgrade() -> None:
    op.drop_column("datasets", "source_file_path")
    op.drop_column("datasets", "sheet_name")
