"""add league module tables

Revision ID: 2f9d3f3a6b1c
Revises: c1ab44651e79
Create Date: 2026-02-13 00:00:00.000000

"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import ENUM

from alembic import op

# revision identifiers, used by Alembic.
revision: str | None = "2f9d3f3a6b1c"
down_revision: str | None = "c1ab44651e79"
branch_labels: str | None = None
depends_on: str | None = None

season_membership_role_enum = ENUM(
    "PLAYER",
    "ADMIN",
    name="season_membership_role",
    create_type=True,
)


def upgrade() -> None:
    season_membership_role_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "seasons",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="t", nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournaments.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_seasons_id"), "seasons", ["id"], unique=False)
    op.create_index(op.f("ix_seasons_is_active"), "seasons", ["is_active"], unique=False)
    op.create_index(op.f("ix_seasons_name"), "seasons", ["name"], unique=False)
    op.create_index(op.f("ix_seasons_tournament_id"), "seasons", ["tournament_id"], unique=False)

    op.create_table(
        "season_memberships",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("season_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("created", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("role", season_membership_role_enum, server_default="PLAYER", nullable=False),
        sa.Column("can_manage_points", sa.Boolean(), server_default="f", nullable=False),
        sa.Column("can_manage_tournaments", sa.Boolean(), server_default="f", nullable=False),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("season_id", "user_id"),
    )
    op.create_index(op.f("ix_season_memberships_id"), "season_memberships", ["id"], unique=False)
    op.create_index(
        op.f("ix_season_memberships_season_id"), "season_memberships", ["season_id"], unique=False
    )
    op.create_index(op.f("ix_season_memberships_user_id"), "season_memberships", ["user_id"], unique=False)

    op.create_table(
        "season_points_ledger",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("season_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("changed_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("tournament_id", sa.BigInteger(), nullable=True),
        sa.Column("points_delta", sa.Float(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["changed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournaments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_season_points_ledger_season_id"), "season_points_ledger", ["season_id"], unique=False
    )
    op.create_index(
        op.f("ix_season_points_ledger_tournament_id"), "season_points_ledger", ["tournament_id"], unique=False
    )
    op.create_index(op.f("ix_season_points_ledger_user_id"), "season_points_ledger", ["user_id"], unique=False)

    op.create_table(
        "card_pool_entries",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("season_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("card_id", sa.String(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("created", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("season_id", "user_id", "card_id"),
    )
    op.create_index(op.f("ix_card_pool_entries_card_id"), "card_pool_entries", ["card_id"], unique=False)
    op.create_index(op.f("ix_card_pool_entries_id"), "card_pool_entries", ["id"], unique=False)
    op.create_index(
        op.f("ix_card_pool_entries_season_id"), "card_pool_entries", ["season_id"], unique=False
    )
    op.create_index(op.f("ix_card_pool_entries_user_id"), "card_pool_entries", ["user_id"], unique=False)

    op.create_table(
        "decks",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("season_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("leader", sa.String(), nullable=False),
        sa.Column("base", sa.String(), nullable=False),
        sa.Column("mainboard", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column("sideboard", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column("created", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournaments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("season_id", "user_id", "name"),
    )
    op.create_index(op.f("ix_decks_base"), "decks", ["base"], unique=False)
    op.create_index(op.f("ix_decks_id"), "decks", ["id"], unique=False)
    op.create_index(op.f("ix_decks_leader"), "decks", ["leader"], unique=False)
    op.create_index(op.f("ix_decks_season_id"), "decks", ["season_id"], unique=False)
    op.create_index(op.f("ix_decks_tournament_id"), "decks", ["tournament_id"], unique=False)
    op.create_index(op.f("ix_decks_user_id"), "decks", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_decks_user_id"), table_name="decks")
    op.drop_index(op.f("ix_decks_tournament_id"), table_name="decks")
    op.drop_index(op.f("ix_decks_season_id"), table_name="decks")
    op.drop_index(op.f("ix_decks_leader"), table_name="decks")
    op.drop_index(op.f("ix_decks_id"), table_name="decks")
    op.drop_index(op.f("ix_decks_base"), table_name="decks")
    op.drop_table("decks")

    op.drop_index(op.f("ix_card_pool_entries_user_id"), table_name="card_pool_entries")
    op.drop_index(op.f("ix_card_pool_entries_season_id"), table_name="card_pool_entries")
    op.drop_index(op.f("ix_card_pool_entries_id"), table_name="card_pool_entries")
    op.drop_index(op.f("ix_card_pool_entries_card_id"), table_name="card_pool_entries")
    op.drop_table("card_pool_entries")

    op.drop_index(op.f("ix_season_points_ledger_user_id"), table_name="season_points_ledger")
    op.drop_index(op.f("ix_season_points_ledger_tournament_id"), table_name="season_points_ledger")
    op.drop_index(op.f("ix_season_points_ledger_season_id"), table_name="season_points_ledger")
    op.drop_table("season_points_ledger")

    op.drop_index(op.f("ix_season_memberships_user_id"), table_name="season_memberships")
    op.drop_index(op.f("ix_season_memberships_season_id"), table_name="season_memberships")
    op.drop_index(op.f("ix_season_memberships_id"), table_name="season_memberships")
    op.drop_table("season_memberships")

    op.drop_index(op.f("ix_seasons_tournament_id"), table_name="seasons")
    op.drop_index(op.f("ix_seasons_name"), table_name="seasons")
    op.drop_index(op.f("ix_seasons_is_active"), table_name="seasons")
    op.drop_index(op.f("ix_seasons_id"), table_name="seasons")
    op.drop_table("seasons")

    season_membership_role_enum.drop(op.get_bind(), checkfirst=True)
