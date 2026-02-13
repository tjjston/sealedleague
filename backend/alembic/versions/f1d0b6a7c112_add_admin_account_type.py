"""add admin account type

Revision ID: f1d0b6a7c112
Revises: fa53e635f410
Create Date: 2026-02-13 16:30:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1d0b6a7c112"
down_revision: Union[str, Sequence[str], None] = ("fa53e635f410", "1c0f2d4a9abc")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE account_type ADD VALUE IF NOT EXISTS 'ADMIN'")


def downgrade() -> None:
    # Postgres enum values cannot be removed safely in-place.
    pass
