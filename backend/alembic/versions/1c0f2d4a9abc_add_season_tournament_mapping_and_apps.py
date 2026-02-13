"""add season tournament mapping and tournament applications

Revision ID: 1c0f2d4a9abc
Revises: 7a1c2f9d0b3e
Create Date: 2026-02-13 00:00:00.000000
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1c0f2d4a9abc"
down_revision: str | None = "7a1c2f9d0b3e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "season_tournaments",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("season_id", sa.BigInteger(), nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournaments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("season_id", "tournament_id"),
    )
    op.create_index(op.f("ix_season_tournaments_id"), "season_tournaments", ["id"], unique=False)
    op.create_index(
        op.f("ix_season_tournaments_season_id"),
        "season_tournaments",
        ["season_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_season_tournaments_tournament_id"),
        "season_tournaments",
        ["tournament_id"],
        unique=False,
    )

    op.execute(
        """
        INSERT INTO season_tournaments (season_id, tournament_id)
        SELECT id, tournament_id
        FROM seasons
        ON CONFLICT (season_id, tournament_id) DO NOTHING
        """
    )

    op.create_table(
        "tournament_applications",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("season_id", sa.BigInteger(), nullable=True),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("deck_id", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="SUBMITTED"),
        sa.Column("created", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["deck_id"], ["decks.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournaments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tournament_id", "user_id"),
    )
    op.create_index(
        op.f("ix_tournament_applications_id"),
        "tournament_applications",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_tournament_applications_tournament_id"),
        "tournament_applications",
        ["tournament_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_tournament_applications_user_id"),
        "tournament_applications",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_tournament_applications_season_id"),
        "tournament_applications",
        ["season_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_tournament_applications_deck_id"),
        "tournament_applications",
        ["deck_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_tournament_applications_deck_id"), table_name="tournament_applications")
    op.drop_index(op.f("ix_tournament_applications_season_id"), table_name="tournament_applications")
    op.drop_index(op.f("ix_tournament_applications_user_id"), table_name="tournament_applications")
    op.drop_index(op.f("ix_tournament_applications_tournament_id"), table_name="tournament_applications")
    op.drop_index(op.f("ix_tournament_applications_id"), table_name="tournament_applications")
    op.drop_table("tournament_applications")

    op.drop_index(op.f("ix_season_tournaments_tournament_id"), table_name="season_tournaments")
    op.drop_index(op.f("ix_season_tournaments_season_id"), table_name="season_tournaments")
    op.drop_index(op.f("ix_season_tournaments_id"), table_name="season_tournaments")
    op.drop_table("season_tournaments")
