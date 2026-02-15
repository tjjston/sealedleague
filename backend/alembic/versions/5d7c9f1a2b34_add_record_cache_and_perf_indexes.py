"""add tournament record cache table and performance indexes

Revision ID: 5d7c9f1a2b34
Revises: 3c4e9b7a2f11
Create Date: 2026-02-15 00:00:00.000000
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5d7c9f1a2b34"
down_revision: str | None = "3c4e9b7a2f11"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tournament_record_cache_state",
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("last_recalculated", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournaments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("tournament_id"),
    )

    op.create_index(op.f("ix_matches_round_id"), "matches", ["round_id"], unique=False)
    op.create_index(
        op.f("ix_matches_stage_item_input1_id"),
        "matches",
        ["stage_item_input1_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_matches_stage_item_input2_id"),
        "matches",
        ["stage_item_input2_id"],
        unique=False,
    )
    op.create_index(op.f("ix_rounds_stage_item_id"), "rounds", ["stage_item_id"], unique=False)
    op.create_index(
        op.f("ix_players_x_teams_player_id"),
        "players_x_teams",
        ["player_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_players_x_teams_team_id"),
        "players_x_teams",
        ["team_id"],
        unique=False,
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_players_tournament_id_name_normalized
        ON players (tournament_id, lower(trim(name)))
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_players_tournament_id_name_normalized")
    op.drop_index(op.f("ix_players_x_teams_team_id"), table_name="players_x_teams")
    op.drop_index(op.f("ix_players_x_teams_player_id"), table_name="players_x_teams")
    op.drop_index(op.f("ix_rounds_stage_item_id"), table_name="rounds")
    op.drop_index(op.f("ix_matches_stage_item_input2_id"), table_name="matches")
    op.drop_index(op.f("ix_matches_stage_item_input1_id"), table_name="matches")
    op.drop_index(op.f("ix_matches_round_id"), table_name="matches")
    op.drop_table("tournament_record_cache_state")
