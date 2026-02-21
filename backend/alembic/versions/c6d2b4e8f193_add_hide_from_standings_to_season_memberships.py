"""add hide from standings to season memberships

Revision ID: c6d2b4e8f193
Revises: f7c3e5d2a1b4
Create Date: 2026-02-20 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str | None = "c6d2b4e8f193"
down_revision: str | None = "f7c3e5d2a1b4"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "season_memberships",
        sa.Column("hide_from_standings", sa.Boolean(), nullable=False, server_default="f"),
    )


def downgrade() -> None:
    op.drop_column("season_memberships", "hide_from_standings")
