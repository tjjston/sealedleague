"""add stage item winner confirmation fields

Revision ID: 1f2a9d7c4b66
Revises: c6d2b4e8f193
Create Date: 2026-02-23 00:00:00.000000
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1f2a9d7c4b66"
down_revision: str | None = "c6d2b4e8f193"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "stage_items",
        sa.Column("winner_confirmed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("stage_items", sa.Column("winner_confirmed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("stage_items", sa.Column("winner_confirmed_by_user_id", sa.BigInteger(), nullable=True))
    op.add_column("stage_items", sa.Column("winner_team_id", sa.BigInteger(), nullable=True))
    op.add_column("stage_items", sa.Column("winner_team_name", sa.Text(), nullable=True))
    op.add_column(
        "stage_items",
        sa.Column("ended_early", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column("stage_items", sa.Column("ended_early_at", sa.DateTime(timezone=True), nullable=True))

    op.create_foreign_key(
        "fk_stage_items_winner_confirmed_by_user_id_users",
        "stage_items",
        "users",
        ["winner_confirmed_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_stage_items_winner_team_id_teams",
        "stage_items",
        "teams",
        ["winner_team_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_stage_items_winner_team_id_teams", "stage_items", type_="foreignkey")
    op.drop_constraint(
        "fk_stage_items_winner_confirmed_by_user_id_users",
        "stage_items",
        type_="foreignkey",
    )
    op.drop_column("stage_items", "ended_early_at")
    op.drop_column("stage_items", "ended_early")
    op.drop_column("stage_items", "winner_team_name")
    op.drop_column("stage_items", "winner_team_id")
    op.drop_column("stage_items", "winner_confirmed_by_user_id")
    op.drop_column("stage_items", "winner_confirmed_at")
    op.drop_column("stage_items", "winner_confirmed")
