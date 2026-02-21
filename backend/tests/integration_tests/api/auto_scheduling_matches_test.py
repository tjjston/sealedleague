import pytest
from heliclockter import datetime_utc

from bracket.models.db.match import MatchBody
from bracket.logic.scheduling.builder import build_matches_for_stage_item
from bracket.models.db.round import RoundInsertable
from bracket.models.db.stage_item import StageItemWithInputsCreate, StageType
from bracket.models.db.stage_item_inputs import (
    StageItemInputCreateBodyFinal,
)
from bracket.sql.matches import sql_update_match
from bracket.sql.rounds import sql_create_round
from bracket.sql.shared import sql_delete_stage_item_with_foreign_keys
from bracket.sql.stage_items import get_stage_item
from bracket.sql.stage_items import sql_create_stage_item_with_inputs
from bracket.sql.tournaments import sql_get_tournament
from bracket.utils.dummy_records import (
    DUMMY_COURT1,
    DUMMY_STAGE2,
    DUMMY_STAGE_ITEM1,
    DUMMY_TEAM1,
)
from bracket.utils.http import HTTPMethod
from tests.integration_tests.api.shared import (
    SUCCESS_RESPONSE,
    send_tournament_request,
)
from tests.integration_tests.mocks import MOCK_NOW
from tests.integration_tests.models import AuthContext
from tests.integration_tests.sql import (
    inserted_court,
    inserted_stage,
    inserted_team,
)


@pytest.mark.asyncio(loop_scope="session")
async def test_start_next_round(
    startup_and_shutdown_uvicorn_server: None, auth_context: AuthContext
) -> None:
    async with (
        inserted_court(
            DUMMY_COURT1.model_copy(update={"tournament_id": auth_context.tournament.id})
        ),
        inserted_stage(
            DUMMY_STAGE2.model_copy(update={"tournament_id": auth_context.tournament.id})
        ) as stage_inserted_1,
        inserted_team(
            DUMMY_TEAM1.model_copy(update={"tournament_id": auth_context.tournament.id})
        ) as team_inserted_1,
        inserted_team(
            DUMMY_TEAM1.model_copy(update={"tournament_id": auth_context.tournament.id})
        ) as team_inserted_2,
    ):
        tournament_id = auth_context.tournament.id
        stage_item_1 = await sql_create_stage_item_with_inputs(
            tournament_id,
            StageItemWithInputsCreate(
                stage_id=stage_inserted_1.id,
                name=DUMMY_STAGE_ITEM1.name,
                team_count=2,
                type=StageType.SWISS,
                inputs=[
                    StageItemInputCreateBodyFinal(
                        slot=1,
                        team_id=team_inserted_1.id,
                    ),
                    StageItemInputCreateBodyFinal(
                        slot=2,
                        team_id=team_inserted_2.id,
                    ),
                ],
            ),
        )
        await sql_create_round(
            RoundInsertable(
                stage_item_id=stage_item_1.id,
                name="",
                is_draft=False,
                created=MOCK_NOW,
            ),
        )

        try:
            response = await send_tournament_request(
                HTTPMethod.POST,
                f"stage_items/{stage_item_1.id}/start_next_round",
                auth_context,
                json={},
            )

            assert response == SUCCESS_RESPONSE

            response = await send_tournament_request(
                HTTPMethod.POST,
                f"stage_items/{stage_item_1.id}/start_next_round",
                auth_context,
                json={"adjust_to_time": datetime_utc.now().isoformat()},
            )
            msg = "No more matches to schedule, all combinations of teams have been added already"
            assert response == {"detail": msg}
        finally:
            await sql_delete_stage_item_with_foreign_keys(stage_item_1.id)


@pytest.mark.asyncio(loop_scope="session")
async def test_start_next_round_double_elimination(
    startup_and_shutdown_uvicorn_server: None, auth_context: AuthContext
) -> None:
    async with (
        inserted_stage(
            DUMMY_STAGE2.model_copy(update={"tournament_id": auth_context.tournament.id})
        ) as stage_inserted_1,
        inserted_team(
            DUMMY_TEAM1.model_copy(update={"tournament_id": auth_context.tournament.id})
        ) as team_inserted_1,
        inserted_team(
            DUMMY_TEAM1.model_copy(update={"tournament_id": auth_context.tournament.id})
        ) as team_inserted_2,
        inserted_team(
            DUMMY_TEAM1.model_copy(update={"tournament_id": auth_context.tournament.id})
        ) as team_inserted_3,
        inserted_team(
            DUMMY_TEAM1.model_copy(update={"tournament_id": auth_context.tournament.id})
        ) as team_inserted_4,
    ):
        tournament_id = auth_context.tournament.id
        stage_item_1 = await sql_create_stage_item_with_inputs(
            tournament_id,
            StageItemWithInputsCreate(
                stage_id=stage_inserted_1.id,
                name=DUMMY_STAGE_ITEM1.name,
                team_count=4,
                type=StageType.DOUBLE_ELIMINATION,
                inputs=[
                    StageItemInputCreateBodyFinal(slot=1, team_id=team_inserted_1.id),
                    StageItemInputCreateBodyFinal(slot=2, team_id=team_inserted_2.id),
                    StageItemInputCreateBodyFinal(slot=3, team_id=team_inserted_3.id),
                    StageItemInputCreateBodyFinal(slot=4, team_id=team_inserted_4.id),
                ],
            ),
        )
        await build_matches_for_stage_item(stage_item_1, tournament_id)
        stage_item_full = await get_stage_item(tournament_id, stage_item_1.id)
        first_round = min(stage_item_full.rounds, key=lambda round_: int(round_.id))
        assert len(first_round.matches) == 2
        tournament = await sql_get_tournament(tournament_id)
        for match in first_round.matches:
            await sql_update_match(
                match.id,
                MatchBody(
                    round_id=match.round_id,
                    stage_item_input1_score=1,
                    stage_item_input2_score=0,
                    court_id=match.court_id,
                    custom_duration_minutes=match.custom_duration_minutes,
                    custom_margin_minutes=match.custom_margin_minutes,
                ),
                tournament,
            )

        try:
            response = await send_tournament_request(
                HTTPMethod.POST,
                f"stage_items/{stage_item_1.id}/start_next_round",
                auth_context,
                json={},
            )
            assert response == SUCCESS_RESPONSE
            refreshed_stage_item = await get_stage_item(tournament_id, stage_item_1.id)
            matches_by_id = {
                match.id: match for round_ in refreshed_stage_item.rounds for match in round_.matches
            }
            winner_final = max(
                (
                    match
                    for match in matches_by_id.values()
                    if match.stage_item_input1_winner_from_match_id is not None
                    and match.stage_item_input2_winner_from_match_id is not None
                ),
                key=lambda match: int(match.id),
            )
            first_losers_round_match = next(
                match
                for match in matches_by_id.values()
                if match.stage_item_input1_loser_from_match_id is not None
                and match.stage_item_input2_loser_from_match_id is not None
            )
            assert winner_final.stage_item_input1_id is not None
            assert winner_final.stage_item_input2_id is not None
            assert first_losers_round_match.stage_item_input1_id is not None
            assert first_losers_round_match.stage_item_input2_id is not None
        finally:
            await sql_delete_stage_item_with_foreign_keys(stage_item_1.id)
