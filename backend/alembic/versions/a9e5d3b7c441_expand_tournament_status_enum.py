"""expand tournament status enum

Revision ID: a9e5d3b7c441
Revises: f2a8c6e1b9d4
Create Date: 2026-02-20 00:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision: str | None = "a9e5d3b7c441"
down_revision: str | None = "f2a8c6e1b9d4"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE tournament_status RENAME VALUE 'ARCHIVED' TO 'CLOSED'")
    op.execute("ALTER TYPE tournament_status ADD VALUE IF NOT EXISTS 'PLANNED'")
    op.execute("ALTER TYPE tournament_status ADD VALUE IF NOT EXISTS 'IN_PROGRESS'")


def downgrade() -> None:
    op.execute("UPDATE tournaments SET status = 'OPEN' WHERE status IN ('PLANNED', 'IN_PROGRESS')")
    op.execute("ALTER TABLE tournaments ALTER COLUMN status DROP DEFAULT")

    op.execute("CREATE TYPE tournament_status_old AS ENUM ('OPEN', 'ARCHIVED')")
    op.execute(
        """
        ALTER TABLE tournaments
        ALTER COLUMN status
        TYPE tournament_status_old
        USING (
            CASE
                WHEN status::text = 'CLOSED' THEN 'ARCHIVED'
                ELSE status::text
            END
        )::tournament_status_old
        """
    )
    op.execute("DROP TYPE tournament_status")
    op.execute("ALTER TYPE tournament_status_old RENAME TO tournament_status")
    op.execute("ALTER TABLE tournaments ALTER COLUMN status SET DEFAULT 'OPEN'")
