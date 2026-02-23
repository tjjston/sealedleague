import asyncio
from collections import Counter
from collections.abc import Sequence
from heliclockter import datetime_utc
import json
import re

from bracket.database import database
from bracket.models.db.league import Season
from bracket.models.db.player import PlayerBody
from bracket.models.db.team import TeamInsertable
from bracket.models.league import (
    LeagueAspectUsage,
    LeagueAdminUserView,
    LeagueFavoriteCard,
    LeagueDistributionBucket,
    LeagueMetaAnalysisView,
    LeagueMetaCardUsage,
    LeagueMetaCountBucket,
    LeagueMetaDeckCoreUsage,
    LeagueMetaKeywordImpact,
    LeagueMetaPerformancePattern,
    LeagueMetaSynergyGraph,
    LeagueMetaTrendingCard,
    LeagueCommunicationUpsertBody,
    LeagueCommunicationUpdateBody,
    LeagueCommunicationView,
    LeagueDashboardBackgroundSettingsUpdateBody,
    LeagueDashboardBackgroundSettingsView,
    LeaguePlayerCareerProfile,
    LeagueProjectedScheduleItemUpsertBody,
    LeagueProjectedScheduleItemUpdateBody,
    LeagueProjectedScheduleItemView,
    LeagueSeasonDraftCardBase,
    LeagueSeasonDraftOrderItem,
    LeagueSeasonDraftView,
    LeagueUpcomingOpponentView,
    LeagueSeasonRecord,
    LeagueSeasonAdminView,
    LeagueCardPoolEntryView,
    LeagueDeckView,
    LeagueSeasonPrivilegesUpdateBody,
    LeagueTournamentApplicationView,
    LeagueStandingsRow,
)
from bracket.sql.players import get_player_by_name, insert_player
from bracket.schema import teams
from bracket.utils.id_types import DeckId, TournamentId, UserId
from bracket.utils.league_cards import (
    DEFAULT_SWU_SET_CODES,
    fetch_swu_cards_cached,
    normalize_card_for_deckbuilding,
)
from bracket.utils.types import assert_some


async def get_or_create_active_season(tournament_id: TournamentId) -> Season:
    scope_filter = """
        (
            tournament_id = :tournament_id
            OR id IN (
                SELECT season_id
                FROM season_tournaments
                WHERE tournament_id = :tournament_id
            )
        )
    """
    existing_query = f"""
        SELECT *
        FROM seasons
        WHERE is_active = TRUE
          AND {scope_filter}
        ORDER BY created DESC, id DESC
    """
    async with database.transaction():
        # Prevent concurrent requests from creating duplicate active seasons for the same tournament.
        await database.execute(
            "SELECT pg_advisory_xact_lock(:lock_scope, :lock_key)",
            values={"lock_scope": 71001, "lock_key": int(tournament_id)},
        )

        existing_rows = await database.fetch_all(existing_query, values={"tournament_id": tournament_id})
        if len(existing_rows) > 0:
            canonical_row = existing_rows[0]
            duplicate_ids = [int(row._mapping["id"]) for row in existing_rows[1:]]
            if len(duplicate_ids) > 0:
                await database.execute(
                    "UPDATE seasons SET is_active = FALSE WHERE id = ANY(:season_ids)",
                    values={"season_ids": duplicate_ids},
                )
            return Season.model_validate(dict(canonical_row._mapping))

        rows = await database.fetch_all(
            f"""
            SELECT name
            FROM seasons
            WHERE {scope_filter}
            """,
            values={"tournament_id": tournament_id},
        )
        max_season_number = 0
        for row in rows:
            season_name = str(row._mapping["name"] or "")
            season_number_match = re.search(r"\bseason\s+(\d+)\b", season_name, re.IGNORECASE)
            if season_number_match is None:
                continue
            max_season_number = max(max_season_number, int(season_number_match.group(1)))
        season_number = max_season_number + 1 if max_season_number > 0 else (len(rows) + 1)

        created = datetime_utc.now()
        inserted = await database.fetch_one(
            """
            INSERT INTO seasons (tournament_id, name, created, is_active)
            VALUES (:tournament_id, :name, :created, TRUE)
            RETURNING *
            """,
            values={
                "tournament_id": tournament_id,
                "name": f"Season {season_number}",
                "created": created,
            },
        )
        season = Season.model_validate(dict(assert_some(inserted)._mapping))
        await set_season_tournaments(season.id, [tournament_id])
        return season


async def get_seasons_for_tournament(tournament_id: TournamentId) -> list[Season]:
    linked_rows = await database.fetch_all(
        """
        SELECT DISTINCT lps.season_id
        FROM league_projected_schedule_items lps
        WHERE lps.linked_tournament_id = :tournament_id
          AND lps.season_id IS NOT NULL
        ORDER BY lps.season_id ASC
        """,
        values={"tournament_id": int(tournament_id)},
    )
    linked_season_ids = [int(row._mapping["season_id"]) for row in linked_rows if row is not None]

    scoped_rows = await database.fetch_all(
        """
        WITH scoped_club AS (
            SELECT t.club_id
            FROM tournaments t
            WHERE t.id = :tournament_id
            LIMIT 1
        ),
        club_users AS (
            SELECT DISTINCT uxc.user_id
            FROM users_x_clubs uxc
            JOIN scoped_club sc ON sc.club_id = uxc.club_id
        ),
        club_tournaments AS (
            SELECT DISTINCT t.id
            FROM tournaments t
            JOIN scoped_club sc ON sc.club_id = t.club_id
        ),
        derived_seasons AS (
            SELECT d.season_id
            FROM decks d
            WHERE d.season_id IS NOT NULL
              AND (
                  d.tournament_id IN (SELECT id FROM club_tournaments)
                  OR d.user_id IN (SELECT user_id FROM club_users)
              )
            UNION
            SELECT cpe.season_id
            FROM card_pool_entries cpe
            WHERE cpe.season_id IS NOT NULL
              AND cpe.user_id IN (SELECT user_id FROM club_users)
            UNION
            SELECT ta.season_id
            FROM tournament_applications ta
            WHERE ta.season_id IS NOT NULL
              AND (
                  ta.tournament_id IN (SELECT id FROM club_tournaments)
                  OR ta.user_id IN (SELECT user_id FROM club_users)
              )
            UNION
            SELECT sm.season_id
            FROM season_memberships sm
            WHERE sm.season_id IS NOT NULL
              AND sm.user_id IN (SELECT user_id FROM club_users)
            UNION
            SELECT spl.season_id
            FROM season_points_ledger spl
            WHERE spl.season_id IS NOT NULL
              AND spl.user_id IN (SELECT user_id FROM club_users)
        )
        SELECT DISTINCT ds.season_id
        FROM derived_seasons ds
        ORDER BY ds.season_id ASC
        """,
        values={"tournament_id": int(tournament_id)},
    )
    scoped_season_ids = [
        int(row._mapping["season_id"])
        for row in scoped_rows
        if row is not None and row._mapping["season_id"] is not None
    ]
    season_id_candidates = sorted({*linked_season_ids, *scoped_season_ids})

    if len(season_id_candidates) > 0:
        season_ids_csv = ",".join(str(int(value)) for value in season_id_candidates)
        # Include explicit mappings plus derived club-scoped season usage from decks/card pools/apps.
        rows = await database.fetch_all(
            f"""
            SELECT DISTINCT s.*
            FROM seasons s
            LEFT JOIN season_tournaments st ON st.season_id = s.id
            WHERE s.id IN ({season_ids_csv})
               OR st.tournament_id = :tournament_id
               OR s.tournament_id = :tournament_id
            ORDER BY s.created ASC
            """,
            values={
                "tournament_id": int(tournament_id),
            },
        )
    else:
        rows = await database.fetch_all(
            """
            SELECT DISTINCT s.*
            FROM seasons s
            LEFT JOIN season_tournaments st ON st.season_id = s.id
            WHERE s.tournament_id = :tournament_id
               OR st.tournament_id = :tournament_id
            ORDER BY s.created ASC
            """,
            values={"tournament_id": int(tournament_id)},
        )
    seen_ids: set[int] = set()
    unique_by_name: dict[str, Season] = {}
    for row in rows:
        season = Season.model_validate(dict(row._mapping))
        season_id = int(season.id)
        if season_id in seen_ids:
            continue
        seen_ids.add(season_id)
        season_name_key = re.sub(r"\s+", " ", str(season.name)).strip().lower()
        lookup_key = season_name_key if season_name_key != "" else f"id:{season_id}"
        existing = unique_by_name.get(lookup_key)
        if existing is None:
            unique_by_name[lookup_key] = season
            continue
        if (not bool(existing.is_active) and bool(season.is_active)) or (
            bool(existing.is_active) == bool(season.is_active) and int(season.id) > int(existing.id)
        ):
            unique_by_name[lookup_key] = season
    return sorted(unique_by_name.values(), key=lambda item: item.created)


async def get_or_create_season_by_name(tournament_id: TournamentId, season_name: str) -> Season:
    normalized_name = season_name.strip()
    if normalized_name == "":
        return await get_or_create_active_season(tournament_id)

    query = """
        SELECT DISTINCT s.*
        FROM seasons s
        LEFT JOIN season_tournaments st ON st.season_id = s.id
        WHERE (s.tournament_id = :tournament_id OR st.tournament_id = :tournament_id)
          AND lower(name) = lower(:season_name)
        ORDER BY created DESC
        LIMIT 1
    """
    row = await database.fetch_one(
        query=query,
        values={"tournament_id": tournament_id, "season_name": normalized_name},
    )
    if row is not None:
        return Season.model_validate(dict(row._mapping))

    insert_query = """
        INSERT INTO seasons (tournament_id, name, created, is_active)
        VALUES (:tournament_id, :name, :created, FALSE)
        RETURNING *
    """
    inserted = await database.fetch_one(
        query=insert_query,
        values={
            "tournament_id": tournament_id,
            "name": normalized_name,
            "created": datetime_utc.now(),
        },
    )
    season = Season.model_validate(dict(assert_some(inserted)._mapping))
    await set_season_tournaments(season.id, [tournament_id])
    return season


def season_ids_subquery() -> str:
    return """
        SELECT season_id
        FROM season_tournaments
        WHERE tournament_id = :tournament_id
        UNION
        SELECT id
        FROM seasons
        WHERE tournament_id = :tournament_id
    """


async def get_tournament_ids_for_season(season_id: int) -> list[TournamentId]:
    query = """
        SELECT DISTINCT tournament_id
        FROM (
            SELECT tournament_id FROM season_tournaments WHERE season_id = :season_id
            UNION
            SELECT tournament_id FROM seasons WHERE id = :season_id
        ) mapped
        ORDER BY tournament_id
    """
    rows = await database.fetch_all(query=query, values={"season_id": season_id})
    return [TournamentId(int(row._mapping["tournament_id"])) for row in rows]


async def set_season_tournaments(season_id: int, tournament_ids: list[TournamentId]) -> None:
    unique_tournament_ids: list[TournamentId] = []
    seen: set[int] = set()
    for tournament_id in tournament_ids:
        if int(tournament_id) in seen:
            continue
        seen.add(int(tournament_id))
        unique_tournament_ids.append(tournament_id)

    if len(unique_tournament_ids) < 1:
        owner = await database.fetch_one(
            "SELECT tournament_id FROM seasons WHERE id = :season_id",
            values={"season_id": season_id},
        )
        if owner is not None:
            unique_tournament_ids = [TournamentId(int(owner._mapping["tournament_id"]))]

    async with database.transaction():
        await database.execute(
            "DELETE FROM season_tournaments WHERE season_id = :season_id",
            values={"season_id": season_id},
        )
        for tournament_id in unique_tournament_ids:
            await database.execute(
                """
                INSERT INTO season_tournaments (season_id, tournament_id)
                VALUES (:season_id, :tournament_id)
                ON CONFLICT (season_id, tournament_id) DO NOTHING
                """,
                values={"season_id": season_id, "tournament_id": int(tournament_id)},
            )


async def get_league_standings(
    tournament_id: TournamentId, season_id: int | None
) -> list[LeagueStandingsRow]:
    season_filter = (
        "AND spl.season_id = :season_id"
        if season_id is not None
        else f"AND spl.season_id IN ({season_ids_subquery()})"
    )
    membership_filter = (
        "AND sm.season_id = :season_id"
        if season_id is not None
        else f"""
            AND sm.season_id = (
                SELECT id
                FROM seasons
                WHERE is_active = TRUE
                  AND id IN ({season_ids_subquery()})
                ORDER BY created DESC
                LIMIT 1
            )
        """
    )
    tournament_scope_filter = (
        """
            t.id IN (
                SELECT tournament_id
                FROM season_tournaments
                WHERE season_id = :season_id
                UNION
                SELECT tournament_id
                FROM seasons
                WHERE id = :season_id
            )
        """
        if season_id is not None
        else f"""
            t.id IN (
                SELECT DISTINCT tournament_id
                FROM season_tournaments
                WHERE season_id IN ({season_ids_subquery()})
                UNION
                SELECT DISTINCT tournament_id
                FROM seasons
                WHERE id IN ({season_ids_subquery()})
            )
        """
    )
    season_points_user_filter = (
        "spl.season_id = :season_id"
        if season_id is not None
        else f"spl.season_id IN ({season_ids_subquery()})"
    )
    season_membership_user_filter = (
        "sm2.season_id = :season_id"
        if season_id is not None
        else f"sm2.season_id IN ({season_ids_subquery()})"
    )
    season_card_pool_user_filter = (
        "cpe.season_id = :season_id"
        if season_id is not None
        else f"cpe.season_id IN ({season_ids_subquery()})"
    )
    season_deck_user_filter = (
        "d.season_id = :season_id"
        if season_id is not None
        else f"d.season_id IN ({season_ids_subquery()})"
    )
    standings_visibility_filter = (
        "WHERE COALESCE(sm.hide_from_standings, FALSE) = FALSE"
        if season_id is not None
        else ""
    )
    live_cte = """
        ,
        live_match_points AS (
            SELECT
                tu.id AS user_id,
                COALESCE(SUM((p.wins * 3) + p.draws), 0) AS live_points,
                COALESCE(SUM(p.wins), 0) AS event_wins
            FROM tournament_users tu
            JOIN scoped_tournaments st
                ON TRUE
            LEFT JOIN players p
                ON p.tournament_id = st.id
               AND lower(trim(p.name)) = lower(trim(tu.name))
            GROUP BY tu.id
        )
    """
    live_join = """
        LEFT JOIN live_match_points lmp
            ON lmp.user_id = tu.id
    """
    live_group_by = "lmp.live_points,\n            lmp.event_wins,\n            "
    live_points_expression = "COALESCE(lmp.live_points, 0)"
    query = """
        WITH
        scoped_tournaments AS (
            SELECT DISTINCT t.id
            FROM tournaments t
            WHERE {tournament_scope_filter}
        ),
        tournament_users AS (
            SELECT DISTINCT u.id, u.name, u.email
            FROM users u
            WHERE u.id IN (
                SELECT uxc.user_id
                FROM users_x_clubs uxc
                WHERE uxc.club_id IN (
                    SELECT DISTINCT t.club_id
                    FROM tournaments t
                    WHERE t.id IN (
                        SELECT id
                        FROM scoped_tournaments
                    )
                )
                UNION
                SELECT ta.user_id
                FROM tournament_applications ta
                WHERE ta.tournament_id IN (
                    SELECT id
                    FROM scoped_tournaments
                )
                UNION
                SELECT spl.user_id
                FROM season_points_ledger spl
                WHERE {season_points_user_filter}
                UNION
                SELECT sm2.user_id
                FROM season_memberships sm2
                WHERE {season_membership_user_filter}
                UNION
                SELECT d.user_id
                FROM decks d
                WHERE d.tournament_id IN (
                    SELECT id
                    FROM scoped_tournaments
                )
                   OR {season_deck_user_filter}
                UNION
                SELECT cpe.user_id
                FROM card_pool_entries cpe
                WHERE {season_card_pool_user_filter}
            )
        )
        {live_cte}
        SELECT
            tu.id AS user_id,
            tu.name AS user_name,
            tu.email AS user_email,
            (
                COALESCE(
                    SUM(
                        CASE
                            WHEN spl.reason LIKE 'ACCOLADE:%' THEN 0
                            ELSE spl.points_delta
                        END
                    ),
                    0
                )
                + {live_points_expression}
            ) AS points,
            COALESCE(lmp.event_wins, 0) AS event_wins,
            COALESCE(
                ARRAY_AGG(REPLACE(spl.reason, 'ACCOLADE:', ''))
                FILTER (WHERE spl.reason LIKE 'ACCOLADE:%'),
                ARRAY[]::TEXT[]
            ) AS accolades,
            COALESCE(
                SUM(
                    CASE
                        WHEN spl.reason LIKE 'TOURNAMENT_WIN:%' THEN COALESCE(NULLIF(split_part(spl.reason, ':', 2), ''), '0')::INT
                        ELSE 0
                    END
                ),
                0
            ) AS tournament_wins,
            COALESCE(
                SUM(
                    CASE
                        WHEN spl.reason LIKE 'TOURNAMENT_PLACEMENT:%' THEN COALESCE(NULLIF(split_part(spl.reason, ':', 2), ''), '0')::INT
                        ELSE 0
                    END
                ),
                0
            ) AS tournament_placements,
            COALESCE(
                SUM(
                    CASE
                        WHEN spl.reason LIKE 'PRIZE_PACKS:%' THEN COALESCE(NULLIF(split_part(spl.reason, ':', 2), ''), '0')::INT
                        ELSE 0
                    END
                ),
                0
            ) AS prize_packs,
            sm.role,
            COALESCE(sm.can_manage_points, FALSE) AS can_manage_points,
            COALESCE(sm.can_manage_tournaments, FALSE) AS can_manage_tournaments
        FROM tournament_users tu
        LEFT JOIN season_memberships sm
            ON sm.user_id = tu.id
            {membership_filter}
        LEFT JOIN season_points_ledger spl
            ON spl.user_id = tu.id
            {season_filter}
        {live_join}
        {standings_visibility_filter}
        GROUP BY
            tu.id,
            tu.name,
            tu.email,
            {live_group_by}
            sm.role,
            sm.can_manage_points,
            sm.can_manage_tournaments
        ORDER BY points DESC, tu.name ASC
    """.format(
        tournament_scope_filter=tournament_scope_filter,
        membership_filter=membership_filter,
        season_filter=season_filter,
        season_points_user_filter=season_points_user_filter,
        season_membership_user_filter=season_membership_user_filter,
        season_card_pool_user_filter=season_card_pool_user_filter,
        season_deck_user_filter=season_deck_user_filter,
        standings_visibility_filter=standings_visibility_filter,
        live_cte=live_cte,
        live_join=live_join,
        live_group_by=live_group_by,
        live_points_expression=live_points_expression,
    )
    values: dict[str, int] = {}
    if season_id is None:
        values["tournament_id"] = int(tournament_id)
    else:
        values["season_id"] = int(season_id)
    result = await database.fetch_all(
        query=query,
        values=values,
    )
    return [
        LeagueStandingsRow.model_validate(
            {
                **dict(row._mapping),
                "accolades": list(row._mapping["accolades"] or []),
            }
        )
        for row in result
    ]


async def get_league_admin_users(
    tournament_id: TournamentId,
    season_id: int,
    include_all_users: bool = False,
) -> list[LeagueAdminUserView]:
    query = f"""
        WITH relevant_user_ids AS (
            SELECT DISTINCT uxc.user_id AS user_id
            FROM tournaments t
            JOIN users_x_clubs uxc ON uxc.club_id = t.club_id
            WHERE t.id = :tournament_id

            UNION

            SELECT DISTINCT ta.user_id
            FROM tournament_applications ta
            WHERE ta.tournament_id IN (
                SELECT tournament_id
                FROM season_tournaments
                WHERE season_id IN ({season_ids_subquery()})
                UNION
                SELECT tournament_id
                FROM seasons
                WHERE id IN ({season_ids_subquery()})
                UNION
                SELECT :tournament_id
            )

            UNION

            SELECT DISTINCT d.user_id
            FROM decks d
            WHERE d.tournament_id IN (
                    SELECT tournament_id
                    FROM season_tournaments
                    WHERE season_id IN ({season_ids_subquery()})
                    UNION
                    SELECT tournament_id
                    FROM seasons
                    WHERE id IN ({season_ids_subquery()})
                    UNION
                    SELECT :tournament_id
                )
               OR d.season_id IN ({season_ids_subquery()})

            UNION

            SELECT DISTINCT sm.user_id
            FROM season_memberships sm
            WHERE sm.season_id IN ({season_ids_subquery()})

            UNION

            SELECT DISTINCT cpe.user_id
            FROM card_pool_entries cpe
            WHERE cpe.season_id IN ({season_ids_subquery()})

            UNION

            SELECT DISTINCT u.id AS user_id
            FROM users u
            WHERE :include_all_users = TRUE
              AND COALESCE(u.account_type, 'REGULAR') <> 'DEMO'
        ),
        tournament_users AS (
            SELECT u.id, u.name, u.email, u.account_type
            FROM users u
            JOIN relevant_user_ids rui ON rui.user_id = u.id
        )
        SELECT
            tu.id AS user_id,
            tu.name AS user_name,
            tu.email AS user_email,
            tu.account_type,
            sm.role,
            COALESCE(sm.can_manage_points, FALSE) AS can_manage_points,
            COALESCE(sm.can_manage_tournaments, FALSE) AS can_manage_tournaments,
            COALESCE(sm.hide_from_standings, FALSE) AS hide_from_standings
        FROM tournament_users tu
        LEFT JOIN season_memberships sm
            ON sm.user_id = tu.id
            AND sm.season_id = :season_id
        ORDER BY tu.name ASC
    """
    rows = await database.fetch_all(
        query=query,
        values={
            "tournament_id": tournament_id,
            "season_id": season_id,
            "include_all_users": include_all_users,
        },
    )
    return [LeagueAdminUserView.model_validate(dict(row._mapping)) for row in rows]


async def upsert_season_membership(
    season_id: int,
    user_id: UserId,
    body: LeagueSeasonPrivilegesUpdateBody,
) -> None:
    query = """
        INSERT INTO season_memberships (
            season_id,
            user_id,
            role,
            can_manage_points,
            can_manage_tournaments,
            hide_from_standings,
            created
        )
        VALUES (
            :season_id,
            :user_id,
            :role,
            :can_manage_points,
            :can_manage_tournaments,
            :hide_from_standings,
            :created
        )
        ON CONFLICT (season_id, user_id)
        DO UPDATE SET
            role = EXCLUDED.role,
            can_manage_points = EXCLUDED.can_manage_points,
            can_manage_tournaments = EXCLUDED.can_manage_tournaments,
            hide_from_standings = EXCLUDED.hide_from_standings
    """
    await database.execute(
        query=query,
        values={
            "season_id": season_id,
            "user_id": user_id,
            "role": body.role.value,
            "can_manage_points": body.can_manage_points,
            "can_manage_tournaments": body.can_manage_tournaments,
            "hide_from_standings": body.hide_from_standings,
            "created": datetime_utc.now(),
        },
    )


async def insert_accolade(
    season_id: int,
    user_id: UserId,
    changed_by_user_id: UserId,
    accolade: str,
    notes: str | None,
) -> None:
    reason = f"ACCOLADE:{accolade.strip()}"
    if notes is not None and notes.strip() != "":
        reason = f"{reason} ({notes.strip()})"

    query = """
        INSERT INTO season_points_ledger (
            season_id,
            user_id,
            changed_by_user_id,
            tournament_id,
            points_delta,
            reason,
            created
        )
        VALUES (
            :season_id,
            :user_id,
            :changed_by_user_id,
            NULL,
            0,
            :reason,
            :created
        )
    """
    await database.execute(
        query=query,
        values={
            "season_id": season_id,
            "user_id": user_id,
            "changed_by_user_id": changed_by_user_id,
            "reason": reason,
            "created": datetime_utc.now(),
        },
    )


async def get_card_pool_entries(
    season_id: int,
    user_id: UserId | None,
) -> list[LeagueCardPoolEntryView]:
    if user_id is None:
        query = """
            SELECT user_id, card_id, quantity
            FROM card_pool_entries
            WHERE season_id = :season_id
            ORDER BY user_id ASC, card_id ASC
        """
        rows = await database.fetch_all(query=query, values={"season_id": season_id})
    else:
        query = """
            SELECT user_id, card_id, quantity
            FROM card_pool_entries
            WHERE season_id = :season_id AND user_id = :user_id
            ORDER BY card_id ASC
        """
        rows = await database.fetch_all(
            query=query,
            values={"season_id": season_id, "user_id": user_id},
        )

    return [LeagueCardPoolEntryView.model_validate(dict(row._mapping)) for row in rows]


async def get_card_pool_entries_for_tournament_scope(
    tournament_id: TournamentId,
    user_id: UserId | None,
) -> list[LeagueCardPoolEntryView]:
    values: dict[str, int] = {"tournament_id": int(tournament_id)}
    if user_id is None:
        user_filter = """
            cpe.user_id IN (
                SELECT uxc.user_id
                FROM users_x_clubs uxc
                WHERE uxc.club_id = (
                    SELECT t0.club_id
                    FROM tournaments t0
                    WHERE t0.id = :tournament_id
                )
            )
        """
    else:
        values["user_id"] = int(user_id)
        user_filter = """
            cpe.user_id = :user_id
        """

    latest_season_row = None
    if user_id is not None:
        # Prefer seasons that are in scope for this tournament when looking up a single user.
        # This keeps single-user view aligned with tournament-scoped all-users view.
        scoped_season_ids = [int(season.id) for season in await get_seasons_for_tournament(tournament_id)]
        if len(scoped_season_ids) > 0:
            season_ids_csv = ",".join(str(season_id) for season_id in scoped_season_ids)
            latest_season_row = await database.fetch_one(
                f"""
                SELECT s.id AS season_id
                FROM seasons s
                WHERE s.id IN ({season_ids_csv})
                  AND s.id IN (
                      SELECT DISTINCT cpe.season_id
                      FROM card_pool_entries cpe
                      WHERE cpe.user_id = :user_id
                  )
                ORDER BY s.created DESC, s.id DESC
                LIMIT 1
                """,
                values={"user_id": int(user_id)},
            )

    if latest_season_row is None:
        latest_season_row = await database.fetch_one(
            f"""
            SELECT s.id AS season_id
            FROM seasons s
            WHERE s.id IN (
                SELECT DISTINCT cpe.season_id
                FROM card_pool_entries cpe
                WHERE {user_filter}
            )
            ORDER BY s.created DESC, s.id DESC
            LIMIT 1
            """,
            values=values,
        )
    if latest_season_row is None:
        return []
    season_id = int(latest_season_row._mapping["season_id"])
    if user_id is not None:
        return await get_card_pool_entries(season_id, user_id)

    rows = await database.fetch_all(
        """
        SELECT cpe.user_id, cpe.card_id, cpe.quantity
        FROM card_pool_entries cpe
        WHERE cpe.season_id = :season_id
          AND cpe.user_id IN (
              SELECT uxc.user_id
              FROM users_x_clubs uxc
              WHERE uxc.club_id = (
                  SELECT t0.club_id
                  FROM tournaments t0
                  WHERE t0.id = :tournament_id
              )
          )
        ORDER BY cpe.user_id ASC, cpe.card_id ASC
        """,
        values={"season_id": season_id, "tournament_id": int(tournament_id)},
    )
    return [LeagueCardPoolEntryView.model_validate(dict(row._mapping)) for row in rows]


async def upsert_card_pool_entry(season_id: int, user_id: UserId, card_id: str, quantity: int) -> None:
    if quantity <= 0:
        delete_query = """
            DELETE FROM card_pool_entries
            WHERE season_id = :season_id AND user_id = :user_id AND card_id = :card_id
        """
        await database.execute(
            query=delete_query,
            values={"season_id": season_id, "user_id": user_id, "card_id": card_id},
        )
        return

    query = """
        INSERT INTO card_pool_entries (season_id, user_id, card_id, quantity, created)
        VALUES (:season_id, :user_id, :card_id, :quantity, :created)
        ON CONFLICT (season_id, user_id, card_id)
        DO UPDATE SET quantity = EXCLUDED.quantity
    """
    await database.execute(
        query=query,
        values={
            "season_id": season_id,
            "user_id": user_id,
            "card_id": card_id,
            "quantity": quantity,
            "created": datetime_utc.now(),
        },
    )


def _distribution_buckets(counter: Counter[str]) -> list[LeagueDistributionBucket]:
    return [
        LeagueDistributionBucket(label=label, count=count)
        for label, count in sorted(counter.items(), key=lambda item: (-item[1], item[0]))
    ]


def _parse_pool_draft_reason(reason: str) -> tuple[str, int, int, int] | None:
    # Format: POOL_DRAFT_<STATUS>:from=<season_id>:source=<source_user_id>:target=<target_user_id>
    if not reason.startswith("POOL_DRAFT_"):
        return None
    prefix = reason.split(":", 1)[0]
    if prefix not in {"POOL_DRAFT_PICK", "POOL_DRAFT_PENDING"}:
        return None
    values: dict[str, int] = {}
    for chunk in reason.split(":")[1:]:
        if "=" not in chunk:
            continue
        key, value = chunk.split("=", 1)
        try:
            values[key.strip()] = int(value.strip())
        except ValueError:
            return None
    if "from" not in values or "source" not in values or "target" not in values:
        return None
    return prefix, values["from"], values["source"], values["target"]


def _pool_draft_reason(
    *,
    pending: bool,
    from_season_id: int,
    source_user_id: int,
    target_user_id: int,
) -> str:
    status_label = "PENDING" if pending else "PICK"
    return (
        f"POOL_DRAFT_{status_label}:from={from_season_id}:"
        f"source={int(source_user_id)}:target={int(target_user_id)}"
    )


async def _get_draft_pick_mappings(
    from_season_id: int,
    to_season_id: int,
    *,
    pending: bool | None = None,
) -> dict[int, int]:
    rows = await database.fetch_all(
        """
        SELECT reason, created
        FROM season_points_ledger
        WHERE season_id = :to_season_id
          AND reason LIKE :reason_prefix
        ORDER BY created ASC
        """,
        values={
            "to_season_id": to_season_id,
            "reason_prefix": f"POOL_DRAFT_%:from={from_season_id}:%",
        },
    )
    target_to_source: dict[int, int] = {}
    for row in rows:
        parsed = _parse_pool_draft_reason(str(row._mapping["reason"] or ""))
        if parsed is None:
            continue
        prefix, parsed_from_season_id, source_user_id, target_user_id = parsed
        if parsed_from_season_id != from_season_id:
            continue
        if pending is True and prefix != "POOL_DRAFT_PENDING":
            continue
        if pending is False and prefix != "POOL_DRAFT_PICK":
            continue
        target_to_source[target_user_id] = source_user_id
    return target_to_source


async def apply_season_draft_pick(
    tournament_id: TournamentId,
    from_season_id: int,
    to_season_id: int,
    target_user_id: UserId,
    source_user_id: UserId,
    changed_by_user_id: UserId,
) -> None:
    existing_mappings = await _get_draft_pick_mappings(
        from_season_id,
        to_season_id,
        pending=True,
    )
    source_to_target = {source: target for target, source in existing_mappings.items()}
    already_claimed_by = source_to_target.get(int(source_user_id))
    if already_claimed_by is not None and already_claimed_by != int(target_user_id):
        raise ValueError("This card base has already been drafted by another player.")

    source_rows = await database.fetch_all(
        """
        SELECT card_id, quantity
        FROM card_pool_entries
        WHERE season_id = :from_season_id
          AND user_id = :source_user_id
        ORDER BY card_id ASC
        """,
        values={"from_season_id": from_season_id, "source_user_id": source_user_id},
    )
    if len(source_rows) < 1:
        raise ValueError("Selected card base has no cards in the previous season.")

    old_source_for_target = existing_mappings.get(int(target_user_id))
    async with database.transaction():
        if old_source_for_target is not None:
            await database.execute(
                """
                DELETE FROM season_points_ledger
                WHERE season_id = :to_season_id
                  AND reason = :reason
                """,
                values={
                    "to_season_id": to_season_id,
                    "reason": _pool_draft_reason(
                        pending=True,
                        from_season_id=from_season_id,
                        source_user_id=old_source_for_target,
                        target_user_id=int(target_user_id),
                    ),
                },
            )

        await database.execute(
            """
            INSERT INTO season_points_ledger (
                season_id,
                user_id,
                changed_by_user_id,
                tournament_id,
                points_delta,
                reason,
                created
            )
            VALUES (
                :season_id,
                :user_id,
                :changed_by_user_id,
                :tournament_id,
                0,
                :reason,
                :created
            )
            """,
            values={
                "season_id": to_season_id,
                "user_id": target_user_id,
                "changed_by_user_id": changed_by_user_id,
                "tournament_id": tournament_id,
                "reason": _pool_draft_reason(
                    pending=True,
                    from_season_id=from_season_id,
                    source_user_id=int(source_user_id),
                    target_user_id=int(target_user_id),
                ),
                "created": datetime_utc.now(),
            },
        )


async def confirm_season_draft_results(
    tournament_id: TournamentId,
    from_season_id: int,
    to_season_id: int,
    changed_by_user_id: UserId,
) -> None:
    pending_mappings = await _get_draft_pick_mappings(
        from_season_id,
        to_season_id,
        pending=True,
    )
    if len(pending_mappings) < 1:
        raise ValueError("No pending draft picks to confirm.")

    confirmed_mappings = await _get_draft_pick_mappings(
        from_season_id,
        to_season_id,
        pending=False,
    )
    target_ids_to_refresh = sorted({*pending_mappings.keys(), *confirmed_mappings.keys()})

    async with database.transaction():
        for target_user_id in target_ids_to_refresh:
            await database.execute(
                """
                DELETE FROM card_pool_entries
                WHERE season_id = :to_season_id
                  AND user_id = :target_user_id
                """,
                values={
                    "to_season_id": to_season_id,
                    "target_user_id": int(target_user_id),
                },
            )

        await database.execute(
            """
            DELETE FROM season_points_ledger
            WHERE season_id = :to_season_id
              AND reason LIKE :reason_prefix
            """,
            values={
                "to_season_id": to_season_id,
                "reason_prefix": f"POOL_DRAFT_PICK:from={from_season_id}:%",
            },
        )

        for target_user_id, source_user_id in sorted(pending_mappings.items(), key=lambda item: item[0]):
            source_rows = await database.fetch_all(
                """
                SELECT card_id, quantity
                FROM card_pool_entries
                WHERE season_id = :from_season_id
                  AND user_id = :source_user_id
                ORDER BY card_id ASC
                """,
                values={
                    "from_season_id": from_season_id,
                    "source_user_id": int(source_user_id),
                },
            )
            if len(source_rows) < 1:
                raise ValueError("Selected card base has no cards in the previous season.")
            for source_row in source_rows:
                quantity = int(source_row._mapping["quantity"] or 0)
                if quantity <= 0:
                    continue
                await database.execute(
                    """
                    INSERT INTO card_pool_entries (season_id, user_id, card_id, quantity, created)
                    VALUES (:season_id, :user_id, :card_id, :quantity, :created)
                    ON CONFLICT (season_id, user_id, card_id)
                    DO UPDATE SET quantity = EXCLUDED.quantity
                    """,
                    values={
                        "season_id": to_season_id,
                        "user_id": int(target_user_id),
                        "card_id": str(source_row._mapping["card_id"]),
                        "quantity": quantity,
                        "created": datetime_utc.now(),
                    },
                )

            await database.execute(
                """
                INSERT INTO season_points_ledger (
                    season_id,
                    user_id,
                    changed_by_user_id,
                    tournament_id,
                    points_delta,
                    reason,
                    created
                )
                VALUES (
                    :season_id,
                    :user_id,
                    :changed_by_user_id,
                    :tournament_id,
                    0,
                    :reason,
                    :created
                )
                """,
                values={
                    "season_id": to_season_id,
                    "user_id": int(target_user_id),
                    "changed_by_user_id": int(changed_by_user_id),
                    "tournament_id": int(tournament_id),
                    "reason": _pool_draft_reason(
                        pending=False,
                        from_season_id=from_season_id,
                        source_user_id=int(source_user_id),
                        target_user_id=int(target_user_id),
                    ),
                    "created": datetime_utc.now(),
                },
            )

        await database.execute(
            """
            DELETE FROM season_points_ledger
            WHERE season_id = :to_season_id
              AND reason LIKE :reason_prefix
            """,
            values={
                "to_season_id": to_season_id,
                "reason_prefix": f"POOL_DRAFT_PENDING:from={from_season_id}:%",
            },
        )


async def reset_season_draft_results(
    from_season_id: int,
    to_season_id: int,
) -> None:
    await database.execute(
        """
        DELETE FROM season_points_ledger
        WHERE season_id = :to_season_id
          AND reason LIKE :reason_prefix
        """,
        values={
            "to_season_id": to_season_id,
            "reason_prefix": f"POOL_DRAFT_PENDING:from={from_season_id}:%",
        },
    )


async def get_season_draft_view(tournament_id: TournamentId) -> LeagueSeasonDraftView:
    seasons = await get_seasons_for_tournament(tournament_id)
    if len(seasons) < 2:
        return LeagueSeasonDraftView()

    ordered = sorted(seasons, key=lambda season: season.created)
    active = next((season for season in reversed(ordered) if season.is_active), ordered[-1])
    active_index = next(
        (index for index, season in enumerate(ordered) if int(season.id) == int(active.id)),
        len(ordered) - 1,
    )
    if active_index < 1:
        return LeagueSeasonDraftView(
            to_season_id=int(active.id),
            to_season_name=active.name,
        )
    previous = ordered[active_index - 1]

    standings = await get_league_standings(tournament_id, previous.id)
    standings_by_user_id = {int(row.user_id): row for row in standings}
    user_ids = [int(row.user_id) for row in standings]
    user_names = {int(row.user_id): row.user_name for row in standings}

    tournament_ids = await get_tournament_ids_for_season(previous.id)
    records_by_user_id: dict[int, tuple[int, int, int]] = {}
    if len(tournament_ids) > 0 and len(user_ids) > 0:
        tournaments_csv = ",".join(str(int(value)) for value in tournament_ids)
        user_ids_csv = ",".join(str(int(value)) for value in user_ids)
        record_rows = await database.fetch_all(
            f"""
            SELECT
                u.id AS user_id,
                COALESCE(SUM(p.wins), 0) AS wins,
                COALESCE(SUM(p.draws), 0) AS draws,
                COALESCE(SUM(p.losses), 0) AS losses
            FROM users u
            LEFT JOIN players p
              ON lower(trim(p.name)) = lower(trim(u.name))
             AND p.tournament_id IN ({tournaments_csv})
            WHERE u.id IN ({user_ids_csv})
            GROUP BY u.id
            """
        )
        for row in record_rows:
            records_by_user_id[int(row._mapping["user_id"])] = (
                int(row._mapping["wins"] or 0),
                int(row._mapping["draws"] or 0),
                int(row._mapping["losses"] or 0),
            )

    pending_picks_by_target = await _get_draft_pick_mappings(previous.id, active.id, pending=True)
    confirmed_picks_by_target = await _get_draft_pick_mappings(previous.id, active.id, pending=False)
    picks_by_target = (
        pending_picks_by_target
        if len(pending_picks_by_target) > 0
        else confirmed_picks_by_target
    )
    picks_by_source = {source: target for target, source in picks_by_target.items()}

    card_pool_entries = await get_card_pool_entries(previous.id, None)
    pool_by_source: dict[int, list[LeagueCardPoolEntryView]] = {}
    for entry in card_pool_entries:
        pool_by_source.setdefault(int(entry.user_id), []).append(entry)

    set_codes = sorted(
        {
            set_code
            for set_code in (_extract_set_code_from_card_id(str(entry.card_id)) for entry in card_pool_entries)
            if set_code is not None and set_code != ""
        }
    )
    card_lookup: dict[str, dict] = {}
    if len(set_codes) > 0:
        try:
            cards_raw = await asyncio.to_thread(fetch_swu_cards_cached, set_codes, 8, 1800)
            cards = [normalize_card_for_deckbuilding(card) for card in cards_raw]
            for card in cards:
                card_id = _normalize_meta_card_id(str(card.get("card_id") or ""))
                if card_id == "":
                    continue
                previous = card_lookup.get(card_id)
                card_lookup[card_id] = _preferred_card_row(previous, card)
        except Exception:
            card_lookup = {}

    source_user_ids = sorted(pool_by_source.keys())
    unknown_source_user_ids = [user_id for user_id in source_user_ids if user_id not in user_names]
    if len(unknown_source_user_ids) > 0:
        unknown_ids_csv = ",".join(str(user_id) for user_id in unknown_source_user_ids)
        unknown_rows = await database.fetch_all(
            f"""
            SELECT id, name
            FROM users
            WHERE id IN ({unknown_ids_csv})
            """
        )
        for row in unknown_rows:
            user_names[int(row._mapping["id"])] = str(row._mapping["name"])

    card_bases: list[LeagueSeasonDraftCardBase] = []
    for source_user_id, entries in pool_by_source.items():
        by_cost: Counter[str] = Counter()
        by_type: Counter[str] = Counter()
        by_aspect: Counter[str] = Counter()
        by_trait: Counter[str] = Counter()
        by_rarity: Counter[str] = Counter()
        total_cards = 0

        for entry in entries:
            quantity = int(entry.quantity)
            if quantity <= 0:
                continue
            total_cards += quantity
            card = _resolve_meta_card(card_lookup, str(entry.card_id))
            if card is None:
                by_type["Unknown"] += quantity
                by_rarity["Unknown"] += quantity
                by_cost["-"] += quantity
                continue

            by_cost[str(card.get("cost") if card.get("cost") is not None else "-")] += quantity
            by_type[str(card.get("type") or "Unknown")] += quantity
            by_rarity[str(card.get("rarity") or "Unknown")] += quantity

            for aspect in card.get("aspects", []) or []:
                label = str(aspect).strip()
                if label != "":
                    by_aspect[label] += quantity
            for trait in card.get("traits", []) or []:
                label = str(trait).strip()
                if label != "":
                    by_trait[label] += quantity

        wins, draws, losses = records_by_user_id.get(source_user_id, (0, 0, 0))
        target_user_id = picks_by_source.get(source_user_id)
        standings_row = standings_by_user_id.get(source_user_id)
        previous_points = float(standings_row.points) if standings_row is not None else 0
        card_bases.append(
            LeagueSeasonDraftCardBase(
                source_user_id=source_user_id,
                source_user_name=user_names.get(source_user_id, f"User {source_user_id}"),
                total_cards=total_cards,
                previous_points=previous_points,
                previous_wins=wins,
                previous_draws=draws,
                previous_losses=losses,
                previous_matches=wins + draws + losses,
                by_cost=_distribution_buckets(by_cost),
                by_type=_distribution_buckets(by_type),
                by_aspect=_distribution_buckets(by_aspect),
                by_trait=_distribution_buckets(by_trait),
                by_rarity=_distribution_buckets(by_rarity),
                claimed_by_user_id=None if target_user_id is None else UserId(target_user_id),
                claimed_by_user_name=None if target_user_id is None else user_names.get(target_user_id),
            )
        )

    ordered_for_draft = sorted(
        standings,
        key=lambda row: (
            float(row.points),
            row.user_name.lower(),
        ),
    )
    draft_order: list[LeagueSeasonDraftOrderItem] = []
    for index, row in enumerate(ordered_for_draft):
        user_id = int(row.user_id)
        wins, draws, losses = records_by_user_id.get(user_id, (0, 0, 0))
        picked_source_user_id = picks_by_target.get(user_id)
        draft_order.append(
            LeagueSeasonDraftOrderItem(
                pick_number=index + 1,
                user_id=user_id,
                user_name=row.user_name,
                previous_points=float(row.points),
                previous_wins=wins,
                previous_draws=draws,
                previous_losses=losses,
                previous_matches=wins + draws + losses,
                picked_source_user_id=(
                    None if picked_source_user_id is None else UserId(picked_source_user_id)
                ),
                picked_source_user_name=(
                    None if picked_source_user_id is None else user_names.get(picked_source_user_id)
                ),
            )
        )

    card_bases.sort(
        key=lambda item: (
            -item.previous_points,
            item.source_user_name.lower(),
        )
    )

    return LeagueSeasonDraftView(
        from_season_id=int(previous.id),
        from_season_name=previous.name,
        to_season_id=int(active.id),
        to_season_name=active.name,
        pending_pick_count=len(pending_picks_by_target),
        confirmed_pick_count=len(confirmed_picks_by_target),
        draft_order=draft_order,
        card_bases=card_bases,
    )


async def get_decks(
    season_id: int,
    user_id: UserId | None = None,
    *,
    only_admin_users: bool = False,
) -> list[LeagueDeckView]:
    values: dict[str, int] = {"season_id": season_id}
    scope_filter = "d.season_id = :season_id"
    condition = ""
    if user_id is not None:
        condition = "AND d.user_id = :user_id"
        values["user_id"] = user_id
    if only_admin_users:
        condition += " AND u.account_type = 'ADMIN'"

    query = _build_get_decks_query(scope_filter=scope_filter, condition=condition)
    rows = await database.fetch_all(query=query, values=values)
    return [LeagueDeckView.model_validate(dict(row._mapping)) for row in rows]


async def get_decks_for_tournament_scope(
    tournament_id: TournamentId,
    user_id: UserId | None = None,
    *,
    only_admin_users: bool = False,
) -> list[LeagueDeckView]:
    values: dict[str, int] = {"tournament_id": int(tournament_id)}
    scope_filter = f"""
        (
            d.season_id IN ({season_ids_subquery()})
            OR d.tournament_id IN (
                SELECT club_tournaments.id
                FROM tournaments club_tournaments
                WHERE club_tournaments.club_id = (
                    SELECT t0.club_id
                    FROM tournaments t0
                    WHERE t0.id = :tournament_id
                )
            )
        )
    """
    condition = ""
    if user_id is not None:
        condition = "AND d.user_id = :user_id"
        values["user_id"] = user_id
    if only_admin_users:
        condition += " AND u.account_type = 'ADMIN'"

    query = _build_get_decks_query(scope_filter=scope_filter, condition=condition)
    rows = await database.fetch_all(query=query, values=values)
    return [LeagueDeckView.model_validate(dict(row._mapping)) for row in rows]


async def get_decks_for_tournament_club_users(
    tournament_id: TournamentId,
    user_id: UserId | None = None,
    *,
    only_admin_users: bool = False,
) -> list[LeagueDeckView]:
    values: dict[str, int] = {"tournament_id": int(tournament_id)}
    scope_filter = """
        d.user_id IN (
            SELECT uxc.user_id
            FROM users_x_clubs uxc
            WHERE uxc.club_id = (
                SELECT t0.club_id
                FROM tournaments t0
                WHERE t0.id = :tournament_id
            )
        )
    """
    condition = ""
    if user_id is not None:
        condition = "AND d.user_id = :user_id"
        values["user_id"] = user_id
    if only_admin_users:
        condition += " AND u.account_type = 'ADMIN'"

    query = _build_get_decks_query(scope_filter=scope_filter, condition=condition)
    rows = await database.fetch_all(query=query, values=values)
    return [LeagueDeckView.model_validate(dict(row._mapping)) for row in rows]


def _build_get_decks_query(*, scope_filter: str, condition: str) -> str:
    return f"""
        WITH deck_stats AS (
            SELECT
                ta.deck_id,
                COUNT(DISTINCT ta.tournament_id) AS tournaments_submitted,
                COALESCE(SUM(p.wins), 0) AS wins,
                COALESCE(SUM(p.draws), 0) AS draws,
                COALESCE(SUM(p.losses), 0) AS losses
            FROM tournament_applications ta
            JOIN decks d2 ON d2.id = ta.deck_id
            JOIN users u2 ON u2.id = d2.user_id
            JOIN tournaments t ON t.id = ta.tournament_id
            LEFT JOIN players p
                ON p.tournament_id = t.id
               AND lower(trim(p.name)) = lower(trim(u2.name))
            WHERE ta.deck_id IS NOT NULL
            GROUP BY ta.deck_id
        )
        SELECT
            d.id,
            d.season_id,
            d.user_id,
            u.name AS user_name,
            u.email AS user_email,
            d.tournament_id,
            d.name,
            d.leader,
            d.base,
            d.mainboard,
            d.sideboard,
            d.created,
            d.updated,
            COALESCE(ds.tournaments_submitted, 0) AS tournaments_submitted,
            COALESCE(ds.wins, 0) AS wins,
            COALESCE(ds.draws, 0) AS draws,
            COALESCE(ds.losses, 0) AS losses,
            COALESCE(ds.wins, 0) + COALESCE(ds.draws, 0) + COALESCE(ds.losses, 0) AS matches,
            CASE
                WHEN COALESCE(ds.wins, 0) + COALESCE(ds.draws, 0) + COALESCE(ds.losses, 0) > 0
                    THEN ROUND(
                        (
                            COALESCE(ds.wins, 0)::numeric
                            / (
                                COALESCE(ds.wins, 0)
                                + COALESCE(ds.draws, 0)
                                + COALESCE(ds.losses, 0)
                            )
                        ) * 100,
                        2
                    )::float
                ELSE 0
            END AS win_percentage
        FROM decks d
        JOIN users u ON u.id = d.user_id
        LEFT JOIN deck_stats ds ON ds.deck_id = d.id
        WHERE {scope_filter}
        {condition}
        ORDER BY d.updated DESC, d.name ASC
    """


def _extract_set_code_from_card_id(card_id: str) -> str | None:
    normalized = _normalize_meta_card_id(card_id)
    if normalized == "":
        return None
    if "-" in normalized:
        prefix = normalized.split("-", 1)[0].strip()
        return prefix or None
    return None


def _normalize_meta_card_id(card_id: str | None) -> str:
    normalized = (
        str(card_id or "")
        .strip()
        .lower()
        .replace("_", "-")
        .replace(" ", "-")
    )
    if normalized == "":
        return ""
    while "--" in normalized:
        normalized = normalized.replace("--", "-")
    normalized = normalized.strip("-")
    if "-" not in normalized:
        return normalized

    set_code, remainder = normalized.split("-", 1)
    set_code = set_code.strip()
    remainder = remainder.strip()
    if set_code == "" or remainder == "":
        return normalized

    number_token = remainder.split("-", 1)[0].strip()
    if number_token == "":
        return f"{set_code}-{remainder}"

    parsed = re.fullmatch(r"0*(\d+)([a-z]*)", number_token)
    if parsed is None:
        return f"{set_code}-{number_token}"

    numeric = str(int(parsed.group(1)))
    suffix = parsed.group(2) or ""
    return f"{set_code}-{numeric}{suffix}"


def _meta_card_lookup_keys(card_id: str | None) -> list[str]:
    normalized = _normalize_meta_card_id(card_id)
    if normalized == "":
        return []

    keys: list[str] = [normalized]
    if "-" not in normalized:
        return keys

    set_code, remainder = normalized.split("-", 1)
    base_match = re.fullmatch(r"(\d+)[a-z]+", remainder)
    if base_match is not None:
        keys.append(f"{set_code}-{base_match.group(1)}")
    return keys


def _resolve_meta_card(card_lookup: dict[str, dict], card_id: str | None) -> dict | None:
    for key in _meta_card_lookup_keys(card_id):
        card = card_lookup.get(key)
        if card is not None:
            return card
    return None


def _normalize_variant_type(value: str | None) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _preferred_card_row(previous: dict | None, current: dict) -> dict:
    if previous is None:
        return current
    variant_rank = {
        "showcase": 0,
        "hyperspace foil": 1,
        "hyperspace": 2,
        "normal": 3,
        "serialized": 4,
        "foil": 5,
        "": 6,
    }
    prev_image = str(previous.get("image_url") or "").strip()
    curr_image = str(current.get("image_url") or "").strip()
    if prev_image == "" and curr_image != "":
        return current
    if prev_image != "" and curr_image == "":
        return previous

    prev_rank = variant_rank.get(_normalize_variant_type(previous.get("variant_type")), 99)
    curr_rank = variant_rank.get(_normalize_variant_type(current.get("variant_type")), 99)
    if curr_rank < prev_rank:
        return current
    return previous


async def get_league_meta_analysis(
    *,
    season_id: int,
    season_name: str,
) -> LeagueMetaAnalysisView:
    decks = await get_decks(season_id)
    if len(decks) < 1:
        return LeagueMetaAnalysisView(
            season_id=season_id,
            season_name=season_name,
            total_decks=0,
            top_decks_sample_size=0,
        )

    def win_rate_from(wins: int, matches: int) -> float:
        if matches <= 0:
            return 0
        return round((wins / matches) * 100, 2)

    season_scoped_deck_stats_rows = await database.fetch_all(
        """
        WITH scoped_tournaments AS (
            SELECT tournament_id
            FROM season_tournaments
            WHERE season_id = :season_id
            UNION
            SELECT tournament_id
            FROM seasons
            WHERE id = :season_id
        )
        SELECT
            ta.deck_id,
            COALESCE(SUM(p.wins), 0) AS wins,
            COALESCE(SUM(p.draws), 0) AS draws,
            COALESCE(SUM(p.losses), 0) AS losses
        FROM tournament_applications ta
        JOIN scoped_tournaments st ON st.tournament_id = ta.tournament_id
        JOIN decks d2 ON d2.id = ta.deck_id
        JOIN users u2 ON u2.id = d2.user_id
        LEFT JOIN players p
            ON p.tournament_id = ta.tournament_id
           AND lower(trim(p.name)) = lower(trim(u2.name))
        WHERE ta.deck_id IS NOT NULL
          AND d2.season_id = :season_id
        GROUP BY ta.deck_id
        """,
        values={"season_id": season_id},
    )
    season_scoped_stats_by_deck_id: dict[int, tuple[int, int, int]] = {
        int(row._mapping["deck_id"]): (
            int(row._mapping["wins"] or 0),
            int(row._mapping["draws"] or 0),
            int(row._mapping["losses"] or 0),
        )
        for row in season_scoped_deck_stats_rows
        if row._mapping.get("deck_id") is not None
    }

    def deck_performance(deck: LeagueDeckView) -> tuple[int, int, int, int, float]:
        wins, draws, losses = season_scoped_stats_by_deck_id.get(
            int(deck.id),
            (int(deck.wins), int(deck.draws), int(deck.losses)),
        )
        matches = wins + draws + losses
        return wins, draws, losses, matches, win_rate_from(wins, matches)

    deck_stats_cache: dict[int, tuple[int, int, int, int, float]] = {
        int(deck.id): deck_performance(deck) for deck in decks
    }
    total_league_wins = sum(int(stats[0]) for stats in deck_stats_cache.values())
    total_league_matches = sum(int(stats[3]) for stats in deck_stats_cache.values())
    league_average_win_rate = win_rate_from(total_league_wins, total_league_matches)

    top4_rows = await database.fetch_all(
        """
        WITH scoped_tournaments AS (
            SELECT tournament_id
            FROM season_tournaments
            WHERE season_id = :season_id
            UNION
            SELECT tournament_id
            FROM seasons
            WHERE id = :season_id
        ),
        ranked_players AS (
            SELECT
                p.tournament_id,
                lower(trim(p.name)) AS player_name_normalized,
                ROW_NUMBER() OVER (
                    PARTITION BY p.tournament_id
                    ORDER BY p.wins DESC, p.swiss_score DESC, p.elo_score DESC, p.id ASC
                ) AS placement_rank
            FROM players p
            JOIN scoped_tournaments st ON st.tournament_id = p.tournament_id
            WHERE COALESCE(p.active, TRUE) = TRUE
        )
        SELECT
            ta.deck_id,
            COUNT(*)::INT AS appearances,
            COUNT(*) FILTER (WHERE rp.placement_rank <= 4)::INT AS top4_finishes
        FROM tournament_applications ta
        JOIN decks d ON d.id = ta.deck_id AND d.season_id = :season_id
        JOIN users u ON u.id = d.user_id
        LEFT JOIN ranked_players rp
          ON rp.tournament_id = ta.tournament_id
         AND rp.player_name_normalized = lower(trim(u.name))
        WHERE ta.deck_id IS NOT NULL
        GROUP BY ta.deck_id
        """,
        values={"season_id": season_id},
    )
    top4_by_deck_id: dict[int, tuple[int, int]] = {
        int(row._mapping["deck_id"]): (
            int(row._mapping["top4_finishes"] or 0),
            int(row._mapping["appearances"] or 0),
        )
        for row in top4_rows
        if row._mapping.get("deck_id") is not None
    }

    leader_counts: Counter[str] = Counter()
    leader_wins: Counter[str] = Counter()
    leader_matches: Counter[str] = Counter()

    card_total_copies: Counter[str] = Counter()
    card_deck_counts: Counter[str] = Counter()
    cost_curve_totals: Counter[str] = Counter()
    cost_curve_wins: Counter[str] = Counter()
    cost_curve_matches: Counter[str] = Counter()
    arena_pattern_totals: Counter[str] = Counter()
    arena_pattern_wins: Counter[str] = Counter()
    arena_pattern_matches: Counter[str] = Counter()
    hero_villain_totals: Counter[str] = Counter()
    hero_villain_wins: Counter[str] = Counter()
    hero_villain_matches: Counter[str] = Counter()
    aspect_combo_totals: Counter[str] = Counter()
    aspect_combo_wins: Counter[str] = Counter()
    aspect_combo_matches: Counter[str] = Counter()

    for deck in decks:
        deck_wins, _, _, deck_matches, _ = deck_stats_cache[int(deck.id)]
        leader_id = _normalize_meta_card_id(deck.leader)
        if leader_id != "":
            leader_counts[leader_id] += 1
            leader_wins[leader_id] += deck_wins
            leader_matches[leader_id] += deck_matches

        deck_card_ids: set[str] = set()
        for card_id in {**deck.mainboard, **deck.sideboard}.keys():
            normalized_card_id = _normalize_meta_card_id(card_id)
            if normalized_card_id != "":
                deck_card_ids.add(normalized_card_id)

        for card_id, count in deck.mainboard.items():
            normalized_card_id = _normalize_meta_card_id(card_id)
            if normalized_card_id == "":
                continue
            card_total_copies[normalized_card_id] += int(count)
        for card_id, count in deck.sideboard.items():
            normalized_card_id = _normalize_meta_card_id(card_id)
            if normalized_card_id == "":
                continue
            card_total_copies[normalized_card_id] += int(count)
        for card_id in deck_card_ids:
            card_deck_counts[card_id] += 1

    needed_card_ids = set(card_total_copies.keys())
    needed_card_ids.update(leader_counts.keys())
    needed_card_ids.update(
        _normalize_meta_card_id(deck.base) for deck in decks if _normalize_meta_card_id(deck.base) != ""
    )
    set_codes = sorted(
        {
            set_code
            for set_code in (
                _extract_set_code_from_card_id(card_id) for card_id in needed_card_ids
            )
            if set_code is not None
        }
    )

    card_lookup: dict[str, dict] = {}
    if len(set_codes) > 0:
        try:
            cards_raw = await asyncio.to_thread(fetch_swu_cards_cached, set_codes, 8, 1800)
            cards = [normalize_card_for_deckbuilding(card) for card in cards_raw]
            for card in cards:
                normalized_card_id = _normalize_meta_card_id(card.get("card_id"))
                if normalized_card_id == "":
                    continue
                previous = card_lookup.get(normalized_card_id)
                card_lookup[normalized_card_id] = _preferred_card_row(previous, card)
        except Exception:
            card_lookup = {}

    HEROIC_ASPECT_VALUES = {"heroic", "heroism"}
    VILLAINY_ASPECT_VALUES = {"villainy"}

    def combo_aspect_label(aspect_value: str) -> str:
        normalized = str(aspect_value).strip().lower()
        if normalized in HEROIC_ASPECT_VALUES:
            return "Heroism"
        if normalized in VILLAINY_ASPECT_VALUES or normalized == "villany":
            return "Villainy"
        return normalized.title()

    deck_trait_presence_by_deck: dict[int, set[str]] = {}
    deck_keyword_presence_by_deck: dict[int, set[str]] = {}

    for deck in decks:
        deck_wins, _, _, deck_matches, _ = deck_stats_cache[int(deck.id)]
        low_cost_copies = 0
        mid_cost_copies = 0
        high_cost_copies = 0
        space_unit_copies = 0
        ground_unit_copies = 0
        total_mainboard_copies = 0
        total_arena_unit_copies = 0

        leader_card = _resolve_meta_card(card_lookup, deck.leader) or {}
        base_card = _resolve_meta_card(card_lookup, deck.base) or {}
        leader_aspects = {
            str(aspect).strip().lower()
            for aspect in (leader_card.get("aspects") or [])
            if str(aspect).strip() != ""
        }
        deck_aspects = {
            str(aspect).strip().lower()
            for aspect in [*(leader_card.get("aspects") or []), *(base_card.get("aspects") or [])]
            if str(aspect).strip() != ""
        }
        if any(aspect in VILLAINY_ASPECT_VALUES for aspect in leader_aspects):
            alignment_label = "Villainy"
        elif any(aspect in HEROIC_ASPECT_VALUES for aspect in leader_aspects):
            alignment_label = "Heroic"
        else:
            alignment_label = "Unknown"
        hero_villain_totals[alignment_label] += 1
        hero_villain_wins[alignment_label] += deck_wins
        hero_villain_matches[alignment_label] += deck_matches

        combo_aspects = sorted({combo_aspect_label(aspect) for aspect in deck_aspects})
        combo_label = " + ".join(combo_aspects) if len(combo_aspects) > 0 else "Colorless / Neutral"
        aspect_combo_totals[combo_label] += 1
        aspect_combo_wins[combo_label] += deck_wins
        aspect_combo_matches[combo_label] += deck_matches

        deck_traits: set[str] = set()
        deck_keywords: set[str] = set()
        for card_id, count in deck.mainboard.items():
            normalized_card_id = _normalize_meta_card_id(card_id)
            normalized_count = int(count)
            if normalized_card_id == "" or normalized_count <= 0:
                continue
            total_mainboard_copies += normalized_count
            card = _resolve_meta_card(card_lookup, normalized_card_id)
            if card is None:
                continue
            cost = card.get("cost")
            if isinstance(cost, int):
                if cost <= 2:
                    low_cost_copies += normalized_count
                elif cost >= 6:
                    high_cost_copies += normalized_count
                else:
                    mid_cost_copies += normalized_count

            arenas = [str(arena).strip().lower() for arena in (card.get("arenas") or [])]
            card_type = str(card.get("type") or "").strip().lower()
            if card_type == "unit":
                if "space" in arenas:
                    space_unit_copies += normalized_count
                if "ground" in arenas:
                    ground_unit_copies += normalized_count
                if "space" in arenas or "ground" in arenas:
                    total_arena_unit_copies += normalized_count

            for trait in card.get("traits", []):
                normalized_trait = str(trait).strip()
                if normalized_trait != "":
                    deck_traits.add(normalized_trait)
            for keyword in card.get("keywords", []):
                normalized_keyword = str(keyword).strip()
                if normalized_keyword != "":
                    deck_keywords.add(normalized_keyword)

        if total_mainboard_copies > 0:
            low_ratio = low_cost_copies / total_mainboard_copies
            mid_ratio = mid_cost_copies / total_mainboard_copies
            high_ratio = high_cost_copies / total_mainboard_copies
            if high_ratio >= 0.40:
                curve_label = "High Curve Finishers"
            elif low_ratio >= 0.45:
                curve_label = "Low Curve Tempo"
            elif mid_ratio >= 0.55:
                curve_label = "Midrange Curve"
            else:
                curve_label = "Balanced Curve"
            cost_curve_totals[curve_label] += 1
            cost_curve_wins[curve_label] += deck_wins
            cost_curve_matches[curve_label] += deck_matches

        if total_arena_unit_copies > 0:
            space_ratio = space_unit_copies / total_arena_unit_copies
            ground_ratio = ground_unit_copies / total_arena_unit_copies
            if space_ratio >= 0.60:
                arena_label = "Space Unit Pressure"
            elif ground_ratio >= 0.60:
                arena_label = "Ground Unit Pressure"
            else:
                arena_label = "Dual-Arena Mix"
            arena_pattern_totals[arena_label] += 1
            arena_pattern_wins[arena_label] += deck_wins
            arena_pattern_matches[arena_label] += deck_matches

        deck_trait_presence_by_deck[int(deck.id)] = deck_traits
        deck_keyword_presence_by_deck[int(deck.id)] = deck_keywords

    trait_counts: Counter[str] = Counter()
    keyword_counts: Counter[str] = Counter()
    for card_id, copies in card_total_copies.items():
        card = _resolve_meta_card(card_lookup, card_id)
        if card is None:
            continue
        for trait in card.get("traits", []):
            normalized_trait = str(trait).strip()
            if normalized_trait != "":
                trait_counts[normalized_trait] += int(copies)
        for keyword in card.get("keywords", []):
            normalized_keyword = str(keyword).strip()
            if normalized_keyword != "":
                keyword_counts[normalized_keyword] += int(copies)

    top_cards: list[LeagueMetaCardUsage] = []
    for card_id, total_copies in card_total_copies.most_common(120):
        card = _resolve_meta_card(card_lookup, card_id)
        if card is None:
            continue
        image_url = str(card.get("image_url") or "").strip()
        if not (image_url.startswith("http://") or image_url.startswith("https://")):
            continue
        top_cards.append(
            LeagueMetaCardUsage(
                card_id=card_id,
                card_name=card.get("name"),
                image_url=image_url,
                set_code=card.get("set_code"),
                card_type=card.get("type"),
                traits=list(card.get("traits", []) or []),
                keywords=list(card.get("keywords", []) or []),
                rules_text=card.get("rules_text"),
                deck_count=int(card_deck_counts[card_id]),
                total_copies=int(total_copies),
            )
        )

    top_leaders = [
        LeagueMetaDeckCoreUsage(
            card_id=card_id,
            card_name=(_resolve_meta_card(card_lookup, card_id) or {}).get("name"),
            image_url=(_resolve_meta_card(card_lookup, card_id) or {}).get("image_url"),
            count=int(count),
            win_rate=win_rate_from(int(leader_wins[card_id]), int(leader_matches[card_id])),
        )
        for card_id, count in leader_counts.most_common(20)
    ]

    top_traits = [
        LeagueMetaCountBucket(label=label, count=int(count))
        for label, count in trait_counts.most_common(25)
    ]
    top_keywords = [
        LeagueMetaCountBucket(label=label, count=int(count))
        for label, count in keyword_counts.most_common(25)
    ]

    ranked_decks = sorted(
        decks,
        key=lambda deck: (
            -float(deck_stats_cache[int(deck.id)][4]),
            -int(deck_stats_cache[int(deck.id)][3]),
            -int(deck_stats_cache[int(deck.id)][0]),
            str(deck.name).lower(),
        ),
    )
    top_decks_sample_size = max(1, min(len(ranked_decks), (len(ranked_decks) * 35 + 99) // 100))
    top_decks = ranked_decks[:top_decks_sample_size]

    top_deck_trait_counts: Counter[str] = Counter()
    top_deck_keyword_counts: Counter[str] = Counter()
    top_deck_card_type_counts: Counter[str] = Counter()
    for deck in top_decks:
        for card_id, copies in deck.mainboard.items():
            normalized_card_id = _normalize_meta_card_id(card_id)
            normalized_copies = int(copies)
            if normalized_card_id == "" or normalized_copies <= 0:
                continue
            card = _resolve_meta_card(card_lookup, normalized_card_id)
            if card is None:
                continue

            card_type = str(card.get("type") or "").strip()
            if card_type != "":
                top_deck_card_type_counts[card_type.title()] += normalized_copies

            for trait in card.get("traits", []):
                normalized_trait = str(trait).strip()
                if normalized_trait != "":
                    top_deck_trait_counts[normalized_trait] += normalized_copies
            for keyword in card.get("keywords", []):
                normalized_keyword = str(keyword).strip()
                if normalized_keyword != "":
                    top_deck_keyword_counts[normalized_keyword] += normalized_copies

    top_deck_traits = [
        LeagueMetaCountBucket(label=label, count=int(count))
        for label, count in top_deck_trait_counts.most_common(25)
    ]
    top_deck_keywords = [
        LeagueMetaCountBucket(label=label, count=int(count))
        for label, count in top_deck_keyword_counts.most_common(25)
    ]
    top_deck_card_types = [
        LeagueMetaCountBucket(label=label, count=int(count))
        for label, count in top_deck_card_type_counts.most_common(12)
    ]

    keyword_deck_counts: Counter[str] = Counter()
    keyword_wins: Counter[str] = Counter()
    keyword_matches: Counter[str] = Counter()
    keyword_top4_finishes: Counter[str] = Counter()
    keyword_top4_appearances: Counter[str] = Counter()
    trait_top4_finishes: Counter[str] = Counter()
    trait_top4_appearances: Counter[str] = Counter()

    for deck in decks:
        deck_id = int(deck.id)
        deck_wins, _, _, deck_matches, _ = deck_stats_cache[deck_id]
        top4_finishes, top4_appearances = top4_by_deck_id.get(deck_id, (0, 0))
        for keyword in deck_keyword_presence_by_deck.get(deck_id, set()):
            keyword_deck_counts[keyword] += 1
            keyword_wins[keyword] += deck_wins
            keyword_matches[keyword] += deck_matches
            keyword_top4_finishes[keyword] += int(top4_finishes)
            keyword_top4_appearances[keyword] += int(top4_appearances)
        for trait in deck_trait_presence_by_deck.get(deck_id, set()):
            trait_top4_finishes[trait] += int(top4_finishes)
            trait_top4_appearances[trait] += int(top4_appearances)

    keyword_win_impact = [
        LeagueMetaKeywordImpact(
            keyword=keyword,
            deck_count=int(deck_count),
            usage_share_pct=round((int(deck_count) / len(decks)) * 100, 2),
            win_rate_with_keyword=win_rate_from(int(keyword_wins[keyword]), int(keyword_matches[keyword])),
            league_avg_win_rate=league_average_win_rate,
            win_impact_score=round(
                win_rate_from(int(keyword_wins[keyword]), int(keyword_matches[keyword]))
                - league_average_win_rate,
                2,
            ),
            top4_conversion_pct=(
                round((int(keyword_top4_finishes[keyword]) / int(keyword_top4_appearances[keyword])) * 100, 2)
                if int(keyword_top4_appearances[keyword]) > 0
                else 0
            ),
        )
        for keyword, deck_count in keyword_deck_counts.items()
    ]
    keyword_win_impact.sort(
        key=lambda row: (
            -abs(float(row.win_impact_score)),
            -int(row.deck_count),
            str(row.keyword).lower(),
        )
    )
    synergy_graph = LeagueMetaSynergyGraph()

    def to_pattern_rows(
        totals: Counter[str],
        wins: Counter[str],
        matches: Counter[str],
        summaries: dict[str, str],
    ) -> list[LeagueMetaPerformancePattern]:
        rows = [
            LeagueMetaPerformancePattern(
                label=label,
                decks=int(total_decks),
                avg_win_rate=win_rate_from(int(wins[label]), int(matches[label])),
                summary=summaries.get(label),
            )
            for label, total_decks in totals.items()
        ]
        rows.sort(
            key=lambda row: (
                -float(row.avg_win_rate),
                -int(row.decks),
                str(row.label).lower(),
            )
        )
        return rows

    cost_curve_summaries = {
        "High Curve Finishers": "Higher top-end concentration that closes games with late power spikes.",
        "Low Curve Tempo": "Lower-cost pressure creates early tempo and punishes slow starts.",
        "Midrange Curve": "Dense 3-5 cost band with flexible pressure across turns.",
        "Balanced Curve": "Even curve distribution to adapt by matchup and game length.",
    }
    arena_summaries = {
        "Space Unit Pressure": "Winning lists skew toward space units and evasion race lines.",
        "Ground Unit Pressure": "Winning lists lean on board-centric ground combat to snowball advantage.",
        "Dual-Arena Mix": "Balanced arena split supports flexible sequencing and matchup coverage.",
    }
    hero_villain_summaries = {
        "Heroic": "Heroic alignment deck share and win trend.",
        "Villainy": "Villainy alignment deck share and win trend.",
        "Unknown": "Decks where leader alignment could not be resolved.",
    }
    top_cost_curve_patterns = to_pattern_rows(
        totals=cost_curve_totals,
        wins=cost_curve_wins,
        matches=cost_curve_matches,
        summaries=cost_curve_summaries,
    )
    top_arena_patterns = to_pattern_rows(
        totals=arena_pattern_totals,
        wins=arena_pattern_wins,
        matches=arena_pattern_matches,
        summaries=arena_summaries,
    )
    hero_villain_breakdown = to_pattern_rows(
        totals=hero_villain_totals,
        wins=hero_villain_wins,
        matches=hero_villain_matches,
        summaries=hero_villain_summaries,
    )
    aspect_combo_breakdown = to_pattern_rows(
        totals=aspect_combo_totals,
        wins=aspect_combo_wins,
        matches=aspect_combo_matches,
        summaries={},
    )

    trending_rows = await database.fetch_all(
        """
        WITH scoped_tournaments AS (
            SELECT tournament_id
            FROM season_tournaments
            WHERE season_id = :season_id
            UNION
            SELECT tournament_id
            FROM seasons
            WHERE id = :season_id
        ),
        ordered_tournaments AS (
            SELECT
                t.id AS tournament_id,
                ROW_NUMBER() OVER (
                    ORDER BY COALESCE(t.start_time, t.created) DESC, t.id DESC
                ) AS rn
            FROM tournaments t
            JOIN scoped_tournaments st ON st.tournament_id = t.id
        ),
        recent AS (
            SELECT tournament_id, rn
            FROM ordered_tournaments
            WHERE rn <= 2
        ),
        card_usage AS (
            SELECT
                recent.rn,
                lower(trim(cards.card_id)) AS card_id,
                COUNT(DISTINCT ta.user_id) AS decks_using_card,
                COALESCE(SUM(p.wins), 0) AS wins,
                COALESCE(SUM(p.draws), 0) AS draws,
                COALESCE(SUM(p.losses), 0) AS losses
            FROM recent
            JOIN tournament_applications ta
              ON ta.tournament_id = recent.tournament_id
             AND ta.deck_id IS NOT NULL
            JOIN decks d
              ON d.id = ta.deck_id
             AND d.season_id = :season_id
            JOIN users u ON u.id = d.user_id
            CROSS JOIN LATERAL json_each_text(d.mainboard::json) AS cards(card_id, qty)
            LEFT JOIN players p
              ON p.tournament_id = ta.tournament_id
             AND lower(trim(p.name)) = lower(trim(u.name))
            WHERE COALESCE(NULLIF(trim(cards.qty), ''), '0')::INT > 0
            GROUP BY recent.rn, lower(trim(cards.card_id))
        ),
        pivot AS (
            SELECT
                card_id,
                MAX(CASE WHEN rn = 1 THEN decks_using_card ELSE 0 END)::INT AS current_usage,
                MAX(CASE WHEN rn = 2 THEN decks_using_card ELSE 0 END)::INT AS previous_usage,
                MAX(CASE WHEN rn = 1 THEN wins ELSE 0 END)::INT AS current_wins,
                MAX(CASE WHEN rn = 2 THEN wins ELSE 0 END)::INT AS previous_wins,
                MAX(CASE WHEN rn = 1 THEN draws ELSE 0 END)::INT AS current_draws,
                MAX(CASE WHEN rn = 2 THEN draws ELSE 0 END)::INT AS previous_draws,
                MAX(CASE WHEN rn = 1 THEN losses ELSE 0 END)::INT AS current_losses,
                MAX(CASE WHEN rn = 2 THEN losses ELSE 0 END)::INT AS previous_losses
            FROM card_usage
            GROUP BY card_id
        )
        SELECT *
        FROM pivot
        """,
        values={"season_id": season_id},
    )

    trending_cards: list[LeagueMetaTrendingCard] = []
    for row in trending_rows:
        card_id = _normalize_meta_card_id(row._mapping.get("card_id"))
        if card_id == "":
            continue
        card = _resolve_meta_card(card_lookup, card_id) or {}
        current_usage = int(row._mapping.get("current_usage") or 0)
        previous_usage = int(row._mapping.get("previous_usage") or 0)
        current_wins = int(row._mapping.get("current_wins") or 0)
        current_draws = int(row._mapping.get("current_draws") or 0)
        current_losses = int(row._mapping.get("current_losses") or 0)
        previous_wins = int(row._mapping.get("previous_wins") or 0)
        previous_draws = int(row._mapping.get("previous_draws") or 0)
        previous_losses = int(row._mapping.get("previous_losses") or 0)
        current_matches = current_wins + current_draws + current_losses
        previous_matches = previous_wins + previous_draws + previous_losses
        current_win_rate = win_rate_from(current_wins, current_matches)
        previous_win_rate = win_rate_from(previous_wins, previous_matches)
        usage_delta = current_usage - previous_usage
        win_rate_delta = round(current_win_rate - previous_win_rate, 2)
        if usage_delta == 0 and abs(win_rate_delta) < 0.01:
            continue
        trending_cards.append(
            LeagueMetaTrendingCard(
                card_id=card_id,
                card_name=card.get("name"),
                image_url=card.get("image_url"),
                usage_delta=usage_delta,
                win_rate_delta=win_rate_delta,
                current_usage=current_usage,
                previous_usage=previous_usage,
                current_win_rate=current_win_rate,
                previous_win_rate=previous_win_rate,
            )
        )

    trending_cards.sort(
        key=lambda row: (
            -(abs(int(row.usage_delta)) * 3 + abs(float(row.win_rate_delta))),
            -int(row.usage_delta),
            -float(row.win_rate_delta),
            str(row.card_name or row.card_id).lower(),
        )
    )
    trending_cards = trending_cards[:16]

    replacement_signals: list[str] = []
    rising = [row for row in trending_cards if int(row.usage_delta) > 0]
    falling = [row for row in trending_cards if int(row.usage_delta) < 0]
    rising.sort(key=lambda row: (-int(row.usage_delta), -float(row.win_rate_delta)))
    falling.sort(key=lambda row: (int(row.usage_delta), float(row.win_rate_delta)))
    for index, rising_row in enumerate(rising[:4]):
        if index < len(falling):
            falling_row = falling[index]
            replacement_signals.append(
                (
                    f"{rising_row.card_name or rising_row.card_id} (+{rising_row.usage_delta} decks, "
                    f"{rising_row.win_rate_delta:+.2f}% win-rate delta) may be replacing "
                    f"{falling_row.card_name or falling_row.card_id} ({falling_row.usage_delta} decks, "
                    f"{falling_row.win_rate_delta:+.2f}% win-rate delta)."
                )
            )
        else:
            replacement_signals.append(
                (
                    f"{rising_row.card_name or rising_row.card_id} is trending up "
                    f"(+{rising_row.usage_delta} decks, {rising_row.win_rate_delta:+.2f}% win-rate delta)."
                )
            )

    recent_feature_rows = await database.fetch_all(
        """
        WITH scoped_tournaments AS (
            SELECT tournament_id
            FROM season_tournaments
            WHERE season_id = :season_id
            UNION
            SELECT tournament_id
            FROM seasons
            WHERE id = :season_id
        ),
        ordered_tournaments AS (
            SELECT
                t.id AS tournament_id,
                ROW_NUMBER() OVER (
                    ORDER BY COALESCE(t.start_time, t.created) DESC, t.id DESC
                ) AS rn
            FROM tournaments t
            JOIN scoped_tournaments st ON st.tournament_id = t.id
        )
        SELECT
            ot.rn,
            ta.deck_id,
            COALESCE(p.wins, 0)::INT AS wins,
            COALESCE(p.draws, 0)::INT AS draws,
            COALESCE(p.losses, 0)::INT AS losses
        FROM ordered_tournaments ot
        JOIN tournament_applications ta
          ON ta.tournament_id = ot.tournament_id
         AND ta.deck_id IS NOT NULL
        JOIN decks d
          ON d.id = ta.deck_id
         AND d.season_id = :season_id
        JOIN users u ON u.id = d.user_id
        LEFT JOIN players p
          ON p.tournament_id = ta.tournament_id
         AND lower(trim(p.name)) = lower(trim(u.name))
        WHERE ot.rn <= 2
        """,
        values={"season_id": season_id},
    )
    recent_keyword_wins_by_rn: dict[int, Counter[str]] = {1: Counter(), 2: Counter()}
    recent_keyword_matches_by_rn: dict[int, Counter[str]] = {1: Counter(), 2: Counter()}
    recent_trait_wins_by_rn: dict[int, Counter[str]] = {1: Counter(), 2: Counter()}
    recent_trait_matches_by_rn: dict[int, Counter[str]] = {1: Counter(), 2: Counter()}
    for row in recent_feature_rows:
        rn = int(row._mapping.get("rn") or 0)
        deck_id = int(row._mapping.get("deck_id") or 0)
        if rn not in {1, 2} or deck_id <= 0:
            continue
        wins = int(row._mapping.get("wins") or 0)
        draws = int(row._mapping.get("draws") or 0)
        losses = int(row._mapping.get("losses") or 0)
        matches = wins + draws + losses
        for keyword in deck_keyword_presence_by_deck.get(deck_id, set()):
            recent_keyword_wins_by_rn[rn][keyword] += wins
            recent_keyword_matches_by_rn[rn][keyword] += matches
        for trait in deck_trait_presence_by_deck.get(deck_id, set()):
            recent_trait_wins_by_rn[rn][trait] += wins
            recent_trait_matches_by_rn[rn][trait] += matches

    def keyword_impact_by_name(keyword_name: str) -> LeagueMetaKeywordImpact | None:
        target = keyword_name.strip().lower()
        for row in keyword_win_impact:
            if str(row.keyword).strip().lower() == target:
                return row
        return None

    def counter_value_ci(counter: Counter[str], label: str) -> int:
        target = label.strip().lower()
        return sum(int(value) for key, value in counter.items() if str(key).strip().lower() == target)

    live_meta_findings: list[str] = []
    shield_impact = keyword_impact_by_name("shield")
    if shield_impact is not None and int(shield_impact.deck_count) >= 2:
        shield_phrase = "outperform field by" if float(shield_impact.win_impact_score) >= 0 else "trail field by"
        live_meta_findings.append(
            f"Shield decks {shield_phrase} {shield_impact.win_impact_score:+.2f}%."
        )

    raid_impact = keyword_impact_by_name("raid")
    if raid_impact is not None and int(raid_impact.deck_count) >= 2:
        if float(raid_impact.win_impact_score) < 0:
            live_meta_findings.append(
                f"Raid-heavy decks are popular ({raid_impact.usage_share_pct:.1f}% of field) but underperform by {raid_impact.win_impact_score:.2f}%."
            )
        elif float(raid_impact.usage_share_pct) >= 15:
            live_meta_findings.append(
                f"Raid-heavy decks remain a major share ({raid_impact.usage_share_pct:.1f}% of field) with {raid_impact.win_impact_score:+.2f}% win impact."
            )

    vehicle_current_matches = counter_value_ci(recent_trait_matches_by_rn[1], "vehicle")
    vehicle_previous_matches = counter_value_ci(recent_trait_matches_by_rn[2], "vehicle")
    if vehicle_current_matches > 0 and vehicle_previous_matches > 0:
        vehicle_current = win_rate_from(
            counter_value_ci(recent_trait_wins_by_rn[1], "vehicle"),
            vehicle_current_matches,
        )
        vehicle_previous = win_rate_from(
            counter_value_ci(recent_trait_wins_by_rn[2], "vehicle"),
            vehicle_previous_matches,
        )
        vehicle_delta = round(vehicle_current - vehicle_previous, 2)
        if vehicle_delta <= -1.0:
            live_meta_findings.append(
                f"Vehicle-heavy decks are declining in win rate ({vehicle_previous:.2f}% -> {vehicle_current:.2f}%)."
            )

    trait_top4_conversion_rows = [
        (
            trait,
            round((int(trait_top4_finishes[trait]) / int(trait_top4_appearances[trait])) * 100, 2),
            int(trait_top4_appearances[trait]),
        )
        for trait in trait_top4_appearances
        if int(trait_top4_appearances[trait]) > 0
    ]
    trait_top4_conversion_rows.sort(key=lambda row: (-float(row[1]), -int(row[2]), str(row[0]).lower()))
    if len(trait_top4_conversion_rows) > 0:
        best_trait, best_trait_conversion, best_trait_appearances = trait_top4_conversion_rows[0]
        if str(best_trait).strip().lower() == "force" and best_trait_appearances >= 2:
            live_meta_findings.append(
                f"Force trait decks have highest Top 4 conversion at {best_trait_conversion:.2f}%."
            )
    if len(live_meta_findings) < 1 and len(keyword_win_impact) > 0:
        best_keyword = max(keyword_win_impact, key=lambda row: float(row.win_impact_score))
        worst_keyword = min(keyword_win_impact, key=lambda row: float(row.win_impact_score))
        if int(best_keyword.deck_count) >= 2:
            live_meta_findings.append(
                f"{best_keyword.keyword} decks are beating the field by {best_keyword.win_impact_score:+.2f}%."
            )
        if int(worst_keyword.deck_count) >= 2 and worst_keyword.keyword != best_keyword.keyword:
            live_meta_findings.append(
                f"{worst_keyword.keyword} decks are lagging the field by {worst_keyword.win_impact_score:+.2f}%."
            )

    meta_takeaways: list[str] = [
        "Computed across all players and all mapped tournaments/weeks in this season.",
    ]
    if total_league_matches > 0:
        meta_takeaways.append(f"League baseline win rate: {league_average_win_rate:.2f}%.")
    if len(top_cost_curve_patterns) > 0:
        top_curve = top_cost_curve_patterns[0]
        meta_takeaways.append(
            f"Top cost-curve performer: {top_curve.label} ({top_curve.avg_win_rate:.2f}% win rate across {top_curve.decks} decks)."
        )
    if len(top_arena_patterns) > 0:
        top_arena = top_arena_patterns[0]
        meta_takeaways.append(
            f"Top arena trend: {top_arena.label} ({top_arena.avg_win_rate:.2f}% win rate across {top_arena.decks} decks)."
        )
    if len(top_cards) > 0:
        most_played = top_cards[0]
        meta_takeaways.append(
            f"Most played card: {most_played.card_name or most_played.card_id} in {most_played.deck_count} decks."
        )
    if len(top_deck_card_types) > 0:
        best_type = top_deck_card_types[0]
        meta_takeaways.append(
            f"Top decks lean most on {best_type.label} cards ({best_type.count} copies in the top sample)."
        )
    if len(top_deck_traits) > 0:
        meta_takeaways.append(f"Top-deck trait trend: {top_deck_traits[0].label}.")
    if len(top_deck_keywords) > 0:
        meta_takeaways.append(f"Top-deck keyword trend: {top_deck_keywords[0].label}.")
    for finding in live_meta_findings[:4]:
        meta_takeaways.append(finding)

    deduped_top_cards: list[LeagueMetaCardUsage] = []
    by_card_name: dict[str, LeagueMetaCardUsage] = {}
    for row in top_cards:
        normalized_name = str(row.card_name or "").strip().lower()
        aggregate_key = normalized_name if normalized_name != "" else _normalize_meta_card_id(row.card_id)
        if aggregate_key == "":
            continue
        existing = by_card_name.get(aggregate_key)
        if existing is None:
            by_card_name[aggregate_key] = row
            continue
        existing.total_copies += int(row.total_copies)
        existing.deck_count += int(row.deck_count)
        if (existing.image_url is None or existing.image_url == "") and row.image_url not in {None, ""}:
            existing.image_url = row.image_url
        if (existing.rules_text is None or existing.rules_text == "") and row.rules_text not in {None, ""}:
            existing.rules_text = row.rules_text
        if existing.card_type in {None, ""} and row.card_type not in {None, ""}:
            existing.card_type = row.card_type

    deduped_top_cards = sorted(
        by_card_name.values(),
        key=lambda row: (-int(row.total_copies), -int(row.deck_count), str(row.card_name or row.card_id).lower()),
    )[:40]

    return LeagueMetaAnalysisView(
        season_id=season_id,
        season_name=season_name,
        total_decks=len(decks),
        top_decks_sample_size=top_decks_sample_size,
        top_cards=deduped_top_cards,
        top_leaders=top_leaders,
        top_bases=[],
        top_traits=top_traits,
        top_keywords=top_keywords,
        top_deck_traits=top_deck_traits,
        top_deck_keywords=top_deck_keywords,
        top_deck_card_types=top_deck_card_types,
        top_archetypes=[],
        top_cost_curve_patterns=top_cost_curve_patterns,
        top_arena_patterns=top_arena_patterns,
        hero_villain_breakdown=hero_villain_breakdown,
        aspect_combo_breakdown=aspect_combo_breakdown,
        keyword_win_impact=keyword_win_impact,
        synergy_graph=synergy_graph,
        trending_cards=trending_cards,
        replacement_signals=replacement_signals,
        live_meta_findings=live_meta_findings,
        meta_takeaways=meta_takeaways,
    )


async def upsert_deck(
    season_id: int,
    user_id: UserId,
    tournament_id: TournamentId | None,
    name: str,
    leader: str,
    base: str,
    mainboard: dict[str, int],
    sideboard: dict[str, int],
) -> LeagueDeckView:
    now = datetime_utc.now()
    row = await database.fetch_one(
        """
        INSERT INTO decks (
            season_id,
            user_id,
            tournament_id,
            name,
            leader,
            base,
            mainboard,
            sideboard,
            created,
            updated
        )
        VALUES (
            :season_id,
            :user_id,
            :tournament_id,
            :name,
            :leader,
            :base,
            :mainboard,
            :sideboard,
            :created,
            :updated
        )
        ON CONFLICT (season_id, user_id, name)
        DO UPDATE
        SET
            tournament_id = EXCLUDED.tournament_id,
            leader = EXCLUDED.leader,
            base = EXCLUDED.base,
            mainboard = EXCLUDED.mainboard,
            sideboard = EXCLUDED.sideboard,
            updated = EXCLUDED.updated
        RETURNING id
        """,
        values={
            "season_id": season_id,
            "user_id": user_id,
            "tournament_id": tournament_id,
            "name": name,
            "leader": leader,
            "base": base,
            "mainboard": json.dumps(mainboard),
            "sideboard": json.dumps(sideboard),
            "created": now,
            "updated": now,
        },
    )
    deck_id = int(assert_some(row)._mapping["id"])

    row = await database.fetch_one(
        """
        WITH deck_stats AS (
            SELECT
                ta.deck_id,
                COUNT(DISTINCT ta.tournament_id) AS tournaments_submitted,
                COALESCE(SUM(p.wins), 0) AS wins,
                COALESCE(SUM(p.draws), 0) AS draws,
                COALESCE(SUM(p.losses), 0) AS losses
            FROM tournament_applications ta
            JOIN decks d2 ON d2.id = ta.deck_id
            JOIN users u2 ON u2.id = d2.user_id
            JOIN tournaments t ON t.id = ta.tournament_id
            LEFT JOIN players p
                ON p.tournament_id = t.id
               AND lower(trim(p.name)) = lower(trim(u2.name))
            WHERE ta.deck_id IS NOT NULL
            GROUP BY ta.deck_id
        )
        SELECT
            d.id,
            d.season_id,
            d.user_id,
            u.name AS user_name,
            u.email AS user_email,
            d.tournament_id,
            d.name,
            d.leader,
            d.base,
            d.mainboard,
            d.sideboard,
            d.created,
            d.updated,
            COALESCE(ds.tournaments_submitted, 0) AS tournaments_submitted,
            COALESCE(ds.wins, 0) AS wins,
            COALESCE(ds.draws, 0) AS draws,
            COALESCE(ds.losses, 0) AS losses,
            COALESCE(ds.wins, 0) + COALESCE(ds.draws, 0) + COALESCE(ds.losses, 0) AS matches,
            CASE
                WHEN COALESCE(ds.wins, 0) + COALESCE(ds.draws, 0) + COALESCE(ds.losses, 0) > 0
                    THEN ROUND(
                        (
                            COALESCE(ds.wins, 0)::numeric
                            / (
                                COALESCE(ds.wins, 0)
                                + COALESCE(ds.draws, 0)
                                + COALESCE(ds.losses, 0)
                            )
                        ) * 100,
                        2
                    )::float
                ELSE 0
            END AS win_percentage
        FROM decks d
        JOIN users u ON u.id = d.user_id
        LEFT JOIN deck_stats ds ON ds.deck_id = d.id
        WHERE d.id = :deck_id
        """,
        values={"deck_id": deck_id},
    )
    return LeagueDeckView.model_validate(dict(assert_some(row)._mapping))


async def get_deck_by_id(deck_id: DeckId) -> LeagueDeckView | None:
    row = await database.fetch_one(
        """
        WITH deck_stats AS (
            SELECT
                ta.deck_id,
                COUNT(DISTINCT ta.tournament_id) AS tournaments_submitted,
                COALESCE(SUM(p.wins), 0) AS wins,
                COALESCE(SUM(p.draws), 0) AS draws,
                COALESCE(SUM(p.losses), 0) AS losses
            FROM tournament_applications ta
            JOIN decks d2 ON d2.id = ta.deck_id
            JOIN users u2 ON u2.id = d2.user_id
            JOIN tournaments t ON t.id = ta.tournament_id
            LEFT JOIN players p
                ON p.tournament_id = t.id
               AND lower(trim(p.name)) = lower(trim(u2.name))
            WHERE ta.deck_id IS NOT NULL
            GROUP BY ta.deck_id
        )
        SELECT
            d.id,
            d.season_id,
            d.user_id,
            u.name AS user_name,
            u.email AS user_email,
            d.tournament_id,
            d.name,
            d.leader,
            d.base,
            d.mainboard,
            d.sideboard,
            d.created,
            d.updated,
            COALESCE(ds.tournaments_submitted, 0) AS tournaments_submitted,
            COALESCE(ds.wins, 0) AS wins,
            COALESCE(ds.draws, 0) AS draws,
            COALESCE(ds.losses, 0) AS losses,
            COALESCE(ds.wins, 0) + COALESCE(ds.draws, 0) + COALESCE(ds.losses, 0) AS matches,
            CASE
                WHEN COALESCE(ds.wins, 0) + COALESCE(ds.draws, 0) + COALESCE(ds.losses, 0) > 0
                    THEN ROUND(
                        (
                            COALESCE(ds.wins, 0)::numeric
                            / (
                                COALESCE(ds.wins, 0)
                                + COALESCE(ds.draws, 0)
                                + COALESCE(ds.losses, 0)
                            )
                        ) * 100,
                        2
                    )::float
                ELSE 0
            END AS win_percentage
        FROM decks d
        JOIN users u ON u.id = d.user_id
        LEFT JOIN deck_stats ds ON ds.deck_id = d.id
        WHERE d.id = :deck_id
        """,
        values={"deck_id": deck_id},
    )
    return LeagueDeckView.model_validate(dict(row._mapping)) if row is not None else None


async def set_team_logo_for_user_in_tournament(
    tournament_id: TournamentId,
    user_id: UserId,
    logo_path: str | None,
) -> None:
    if logo_path is None or logo_path.strip() == "":
        return
    query = """
        UPDATE teams
        SET logo_path = :logo_path
        WHERE tournament_id = :tournament_id
          AND (
            lower(name) = lower((SELECT name FROM users WHERE id = :user_id))
            OR id IN (
                SELECT pt.team_id
                FROM players_x_teams pt
                JOIN players p ON p.id = pt.player_id
                WHERE p.tournament_id = :tournament_id
                  AND lower(p.name) = lower((SELECT name FROM users WHERE id = :user_id))
            )
          )
    """
    await database.execute(
        query=query,
        values={
            "logo_path": logo_path.strip(),
            "tournament_id": tournament_id,
            "user_id": user_id,
        },
    )


async def insert_points_ledger_delta(
    season_id: int,
    user_id: UserId,
    changed_by_user_id: UserId,
    points_delta: float,
    reason: str | None = None,
) -> None:
    query = """
        INSERT INTO season_points_ledger (
            season_id,
            user_id,
            changed_by_user_id,
            tournament_id,
            points_delta,
            reason,
            created
        )
        VALUES (
            :season_id,
            :user_id,
            :changed_by_user_id,
            NULL,
            :points_delta,
            :reason,
            :created
        )
    """
    await database.execute(
        query=query,
        values={
            "season_id": season_id,
            "user_id": user_id,
            "changed_by_user_id": changed_by_user_id,
            "points_delta": points_delta,
            "reason": reason,
            "created": datetime_utc.now(),
        },
    )


async def get_user_id_by_email(email: str) -> UserId | None:
    query = "SELECT id FROM users WHERE lower(email) = lower(:email)"
    result = await database.fetch_one(query=query, values={"email": email})
    return UserId(result._mapping["id"]) if result is not None else None


async def get_next_opponent_for_user_in_tournament(
    tournament_id: TournamentId,
    user_name: str,
) -> LeagueUpcomingOpponentView | None:
    my_team_ids_rows = await database.fetch_all(
        """
        SELECT DISTINCT t.id
        FROM teams t
        LEFT JOIN players_x_teams pt ON pt.team_id = t.id
        LEFT JOIN players p ON p.id = pt.player_id
        WHERE t.tournament_id = :tournament_id
          AND (
            lower(trim(t.name)) = lower(trim(:user_name))
            OR lower(trim(p.name)) = lower(trim(:user_name))
          )
        """,
        values={"tournament_id": tournament_id, "user_name": user_name},
    )
    my_team_ids = [int(row._mapping["id"]) for row in my_team_ids_rows]
    if len(my_team_ids) < 1:
        return None

    row = await database.fetch_one(
        """
        SELECT
            m.id AS match_id,
            si.name AS stage_item_name,
            m.start_time,
            c.name AS court_name,
            t1.id AS team1_id,
            t1.name AS team1_name,
            t2.id AS team2_id,
            t2.name AS team2_name
        FROM matches m
        JOIN rounds r ON r.id = m.round_id
        JOIN stage_items si ON si.id = r.stage_item_id
        JOIN stages s ON s.id = si.stage_id
        LEFT JOIN stage_item_inputs sii1 ON sii1.id = m.stage_item_input1_id
        LEFT JOIN stage_item_inputs sii2 ON sii2.id = m.stage_item_input2_id
        LEFT JOIN teams t1 ON t1.id = sii1.team_id
        LEFT JOIN teams t2 ON t2.id = sii2.team_id
        LEFT JOIN courts c ON c.id = m.court_id
        WHERE s.tournament_id = :tournament_id
          AND m.start_time IS NOT NULL
          AND (
            sii1.team_id = ANY(:my_team_ids)
            OR sii2.team_id = ANY(:my_team_ids)
          )
          AND (
            m.start_time >= NOW()
            OR (
                m.start_time <= NOW()
                AND (m.stage_item_input1_score = 0 AND m.stage_item_input2_score = 0)
            )
          )
        ORDER BY m.start_time ASC, m.id ASC
        LIMIT 1
        """,
        values={"tournament_id": tournament_id, "my_team_ids": my_team_ids},
    )
    if row is None:
        return None

    team1_id = row._mapping["team1_id"]
    team2_id = row._mapping["team2_id"]
    team1_name = row._mapping["team1_name"]
    team2_name = row._mapping["team2_name"]
    team1_is_me = team1_id is not None and int(team1_id) in my_team_ids
    my_team_name = team1_name if team1_is_me else team2_name
    opponent_team_name = team2_name if team1_is_me else team1_name

    return LeagueUpcomingOpponentView(
        tournament_id=tournament_id,
        match_id=int(row._mapping["match_id"]),
        stage_item_name=None if row._mapping["stage_item_name"] is None else str(row._mapping["stage_item_name"]),
        start_time=row._mapping["start_time"],
        court_name=None if row._mapping["court_name"] is None else str(row._mapping["court_name"]),
        my_team_name=None if my_team_name is None else str(my_team_name),
        opponent_team_name=None if opponent_team_name is None else str(opponent_team_name),
    )


async def delete_deck(deck_id: DeckId) -> None:
    query = "DELETE FROM decks WHERE id = :deck_id"
    await database.execute(query=query, values={"deck_id": deck_id})


async def create_season(
    owner_tournament_id: TournamentId,
    name: str,
    is_active: bool,
    tournament_ids: list[TournamentId],
) -> Season:
    now = datetime_utc.now()
    async with database.transaction():
        if is_active:
            await database.execute(
                """
                UPDATE seasons
                SET is_active = FALSE
                WHERE id IN ({season_ids_subquery})
                """.format(season_ids_subquery=season_ids_subquery()),
                values={"tournament_id": owner_tournament_id},
            )

        row = await database.fetch_one(
            """
            INSERT INTO seasons (tournament_id, name, created, is_active)
            VALUES (:tournament_id, :name, :created, :is_active)
            RETURNING *
            """,
            values={
                "tournament_id": owner_tournament_id,
                "name": name.strip(),
                "created": now,
                "is_active": is_active,
            },
        )
        season = Season.model_validate(dict(assert_some(row)._mapping))
        await set_season_tournaments(
            season.id,
            tournament_ids if len(tournament_ids) > 0 else [owner_tournament_id],
        )
        return season


async def get_season_by_id(season_id: int) -> Season | None:
    row = await database.fetch_one(
        "SELECT * FROM seasons WHERE id = :season_id",
        values={"season_id": season_id},
    )
    if row is None:
        return None
    return Season.model_validate(dict(row._mapping))


async def update_season(
    tournament_id: TournamentId,
    season_id: int,
    name: str | None,
    is_active: bool | None,
    tournament_ids: list[TournamentId] | None,
) -> Season | None:
    season = await get_season_by_id(season_id)
    if season is None:
        return None

    now_name = season.name if name is None else name.strip()
    now_active = season.is_active if is_active is None else is_active

    async with database.transaction():
        if now_active:
            await database.execute(
                """
                UPDATE seasons
                SET is_active = FALSE
                WHERE id IN ({season_ids_subquery})
                """.format(season_ids_subquery=season_ids_subquery()),
                values={"tournament_id": tournament_id},
            )
        await database.execute(
            """
            UPDATE seasons
            SET name = :name, is_active = :is_active
            WHERE id = :season_id
            """,
            values={"season_id": season_id, "name": now_name, "is_active": now_active},
        )
        if tournament_ids is not None:
            await set_season_tournaments(season_id, tournament_ids)

    return await get_season_by_id(season_id)


async def delete_season(season_id: int) -> None:
    await database.execute("DELETE FROM seasons WHERE id = :season_id", values={"season_id": season_id})


async def list_admin_seasons_for_tournament(tournament_id: TournamentId) -> list[LeagueSeasonAdminView]:
    seasons = await get_seasons_for_tournament(tournament_id)
    views: list[LeagueSeasonAdminView] = []
    for season in seasons:
        views.append(
            LeagueSeasonAdminView(
                season_id=season.id,
                name=season.name,
                is_active=season.is_active,
                tournament_ids=await get_tournament_ids_for_season(season.id),
            )
        )
    return views


async def ensure_user_registered_as_participant(
    tournament_id: TournamentId,
    user_id: UserId,
    participant_name: str,
    leader_image_url: str | None = None,
) -> None:
    player = await get_player_by_name(participant_name, tournament_id)
    if player is None:
        await insert_player(PlayerBody(name=participant_name, active=True), tournament_id)
        player = await get_player_by_name(participant_name, tournament_id)

    if player is None:
        return

    team_row = await database.fetch_one(
        """
        SELECT id
        FROM teams
        WHERE tournament_id = :tournament_id
          AND lower(name) = lower(:name)
        LIMIT 1
        """,
        values={"tournament_id": tournament_id, "name": participant_name},
    )
    if team_row is None:
        team_id = await database.execute(
            query=teams.insert(),
            values=TeamInsertable(
                created=datetime_utc.now(),
                name=participant_name,
                tournament_id=tournament_id,
                active=True,
            ).model_dump(),
        )
        if leader_image_url is not None and leader_image_url.strip() != "":
            await database.execute(
                "UPDATE teams SET logo_path = :logo_path WHERE id = :team_id",
                values={"logo_path": leader_image_url.strip(), "team_id": team_id},
            )
    else:
        team_id = int(team_row._mapping["id"])
        if leader_image_url is not None and leader_image_url.strip() != "":
            await database.execute(
                "UPDATE teams SET logo_path = :logo_path WHERE id = :team_id",
                values={"logo_path": leader_image_url.strip(), "team_id": team_id},
            )

    await database.execute(
        """
        INSERT INTO players_x_teams (team_id, player_id)
        VALUES (:team_id, :player_id)
        ON CONFLICT (team_id, player_id) DO NOTHING
        """,
        values={"team_id": team_id, "player_id": int(player.id)},
    )


async def upsert_tournament_application(
    tournament_id: TournamentId,
    user_id: UserId,
    season_id: int | None,
    deck_id: DeckId | None,
) -> None:
    await database.execute(
        """
        INSERT INTO tournament_applications (
            tournament_id, season_id, user_id, deck_id, status, created, updated
        )
        VALUES (
            :tournament_id, :season_id, :user_id, :deck_id, 'SUBMITTED', :created, :updated
        )
        ON CONFLICT (tournament_id, user_id)
        DO UPDATE SET
            season_id = EXCLUDED.season_id,
            deck_id = EXCLUDED.deck_id,
            status = 'SUBMITTED',
            updated = EXCLUDED.updated
        """,
        values={
            "tournament_id": tournament_id,
            "season_id": season_id,
            "user_id": user_id,
            "deck_id": deck_id,
            "created": datetime_utc.now(),
            "updated": datetime_utc.now(),
        },
    )


async def delete_tournament_application(
    tournament_id: TournamentId,
    user_id: UserId,
) -> None:
    await database.execute(
        """
        DELETE FROM tournament_applications
        WHERE tournament_id = :tournament_id
          AND user_id = :user_id
        """,
        values={
            "tournament_id": int(tournament_id),
            "user_id": int(user_id),
        },
    )


async def _get_league_communication_by_id(
    tournament_id: TournamentId, communication_id: int
) -> LeagueCommunicationView | None:
    row = await database.fetch_one(
        """
        SELECT
            lc.id,
            lc.tournament_id,
            lc.kind,
            lc.title,
            lc.body,
            lc.pinned,
            lc.created_by_user_id,
            u.name AS created_by_user_name,
            lc.created,
            lc.updated
        FROM league_communications lc
        LEFT JOIN users u ON u.id = lc.created_by_user_id
        WHERE lc.tournament_id = :tournament_id
          AND lc.id = :communication_id
        """,
        values={"tournament_id": int(tournament_id), "communication_id": int(communication_id)},
    )
    return LeagueCommunicationView.model_validate(dict(row._mapping)) if row is not None else None


async def list_league_communications(tournament_id: TournamentId) -> list[LeagueCommunicationView]:
    rows = await database.fetch_all(
        """
        SELECT
            lc.id,
            lc.tournament_id,
            lc.kind,
            lc.title,
            lc.body,
            lc.pinned,
            lc.created_by_user_id,
            u.name AS created_by_user_name,
            lc.created,
            lc.updated
        FROM league_communications lc
        LEFT JOIN users u ON u.id = lc.created_by_user_id
        WHERE lc.tournament_id = :tournament_id
          AND lc.kind IN ('ANNOUNCEMENT', 'RULE', 'NOTE')
        ORDER BY
            CASE
                WHEN lc.kind = 'ANNOUNCEMENT' THEN 0
                WHEN lc.kind = 'RULE' THEN 1
                ELSE 2
            END ASC,
            lc.pinned DESC,
            lc.updated DESC,
            lc.id DESC
        """,
        values={"tournament_id": int(tournament_id)},
    )
    return [LeagueCommunicationView.model_validate(dict(row._mapping)) for row in rows]


def _normalize_dashboard_background_mode(value: object) -> str:
    normalized = str(value or "").strip().upper()
    return "FIXED" if normalized == "FIXED" else "ROTATE"


def _normalize_dashboard_background_path(value: object) -> str | None:
    normalized = str(value or "").strip()
    if normalized == "":
        return None
    if not normalized.startswith("/backgrounds/"):
        return None
    return normalized


def _parse_dashboard_background_payload(value: object) -> tuple[str, str | None]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            value = {}
    if not isinstance(value, dict):
        value = {}
    mode = _normalize_dashboard_background_mode(value.get("mode"))
    image_path = _normalize_dashboard_background_path(value.get("image_path"))
    if mode != "FIXED":
        image_path = None
    return mode, image_path


async def get_dashboard_background_settings(
    tournament_id: TournamentId,
) -> LeagueDashboardBackgroundSettingsView:
    row = await database.fetch_one(
        """
        SELECT body, updated
        FROM league_communications
        WHERE tournament_id = :tournament_id
          AND kind = 'SYSTEM'
          AND title = 'DASHBOARD_BACKGROUND'
        ORDER BY updated DESC, id DESC
        LIMIT 1
        """,
        values={"tournament_id": int(tournament_id)},
    )
    if row is None:
        return LeagueDashboardBackgroundSettingsView(
            tournament_id=tournament_id,
            mode="ROTATE",
            image_path=None,
            updated=None,
        )
    mode, image_path = _parse_dashboard_background_payload(row._mapping["body"])
    return LeagueDashboardBackgroundSettingsView(
        tournament_id=tournament_id,
        mode=mode,
        image_path=image_path,
        updated=row._mapping["updated"],
    )


async def upsert_dashboard_background_settings(
    tournament_id: TournamentId,
    body: LeagueDashboardBackgroundSettingsUpdateBody,
    user_id: UserId,
) -> LeagueDashboardBackgroundSettingsView:
    mode = _normalize_dashboard_background_mode(body.mode)
    image_path = _normalize_dashboard_background_path(body.image_path)
    if mode != "FIXED":
        image_path = None

    payload = json.dumps(
        {
            "mode": mode,
            "image_path": image_path,
        }
    )
    rows = await database.fetch_all(
        """
        SELECT id
        FROM league_communications
        WHERE tournament_id = :tournament_id
          AND kind = 'SYSTEM'
          AND title = 'DASHBOARD_BACKGROUND'
        ORDER BY updated DESC, id DESC
        """,
        values={"tournament_id": int(tournament_id)},
    )
    now = datetime_utc.now()
    if len(rows) < 1:
        await database.execute(
            """
            INSERT INTO league_communications (
                tournament_id,
                kind,
                title,
                body,
                pinned,
                created_by_user_id,
                created,
                updated
            )
            VALUES (
                :tournament_id,
                'SYSTEM',
                'DASHBOARD_BACKGROUND',
                :body,
                FALSE,
                :user_id,
                :created,
                :updated
            )
            """,
            values={
                "tournament_id": int(tournament_id),
                "body": payload,
                "user_id": int(user_id),
                "created": now,
                "updated": now,
            },
        )
    else:
        primary_id = int(rows[0]._mapping["id"])
        await database.execute(
            """
            UPDATE league_communications
            SET body = :body,
                created_by_user_id = :user_id,
                updated = :updated
            WHERE id = :primary_id
              AND tournament_id = :tournament_id
            """,
            values={
                "body": payload,
                "user_id": int(user_id),
                "updated": now,
                "primary_id": primary_id,
                "tournament_id": int(tournament_id),
            },
        )
        duplicate_ids = [int(row._mapping["id"]) for row in rows[1:]]
        if len(duplicate_ids) > 0:
            await database.execute(
                """
                DELETE FROM league_communications
                WHERE tournament_id = :tournament_id
                  AND id = ANY(:duplicate_ids)
                """,
                values={
                    "tournament_id": int(tournament_id),
                    "duplicate_ids": duplicate_ids,
                },
            )

    return await get_dashboard_background_settings(tournament_id)


async def create_league_communication(
    tournament_id: TournamentId,
    body: LeagueCommunicationUpsertBody,
    created_by_user_id: UserId,
) -> LeagueCommunicationView:
    row = await database.fetch_one(
        """
        INSERT INTO league_communications (
            tournament_id,
            kind,
            title,
            body,
            pinned,
            created_by_user_id,
            created,
            updated
        )
        VALUES (
            :tournament_id,
            :kind,
            :title,
            :body,
            :pinned,
            :created_by_user_id,
            :created,
            :updated
        )
        RETURNING id
        """,
        values={
            "tournament_id": int(tournament_id),
            "kind": body.kind,
            "title": body.title.strip(),
            "body": body.body.strip(),
            "pinned": bool(body.pinned),
            "created_by_user_id": int(created_by_user_id),
            "created": datetime_utc.now(),
            "updated": datetime_utc.now(),
        },
    )
    communication_id = int(assert_some(row)._mapping["id"])
    if body.kind == "ANNOUNCEMENT" and bool(body.pinned):
        await database.execute(
            """
            UPDATE league_communications
            SET pinned = FALSE,
                updated = :updated
            WHERE tournament_id = :tournament_id
              AND kind = 'ANNOUNCEMENT'
              AND id <> :communication_id
              AND pinned = TRUE
            """,
            values={
                "tournament_id": int(tournament_id),
                "communication_id": communication_id,
                "updated": datetime_utc.now(),
            },
        )
    return assert_some(await _get_league_communication_by_id(tournament_id, communication_id))


async def update_league_communication(
    tournament_id: TournamentId,
    communication_id: int,
    body: LeagueCommunicationUpdateBody,
) -> LeagueCommunicationView | None:
    payload = body.model_dump(exclude_unset=True)
    values: dict[str, object] = {
        "tournament_id": int(tournament_id),
        "communication_id": int(communication_id),
    }
    set_clauses: list[str] = []

    for field in ("kind", "title", "body", "pinned"):
        if field not in payload:
            continue
        value = payload[field]
        if field in {"title", "body"} and isinstance(value, str):
            value = value.strip()
        values[field] = value
        set_clauses.append(f"{field} = :{field}")

    if len(set_clauses) < 1:
        return await _get_league_communication_by_id(tournament_id, communication_id)

    values["updated"] = datetime_utc.now()
    set_clauses.append("updated = :updated")

    row = await database.fetch_one(
        f"""
        UPDATE league_communications
        SET {", ".join(set_clauses)}
        WHERE tournament_id = :tournament_id
          AND id = :communication_id
        RETURNING id
        """,
        values=values,
    )
    if row is None:
        return None
    updated = await _get_league_communication_by_id(tournament_id, int(row._mapping["id"]))
    if (
        updated is not None
        and str(updated.kind).upper() == "ANNOUNCEMENT"
        and bool(updated.pinned)
    ):
        await database.execute(
            """
            UPDATE league_communications
            SET pinned = FALSE,
                updated = :updated
            WHERE tournament_id = :tournament_id
              AND kind = 'ANNOUNCEMENT'
              AND id <> :communication_id
              AND pinned = TRUE
            """,
            values={
                "tournament_id": int(tournament_id),
                "communication_id": int(updated.id),
                "updated": datetime_utc.now(),
            },
        )
    return updated


async def delete_league_communication(tournament_id: TournamentId, communication_id: int) -> None:
    await database.execute(
        """
        DELETE FROM league_communications
        WHERE tournament_id = :tournament_id
          AND id = :communication_id
        """,
        values={"tournament_id": int(tournament_id), "communication_id": int(communication_id)},
    )


def _normalize_participant_user_ids(raw_value: object) -> list[UserId] | None:
    if raw_value is None:
        return None

    parsed_value = raw_value
    if isinstance(raw_value, str):
        text = raw_value.strip()
        if text == "":
            return None
        try:
            parsed_value = json.loads(text)
        except json.JSONDecodeError:
            return None

    if not isinstance(parsed_value, list):
        return None

    normalized_ids: list[UserId] = []
    seen_ids: set[int] = set()
    for raw_id in parsed_value:
        try:
            user_id = int(raw_id)
        except (TypeError, ValueError):
            continue
        if user_id <= 0 or user_id in seen_ids:
            continue
        seen_ids.add(user_id)
        normalized_ids.append(UserId(user_id))
    return normalized_ids


def _serialize_participant_user_ids(raw_value: object) -> str | None:
    normalized_ids = _normalize_participant_user_ids(raw_value)
    if normalized_ids is None:
        return None
    return json.dumps([int(user_id) for user_id in normalized_ids])


async def _get_projected_schedule_item_by_id(
    tournament_id: TournamentId, schedule_item_id: int
) -> LeagueProjectedScheduleItemView | None:
    row = await database.fetch_one(
        """
        SELECT
            lps.id,
            lps.tournament_id,
            lps.round_label,
            lps.starts_at,
            lps.title,
            lps.details,
            lps.status,
            lps.event_template,
            lps.regular_season_week_index,
            lps.regular_season_games_per_opponent,
            lps.regular_season_games_per_week,
            lps.participant_user_ids,
            lps.season_id,
            lps.sort_order,
            lps.linked_tournament_id,
            lt.name AS linked_tournament_name,
            lt.status AS linked_tournament_status,
            lps.created_by_user_id,
            u.name AS created_by_user_name,
            lps.created,
            lps.updated
        FROM league_projected_schedule_items lps
        LEFT JOIN users u ON u.id = lps.created_by_user_id
        LEFT JOIN tournaments lt ON lt.id = lps.linked_tournament_id
        WHERE lps.tournament_id = :tournament_id
          AND lps.id = :schedule_item_id
        """,
        values={"tournament_id": int(tournament_id), "schedule_item_id": int(schedule_item_id)},
    )
    if row is None:
        return None
    payload = dict(row._mapping)
    payload["participant_user_ids"] = _normalize_participant_user_ids(
        payload.get("participant_user_ids")
    )
    return LeagueProjectedScheduleItemView.model_validate(payload)


async def get_projected_schedule_item_by_id(
    tournament_id: TournamentId, schedule_item_id: int
) -> LeagueProjectedScheduleItemView | None:
    return await _get_projected_schedule_item_by_id(tournament_id, schedule_item_id)


async def list_projected_schedule_items(
    tournament_id: TournamentId,
) -> list[LeagueProjectedScheduleItemView]:
    rows = await database.fetch_all(
        """
        SELECT
            lps.id,
            lps.tournament_id,
            lps.round_label,
            lps.starts_at,
            lps.title,
            lps.details,
            lps.status,
            lps.event_template,
            lps.regular_season_week_index,
            lps.regular_season_games_per_opponent,
            lps.regular_season_games_per_week,
            lps.participant_user_ids,
            lps.season_id,
            lps.sort_order,
            lps.linked_tournament_id,
            lt.name AS linked_tournament_name,
            lt.status AS linked_tournament_status,
            lps.created_by_user_id,
            u.name AS created_by_user_name,
            lps.created,
            lps.updated
        FROM league_projected_schedule_items lps
        LEFT JOIN users u ON u.id = lps.created_by_user_id
        LEFT JOIN tournaments lt ON lt.id = lps.linked_tournament_id
        WHERE lps.tournament_id = :tournament_id
        ORDER BY lps.sort_order ASC, lps.starts_at ASC NULLS LAST, lps.id ASC
        """,
        values={"tournament_id": int(tournament_id)},
    )
    schedule_items = []
    for row in rows:
        payload = dict(row._mapping)
        payload["participant_user_ids"] = _normalize_participant_user_ids(
            payload.get("participant_user_ids")
        )
        schedule_items.append(LeagueProjectedScheduleItemView.model_validate(payload))
    linked_tournament_ids = {
        int(item.linked_tournament_id)
        for item in schedule_items
        if item.linked_tournament_id is not None and int(item.linked_tournament_id) > 0
    }

    mapped_tournaments = await database.fetch_all(
        f"""
        SELECT DISTINCT
            t.id,
            t.name,
            t.start_time,
            t.status,
            t.created,
            scope.season_id
        FROM tournaments t
        JOIN (
            SELECT st.tournament_id, st.season_id
            FROM season_tournaments st
            WHERE st.season_id IN ({season_ids_subquery()})
            UNION
            SELECT s.tournament_id, s.id AS season_id
            FROM seasons s
            WHERE s.id IN ({season_ids_subquery()})
        ) scope ON scope.tournament_id = t.id
        WHERE t.id <> :tournament_id
        ORDER BY t.start_time ASC, t.id ASC
        """,
        values={"tournament_id": int(tournament_id)},
    )

    for row in mapped_tournaments:
        mapped_tournament_id = int(row._mapping["id"])
        if mapped_tournament_id in linked_tournament_ids:
            continue
        mapped_created = row._mapping["created"]
        schedule_items.append(
            LeagueProjectedScheduleItemView(
                id=-mapped_tournament_id,
                tournament_id=tournament_id,
                round_label="Event",
                starts_at=row._mapping["start_time"],
                title=str(row._mapping["name"]),
                details=None,
                status=str(row._mapping["status"]),
                event_template="STANDARD",
                regular_season_week_index=None,
                regular_season_games_per_opponent=None,
                regular_season_games_per_week=None,
                participant_user_ids=None,
                season_id=(
                    int(row._mapping["season_id"]) if row._mapping["season_id"] is not None else None
                ),
                sort_order=0,
                linked_tournament_id=TournamentId(mapped_tournament_id),
                linked_tournament_name=str(row._mapping["name"]),
                linked_tournament_status=str(row._mapping["status"]),
                created_by_user_id=None,
                created_by_user_name=None,
                created=mapped_created,
                updated=mapped_created,
            )
        )

    def sort_key(item: LeagueProjectedScheduleItemView) -> tuple[int, bool, float, int]:
        return (
            int(item.sort_order),
            item.starts_at is None,
            item.starts_at.timestamp() if item.starts_at is not None else 0.0,
            int(item.id),
        )

    schedule_items.sort(key=sort_key)
    return schedule_items


async def sync_projected_schedule_tournament_statuses(tournament_id: TournamentId) -> None:
    scoped_tournaments = await database.fetch_all(
        f"""
        SELECT DISTINCT
            t.id,
            t.start_time,
            t.status
        FROM tournaments t
        WHERE t.id <> :tournament_id
          AND t.id IN (
            SELECT lps.linked_tournament_id
            FROM league_projected_schedule_items lps
            WHERE lps.tournament_id = :tournament_id
              AND lps.linked_tournament_id IS NOT NULL
            UNION
            SELECT st.tournament_id
            FROM season_tournaments st
            WHERE st.season_id IN ({season_ids_subquery()})
            UNION
            SELECT s.tournament_id
            FROM seasons s
            WHERE s.id IN ({season_ids_subquery()})
          )
        ORDER BY t.start_time ASC, t.id ASC
        """,
        values={"tournament_id": int(tournament_id)},
    )
    if len(scoped_tournaments) < 1:
        return

    now = datetime_utc.now()
    ordered = [
        {
            "id": int(row._mapping["id"]),
            "start_time": row._mapping["start_time"],
            "status": str(row._mapping["status"]).upper(),
        }
        for row in scoped_tournaments
    ]

    past_or_now = [row for row in ordered if row["start_time"] <= now]
    future = [row for row in ordered if row["start_time"] > now]
    current_event_id = int(past_or_now[-1]["id"]) if len(past_or_now) > 0 else None
    next_event_id = int(future[0]["id"]) if len(future) > 0 else None

    for row in ordered:
        event_id = int(row["id"])
        if current_event_id is not None and event_id == current_event_id:
            desired_status = "IN_PROGRESS"
        elif next_event_id is not None and event_id == next_event_id:
            desired_status = "OPEN"
        elif row["start_time"] > now:
            desired_status = "PLANNED"
        else:
            desired_status = "CLOSED"

        if row["status"] == desired_status:
            continue
        await database.execute(
            """
            UPDATE tournaments
            SET
                status = CAST(:state AS tournament_status),
                dashboard_public = CASE
                    WHEN CAST(:state AS tournament_status) = 'CLOSED'::tournament_status
                    THEN FALSE
                    ELSE dashboard_public
                END
            WHERE id = :tournament_id
            """,
            values={"tournament_id": event_id, "state": desired_status},
        )


async def create_projected_schedule_item(
    tournament_id: TournamentId,
    body: LeagueProjectedScheduleItemUpsertBody,
    created_by_user_id: UserId,
) -> LeagueProjectedScheduleItemView:
    serialized_participant_user_ids = _serialize_participant_user_ids(body.participant_user_ids)
    row = await database.fetch_one(
        """
        INSERT INTO league_projected_schedule_items (
            tournament_id,
            round_label,
            starts_at,
            title,
            details,
            status,
            event_template,
            regular_season_week_index,
            regular_season_games_per_opponent,
            regular_season_games_per_week,
            participant_user_ids,
            season_id,
            sort_order,
            linked_tournament_id,
            created_by_user_id,
            created,
            updated
        )
        VALUES (
            :tournament_id,
            :round_label,
            :starts_at,
            :title,
            :details,
            :status,
            :event_template,
            :regular_season_week_index,
            :regular_season_games_per_opponent,
            :regular_season_games_per_week,
            :participant_user_ids,
            :season_id,
            :sort_order,
            :linked_tournament_id,
            :created_by_user_id,
            :created,
            :updated
        )
        RETURNING id
        """,
        values={
            "tournament_id": int(tournament_id),
            "round_label": (
                body.round_label.strip()
                if body.round_label is not None and body.round_label.strip() != ""
                else None
            ),
            "starts_at": body.starts_at,
            "title": body.title.strip(),
            "details": body.details.strip() if body.details is not None else None,
            "status": body.status.strip() if body.status is not None else None,
            "event_template": body.event_template,
            "regular_season_week_index": body.regular_season_week_index,
            "regular_season_games_per_opponent": body.regular_season_games_per_opponent,
            "regular_season_games_per_week": body.regular_season_games_per_week,
            "participant_user_ids": serialized_participant_user_ids,
            "season_id": body.season_id,
            "sort_order": int(body.sort_order),
            "linked_tournament_id": None,
            "created_by_user_id": int(created_by_user_id),
            "created": datetime_utc.now(),
            "updated": datetime_utc.now(),
        },
    )
    schedule_item_id = int(assert_some(row)._mapping["id"])
    return assert_some(await _get_projected_schedule_item_by_id(tournament_id, schedule_item_id))


async def update_projected_schedule_item(
    tournament_id: TournamentId,
    schedule_item_id: int,
    body: LeagueProjectedScheduleItemUpdateBody,
) -> LeagueProjectedScheduleItemView | None:
    payload = body.model_dump(exclude_unset=True)
    values: dict[str, object] = {
        "tournament_id": int(tournament_id),
        "schedule_item_id": int(schedule_item_id),
    }
    set_clauses: list[str] = []

    for field in (
        "round_label",
        "starts_at",
        "title",
        "details",
        "status",
        "event_template",
        "regular_season_week_index",
        "regular_season_games_per_opponent",
        "regular_season_games_per_week",
        "participant_user_ids",
        "season_id",
        "sort_order",
        "linked_tournament_id",
    ):
        if field not in payload:
            continue
        value = payload[field]
        if field in {"round_label", "title", "details", "status"} and isinstance(value, str):
            value = value.strip()
        if field in {"round_label", "details", "status"} and value == "":
            value = None
        if field == "participant_user_ids":
            value = _serialize_participant_user_ids(value)
        values[field] = value
        set_clauses.append(f"{field} = :{field}")

    if len(set_clauses) < 1:
        return await _get_projected_schedule_item_by_id(tournament_id, schedule_item_id)

    values["updated"] = datetime_utc.now()
    set_clauses.append("updated = :updated")

    row = await database.fetch_one(
        f"""
        UPDATE league_projected_schedule_items
        SET {", ".join(set_clauses)}
        WHERE tournament_id = :tournament_id
          AND id = :schedule_item_id
        RETURNING id
        """,
        values=values,
    )
    if row is None:
        return None
    return await _get_projected_schedule_item_by_id(tournament_id, int(row._mapping["id"]))


async def delete_projected_schedule_item(tournament_id: TournamentId, schedule_item_id: int) -> None:
    await database.execute(
        """
        DELETE FROM league_projected_schedule_items
        WHERE tournament_id = :tournament_id
          AND id = :schedule_item_id
        """,
        values={"tournament_id": int(tournament_id), "schedule_item_id": int(schedule_item_id)},
    )


async def get_tournament_applications(
    tournament_id: TournamentId,
    user_id: UserId | None = None,
) -> list[LeagueTournamentApplicationView]:
    user_filter = "AND ta.user_id = :user_id" if user_id is not None else ""
    values: dict[str, int] = {"tournament_id": tournament_id}
    if user_id is not None:
        values["user_id"] = int(user_id)
    rows = await database.fetch_all(
        f"""
        SELECT
            ta.user_id,
            u.name AS user_name,
            u.email AS user_email,
            ta.tournament_id,
            ta.season_id,
            ta.deck_id,
            d.name AS deck_name,
            d.leader AS deck_leader,
            d.base AS deck_base,
            ta.status
        FROM tournament_applications ta
        JOIN users u ON u.id = ta.user_id
        LEFT JOIN decks d ON d.id = ta.deck_id
        WHERE ta.tournament_id = :tournament_id
        {user_filter}
        ORDER BY ta.updated DESC, u.name ASC
        """,
        values=values,
    )
    return [LeagueTournamentApplicationView.model_validate(dict(row._mapping)) for row in rows]


async def user_is_league_admin(tournament_id: TournamentId, user_id: UserId) -> bool:
    row = await database.fetch_one(
        """
        SELECT sm.role, sm.can_manage_tournaments
        FROM season_memberships sm
        JOIN seasons s ON s.id = sm.season_id
        WHERE sm.user_id = :user_id
          AND (
            s.tournament_id = :tournament_id
            OR s.id IN (
                SELECT season_id
                FROM season_tournaments
                WHERE tournament_id = :tournament_id
            )
          )
          AND s.is_active = TRUE
        ORDER BY s.created DESC
        LIMIT 1
        """,
        values={"tournament_id": tournament_id, "user_id": user_id},
    )
    if row is None:
        return False
    return row._mapping["role"] == "ADMIN" or bool(row._mapping["can_manage_tournaments"])


async def delete_league_data_for_tournament(tournament_id: TournamentId) -> None:
    async with database.transaction():
        await database.execute(
            """
            DELETE FROM league_communications
            WHERE tournament_id = :tournament_id
            """,
            values={"tournament_id": tournament_id},
        )
        await database.execute(
            """
            DELETE FROM league_projected_schedule_items
            WHERE tournament_id = :tournament_id
            """,
            values={"tournament_id": tournament_id},
        )
        await database.execute(
            """
            DELETE FROM seasons
            WHERE tournament_id = :tournament_id
               OR id IN (
                    SELECT season_id
                    FROM season_tournaments
                    WHERE tournament_id = :tournament_id
               )
            """,
            values={"tournament_id": tournament_id},
        )


async def get_user_season_records(user_id: UserId, user_name: str) -> list[LeagueSeasonRecord]:
    rows = await database.fetch_all(
        """
        WITH season_map AS (
            SELECT s.id AS season_id, s.name AS season_name, s.created, s.tournament_id
            FROM seasons s
            UNION
            SELECT s.id AS season_id, s.name AS season_name, s.created, st.tournament_id
            FROM seasons s
            JOIN season_tournaments st ON st.season_id = s.id
        )
        SELECT
            sm.season_id,
            sm.season_name,
            sm.created,
            COALESCE(SUM(p.wins), 0) AS wins,
            COALESCE(SUM(p.draws), 0) AS draws,
            COALESCE(SUM(p.losses), 0) AS losses
        FROM season_map sm
        JOIN tournaments t ON t.id = sm.tournament_id
        JOIN users_x_clubs uxc ON uxc.club_id = t.club_id
        LEFT JOIN players p
            ON p.tournament_id = t.id
            AND lower(trim(p.name)) = lower(trim(:user_name))
        WHERE uxc.user_id = :user_id
        GROUP BY sm.season_id, sm.season_name, sm.created
        ORDER BY sm.created DESC, sm.season_id DESC
        """,
        values={"user_id": user_id, "user_name": user_name},
    )
    records: list[LeagueSeasonRecord] = []
    for row in rows:
        wins = int(row._mapping["wins"] or 0)
        draws = int(row._mapping["draws"] or 0)
        losses = int(row._mapping["losses"] or 0)
        matches = wins + draws + losses
        win_percentage = (wins / matches * 100) if matches > 0 else 0
        records.append(
            LeagueSeasonRecord(
                season_id=int(row._mapping["season_id"]),
                season_name=str(row._mapping["season_name"]),
                wins=wins,
                draws=draws,
                losses=losses,
                matches=matches,
                win_percentage=round(win_percentage, 2),
            )
        )
    return records


def _get_card_lookup(card_ids: Sequence[str]) -> dict[str, dict]:
    if len(card_ids) < 1:
        return {}

    cards_raw = fetch_swu_cards_cached(DEFAULT_SWU_SET_CODES, timeout_s=8, cache_ttl_s=1800)
    cards = [normalize_card_for_deckbuilding(card) for card in cards_raw]
    card_lookup: dict[str, dict] = {}
    for card in cards:
        normalized_card_id = _normalize_meta_card_id(str(card.get("card_id") or ""))
        if normalized_card_id == "":
            continue
        previous = card_lookup.get(normalized_card_id)
        card_lookup[normalized_card_id] = _preferred_card_row(previous, card)

    resolved: dict[str, dict] = {}
    for card_id in card_ids:
        normalized_card_id = _normalize_meta_card_id(card_id)
        if normalized_card_id == "":
            continue
        card = _resolve_meta_card(card_lookup, normalized_card_id)
        if card is not None:
            resolved[normalized_card_id] = card
    return resolved


async def get_user_career_profile(
    user_id: UserId,
) -> LeaguePlayerCareerProfile | None:
    user_row = await database.fetch_one(
        """
        SELECT id, name, email, account_type
        FROM users
        WHERE id = :user_id
        """,
        values={"user_id": user_id},
    )
    if user_row is None:
        return None

    user_name = str(user_row._mapping["name"])
    summary_row = await database.fetch_one(
        """
        SELECT
            COALESCE(SUM(p.wins), 0) AS wins,
            COALESCE(SUM(p.draws), 0) AS draws,
            COALESCE(SUM(p.losses), 0) AS losses
        FROM tournaments t
        JOIN users_x_clubs uxc ON uxc.club_id = t.club_id
        LEFT JOIN players p
            ON p.tournament_id = t.id
            AND lower(trim(p.name)) = lower(trim(:user_name))
        WHERE uxc.user_id = :user_id
        """,
        values={"user_id": user_id, "user_name": user_name},
    )

    wins = int(assert_some(summary_row)._mapping["wins"] or 0)
    draws = int(assert_some(summary_row)._mapping["draws"] or 0)
    losses = int(assert_some(summary_row)._mapping["losses"] or 0)
    matches = wins + draws + losses
    overall_win_percentage = (wins / matches * 100) if matches > 0 else 0

    season_records = await get_user_season_records(user_id, user_name)

    deck_rows = await database.fetch_all(
        """
        SELECT leader, base, mainboard
        FROM decks
        WHERE user_id = :user_id
        ORDER BY updated DESC
        """,
        values={"user_id": user_id},
    )
    aspect_counts: Counter[str] = Counter()
    card_counts: Counter[str] = Counter()
    card_ids: set[str] = set()

    for row in deck_rows:
        leader = _normalize_meta_card_id(str(row._mapping["leader"] or ""))
        base = _normalize_meta_card_id(str(row._mapping["base"] or ""))
        if leader != "":
            card_ids.add(leader)
        if base != "":
            card_ids.add(base)

        mainboard_raw = row._mapping["mainboard"]
        if isinstance(mainboard_raw, str):
            try:
                mainboard_raw = json.loads(mainboard_raw)
            except ValueError:
                mainboard_raw = {}
        if isinstance(mainboard_raw, dict):
            for card_id, amount in mainboard_raw.items():
                normalized_card_id = _normalize_meta_card_id(str(card_id))
                if normalized_card_id == "":
                    continue
                try:
                    amount_int = int(amount)
                except (TypeError, ValueError):
                    continue
                if amount_int <= 0:
                    continue
                card_counts[normalized_card_id] += amount_int
                card_ids.add(normalized_card_id)

    card_lookup = await asyncio.to_thread(_get_card_lookup, list(card_ids))
    for row in deck_rows:
        leader = _normalize_meta_card_id(str(row._mapping["leader"] or ""))
        base = _normalize_meta_card_id(str(row._mapping["base"] or ""))
        for deck_card_id in [leader, base]:
            if deck_card_id == "":
                continue
            card = _resolve_meta_card(card_lookup, deck_card_id)
            if card is None:
                continue
            for aspect in card.get("aspects", []):
                normalized_aspect = str(aspect).strip()
                if normalized_aspect != "":
                    aspect_counts[normalized_aspect] += 1

    most_used_aspects = [
        LeagueAspectUsage(aspect=aspect, count=count)
        for aspect, count in aspect_counts.most_common(6)
    ]

    favorite_card: LeagueFavoriteCard | None = None
    if len(card_counts) > 0:
        card_id, uses = card_counts.most_common(1)[0]
        favorite = card_lookup.get(card_id)
        favorite_card = LeagueFavoriteCard(
            card_id=card_id,
            uses=uses,
            name=None if favorite is None else str(favorite.get("name") or ""),
            image_url=None if favorite is None else favorite.get("image_url"),
        )

    return LeaguePlayerCareerProfile.model_validate(
        {
            "user_id": int(user_row._mapping["id"]),
            "user_name": str(user_row._mapping["name"]),
            "user_email": str(user_row._mapping["email"]),
            "account_type": str(user_row._mapping["account_type"]),
            "overall_wins": wins,
            "overall_draws": draws,
            "overall_losses": losses,
            "overall_matches": matches,
            "overall_win_percentage": round(overall_win_percentage, 2),
            "season_records": [record.model_dump() for record in season_records],
            "most_used_aspects": [aspect.model_dump() for aspect in most_used_aspects],
            "favorite_card": None if favorite_card is None else favorite_card.model_dump(),
        }
    )
