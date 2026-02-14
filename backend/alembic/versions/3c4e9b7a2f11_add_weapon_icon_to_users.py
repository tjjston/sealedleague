"""add weapon_icon to users

Revision ID: 3c4e9b7a2f11
Revises: b7e2f62d1aa3
Create Date: 2026-02-14 12:30:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3c4e9b7a2f11"
down_revision: Union[str, Sequence[str], None] = "b7e2f62d1aa3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS weapon_icon VARCHAR")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS weapon_icon")

