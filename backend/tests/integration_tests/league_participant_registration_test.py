import pytest

from bracket.database import database
from bracket.sql.league import ensure_user_registered_as_participant
from bracket.sql.teams import get_teams_with_members
from tests.integration_tests.models import AuthContext


@pytest.mark.asyncio(loop_scope="session")
async def test_ensure_user_registered_as_participant_is_idempotent(
    auth_context: AuthContext,
) -> None:
    tournament_id = auth_context.tournament.id
    user_id = auth_context.user.id
    participant_name = auth_context.user.name

    await ensure_user_registered_as_participant(
        tournament_id=tournament_id,
        user_id=user_id,
        participant_name=participant_name,
    )
    await ensure_user_registered_as_participant(
        tournament_id=tournament_id,
        user_id=user_id,
        participant_name=participant_name,
    )

    team_player_link_count = int(
        await database.fetch_val(
            """
            SELECT COUNT(*)
            FROM players_x_teams pxt
            JOIN players p ON p.id = pxt.player_id
            JOIN teams t ON t.id = pxt.team_id
            WHERE p.tournament_id = :tournament_id
              AND t.tournament_id = :tournament_id
              AND lower(trim(p.name)) = lower(trim(:participant_name))
              AND lower(trim(t.name)) = lower(trim(:participant_name))
            """,
            values={
                "tournament_id": int(tournament_id),
                "participant_name": participant_name,
            },
        )
        or 0
    )
    assert team_player_link_count == 1

    teams = await get_teams_with_members(tournament_id)
    normalized_participant_name = str(participant_name).strip().lower()
    participant_teams = [
        team for team in teams if str(team.name).strip().lower() == normalized_participant_name
    ]
    assert len(participant_teams) == 1
    assert len(participant_teams[0].players) == 1
