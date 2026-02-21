"""add loser dependency columns to matches

Revision ID: f2a8c6e1b9d4
Revises: d7f4c1b8a9e2
Create Date: 2026-02-20 00:00:00.000000

"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str | None = "f2a8c6e1b9d4"
down_revision: str | None = "d7f4c1b8a9e2"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "matches",
        sa.Column(
            "stage_item_input1_loser_from_match_id",
            sa.BigInteger(),
            sa.ForeignKey("matches.id"),
            nullable=True,
        ),
    )
    op.add_column(
        "matches",
        sa.Column(
            "stage_item_input2_loser_from_match_id",
            sa.BigInteger(),
            sa.ForeignKey("matches.id"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("matches", "stage_item_input2_loser_from_match_id")
    op.drop_column("matches", "stage_item_input1_loser_from_match_id")
