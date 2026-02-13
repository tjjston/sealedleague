"""add double elimination stage type

Revision ID: 7a1c2f9d0b3e
Revises: 2f9d3f3a6b1c
Create Date: 2026-02-13 12:10:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision: str | None = "7a1c2f9d0b3e"
down_revision: str | None = "2f9d3f3a6b1c"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE stage_type ADD VALUE IF NOT EXISTS 'DOUBLE_ELIMINATION'")


def downgrade() -> None:
    # PostgreSQL enums cannot easily remove values safely.
    pass
