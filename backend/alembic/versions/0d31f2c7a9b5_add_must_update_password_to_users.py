"""add must_update_password flag to users

Revision ID: 0d31f2c7a9b5
Revises: f4e2b3c8d9aa
Create Date: 2026-02-26 22:15:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "0d31f2c7a9b5"
down_revision: Union[str, Sequence[str], None] = "f4e2b3c8d9aa"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "must_update_password",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "must_update_password")
