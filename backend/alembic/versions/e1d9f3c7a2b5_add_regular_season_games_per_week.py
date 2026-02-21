"""add regular season games per week

Revision ID: e1d9f3c7a2b5
Revises: c4b1e8f7d2a6
Create Date: 2026-02-20 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str | None = "e1d9f3c7a2b5"
down_revision: str | None = "c4b1e8f7d2a6"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "league_projected_schedule_items",
        sa.Column("regular_season_games_per_week", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("league_projected_schedule_items", "regular_season_games_per_week")
