"""add league communications and projected schedule tables

Revision ID: 6f2d8c1e4a77
Revises: 5d7c9f1a2b34
Create Date: 2026-02-15 00:00:00.000000

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str | None = "6f2d8c1e4a77"
down_revision: str | None = "5d7c9f1a2b34"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "league_communications",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("pinned", sa.Boolean(), server_default="f", nullable=False),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournaments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_league_communications_id"), "league_communications", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_league_communications_tournament_id"),
        "league_communications",
        ["tournament_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_league_communications_kind"), "league_communications", ["kind"], unique=False
    )
    op.create_index(
        op.f("ix_league_communications_pinned"), "league_communications", ["pinned"], unique=False
    )
    op.create_index(
        op.f("ix_league_communications_created_by_user_id"),
        "league_communications",
        ["created_by_user_id"],
        unique=False,
    )

    op.create_table(
        "league_projected_schedule_items",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tournament_id", sa.BigInteger(), nullable=False),
        sa.Column("round_label", sa.String(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tournament_id"], ["tournaments.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_league_projected_schedule_items_id"),
        "league_projected_schedule_items",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_league_projected_schedule_items_tournament_id"),
        "league_projected_schedule_items",
        ["tournament_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_league_projected_schedule_items_starts_at"),
        "league_projected_schedule_items",
        ["starts_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_league_projected_schedule_items_sort_order"),
        "league_projected_schedule_items",
        ["sort_order"],
        unique=False,
    )
    op.create_index(
        op.f("ix_league_projected_schedule_items_created_by_user_id"),
        "league_projected_schedule_items",
        ["created_by_user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_league_projected_schedule_items_created_by_user_id"),
        table_name="league_projected_schedule_items",
    )
    op.drop_index(
        op.f("ix_league_projected_schedule_items_sort_order"),
        table_name="league_projected_schedule_items",
    )
    op.drop_index(
        op.f("ix_league_projected_schedule_items_starts_at"),
        table_name="league_projected_schedule_items",
    )
    op.drop_index(
        op.f("ix_league_projected_schedule_items_tournament_id"),
        table_name="league_projected_schedule_items",
    )
    op.drop_index(op.f("ix_league_projected_schedule_items_id"), table_name="league_projected_schedule_items")
    op.drop_table("league_projected_schedule_items")

    op.drop_index(op.f("ix_league_communications_created_by_user_id"), table_name="league_communications")
    op.drop_index(op.f("ix_league_communications_pinned"), table_name="league_communications")
    op.drop_index(op.f("ix_league_communications_kind"), table_name="league_communications")
    op.drop_index(op.f("ix_league_communications_tournament_id"), table_name="league_communications")
    op.drop_index(op.f("ix_league_communications_id"), table_name="league_communications")
    op.drop_table("league_communications")
