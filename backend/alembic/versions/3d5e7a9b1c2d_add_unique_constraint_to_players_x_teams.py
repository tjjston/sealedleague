"""add unique constraint to players_x_teams and dedupe existing rows

Revision ID: 3d5e7a9b1c2d
Revises: 1f2a9d7c4b66
Create Date: 2026-02-23 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3d5e7a9b1c2d"
down_revision: str | None = "1f2a9d7c4b66"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM players_x_teams pxt
        USING players_x_teams dup
        WHERE pxt.id > dup.id
          AND pxt.player_id = dup.player_id
          AND pxt.team_id = dup.team_id
        """
    )

    op.create_unique_constraint(
        "players_x_teams_player_id_team_id_key",
        "players_x_teams",
        ["player_id", "team_id"],
    )

    # Recalculate cached player records after deduping team links.
    op.execute(
        """
        WITH unique_player_teams AS (
            SELECT DISTINCT player_id, team_id
            FROM players_x_teams
        ),
        player_stats AS (
            SELECT
                p.id AS player_id,
                COALESCE(SUM(t.wins), 0) AS wins,
                COALESCE(SUM(t.draws), 0) AS draws,
                COALESCE(SUM(t.losses), 0) AS losses,
                COALESCE(SUM(t.swiss_score), 0) AS swiss_score
            FROM players p
            LEFT JOIN unique_player_teams upt ON upt.player_id = p.id
            LEFT JOIN teams t
                ON t.id = upt.team_id
               AND t.tournament_id = p.tournament_id
            GROUP BY p.id
        )
        UPDATE players p
        SET
            wins = ps.wins,
            draws = ps.draws,
            losses = ps.losses,
            swiss_score = ps.swiss_score
        FROM player_stats ps
        WHERE p.id = ps.player_id
        """
    )


def downgrade() -> None:
    op.drop_constraint(
        "players_x_teams_player_id_team_id_key",
        "players_x_teams",
        type_="unique",
    )
