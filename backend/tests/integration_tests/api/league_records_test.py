import asyncio

import pytest

from bracket.database import database
from bracket.utils.http import HTTPMethod
from tests.integration_tests.api.shared import send_auth_request, send_tournament_request
from tests.integration_tests.models import AuthContext


@pytest.mark.asyncio(loop_scope="session")
async def test_season_history_concurrent_requests(
    startup_and_shutdown_uvicorn_server: None, auth_context: AuthContext
) -> None:
    async def fetch_once() -> dict:
        return await send_tournament_request(HTTPMethod.GET, "league/season_history", auth_context)

    responses = await asyncio.gather(*[fetch_once() for _ in range(10)])
    assert len(responses) == 10
    for response in responses:
        assert "data" in response, response
        assert "seasons" in response["data"], response
        assert "cumulative" in response["data"], response


@pytest.mark.asyncio(loop_scope="session")
async def test_season_history_reuses_recent_record_cache(
    startup_and_shutdown_uvicorn_server: None, auth_context: AuthContext
) -> None:
    await database.execute(
        "DELETE FROM tournament_record_cache_state WHERE tournament_id = :tournament_id",
        values={"tournament_id": auth_context.tournament.id},
    )

    first_response = await send_tournament_request(HTTPMethod.GET, "league/season_history", auth_context)
    assert "data" in first_response, first_response

    first_cache_row = await database.fetch_one(
        """
        SELECT last_recalculated
        FROM tournament_record_cache_state
        WHERE tournament_id = :tournament_id
        """,
        values={"tournament_id": auth_context.tournament.id},
    )
    assert first_cache_row is not None
    first_timestamp = first_cache_row._mapping["last_recalculated"]
    assert first_timestamp is not None

    second_response = await send_tournament_request(
        HTTPMethod.GET, "league/season_history", auth_context
    )
    assert "data" in second_response, second_response

    second_cache_row = await database.fetch_one(
        """
        SELECT last_recalculated
        FROM tournament_record_cache_state
        WHERE tournament_id = :tournament_id
        """,
        values={"tournament_id": auth_context.tournament.id},
    )
    assert second_cache_row is not None
    assert second_cache_row._mapping["last_recalculated"] == first_timestamp


@pytest.mark.asyncio(loop_scope="session")
async def test_media_catalog_query_with_two_characters_returns_results(
    startup_and_shutdown_uvicorn_server: None, auth_context: AuthContext
) -> None:
    response = await send_auth_request(
        HTTPMethod.GET,
        "users/media_catalog?query=an&limit=10",
        auth_context,
    )

    assert "data" in response, response
    assert len(response["data"]) > 0, response
