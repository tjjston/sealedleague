from collections import deque
from typing import Any

import pytest
from heliclockter import datetime_utc

from bracket.sql import players as players_sql
from bracket.utils.id_types import TournamentId


class _DummyTransaction:
    async def __aenter__(self) -> "_DummyTransaction":
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        return False


@pytest.mark.asyncio
async def test_ensure_tournament_records_fresh_skips_when_cache_is_fresh(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"recalc": 0}

    async def fake_get_last_recalculated(_: TournamentId) -> datetime_utc:
        return datetime_utc.now()

    async def fake_recalculate(*_: Any, **__: Any) -> int:
        calls["recalc"] += 1
        return 0

    monkeypatch.setattr(players_sql, "_get_last_recalculated", fake_get_last_recalculated)
    monkeypatch.setattr(players_sql, "recalculate_tournament_records", fake_recalculate)

    recalculated = await players_sql.ensure_tournament_records_fresh(TournamentId(1))

    assert recalculated is False
    assert calls["recalc"] == 0


@pytest.mark.asyncio
async def test_ensure_tournament_records_fresh_recalculates_when_stale(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"recalc": 0, "lock": 0}
    get_last_values = deque([None, None])

    async def fake_get_last_recalculated(_: TournamentId) -> datetime_utc | None:
        return get_last_values.popleft()

    async def fake_try_lock(_: TournamentId) -> bool:
        calls["lock"] += 1
        return True

    async def fake_recalculate(*_: Any, **__: Any) -> int:
        calls["recalc"] += 1
        return 5

    monkeypatch.setattr(players_sql, "_get_last_recalculated", fake_get_last_recalculated)
    monkeypatch.setattr(players_sql, "_try_acquire_recalc_advisory_lock", fake_try_lock)
    monkeypatch.setattr(players_sql, "recalculate_tournament_records", fake_recalculate)
    monkeypatch.setattr(players_sql.database, "transaction", lambda: _DummyTransaction())

    recalculated = await players_sql.ensure_tournament_records_fresh(TournamentId(2))

    assert recalculated is True
    assert calls["lock"] == 1
    assert calls["recalc"] == 1


@pytest.mark.asyncio
async def test_ensure_tournament_records_fresh_skips_when_lock_not_acquired(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = {"recalc": 0}

    async def fake_get_last_recalculated(_: TournamentId) -> None:
        return None

    async def fake_try_lock(_: TournamentId) -> bool:
        return False

    async def fake_recalculate(*_: Any, **__: Any) -> int:
        calls["recalc"] += 1
        return 0

    monkeypatch.setattr(players_sql, "_get_last_recalculated", fake_get_last_recalculated)
    monkeypatch.setattr(players_sql, "_try_acquire_recalc_advisory_lock", fake_try_lock)
    monkeypatch.setattr(players_sql, "recalculate_tournament_records", fake_recalculate)
    monkeypatch.setattr(players_sql.database, "transaction", lambda: _DummyTransaction())

    recalculated = await players_sql.ensure_tournament_records_fresh(TournamentId(3))

    assert recalculated is False
    assert calls["recalc"] == 0
