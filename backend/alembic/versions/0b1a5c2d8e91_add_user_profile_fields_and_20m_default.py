"""add user profile fields and 20m default

Revision ID: 0b1a5c2d8e91
Revises: f1d0b6a7c112
Create Date: 2026-02-13 17:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0b1a5c2d8e91"
down_revision: Union[str, None] = "f1d0b6a7c112"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_url", sa.String(), nullable=True))
    op.add_column("users", sa.Column("favorite_card_id", sa.String(), nullable=True))
    op.add_column("users", sa.Column("favorite_card_name", sa.String(), nullable=True))
    op.add_column("users", sa.Column("favorite_card_image_url", sa.String(), nullable=True))
    op.add_column("users", sa.Column("favorite_media", sa.String(), nullable=True))
    op.alter_column("tournaments", "duration_minutes", server_default="20")


def downgrade() -> None:
    op.alter_column("tournaments", "duration_minutes", server_default="15")
    op.drop_column("users", "favorite_media")
    op.drop_column("users", "favorite_card_image_url")
    op.drop_column("users", "favorite_card_name")
    op.drop_column("users", "favorite_card_id")
    op.drop_column("users", "avatar_url")
