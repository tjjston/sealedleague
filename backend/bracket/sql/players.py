from decimal import Decimal

from heliclockter import datetime_utc

from bracket.database import database
from bracket.logic.ranking.statistics import START_ELO
from bracket.models.db.player import Player, PlayerBody, PlayerToInsert
from bracket.schema import players
from bracket.utils.id_types import PlayerId, TournamentId
from bracket.utils.pagination import PaginationPlayers
from bracket.utils.types import dict_without_none


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


async def recalculate_tournament_records(tournament_id: TournamentId) -> None:
    async with database.transaction():
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
            )
            UPDATE teams t
            SET
                wins = COALESCE(ts.wins, 0),
                draws = COALESCE(ts.draws, 0),
                losses = COALESCE(ts.losses, 0)
            FROM team_stats ts
            WHERE t.id = ts.team_id
              AND t.tournament_id = :tournament_id
            """,
            values={"tournament_id": tournament_id},
        )

        await database.execute(
            """
            UPDATE teams t
            SET wins = 0, draws = 0, losses = 0
            WHERE t.tournament_id = :tournament_id
              AND t.id NOT IN (
                SELECT DISTINCT team_id
                FROM (
                    SELECT sii1.team_id AS team_id
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
                    UNION ALL
                    SELECT sii2.team_id AS team_id
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
                ) played_team_ids
              )
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
                    COALESCE(SUM(t.losses), 0) AS losses
                FROM players p
                LEFT JOIN players_x_teams pxt ON pxt.player_id = p.id
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
                losses = ps.losses
            FROM player_stats ps
            WHERE p.id = ps.player_id
              AND p.tournament_id = :tournament_id
            """,
            values={"tournament_id": tournament_id},
        )
