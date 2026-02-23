import time
from decimal import Decimal

from heliclockter import datetime_utc, timedelta

from bracket.config import config
from bracket.database import database
from bracket.logic.ranking.statistics import START_ELO
from bracket.models.db.player import Player, PlayerBody, PlayerToInsert
from bracket.schema import players
from bracket.utils.id_types import PlayerId, TournamentId
from bracket.utils.logging import logger
from bracket.utils.pagination import PaginationPlayers
from bracket.utils.types import dict_without_none

_RECORDS_RECALC_WARN_MS = 3_000
_RECORDS_RECALC_LOCK_SALT = 2_740_142_607_033_214_976


async def get_all_players_in_tournament(
    tournament_id: TournamentId,
    *,
    not_in_team: bool = False,
    pagination: PaginationPlayers | None = None,
) -> list[Player]:
    not_in_team_filter = "AND players.team_id IS NULL" if not_in_team else ""
    limit_filter = "LIMIT :limit" if pagination is not None and pagination.limit is not None else ""
    offset_filter = (
        "OFFSET :offset" if pagination is not None and pagination.offset is not None else ""
    )
    sort_by = pagination.sort_by if pagination is not None else "name"
    sort_direction = pagination.sort_direction if pagination is not None else ""
    query = f"""
        SELECT *
        FROM players
        WHERE players.tournament_id = :tournament_id
        {not_in_team_filter}
        ORDER BY {sort_by} {sort_direction}
        {limit_filter}
        {offset_filter}
        """

    result = await database.fetch_all(
        query=query,
        values=dict_without_none(
            {
                "tournament_id": tournament_id,
                "offset": pagination.offset if pagination is not None else None,
                "limit": pagination.limit if pagination is not None else None,
            }
        ),
    )

    return [Player.model_validate(x) for x in result]


async def get_player_by_id(player_id: PlayerId, tournament_id: TournamentId) -> Player | None:
    query = """
        SELECT *
        FROM players
        WHERE id = :player_id
        AND tournament_id = :tournament_id
    """
    result = await database.fetch_one(
        query=query, values={"player_id": player_id, "tournament_id": tournament_id}
    )
    return Player.model_validate(result) if result is not None else None


async def get_player_by_name(player_name: str, tournament_id: TournamentId) -> Player | None:
    query = """
        SELECT *
        FROM players
        WHERE lower(name) = lower(:player_name)
        AND tournament_id = :tournament_id
        LIMIT 1
    """
    result = await database.fetch_one(
        query=query, values={"player_name": player_name, "tournament_id": tournament_id}
    )
    return Player.model_validate(result) if result is not None else None


async def get_player_count(
    tournament_id: TournamentId,
    *,
    not_in_team: bool = False,
) -> int:
    not_in_team_filter = "AND players.team_id IS NULL" if not_in_team else ""
    query = f"""
        SELECT count(*)
        FROM players
        WHERE players.tournament_id = :tournament_id
        {not_in_team_filter}
        """
    return int(await database.fetch_val(query=query, values={"tournament_id": tournament_id}))


async def sql_delete_player(tournament_id: TournamentId, player_id: PlayerId) -> None:
    query = "DELETE FROM players WHERE id = :player_id AND tournament_id = :tournament_id"
    await database.execute(query=query, values={"player_id": player_id, "tournament_id": tournament_id})


async def sql_delete_players_of_tournament(tournament_id: TournamentId) -> None:
    query = "DELETE FROM players WHERE tournament_id = :tournament_id"
    await database.execute(query=query, values={"tournament_id": tournament_id})


async def insert_player(player_body: PlayerBody, tournament_id: TournamentId) -> None:
    await database.execute(
        query=players.insert(),
        values=PlayerToInsert(
            **player_body.model_dump(),
            created=datetime_utc.now(),
            tournament_id=tournament_id,
            elo_score=START_ELO,
            swiss_score=Decimal("0.0"),
        ).model_dump(),
    )


def _records_recalc_lock_key(tournament_id: TournamentId) -> int:
    return _RECORDS_RECALC_LOCK_SALT + int(tournament_id)


def _records_cache_is_fresh(last_recalculated: datetime_utc | None) -> bool:
    if last_recalculated is None:
        return False
    max_age_seconds = max(int(config.records_recalc_max_age_seconds), 0)
    if max_age_seconds <= 0:
        return False
    return (datetime_utc.now() - last_recalculated) < timedelta(seconds=max_age_seconds)


async def _get_last_recalculated(tournament_id: TournamentId) -> datetime_utc | None:
    row = await database.fetch_one(
        """
        SELECT last_recalculated
        FROM tournament_record_cache_state
        WHERE tournament_id = :tournament_id
        """,
        values={"tournament_id": tournament_id},
    )
    if row is None:
        return None
    return row._mapping["last_recalculated"]


async def _set_tournament_records_recalculated_now(tournament_id: TournamentId) -> datetime_utc:
    recalculated_at = datetime_utc.now()
    await database.execute(
        """
        INSERT INTO tournament_record_cache_state (tournament_id, last_recalculated, updated)
        VALUES (:tournament_id, :last_recalculated, :updated)
        ON CONFLICT (tournament_id)
        DO UPDATE
        SET
            last_recalculated = EXCLUDED.last_recalculated,
            updated = EXCLUDED.updated
        """,
        values={
            "tournament_id": tournament_id,
            "last_recalculated": recalculated_at,
            "updated": recalculated_at,
        },
    )
    return recalculated_at


async def _try_acquire_recalc_advisory_lock(tournament_id: TournamentId) -> bool:
    lock_acquired = await database.fetch_val(
        "SELECT pg_try_advisory_xact_lock(:lock_key)",
        values={"lock_key": _records_recalc_lock_key(tournament_id)},
    )
    return bool(lock_acquired)


async def ensure_tournament_records_fresh(tournament_id: TournamentId) -> bool:
    last_recalculated = await _get_last_recalculated(tournament_id)
    if _records_cache_is_fresh(last_recalculated):
        return False

    async with database.transaction():
        if not await _try_acquire_recalc_advisory_lock(tournament_id):
            return False

        last_recalculated = await _get_last_recalculated(tournament_id)
        if _records_cache_is_fresh(last_recalculated):
            return False

        await recalculate_tournament_records(tournament_id, manage_transaction=False)
        return True


async def recalculate_tournament_records(
    tournament_id: TournamentId, *, manage_transaction: bool = True
) -> int:
    started_at = time.monotonic()

    async def recalculate_inside_transaction() -> None:
        await database.execute(
            """
            WITH played_matches AS (
                SELECT
                    sii1.team_id AS team1_id,
                    sii2.team_id AS team2_id,
                    m.stage_item_input1_score AS score1,
                    m.stage_item_input2_score AS score2
                FROM matches m
                JOIN rounds r ON r.id = m.round_id
                JOIN stage_items si ON si.id = r.stage_item_id
                JOIN stages s ON s.id = si.stage_id
                JOIN stage_item_inputs sii1 ON sii1.id = m.stage_item_input1_id
                JOIN stage_item_inputs sii2 ON sii2.id = m.stage_item_input2_id
                WHERE s.tournament_id = :tournament_id
                  AND sii1.team_id IS NOT NULL
                  AND sii2.team_id IS NOT NULL
                  AND NOT (
                    m.stage_item_input1_score = 0
                    AND m.stage_item_input2_score = 0
                  )
            ),
            team_match_rows AS (
                SELECT
                    team1_id AS team_id,
                    CASE WHEN score1 > score2 THEN 1 ELSE 0 END AS wins,
                    CASE WHEN score1 = score2 THEN 1 ELSE 0 END AS draws,
                    CASE WHEN score1 < score2 THEN 1 ELSE 0 END AS losses
                FROM played_matches
                UNION ALL
                SELECT
                    team2_id AS team_id,
                    CASE WHEN score2 > score1 THEN 1 ELSE 0 END AS wins,
                    CASE WHEN score2 = score1 THEN 1 ELSE 0 END AS draws,
                    CASE WHEN score2 < score1 THEN 1 ELSE 0 END AS losses
                FROM played_matches
            ),
            team_stats AS (
                SELECT
                    team_id,
                    SUM(wins) AS wins,
                    SUM(draws) AS draws,
                    SUM(losses) AS losses
                FROM team_match_rows
                GROUP BY team_id
            ),
            team_points AS (
                SELECT
                    sii.team_id AS team_id,
                    COALESCE(SUM(sii.points), 0) AS swiss_score
                FROM stage_item_inputs sii
                JOIN stage_items si ON si.id = sii.stage_item_id
                JOIN stages s ON s.id = si.stage_id
                WHERE s.tournament_id = :tournament_id
                  AND sii.team_id IS NOT NULL
                GROUP BY sii.team_id
            ),
            scoped_team_stats AS (
                SELECT
                    t.id AS team_id,
                    ts.wins,
                    ts.draws,
                    ts.losses,
                    tp.swiss_score
                FROM teams t
                LEFT JOIN team_stats ts ON ts.team_id = t.id
                LEFT JOIN team_points tp ON tp.team_id = t.id
                WHERE t.tournament_id = :tournament_id
            )
            UPDATE teams t
            SET
                wins = COALESCE(sts.wins, 0),
                draws = COALESCE(sts.draws, 0),
                losses = COALESCE(sts.losses, 0),
                swiss_score = COALESCE(sts.swiss_score, 0)
            FROM scoped_team_stats sts
            WHERE t.id = sts.team_id
            """,
            values={"tournament_id": tournament_id},
        )

        await database.execute(
            """
            WITH player_stats AS (
                SELECT
                    p.id AS player_id,
                    COALESCE(SUM(t.wins), 0) AS wins,
                    COALESCE(SUM(t.draws), 0) AS draws,
                    COALESCE(SUM(t.losses), 0) AS losses,
                    COALESCE(SUM(t.swiss_score), 0) AS swiss_score
                FROM players p
                LEFT JOIN (
                    SELECT DISTINCT player_id, team_id
                    FROM players_x_teams
                ) pxt ON pxt.player_id = p.id
                LEFT JOIN teams t
                    ON t.id = pxt.team_id
                   AND t.tournament_id = p.tournament_id
                WHERE p.tournament_id = :tournament_id
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
              AND p.tournament_id = :tournament_id
            """,
            values={"tournament_id": tournament_id},
        )
        await _set_tournament_records_recalculated_now(tournament_id)

    if manage_transaction:
        async with database.transaction():
            await recalculate_inside_transaction()
    else:
        await recalculate_inside_transaction()

    duration_ms = int((time.monotonic() - started_at) * 1000)
    if duration_ms >= _RECORDS_RECALC_WARN_MS:
        logger.warning(
            "Tournament record recalculation was slow: tournament_id=%s duration_ms=%s",
            int(tournament_id),
            duration_ms,
        )
    return duration_ms
