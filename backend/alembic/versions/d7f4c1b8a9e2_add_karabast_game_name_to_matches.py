"""add karabast game name to matches

Revision ID: d7f4c1b8a9e2
Revises: b4a91d7f2cde
Create Date: 2026-02-20 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7f4c1b8a9e2"
down_revision: Union[str, Sequence[str], None] = "b4a91d7f2cde"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("matches", sa.Column("karabast_game_name", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("matches", "karabast_game_name")
