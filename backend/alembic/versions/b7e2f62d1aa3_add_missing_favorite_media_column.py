"""add missing favorite_media column

Revision ID: b7e2f62d1aa3
Revises: 0b1a5c2d8e91
Create Date: 2026-02-13 17:40:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7e2f62d1aa3"
down_revision: Union[str, Sequence[str], None] = "0b1a5c2d8e91"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_media VARCHAR")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS favorite_media")
