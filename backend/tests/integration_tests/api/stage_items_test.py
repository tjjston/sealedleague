import pytest

from bracket.database import database
from bracket.models.db.stage_item import StageType
from bracket.models.db.stage_item_inputs import StageItemInputCreateBodyFinal
from bracket.schema import matches, rounds, stage_items, stages
from bracket.sql.stage_items import get_stage_item
from bracket.utils.dummy_records import (
    DUMMY_STAGE1,
    DUMMY_STAGE2,
    DUMMY_STAGE_ITEM1,
    DUMMY_TEAM1,
)
from bracket.utils.http import HTTPMethod
from tests.integration_tests.api.shared import (
    SUCCESS_RESPONSE,
    send_tournament_request,
)
from tests.integration_tests.models import AuthContext
from tests.integration_tests.sql import (
    assert_row_count_and_clear,
    inserted_stage,
    inserted_stage_item,
    inserted_team,
)


@pytest.mark.asyncio(loop_scope="session")
async def test_create_stage_item(
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
    ):
        assert team_inserted_1.id and team_inserted_2.id
        inputs = [
            StageItemInputCreateBodyFinal(slot=1, team_id=team_inserted_1.id).model_dump(),
            StageItemInputCreateBodyFinal(slot=2, team_id=team_inserted_2.id).model_dump(),
        ]
        assert (
            await send_tournament_request(
                HTTPMethod.POST,
                "stage_items",
                auth_context,
                json={
                    "type": StageType.SINGLE_ELIMINATION.value,
                    "team_count": 2,
                    "stage_id": stage_inserted_1.id,
                    "inputs": inputs,
                },
            )
            == SUCCESS_RESPONSE
        )
        await assert_row_count_and_clear(matches, 1)
        await assert_row_count_and_clear(rounds, 1)
        await assert_row_count_and_clear(stage_items, 1)
        await assert_row_count_and_clear(stages, 1)


@pytest.mark.asyncio(loop_scope="session")
async def test_delete_stage_item(
    startup_and_shutdown_uvicorn_server: None, auth_context: AuthContext
) -> None:
    async with (
        inserted_team(DUMMY_TEAM1.model_copy(update={"tournament_id": auth_context.tournament.id})),
        inserted_stage(
            DUMMY_STAGE2.model_copy(update={"tournament_id": auth_context.tournament.id})
        ) as stage_inserted_1,
        inserted_stage_item(
            DUMMY_STAGE_ITEM1.model_copy(
                update={"stage_id": stage_inserted_1.id, "ranking_id": auth_context.ranking.id}
            )
        ) as stage_item_inserted,
    ):
        assert (
            await send_tournament_request(
                HTTPMethod.DELETE, f"stage_items/{stage_item_inserted.id}", auth_context, {}
            )
            == SUCCESS_RESPONSE
        )
        await assert_row_count_and_clear(stages, 0)


@pytest.mark.asyncio(loop_scope="session")
async def test_update_stage_item(
    startup_and_shutdown_uvicorn_server: None, auth_context: AuthContext
) -> None:
    body = {"name": "Optimus", "ranking_id": auth_context.ranking.id}
    async with (
        inserted_stage(
            DUMMY_STAGE1.model_copy(update={"tournament_id": auth_context.tournament.id})
        ) as stage_inserted,
        inserted_stage_item(
            DUMMY_STAGE_ITEM1.model_copy(
                update={"stage_id": stage_inserted.id, "ranking_id": auth_context.ranking.id}
            )
        ) as stage_item_inserted,
    ):
        assert (
            await send_tournament_request(
                HTTPMethod.PUT, f"stage_items/{stage_item_inserted.id}", auth_context, json=body
            )
            == SUCCESS_RESPONSE
        )

        assert auth_context.tournament.id
        updated_stage_item = await get_stage_item(
            auth_context.tournament.id, stage_item_inserted.id
        )
        assert updated_stage_item.name == body["name"]


@pytest.mark.asyncio(loop_scope="session")
async def test_expand_round_robin_stage_item(
    startup_and_shutdown_uvicorn_server: None, auth_context: AuthContext
) -> None:
    async with inserted_stage(
        DUMMY_STAGE1.model_copy(update={"tournament_id": auth_context.tournament.id})
    ) as stage_inserted:
        assert (
            await send_tournament_request(
                HTTPMethod.POST,
                "stage_items",
                auth_context,
                json={
                    "type": StageType.ROUND_ROBIN.value,
                    "team_count": 3,
                    "stage_id": stage_inserted.id,
                },
            )
            == SUCCESS_RESPONSE
        )
        stage_item_id = await database.fetch_val(
            """
            SELECT id
            FROM stage_items
            WHERE stage_id = :stage_id
            ORDER BY id DESC
            LIMIT 1
            """,
            values={"stage_id": int(stage_inserted.id)},
        )
        assert stage_item_id is not None

        assert (
            await send_tournament_request(
                HTTPMethod.POST,
                f"stage_items/{int(stage_item_id)}/expand_round_robin",
                auth_context,
                json={"additional_team_count": 1},
            )
            == SUCCESS_RESPONSE
        )

        expanded_stage_item = await get_stage_item(auth_context.tournament.id, int(stage_item_id))
        assert int(expanded_stage_item.team_count) == 4
        assert len(expanded_stage_item.inputs) == 4

        non_draft_rounds = [round_ for round_ in expanded_stage_item.rounds if not round_.is_draft]
        all_matches = [match for round_ in non_draft_rounds for match in round_.matches]
        assert len(non_draft_rounds) == 6
        assert len(all_matches) == 6

        input_ids = [int(input_.id) for input_ in expanded_stage_item.inputs if input_.id is not None]
        new_input_id = max(input_ids)
        new_input_matchups = [
            match
            for match in all_matches
            if int(match.stage_item_input1_id) == new_input_id
            or int(match.stage_item_input2_id) == new_input_id
        ]
        assert len(new_input_matchups) == 3
        await assert_row_count_and_clear(matches, 6)
        await assert_row_count_and_clear(rounds, 6)
        await assert_row_count_and_clear(stage_items, 1)
        await assert_row_count_and_clear(stages, 1)
