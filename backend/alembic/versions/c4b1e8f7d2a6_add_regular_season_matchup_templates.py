"""add regular season matchup templates

Revision ID: c4b1e8f7d2a6
Revises: a9e5d3b7c441
Create Date: 2026-02-20 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str | None = "c4b1e8f7d2a6"
down_revision: str | None = "a9e5d3b7c441"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE stage_type ADD VALUE IF NOT EXISTS 'REGULAR_SEASON_MATCHUP'")

    op.add_column(
        "league_projected_schedule_items",
        sa.Column("event_template", sa.String(), nullable=False, server_default="STANDARD"),
    )
    op.add_column(
        "league_projected_schedule_items",
        sa.Column("regular_season_week_index", sa.Integer(), nullable=True),
    )
    op.add_column(
        "league_projected_schedule_items",
        sa.Column("regular_season_games_per_opponent", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("league_projected_schedule_items", "regular_season_games_per_opponent")
    op.drop_column("league_projected_schedule_items", "regular_season_week_index")
    op.drop_column("league_projected_schedule_items", "event_template")
    # PostgreSQL enums cannot easily remove values safely.
