"""add match-level deck selection fields

Revision ID: f4e2b3c8d9aa
Revises: 1c0f2d4a9abc, 3d5e7a9b1c2d, 9d0f6a1c2b44
Create Date: 2026-02-26 18:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "f4e2b3c8d9aa"
down_revision: Union[str, Sequence[str], None] = (
    "1c0f2d4a9abc",
    "3d5e7a9b1c2d",
    "9d0f6a1c2b44",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "matches",
        sa.Column(
            "stage_item_input1_deck_id",
            sa.BigInteger(),
            sa.ForeignKey("decks.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "matches",
        sa.Column(
            "stage_item_input2_deck_id",
            sa.BigInteger(),
            sa.ForeignKey("decks.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_matches_stage_item_input1_deck_id",
        "matches",
        ["stage_item_input1_deck_id"],
        unique=False,
    )
    op.create_index(
        "ix_matches_stage_item_input2_deck_id",
        "matches",
        ["stage_item_input2_deck_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_matches_stage_item_input2_deck_id", table_name="matches")
    op.drop_index("ix_matches_stage_item_input1_deck_id", table_name="matches")
    op.drop_column("matches", "stage_item_input2_deck_id")
    op.drop_column("matches", "stage_item_input1_deck_id")
