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


async def add_user_to_club(
    user_id: UserId,
    club_id: ClubId,
    relation: str = "COLLABORATOR",
) -> None:
    await database.execute(
        """
        INSERT INTO users_x_clubs (club_id, user_id, relation)
        SELECT :club_id, :user_id, :relation
        WHERE NOT EXISTS (
            SELECT 1
            FROM users_x_clubs
            WHERE club_id = :club_id
              AND user_id = :user_id
        )
        """,
        values={
            "club_id": int(club_id),
            "user_id": int(user_id),
            "relation": relation,
        },
    )


async def update_user(user_id: UserId, user: UserToUpdate) -> None:
    next_name = str(user.name).strip()
    next_email = str(user.email).strip()

    async with database.transaction():
        existing = await database.fetch_one(
            """
            SELECT name
            FROM users
            WHERE id = :user_id
            """,
            values={"user_id": user_id},
        )
        previous_name = str(existing._mapping["name"]) if existing is not None else ""

        query = """
            UPDATE users
            SET name = :name, email = :email
            WHERE id = :user_id
            """
        await database.execute(
            query=query,
            values={"user_id": user_id, "name": next_name, "email": next_email},
        )

        await sync_user_name_references(user_id, previous_name, next_name)


async def sync_user_name_references(
    user_id: UserId,
    previous_name: str | None,
    next_name: str | None,
) -> None:
    old_name = str(previous_name or "").strip()
    new_name = str(next_name or "").strip()
    if old_name == "" or new_name == "":
        return
    if old_name.lower() == new_name.lower():
        return

    values = {"user_id": int(user_id), "old_name": old_name, "new_name": new_name}
    await database.execute(
        """
        WITH scoped_tournaments AS (
            SELECT DISTINCT t.id AS tournament_id
            FROM tournaments t
            WHERE t.club_id IN (
                SELECT uxc.club_id
                FROM users_x_clubs uxc
                WHERE uxc.user_id = :user_id
            )
            UNION
            SELECT DISTINCT ta.tournament_id
            FROM tournament_applications ta
            WHERE ta.user_id = :user_id
            UNION
            SELECT DISTINCT d.tournament_id
            FROM decks d
            WHERE d.user_id = :user_id
              AND d.tournament_id IS NOT NULL
        ),
        safe_player_tournaments AS (
            SELECT p.tournament_id
            FROM players p
            WHERE p.tournament_id IN (SELECT tournament_id FROM scoped_tournaments)
              AND lower(trim(p.name)) = lower(trim(:old_name))
            GROUP BY p.tournament_id
            HAVING COUNT(*) = 1
        )
        UPDATE players p
        SET name = :new_name
        WHERE p.tournament_id IN (SELECT tournament_id FROM safe_player_tournaments)
          AND lower(trim(p.name)) = lower(trim(:old_name))
        """,
        values=values,
    )
    await database.execute(
        """
        WITH scoped_tournaments AS (
            SELECT DISTINCT t.id AS tournament_id
            FROM tournaments t
            WHERE t.club_id IN (
                SELECT uxc.club_id
                FROM users_x_clubs uxc
                WHERE uxc.user_id = :user_id
            )
            UNION
            SELECT DISTINCT ta.tournament_id
            FROM tournament_applications ta
            WHERE ta.user_id = :user_id
            UNION
            SELECT DISTINCT d.tournament_id
            FROM decks d
            WHERE d.user_id = :user_id
              AND d.tournament_id IS NOT NULL
        ),
        safe_team_tournaments AS (
            SELECT t.tournament_id
            FROM teams t
            WHERE t.tournament_id IN (SELECT tournament_id FROM scoped_tournaments)
              AND lower(trim(t.name)) = lower(trim(:old_name))
            GROUP BY t.tournament_id
            HAVING COUNT(*) = 1
        )
        UPDATE teams t
        SET name = :new_name
        WHERE t.tournament_id IN (SELECT tournament_id FROM safe_team_tournaments)
          AND lower(trim(t.name)) = lower(trim(:old_name))
        """,
        values=values,
    )


async def update_user_preferences(user_id: UserId, body: UserPreferencesToUpdate) -> None:
    available_columns = await get_users_table_columns()
    updatable_columns = [
        "avatar_url",
        "avatar_fit_mode",
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


async def update_user_password(
    user_id: UserId, password_hash: str, must_update_password: bool
) -> None:
    query = """
        UPDATE users
        SET password_hash = :password_hash,
            must_update_password = :must_update_password
        WHERE id = :user_id
        """
    await database.execute(
        query=query,
        values={
            "user_id": user_id,
            "password_hash": password_hash,
            "must_update_password": must_update_password,
        },
    )


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


async def get_owned_card_ids_for_user(user_id: UserId) -> set[str]:
    rows = await database.fetch_all(
        """
        SELECT DISTINCT lower(trim(card_id)) AS card_id
        FROM card_pool_entries
        WHERE user_id = :user_id
          AND quantity > 0
          AND card_id IS NOT NULL
        """,
        values={"user_id": user_id},
    )
    return {
        str(row._mapping["card_id"]).strip().lower()
        for row in rows
        if row._mapping.get("card_id") is not None and str(row._mapping["card_id"]).strip() != ""
    }


async def get_user_card_pool_totals(user_id: UserId) -> list[dict[str, int | str]]:
    rows = await database.fetch_all(
        """
        SELECT
            lower(trim(card_id)) AS card_id,
            COALESCE(SUM(quantity), 0)::INT AS quantity
        FROM card_pool_entries
        WHERE user_id = :user_id
          AND quantity > 0
          AND card_id IS NOT NULL
        GROUP BY lower(trim(card_id))
        ORDER BY COALESCE(SUM(quantity), 0) DESC, lower(trim(card_id)) ASC
        """,
        values={"user_id": user_id},
    )
    return [
        {
            "card_id": str(row._mapping["card_id"]).strip().lower(),
            "quantity": int(row._mapping["quantity"] or 0),
        }
        for row in rows
        if row._mapping.get("card_id") is not None and str(row._mapping["card_id"]).strip() != ""
    ]


async def get_user_directory() -> list[UserDirectoryEntry]:
    available_columns = await get_users_table_columns()
    has_favorite_media = "favorite_media" in available_columns
    has_favorite_card_id = "favorite_card_id" in available_columns
    has_favorite_card_name = "favorite_card_name" in available_columns
    has_favorite_card_image_url = "favorite_card_image_url" in available_columns
    has_avatar_fit_mode = "avatar_fit_mode" in available_columns
    has_weapon_icon = "weapon_icon" in available_columns
    favorite_media_select = (
        "u.favorite_media"
        if has_favorite_media
        else "NULL::TEXT AS favorite_media"
    )
    favorite_card_id_select = (
        "u.favorite_card_id"
        if has_favorite_card_id
        else "NULL::TEXT AS favorite_card_id"
    )
    favorite_card_name_select = (
        "u.favorite_card_name"
        if has_favorite_card_name
        else "NULL::TEXT AS favorite_card_name"
    )
    favorite_card_image_url_select = (
        "u.favorite_card_image_url"
        if has_favorite_card_image_url
        else "NULL::TEXT AS favorite_card_image_url"
    )
    avatar_fit_mode_select = (
        "u.avatar_fit_mode"
        if has_avatar_fit_mode
        else "'cover'::TEXT AS avatar_fit_mode"
    )
    weapon_icon_select = (
        "u.weapon_icon"
        if has_weapon_icon
        else "NULL::TEXT AS weapon_icon"
    )
    favorite_media_group_by = ", u.favorite_media" if has_favorite_media else ""
    favorite_card_id_group_by = ", u.favorite_card_id" if has_favorite_card_id else ""
    favorite_card_name_group_by = ", u.favorite_card_name" if has_favorite_card_name else ""
    favorite_card_image_url_group_by = (
        ", u.favorite_card_image_url" if has_favorite_card_image_url else ""
    )
    avatar_fit_mode_group_by = ", u.avatar_fit_mode" if has_avatar_fit_mode else ""
    weapon_icon_group_by = ", u.weapon_icon" if has_weapon_icon else ""

    rows = await database.fetch_all(
        f"""
        SELECT
            u.id AS user_id,
            u.name AS user_name,
            u.avatar_url,
            {favorite_media_select},
            {favorite_card_id_select},
            {favorite_card_name_select},
            {favorite_card_image_url_select},
            {avatar_fit_mode_select},
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
            COALESCE(deck_counts.total_saved_decks, 0) AS total_saved_decks,
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
        LEFT JOIN LATERAL (
            SELECT COUNT(*) AS total_saved_decks
            FROM decks d_count
            WHERE d_count.user_id = u.id
        ) deck_counts ON TRUE
        LEFT JOIN season_points_ledger spl ON spl.user_id = u.id
        GROUP BY
            u.id,
            u.name,
            u.avatar_url,
            d.leader,
            deck_counts.total_saved_decks,
            active_pool.total_cards_active_season,
            career_pool.total_cards_career_pool
            {favorite_media_group_by}
            {favorite_card_id_group_by}
            {favorite_card_name_group_by}
            {favorite_card_image_url_group_by}
            {avatar_fit_mode_group_by}
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
