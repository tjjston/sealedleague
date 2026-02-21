"""add projected schedule participant ids

Revision ID: f7c3e5d2a1b4
Revises: e1d9f3c7a2b5
Create Date: 2026-02-20 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str | None = "f7c3e5d2a1b4"
down_revision: str | None = "e1d9f3c7a2b5"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "league_projected_schedule_items",
        sa.Column("participant_user_ids", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("league_projected_schedule_items", "participant_user_ids")
