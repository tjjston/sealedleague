"""add season and linked event fields to projected schedule

Revision ID: 9d0f6a1c2b44
Revises: 6f2d8c1e4a77
Create Date: 2026-02-16 00:00:00.000000
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9d0f6a1c2b44"
down_revision: str | None = "6f2d8c1e4a77"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "league_projected_schedule_items",
        sa.Column("season_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "league_projected_schedule_items",
        sa.Column("linked_tournament_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_lpsi_season_id",
        "league_projected_schedule_items",
        "seasons",
        ["season_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_lpsi_linked_tournament_id",
        "league_projected_schedule_items",
        "tournaments",
        ["linked_tournament_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_league_projected_schedule_items_season_id"),
        "league_projected_schedule_items",
        ["season_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_league_projected_schedule_items_linked_tournament_id"),
        "league_projected_schedule_items",
        ["linked_tournament_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_league_projected_schedule_items_linked_tournament_id"),
        table_name="league_projected_schedule_items",
    )
    op.drop_index(
        op.f("ix_league_projected_schedule_items_season_id"),
        table_name="league_projected_schedule_items",
    )
    op.drop_constraint(
        "fk_lpsi_linked_tournament_id",
        "league_projected_schedule_items",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_lpsi_season_id",
        "league_projected_schedule_items",
        type_="foreignkey",
    )
    op.drop_column("league_projected_schedule_items", "linked_tournament_id")
    op.drop_column("league_projected_schedule_items", "season_id")
