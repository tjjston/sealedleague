from typing import Any

import pytest
from heliclockter import datetime_utc
from starlette.exceptions import HTTPException

from bracket.models.db.account import UserAccountType
from bracket.models.db.user import UserPublic
from bracket.routes import league as league_routes
from bracket.utils.id_types import TournamentId, UserId


def _build_admin_user() -> UserPublic:
    return UserPublic(
        id=UserId(77),
        email="admin@example.com",
        name="Admin User",
        created=datetime_utc.now(),
        account_type=UserAccountType.ADMIN,
    )


@pytest.mark.asyncio
async def test_post_recalculate_records_calls_recalculate(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"recalculate": 0}

    async def fake_user_is_league_admin_for_tournament(
        _: TournamentId, __: UserPublic
    ) -> bool:
        return True

    async def fake_recalculate(_: TournamentId, **__: Any) -> int:
        calls["recalculate"] += 1
        return 42

    monkeypatch.setattr(
        league_routes,
        "user_is_league_admin_for_tournament",
        fake_user_is_league_admin_for_tournament,
    )
    monkeypatch.setattr(league_routes, "recalculate_tournament_records", fake_recalculate)

    response = await league_routes.post_recalculate_records(TournamentId(5), _build_admin_user())

    assert response.data.success is True
    assert response.data.duration_ms == 42
    assert response.data.recalculated_at != ""
    assert calls["recalculate"] == 1


@pytest.mark.asyncio
async def test_post_recalculate_records_requires_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_user_is_league_admin_for_tournament(
        _: TournamentId, __: UserPublic
    ) -> bool:
        return False

    monkeypatch.setattr(
        league_routes,
        "user_is_league_admin_for_tournament",
        fake_user_is_league_admin_for_tournament,
    )

    with pytest.raises(HTTPException) as exc_info:
        await league_routes.post_recalculate_records(TournamentId(5), _build_admin_user())

    assert exc_info.value.status_code == 401
