import pytest
from heliclockter import datetime_utc

from bracket.models.db.account import UserAccountType
from bracket.models.db.user import MediaCatalogEntry, UserPublic
from bracket.routes import users as user_routes
from bracket.utils.id_types import UserId


def _build_user() -> UserPublic:
    return UserPublic(
        id=UserId(5),
        email="player@example.com",
        name="Player",
        created=datetime_utc.now(),
        account_type=UserAccountType.REGULAR,
    )


@pytest.mark.asyncio
async def test_media_catalog_empty_query_returns_fallback_without_swapi(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fail_swapi_call() -> list[object]:
        raise AssertionError("SWAPI lookup should be skipped for empty query")

    monkeypatch.setattr(user_routes, "_get_swapi_films_cached", fail_swapi_call)

    response = await user_routes.get_media_catalog(_build_user(), query=None, limit=12)

    assert len(response.data) == 12
    assert response.data[0].title != ""


@pytest.mark.asyncio
async def test_media_catalog_with_query_uses_swapi_and_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_swapi() -> list[MediaCatalogEntry]:
        return [
            MediaCatalogEntry(
                title="Andor",
                year="2022",
                media_type="series",
                imdb_id="id-1",
                poster_url=None,
            )
        ]

    monkeypatch.setattr(user_routes, "_get_swapi_films_cached", fake_swapi)

    response = await user_routes.get_media_catalog(_build_user(), query="andor", limit=10)

    assert any(str(item.title).lower() == "andor" for item in response.data)
