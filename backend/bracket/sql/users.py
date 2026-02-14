from bracket.database import database
from bracket.logic.tournaments import sql_delete_tournament_completely
from bracket.models.db.account import UserAccountType
from bracket.models.db.user import (
    User,
    UserDirectoryEntry,
    UserInDB,
    UserInsertable,
    UserPreferencesToUpdate,
    UserPublic,
    UserToUpdate,
)
from bracket.schema import users
from bracket.sql.clubs import get_clubs_for_user_id, sql_delete_club
from bracket.sql.tournaments import sql_get_tournaments
from bracket.utils.db import fetch_one_parsed
from bracket.utils.id_types import ClubId, TournamentId, UserId
from bracket.utils.types import assert_some


async def get_users_table_columns() -> set[str]:
    rows = await database.fetch_all(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
        """
    )
    return {str(row._mapping["column_name"]) for row in rows}


async def get_user_access_to_tournament(tournament_id: TournamentId, user_id: UserId) -> bool:
    query = """
        SELECT DISTINCT t.id
        FROM users_x_clubs
        JOIN tournaments t ON t.club_id = users_x_clubs.club_id
        WHERE user_id = :user_id
        """
    result = await database.fetch_all(query=query, values={"user_id": user_id})
    return tournament_id in {tournament["id"] for tournament in result}


async def get_users_for_tournament(tournament_id: TournamentId) -> list[UserPublic]:
    query = """
        SELECT DISTINCT u.*
        FROM tournaments t
        JOIN users_x_clubs uxc ON uxc.club_id = t.club_id
        JOIN users u ON u.id = uxc.user_id
        WHERE t.id = :tournament_id
        ORDER BY u.name ASC
    """
    result = await database.fetch_all(query=query, values={"tournament_id": tournament_id})
    return [UserPublic.model_validate(dict(user._mapping)) for user in result]


async def get_users_for_club(club_id: ClubId) -> list[UserPublic]:
    query = """
        SELECT DISTINCT u.*
        FROM users_x_clubs uxc
        JOIN users u ON u.id = uxc.user_id
        WHERE uxc.club_id = :club_id
        ORDER BY u.name ASC
    """
    result = await database.fetch_all(query=query, values={"club_id": club_id})
    return [UserPublic.model_validate(dict(user._mapping)) for user in result]


async def get_which_clubs_has_user_access_to(user_id: UserId) -> set[ClubId]:
    query = """
        SELECT club_id
        FROM users_x_clubs
        WHERE user_id = :user_id
        """
    result = await database.fetch_all(query=query, values={"user_id": user_id})
    return {club["club_id"] for club in result}


async def get_user_access_to_club(club_id: ClubId, user_id: UserId) -> bool:
    return club_id in await get_which_clubs_has_user_access_to(user_id)


async def update_user(user_id: UserId, user: UserToUpdate) -> None:
    query = """
        UPDATE users
        SET name = :name, email = :email
        WHERE id = :user_id
        """
    await database.execute(
        query=query, values={"user_id": user_id, "name": user.name, "email": user.email}
    )


async def update_user_preferences(user_id: UserId, body: UserPreferencesToUpdate) -> None:
    available_columns = await get_users_table_columns()
    updatable_columns = [
        "avatar_url",
        "favorite_card_id",
        "favorite_card_name",
        "favorite_card_image_url",
        "favorite_media",
        "weapon_icon",
    ]
    assignments = [
        f"{column_name} = :{column_name}"
        for column_name in updatable_columns
        if column_name in available_columns
    ]
    if len(assignments) < 1:
        return

    query = f"""
        UPDATE users
        SET {", ".join(assignments)}
        WHERE id = :user_id
        """
    values = {"user_id": user_id}
    body_values = body.model_dump()
    for column_name in updatable_columns:
        if column_name in available_columns:
            values[column_name] = body_values.get(column_name)
    await database.execute(
        query=query,
        values=values,
    )


async def update_user_account_type(user_id: UserId, account_type: UserAccountType) -> None:
    query = """
        UPDATE users
        SET account_type = :account_type
        WHERE id = :user_id
        """
    await database.execute(
        query=query, values={"user_id": user_id, "account_type": account_type.value}
    )


async def update_user_password(user_id: UserId, password_hash: str) -> None:
    query = """
        UPDATE users
        SET password_hash = :password_hash
        WHERE id = :user_id
        """
    await database.execute(query=query, values={"user_id": user_id, "password_hash": password_hash})


async def get_user_by_id(user_id: UserId) -> UserPublic | None:
    query = """
        SELECT *
        FROM users
        WHERE id = :user_id
        """
    result = await database.fetch_one(query=query, values={"user_id": user_id})
    return UserPublic.model_validate(dict(result._mapping)) if result is not None else None


async def get_users() -> list[UserPublic]:
    query = """
        SELECT *
        FROM users
        ORDER BY created DESC
        """
    result = await database.fetch_all(query=query)
    return [UserPublic.model_validate(dict(user._mapping)) for user in result]


async def get_user_directory() -> list[UserDirectoryEntry]:
    available_columns = await get_users_table_columns()
    has_favorite_media = "favorite_media" in available_columns
    has_weapon_icon = "weapon_icon" in available_columns
    favorite_media_select = (
        "u.favorite_media"
        if has_favorite_media
        else "NULL::TEXT AS favorite_media"
    )
    weapon_icon_select = (
        "u.weapon_icon"
        if has_weapon_icon
        else "NULL::TEXT AS weapon_icon"
    )
    favorite_media_group_by = ", u.favorite_media" if has_favorite_media else ""
    weapon_icon_group_by = ", u.weapon_icon" if has_weapon_icon else ""

    rows = await database.fetch_all(
        f"""
        SELECT
            u.id AS user_id,
            u.name AS user_name,
            u.avatar_url,
            {favorite_media_select},
            {weapon_icon_select},
            COALESCE(
                SUM(
                    CASE
                        WHEN spl.reason LIKE 'TOURNAMENT_WIN:%'
                            THEN COALESCE(NULLIF(split_part(spl.reason, ':', 2), ''), '0')::INT
                        ELSE 0
                    END
                ),
                0
            ) AS tournaments_won,
            COALESCE(
                SUM(
                    CASE
                        WHEN spl.reason LIKE 'TOURNAMENT_PLACEMENT:%'
                            THEN COALESCE(NULLIF(split_part(spl.reason, ':', 2), ''), '0')::INT
                        ELSE 0
                    END
                ),
                0
            ) AS tournaments_placed,
            COALESCE(active_pool.total_cards_active_season, 0) AS total_cards_active_season,
            COALESCE(career_pool.total_cards_career_pool, 0) AS total_cards_career_pool,
            d.leader AS current_leader_card_id
        FROM users u
        LEFT JOIN LATERAL (
            SELECT leader
            FROM decks
            WHERE user_id = u.id
            ORDER BY updated DESC
            LIMIT 1
        ) d ON TRUE
        LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(cpe.quantity), 0) AS total_cards_active_season
            FROM card_pool_entries cpe
            JOIN seasons s ON s.id = cpe.season_id
            WHERE cpe.user_id = u.id
              AND s.is_active = TRUE
        ) active_pool ON TRUE
        LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(cpe.quantity), 0) AS total_cards_career_pool
            FROM card_pool_entries cpe
            WHERE cpe.user_id = u.id
        ) career_pool ON TRUE
        LEFT JOIN season_points_ledger spl ON spl.user_id = u.id
        GROUP BY
            u.id,
            u.name,
            u.avatar_url,
            d.leader,
            active_pool.total_cards_active_season,
            career_pool.total_cards_career_pool
            {favorite_media_group_by}
            {weapon_icon_group_by}
        ORDER BY u.name ASC
        """
    )
    return [UserDirectoryEntry.model_validate(dict(row._mapping)) for row in rows]


async def get_latest_leader_card_id_for_user(user_id: UserId) -> str | None:
    try:
        row = await database.fetch_one(
            """
            SELECT leader
            FROM decks
            WHERE user_id = :user_id
            ORDER BY updated DESC
            LIMIT 1
            """,
            values={"user_id": user_id},
        )
    except Exception:
        return None
    if row is None:
        return None
    leader = row._mapping["leader"]
    return None if leader is None else str(leader)


async def get_expired_demo_users() -> list[UserPublic]:
    query = """
        SELECT *
        FROM users
        WHERE account_type='DEMO'
        AND created <= NOW() - INTERVAL '30 minutes'
        """
    result = await database.fetch_all(query=query)
    return [UserPublic.model_validate(demo_user) for demo_user in result]


async def create_user(user: UserInsertable) -> User:
    query = """
        INSERT INTO users (email, name, password_hash, created, account_type)
        VALUES (:email, :name, :password_hash, :created, :account_type)
        RETURNING *
        """
    result = await database.fetch_one(
        query=query,
        values={
            "password_hash": user.password_hash,
            "name": user.name,
            "email": user.email,
            "created": user.created,
            "account_type": user.account_type.value,
        },
    )
    return User.model_validate(dict(assert_some(result)._mapping))


async def delete_user(user_id: UserId) -> None:
    query = """
        DELETE FROM users
        WHERE id = :user_id
        """
    await database.fetch_one(query=query, values={"user_id": user_id})


async def check_whether_email_is_in_use(email: str) -> bool:
    query = """
        SELECT id
        FROM users
        WHERE email = :email
        """
    result = await database.fetch_one(query=query, values={"email": email})
    return result is not None


async def get_user(email: str) -> UserInDB | None:
    return await fetch_one_parsed(database, UserInDB, users.select().where(users.c.email == email))


async def delete_user_and_owned_clubs(user_id: UserId) -> None:
    for club in await get_clubs_for_user_id(user_id):
        for tournament in await sql_get_tournaments((club.id,), None):
            await sql_delete_tournament_completely(tournament.id)

        await sql_delete_club(club.id)

    await delete_user(user_id)
