"""add users.avatar_fit_mode

Revision ID: b4a91d7f2cde
Revises: 1c0f2d4a9abc, 9d0f6a1c2b44
Create Date: 2026-02-18 00:00:00.000000
"""

from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b4a91d7f2cde"
down_revision: str | Sequence[str] | None = ("1c0f2d4a9abc", "9d0f6a1c2b44")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_fit_mode", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_fit_mode")
