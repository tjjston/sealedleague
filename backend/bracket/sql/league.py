from heliclockter import datetime_utc
import json

from bracket.database import database
from bracket.models.db.league import Season
from bracket.models.league import (
    LeagueAdminUserView,
    LeagueCardPoolEntryView,
    LeagueDeckView,
    LeagueSeasonPrivilegesUpdateBody,
    LeagueStandingsRow,
)
from bracket.utils.id_types import DeckId, TournamentId, UserId
from bracket.utils.types import assert_some


async def get_or_create_active_season(tournament_id: TournamentId) -> Season:
    existing_query = """
        SELECT *
        FROM seasons
        WHERE tournament_id = :tournament_id AND is_active = TRUE
        ORDER BY created DESC
        LIMIT 1
    """
    existing = await database.fetch_one(existing_query, values={"tournament_id": tournament_id})
    if existing is not None:
        return Season.model_validate(dict(existing._mapping))

    count_query = "SELECT COUNT(*) AS count FROM seasons WHERE tournament_id = :tournament_id"
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
    return Season.model_validate(dict(assert_some(inserted)._mapping))


async def get_league_standings(tournament_id: TournamentId, season_id: int) -> list[LeagueStandingsRow]:
    query = """
        WITH tournament_users AS (
            SELECT DISTINCT u.id, u.name, u.email
            FROM tournaments t
            JOIN users_x_clubs uxc ON uxc.club_id = t.club_id
            JOIN users u ON u.id = uxc.user_id
            WHERE t.id = :tournament_id
        )
        SELECT
            tu.id AS user_id,
            tu.name AS user_name,
            tu.email AS user_email,
            COALESCE(
                SUM(
                    CASE
                        WHEN spl.reason LIKE 'ACCOLADE:%' THEN 0
                        ELSE spl.points_delta
                    END
                ),
                0
            ) AS points,
            COALESCE(
                ARRAY_AGG(REPLACE(spl.reason, 'ACCOLADE:', ''))
                FILTER (WHERE spl.reason LIKE 'ACCOLADE:%'),
                ARRAY[]::TEXT[]
            ) AS accolades,
            sm.role,
            COALESCE(sm.can_manage_points, FALSE) AS can_manage_points,
            COALESCE(sm.can_manage_tournaments, FALSE) AS can_manage_tournaments
        FROM tournament_users tu
        LEFT JOIN season_memberships sm
            ON sm.user_id = tu.id
            AND sm.season_id = :season_id
        LEFT JOIN season_points_ledger spl
            ON spl.user_id = tu.id
            AND spl.season_id = :season_id
        GROUP BY
            tu.id,
            tu.name,
            tu.email,
            sm.role,
            sm.can_manage_points,
            sm.can_manage_tournaments
        ORDER BY points DESC, tu.name ASC
    """
    result = await database.fetch_all(
        query=query,
        values={"tournament_id": tournament_id, "season_id": season_id},
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


async def get_decks(season_id: int, user_id: UserId | None = None) -> list[LeagueDeckView]:
    values: dict[str, int] = {"season_id": season_id}
    condition = ""
    if user_id is not None:
        condition = "AND d.user_id = :user_id"
        values["user_id"] = user_id

    query = f"""
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
            d.sideboard
        FROM decks d
        JOIN users u ON u.id = d.user_id
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
    query = """
        WITH upserted AS (
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
            DO UPDATE SET
                tournament_id = EXCLUDED.tournament_id,
                leader = EXCLUDED.leader,
                base = EXCLUDED.base,
                mainboard = EXCLUDED.mainboard,
                sideboard = EXCLUDED.sideboard,
                updated = EXCLUDED.updated
            RETURNING *
        )
        SELECT
            udeck.id,
            udeck.season_id,
            udeck.user_id,
            u.name AS user_name,
            u.email AS user_email,
            udeck.tournament_id,
            udeck.name,
            udeck.leader,
            udeck.base,
            udeck.mainboard,
            udeck.sideboard
        FROM upserted udeck
        JOIN users u ON u.id = udeck.user_id
    """
    row = await database.fetch_one(
        query=query,
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
    return LeagueDeckView.model_validate(dict(assert_some(row)._mapping))


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
          AND lower(name) = lower((SELECT name FROM users WHERE id = :user_id))
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


async def get_deck_by_id(deck_id: DeckId) -> LeagueDeckView | None:
    query = """
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
            d.sideboard
        FROM decks d
        JOIN users u ON u.id = d.user_id
        WHERE d.id = :deck_id
    """
    row = await database.fetch_one(query=query, values={"deck_id": deck_id})
    return LeagueDeckView.model_validate(dict(row._mapping)) if row is not None else None


async def delete_deck(deck_id: DeckId) -> None:
    query = "DELETE FROM decks WHERE id = :deck_id"
    await database.execute(query=query, values={"deck_id": deck_id})
