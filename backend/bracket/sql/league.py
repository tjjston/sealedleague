import asyncio
from collections import Counter
from collections.abc import Sequence
from heliclockter import datetime_utc
import json

from bracket.database import database
from bracket.models.db.league import Season
from bracket.models.db.player import PlayerBody
from bracket.models.db.team import TeamInsertable
from bracket.models.league import (
    LeagueAspectUsage,
    LeagueAdminUserView,
    LeagueFavoriteCard,
    LeagueDistributionBucket,
    LeagueCommunicationUpsertBody,
    LeagueCommunicationUpdateBody,
    LeagueCommunicationView,
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
    existing_query = """
        SELECT *
        FROM seasons
        WHERE is_active = TRUE
          AND (
            tournament_id = :tournament_id
            OR id IN (
                SELECT season_id
                FROM season_tournaments
                WHERE tournament_id = :tournament_id
            )
          )
        ORDER BY created DESC
        LIMIT 1
    """
    existing = await database.fetch_one(existing_query, values={"tournament_id": tournament_id})
    if existing is not None:
        return Season.model_validate(dict(existing._mapping))

    count_query = """
        SELECT COUNT(*) AS count
        FROM seasons
        WHERE tournament_id = :tournament_id
           OR id IN (
                SELECT season_id
                FROM season_tournaments
                WHERE tournament_id = :tournament_id
           )
    """
    count_result = await database.fetch_one(count_query, values={"tournament_id": tournament_id})
    season_number = int(assert_some(count_result)._mapping["count"]) + 1

    insert_query = """
        INSERT INTO seasons (tournament_id, name, created, is_active)
        VALUES (:tournament_id, :name, :created, TRUE)
        RETURNING *
    """
    created = datetime_utc.now()
    inserted = await database.fetch_one(
        insert_query,
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
    query = """
        SELECT DISTINCT s.*
        FROM seasons s
        LEFT JOIN season_tournaments st ON st.season_id = s.id
        WHERE s.tournament_id = :tournament_id
           OR st.tournament_id = :tournament_id
        ORDER BY created ASC
    """
    rows = await database.fetch_all(query=query, values={"tournament_id": tournament_id})
    return [Season.model_validate(dict(row._mapping)) for row in rows]


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
    include_live_points = season_id is None
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
    live_cte = ""
    live_join = ""
    live_group_by = ""
    live_points_expression = "0"
    if include_live_points:
        live_cte = f"""
        ,
        live_match_points AS (
            SELECT
                tu.id AS user_id,
                COALESCE(SUM((p.wins * 3) + p.draws), 0) AS live_points
            FROM tournament_users tu
            JOIN tournaments t
                ON {tournament_scope_filter}
            LEFT JOIN players p
                ON p.tournament_id = t.id
               AND lower(trim(p.name)) = lower(trim(tu.name))
            GROUP BY tu.id
        )
        """
        live_join = """
        LEFT JOIN live_match_points lmp
            ON lmp.user_id = tu.id
        """
        live_group_by = "lmp.live_points,\n            "
        live_points_expression = "COALESCE(lmp.live_points, 0)"
    query = """
        WITH tournament_users AS (
            SELECT DISTINCT u.id, u.name, u.email
            FROM tournaments t
            JOIN users_x_clubs uxc ON uxc.club_id = t.club_id
            JOIN users u ON u.id = uxc.user_id
            WHERE t.id = :tournament_id
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
        membership_filter=membership_filter,
        season_filter=season_filter,
        live_cte=live_cte,
        live_join=live_join,
        live_group_by=live_group_by,
        live_points_expression=live_points_expression,
    )
    values: dict[str, int] = {"tournament_id": tournament_id}
    if season_id is not None:
        values["season_id"] = season_id
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


async def get_league_admin_users(tournament_id: TournamentId, season_id: int) -> list[LeagueAdminUserView]:
    query = """
        WITH tournament_users AS (
            SELECT DISTINCT u.id, u.name, u.email, u.account_type
            FROM tournaments t
            JOIN users_x_clubs uxc ON uxc.club_id = t.club_id
            JOIN users u ON u.id = uxc.user_id
            WHERE t.id = :tournament_id
        )
        SELECT
            tu.id AS user_id,
            tu.name AS user_name,
            tu.email AS user_email,
            tu.account_type,
            sm.role,
            COALESCE(sm.can_manage_points, FALSE) AS can_manage_points,
            COALESCE(sm.can_manage_tournaments, FALSE) AS can_manage_tournaments
        FROM tournament_users tu
        LEFT JOIN season_memberships sm
            ON sm.user_id = tu.id
            AND sm.season_id = :season_id
        ORDER BY tu.name ASC
    """
    rows = await database.fetch_all(
        query=query,
        values={"tournament_id": tournament_id, "season_id": season_id},
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
            created
        )
        VALUES (
            :season_id,
            :user_id,
            :role,
            :can_manage_points,
            :can_manage_tournaments,
            :created
        )
        ON CONFLICT (season_id, user_id)
        DO UPDATE SET
            role = EXCLUDED.role,
            can_manage_points = EXCLUDED.can_manage_points,
            can_manage_tournaments = EXCLUDED.can_manage_tournaments
    """
    await database.execute(
        query=query,
        values={
            "season_id": season_id,
            "user_id": user_id,
            "role": body.role.value,
            "can_manage_points": body.can_manage_points,
            "can_manage_tournaments": body.can_manage_tournaments,
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


def _parse_pool_draft_reason(reason: str) -> tuple[int, int, int] | None:
    # Format: POOL_DRAFT_PICK:from=<season_id>:source=<source_user_id>:target=<target_user_id>
    if not reason.startswith("POOL_DRAFT_PICK:"):
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
    return values["from"], values["source"], values["target"]


async def _get_draft_pick_mappings(from_season_id: int, to_season_id: int) -> dict[int, int]:
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
            "reason_prefix": f"POOL_DRAFT_PICK:from={from_season_id}:%",
        },
    )
    target_to_source: dict[int, int] = {}
    for row in rows:
        parsed = _parse_pool_draft_reason(str(row._mapping["reason"] or ""))
        if parsed is None:
            continue
        parsed_from_season_id, source_user_id, target_user_id = parsed
        if parsed_from_season_id != from_season_id:
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
    existing_mappings = await _get_draft_pick_mappings(from_season_id, to_season_id)
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
                    "reason": (
                        f"POOL_DRAFT_PICK:from={from_season_id}:"
                        f"source={old_source_for_target}:target={int(target_user_id)}"
                    ),
                },
            )

        await database.execute(
            """
            DELETE FROM card_pool_entries
            WHERE season_id = :to_season_id
              AND user_id = :target_user_id
            """,
            values={"to_season_id": to_season_id, "target_user_id": target_user_id},
        )

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
                    "user_id": target_user_id,
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
                "user_id": target_user_id,
                "changed_by_user_id": changed_by_user_id,
                "tournament_id": tournament_id,
                "reason": (
                    f"POOL_DRAFT_PICK:from={from_season_id}:"
                    f"source={int(source_user_id)}:target={int(target_user_id)}"
                ),
                "created": datetime_utc.now(),
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

    picks_by_target = await _get_draft_pick_mappings(previous.id, active.id)
    picks_by_source = {source: target for target, source in picks_by_target.items()}

    card_pool_entries = await get_card_pool_entries(previous.id, None)
    pool_by_source: dict[int, list[LeagueCardPoolEntryView]] = {}
    for entry in card_pool_entries:
        pool_by_source.setdefault(int(entry.user_id), []).append(entry)

    set_codes = sorted(
        {
            str(entry.card_id).split("-", 1)[0].strip().lower()
            for entry in card_pool_entries
            if "-" in str(entry.card_id)
        }
    )
    card_lookup: dict[str, dict] = {}
    if len(set_codes) > 0:
        try:
            cards_raw = await asyncio.to_thread(fetch_swu_cards_cached, set_codes, 8, 1800)
            cards = [normalize_card_for_deckbuilding(card) for card in cards_raw]
            card_lookup = {str(card["card_id"]).lower(): card for card in cards}
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
            card = card_lookup.get(str(entry.card_id).lower())
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
    condition = ""
    if user_id is not None:
        condition = "AND d.user_id = :user_id"
        values["user_id"] = user_id
    if only_admin_users:
        condition += " AND u.account_type = 'ADMIN'"

    query = f"""
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
        WHERE d.season_id = :season_id
        {condition}
        ORDER BY d.updated DESC, d.name ASC
    """
    rows = await database.fetch_all(query=query, values=values)
    return [LeagueDeckView.model_validate(dict(row._mapping)) for row in rows]


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
        ON CONFLICT DO NOTHING
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
    return await _get_league_communication_by_id(tournament_id, int(row._mapping["id"]))


async def delete_league_communication(tournament_id: TournamentId, communication_id: int) -> None:
    await database.execute(
        """
        DELETE FROM league_communications
        WHERE tournament_id = :tournament_id
          AND id = :communication_id
        """,
        values={"tournament_id": int(tournament_id), "communication_id": int(communication_id)},
    )


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
            lps.sort_order,
            lps.created_by_user_id,
            u.name AS created_by_user_name,
            lps.created,
            lps.updated
        FROM league_projected_schedule_items lps
        LEFT JOIN users u ON u.id = lps.created_by_user_id
        WHERE lps.tournament_id = :tournament_id
          AND lps.id = :schedule_item_id
        """,
        values={"tournament_id": int(tournament_id), "schedule_item_id": int(schedule_item_id)},
    )
    return LeagueProjectedScheduleItemView.model_validate(dict(row._mapping)) if row is not None else None


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
            lps.sort_order,
            lps.created_by_user_id,
            u.name AS created_by_user_name,
            lps.created,
            lps.updated
        FROM league_projected_schedule_items lps
        LEFT JOIN users u ON u.id = lps.created_by_user_id
        WHERE lps.tournament_id = :tournament_id
        ORDER BY lps.sort_order ASC, lps.starts_at ASC NULLS LAST, lps.id ASC
        """,
        values={"tournament_id": int(tournament_id)},
    )
    return [LeagueProjectedScheduleItemView.model_validate(dict(row._mapping)) for row in rows]


async def create_projected_schedule_item(
    tournament_id: TournamentId,
    body: LeagueProjectedScheduleItemUpsertBody,
    created_by_user_id: UserId,
) -> LeagueProjectedScheduleItemView:
    row = await database.fetch_one(
        """
        INSERT INTO league_projected_schedule_items (
            tournament_id,
            round_label,
            starts_at,
            title,
            details,
            status,
            sort_order,
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
            :sort_order,
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
            "sort_order": int(body.sort_order),
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

    for field in ("round_label", "starts_at", "title", "details", "status", "sort_order"):
        if field not in payload:
            continue
        value = payload[field]
        if field in {"round_label", "title", "details", "status"} and isinstance(value, str):
            value = value.strip()
        if field in {"round_label", "details", "status"} and value == "":
            value = None
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
    by_id = {str(card["card_id"]).lower(): card for card in cards}
    return {
        card_id.lower(): by_id[card_id.lower()]
        for card_id in card_ids
        if card_id.lower() in by_id
    }


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
        leader = str(row._mapping["leader"] or "").strip().lower()
        base = str(row._mapping["base"] or "").strip().lower()
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
                normalized_card_id = str(card_id).strip().lower()
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
        leader = str(row._mapping["leader"] or "").strip().lower()
        base = str(row._mapping["base"] or "").strip().lower()
        for deck_card_id in [leader, base]:
            if deck_card_id == "" or deck_card_id not in card_lookup:
                continue
            for aspect in card_lookup[deck_card_id].get("aspects", []):
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
