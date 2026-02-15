import os
import json
import asyncio
import time
from uuid import uuid4
from threading import Lock
from urllib.error import URLError, HTTPError
from urllib.parse import urlencode
from urllib.request import urlopen

import aiofiles
import aiofiles.os
import aiohttp

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from heliclockter import datetime_utc, timedelta
from starlette import status

from bracket.config import config
from bracket.logic.subscriptions import setup_demo_account
from bracket.models.db.account import UserAccountType
from bracket.models.db.user import (
    CardCatalogEntry,
    DemoUserToRegister,
    MediaCatalogEntry,
    UserDirectoryEntry,
    UserAccountTypeToUpdate,
    UserInsertable,
    UserPasswordToUpdate,
    UserPreferencesToUpdate,
    UserPublic,
    UserToRegister,
    UserToUpdate,
)
from bracket.routes.auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    Token,
    create_access_token,
    is_admin_user,
    user_authenticated,
)
from bracket.routes.models import (
    CardCatalogResponse,
    LeaguePlayerCareerProfileResponse,
    MediaCatalogResponse,
    SuccessResponse,
    TokenResponse,
    UserDirectoryResponse,
    UserPublicResponse,
    UsersResponse,
)
from bracket.sql.league import get_user_career_profile
from bracket.sql.users import (
    check_whether_email_is_in_use,
    create_user,
    get_user_directory,
    get_users,
    get_user_by_id,
    get_latest_leader_card_id_for_user,
    update_user_account_type,
    update_user_preferences,
    update_user,
    update_user_password,
)
from bracket.utils.id_types import UserId
from bracket.utils.league_cards import (
    DEFAULT_SWU_SET_CODES,
    fetch_swu_cards_cached,
    normalize_card_for_deckbuilding,
)
from bracket.utils.security import hash_password, verify_captcha_token
from bracket.utils.types import assert_some

router = APIRouter(prefix=config.api_prefix)

_STAR_WARS_MEDIA_FALLBACK: list[dict[str, str]] = [
    {"title": "Star Wars: Episode IV - A New Hope", "year": "1977", "media_type": "movie"},
    {"title": "Star Wars: Episode V - The Empire Strikes Back", "year": "1980", "media_type": "movie"},
    {"title": "Star Wars: Episode VI - Return of the Jedi", "year": "1983", "media_type": "movie"},
    {"title": "Star Wars: Episode I - The Phantom Menace", "year": "1999", "media_type": "movie"},
    {"title": "Star Wars: Episode II - Attack of the Clones", "year": "2002", "media_type": "movie"},
    {"title": "Star Wars: Episode III - Revenge of the Sith", "year": "2005", "media_type": "movie"},
    {"title": "Star Wars: The Clone Wars", "year": "2008", "media_type": "movie"},
    {"title": "Star Wars: The Force Awakens", "year": "2015", "media_type": "movie"},
    {"title": "Rogue One: A Star Wars Story", "year": "2016", "media_type": "movie"},
    {"title": "Star Wars: The Last Jedi", "year": "2017", "media_type": "movie"},
    {"title": "Solo: A Star Wars Story", "year": "2018", "media_type": "movie"},
    {"title": "Star Wars: The Rise of Skywalker", "year": "2019", "media_type": "movie"},
    {"title": "The Mandalorian", "year": "2019", "media_type": "series"},
    {"title": "The Book of Boba Fett", "year": "2021", "media_type": "series"},
    {"title": "Obi-Wan Kenobi", "year": "2022", "media_type": "series"},
    {"title": "Andor", "year": "2022", "media_type": "series"},
    {"title": "Ahsoka", "year": "2023", "media_type": "series"},
    {"title": "Skeleton Crew", "year": "2024", "media_type": "series"},
    {"title": "Star Wars: The Clone Wars", "year": "2008", "media_type": "series"},
    {"title": "Star Wars Rebels", "year": "2014", "media_type": "series"},
    {"title": "Star Wars Resistance", "year": "2018", "media_type": "series"},
    {"title": "Star Wars: The Bad Batch", "year": "2021", "media_type": "series"},
    {"title": "Tales of the Jedi", "year": "2022", "media_type": "series"},
    {"title": "Tales of the Empire", "year": "2024", "media_type": "series"},
    {"title": "Star Wars: Visions", "year": "2021", "media_type": "series"},
    {"title": "Star Wars Jedi: Fallen Order", "year": "2019", "media_type": "game"},
    {"title": "Star Wars Jedi: Survivor", "year": "2023", "media_type": "game"},
    {"title": "Star Wars: Knights of the Old Republic", "year": "2003", "media_type": "game"},
    {"title": "Star Wars: Knights of the Old Republic II", "year": "2004", "media_type": "game"},
    {"title": "Star Wars: The Old Republic", "year": "2011", "media_type": "game"},
    {"title": "LEGO Star Wars: The Skywalker Saga", "year": "2022", "media_type": "game"},
    {"title": "Star Wars Outlaws", "year": "2024", "media_type": "game"},
    {"title": "Star Wars Battlefront II", "year": "2017", "media_type": "game"},
    {"title": "Star Wars: Squadrons", "year": "2020", "media_type": "game"},
    {"title": "The Acolyte", "year": "2024", "media_type": "series"},
    {"title": "Caravan of Courage: An Ewok Adventure", "year": "1984", "media_type": "movie"},
    {"title": "Ewoks: The Battle for Endor", "year": "1985", "media_type": "movie"},
    {"title": "The Star Wars Holiday Special", "year": "1978", "media_type": "movie"},
    {"title": "Star Wars: Droids", "year": "1985", "media_type": "series"},
    {"title": "Ewoks", "year": "1985", "media_type": "series"},
    {"title": "Clone Wars", "year": "2003", "media_type": "series"},
    {"title": "Star Wars: Forces of Destiny", "year": "2017", "media_type": "series"},
    {"title": "Star Wars: Young Jedi Adventures", "year": "2023", "media_type": "series"},
    {"title": "LEGO Star Wars: Rebuild the Galaxy", "year": "2024", "media_type": "series"},
    {"title": "LEGO Star Wars: Terrifying Tales", "year": "2021", "media_type": "movie"},
    {"title": "LEGO Star Wars: Summer Vacation", "year": "2022", "media_type": "movie"},
    {"title": "The LEGO Star Wars Holiday Special", "year": "2020", "media_type": "movie"},
    {"title": "LEGO Star Wars: Droid Tales", "year": "2015", "media_type": "series"},
    {"title": "LEGO Star Wars: The Yoda Chronicles", "year": "2013", "media_type": "series"},
    {"title": "Star Wars: Republic Commando", "year": "2005", "media_type": "game"},
    {"title": "Star Wars: Empire at War", "year": "2006", "media_type": "game"},
    {"title": "Star Wars: Dark Forces", "year": "1995", "media_type": "game"},
    {"title": "Star Wars Jedi Knight: Dark Forces II", "year": "1997", "media_type": "game"},
    {"title": "Star Wars Jedi Knight II: Jedi Outcast", "year": "2002", "media_type": "game"},
    {"title": "Star Wars Jedi Knight: Jedi Academy", "year": "2003", "media_type": "game"},
    {"title": "Star Wars: Rogue Squadron", "year": "1998", "media_type": "game"},
    {"title": "Star Wars: Bounty Hunter", "year": "2002", "media_type": "game"},
    {"title": "Star Wars: Racer Revenge", "year": "2002", "media_type": "game"},
    {"title": "Star Wars Battlefront", "year": "2004", "media_type": "game"},
    {"title": "Star Wars Battlefront II", "year": "2005", "media_type": "game"},
]

_CARD_CATALOG_CACHE_LOCK = Lock()
_CARD_CATALOG_CACHE: tuple[float, list[dict]] | None = None
_CARD_CATALOG_CACHE_TTL_S = 1800
_SWAPI_FILMS_CACHE_LOCK = asyncio.Lock()
_SWAPI_FILMS_CACHE: tuple[float, list[MediaCatalogEntry]] | None = None
_SWAPI_FILMS_CACHE_TTL_S = 21600


def _get_cached_normalized_card_catalog() -> list[dict]:
    global _CARD_CATALOG_CACHE
    now = time.monotonic()
    cached = _CARD_CATALOG_CACHE
    if cached is not None and now - cached[0] < _CARD_CATALOG_CACHE_TTL_S:
        return cached[1]

    with _CARD_CATALOG_CACHE_LOCK:
        cached = _CARD_CATALOG_CACHE
        now = time.monotonic()
        if cached is not None and now - cached[0] < _CARD_CATALOG_CACHE_TTL_S:
            return cached[1]

        raw_cards = fetch_swu_cards_cached(
            DEFAULT_SWU_SET_CODES,
            timeout_s=12,
            cache_ttl_s=_CARD_CATALOG_CACHE_TTL_S,
        )
        normalized = [normalize_card_for_deckbuilding(card) for card in raw_cards]
        normalized.sort(
            key=lambda card: (
                str(card.get("name", "")).lower(),
                str(card.get("character_variant", "")).lower(),
                str(card.get("card_id", "")).lower(),
            )
        )
        _CARD_CATALOG_CACHE = (time.monotonic(), normalized)
        return normalized


@router.get("/users", response_model=UsersResponse)
async def list_users(user_public: UserPublic = Depends(user_authenticated)) -> UsersResponse:
    if not is_admin_user(user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    return UsersResponse(data=await get_users())


@router.get("/users/directory", response_model=UserDirectoryResponse)
async def list_user_directory(_: UserPublic = Depends(user_authenticated)) -> UserDirectoryResponse:
    try:
        entries = await get_user_directory()
    except Exception:
        fallback_users = await get_users()
        return UserDirectoryResponse(
            data=[
                UserDirectoryEntry(
                    user_id=user.id,
                    user_name=user.name,
                    avatar_url=user.avatar_url,
                    tournaments_won=0,
                    tournaments_placed=0,
                    total_cards_active_season=0,
                    total_cards_career_pool=0,
                    favorite_media=user.favorite_media,
                    current_leader_card_id=None,
                    current_leader_name=None,
                    current_leader_image_url=None,
                    weapon_icon=user.weapon_icon,
                )
                for user in fallback_users
            ]
        )

    leader_ids = sorted(
        {
            entry.current_leader_card_id.lower()
            for entry in entries
            if entry.current_leader_card_id is not None and entry.current_leader_card_id != ""
        }
    )
    card_lookup: dict[str, dict] = {}
    if len(leader_ids) > 0:
        set_codes = sorted(
            {
                leader_id.split("-", 1)[0].strip().lower()
                for leader_id in leader_ids
                if "-" in leader_id and leader_id.split("-", 1)[0].strip() != ""
            }
        )
        if len(set_codes) > 0:
            try:
                raw_cards = await asyncio.to_thread(
                    fetch_swu_cards_cached,
                    set_codes,
                    10,
                    900,
                )
                cards = [normalize_card_for_deckbuilding(card) for card in raw_cards]
                card_lookup = {str(card["card_id"]).lower(): card for card in cards}
            except Exception:
                card_lookup = {}

    result: list[UserDirectoryEntry] = []
    for entry in entries:
        leader_id = None if entry.current_leader_card_id is None else entry.current_leader_card_id.lower()
        leader_card = card_lookup.get(leader_id) if leader_id is not None else None
        avatar_url = entry.avatar_url
        if (avatar_url is None or avatar_url == "") and leader_card is not None:
            avatar_url = leader_card.get("image_url")
        result.append(
            UserDirectoryEntry(
                user_id=entry.user_id,
                user_name=entry.user_name,
                avatar_url=avatar_url,
                tournaments_won=entry.tournaments_won,
                tournaments_placed=entry.tournaments_placed,
                total_cards_active_season=entry.total_cards_active_season,
                total_cards_career_pool=entry.total_cards_career_pool,
                favorite_media=entry.favorite_media,
                current_leader_card_id=entry.current_leader_card_id,
                current_leader_name=None if leader_card is None else str(leader_card.get("name") or ""),
                current_leader_image_url=None if leader_card is None else leader_card.get("image_url"),
                weapon_icon=entry.weapon_icon,
            )
        )
    return UserDirectoryResponse(data=result)


@router.get("/users/card_catalog", response_model=CardCatalogResponse)
async def get_card_catalog(
    _: UserPublic = Depends(user_authenticated),
    query: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> CardCatalogResponse:
    normalized_query = (query or "").strip().lower()
    if normalized_query == "":
        return CardCatalogResponse(data=[])

    try:
        cards = await asyncio.to_thread(_get_cached_normalized_card_catalog)
    except (URLError, HTTPError, TimeoutError, ValueError, OSError):
        return CardCatalogResponse(data=[])
    filtered = [
        card
        for card in cards
        if normalized_query == ""
        or normalized_query in str(card.get("name", "")).lower()
        or normalized_query in str(card.get("character_variant", "")).lower()
        or normalized_query in str(card.get("card_id", "")).lower()
    ]
    return CardCatalogResponse(
        data=[
            CardCatalogEntry(
                card_id=str(card.get("card_id", "")),
                name=str(card.get("name", "")),
                character_variant=(
                    str(card.get("character_variant", "")).strip() or None
                ),
                set_code=str(card.get("set_code", "")),
                image_url=card.get("image_url"),
            )
            for card in filtered[:limit]
        ]
    )


def _search_star_wars_media_fallback(query: str, limit: int) -> list[MediaCatalogEntry]:
    normalized_query = query.strip().lower()
    results = []
    for item in _STAR_WARS_MEDIA_FALLBACK:
        title = item["title"]
        media_type = item["media_type"]
        year = item["year"]
        if normalized_query != "" and normalized_query not in title.lower():
            continue
        results.append(
            MediaCatalogEntry(
                title=title,
                year=year,
                media_type=media_type,
                imdb_id=None,
                poster_url=None,
            )
        )
    return results[:limit]


async def _fetch_swapi_films() -> list[MediaCatalogEntry]:
    entries: list[MediaCatalogEntry] = []
    next_url: str | None = "https://swapi.dev/api/films/"
    timeout = aiohttp.ClientTimeout(total=6)

    async with aiohttp.ClientSession(timeout=timeout) as session:
        while next_url is not None and next_url != "":
            async with session.get(next_url) as response:
                if response.status != 200:
                    break
                payload = await response.json()

            results = payload.get("results", [])
            if not isinstance(results, list):
                break

            for item in results:
                if not isinstance(item, dict):
                    continue
                title = str(item.get("title", "")).strip()
                if title == "":
                    continue
                release_date = str(item.get("release_date", "")).strip()
                year = release_date[:4] if len(release_date) >= 4 else None
                resource_url = str(item.get("url", "")).strip() or None
                entries.append(
                    MediaCatalogEntry(
                        title=title,
                        year=year,
                        media_type="movie",
                        imdb_id=resource_url,
                        poster_url=None,
                    )
                )

            next_field = payload.get("next")
            next_url = str(next_field).strip() if isinstance(next_field, str) else None

    entries.sort(key=lambda entry: (str(entry.year or ""), str(entry.title).lower()))
    return entries


async def _get_swapi_films_cached() -> list[MediaCatalogEntry]:
    global _SWAPI_FILMS_CACHE
    now = time.monotonic()
    cached = _SWAPI_FILMS_CACHE
    if cached is not None and now - cached[0] < _SWAPI_FILMS_CACHE_TTL_S:
        return cached[1]

    async with _SWAPI_FILMS_CACHE_LOCK:
        now = time.monotonic()
        cached = _SWAPI_FILMS_CACHE
        if cached is not None and now - cached[0] < _SWAPI_FILMS_CACHE_TTL_S:
            return cached[1]

        try:
            films = await _fetch_swapi_films()
        except (aiohttp.ClientError, TimeoutError, ValueError, OSError):
            films = []

        _SWAPI_FILMS_CACHE = (time.monotonic(), films)
        return films


def _search_star_wars_media_omdb(query: str, limit: int) -> list[MediaCatalogEntry]:
    if config.omdb_api_key is None or config.omdb_api_key.strip() == "":
        return _search_star_wars_media_fallback(query, limit)

    normalized_query = query.strip().lower()
    if normalized_query == "":
        return _search_star_wars_media_fallback(query, limit)
    search_terms = (
        [f"star wars {normalized_query}".strip()]
        if normalized_query != ""
        else ["star wars"]
    )
    pages_per_term = 1

    def search_omdb_page(search_term: str, page: int) -> list[dict]:
        params = urlencode(
            {"apikey": config.omdb_api_key.strip(), "s": search_term, "page": str(page)}
        )
        url = f"https://www.omdbapi.com/?{params}"
        with urlopen(url, timeout=10) as response:  # noqa: S310 controlled host
            payload = json.loads(response.read().decode("utf-8"))
        items = payload.get("Search", [])
        return items if isinstance(items, list) else []

    entries: list[MediaCatalogEntry] = []
    dedupe_keys: set[str] = set()
    try:
        for term in search_terms:
            for page in range(1, pages_per_term + 1):
                items = search_omdb_page(term, page)
                if len(items) < 1:
                    break
                for item in items:
                    title = str(item.get("Title", "")).strip()
                    if title == "":
                        continue
                    if normalized_query != "" and normalized_query not in title.lower():
                        continue

                    media_type = str(item.get("Type", "")).strip().lower() or None
                    imdb_id = str(item.get("imdbID", "")).strip() or None
                    dedupe_key = imdb_id or f"{title.lower()}::{str(item.get('Year', '')).strip()}::{media_type or ''}"
                    if dedupe_key in dedupe_keys:
                        continue
                    dedupe_keys.add(dedupe_key)

                    entries.append(
                        MediaCatalogEntry(
                            title=title,
                            year=str(item.get("Year", "")).strip() or None,
                            media_type=media_type,
                            imdb_id=imdb_id,
                            poster_url=str(item.get("Poster", "")).strip() or None,
                        )
                    )
    except (URLError, HTTPError, TimeoutError, ValueError, OSError):
        return _search_star_wars_media_fallback(query, limit)

    filtered = [
        entry
        for entry in entries
        if entry.media_type is None or entry.media_type in {"movie", "series", "game"}
    ]
    filtered.sort(
        key=lambda entry: (
            str(entry.media_type or ""),
            str(entry.title).lower(),
            str(entry.year or ""),
        )
    )

    if len(filtered) < 1:
        return _search_star_wars_media_fallback(query, limit)
    return filtered[:limit]


@router.get("/users/media_catalog", response_model=MediaCatalogResponse)
async def get_media_catalog(
    _: UserPublic = Depends(user_authenticated),
    query: str | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
) -> MediaCatalogResponse:
    normalized_query = (query or "").strip().lower()
    if normalized_query == "":
        return MediaCatalogResponse(data=_search_star_wars_media_fallback("", limit))

    fallback = _search_star_wars_media_fallback(normalized_query, max(limit * 4, 100))
    swapi_films = await _get_swapi_films_cached()
    filtered_swapi_films = [
        entry
        for entry in swapi_films
        if normalized_query == "" or normalized_query in str(entry.title).lower()
    ]

    media_type_order = {"movie": 0, "series": 1, "game": 2}
    combined: list[MediaCatalogEntry] = []
    seen_keys: set[str] = set()
    for entry in [*filtered_swapi_films, *fallback]:
        key = f"{str(entry.title).strip().lower()}::{str(entry.year or '').strip()}::{str(entry.media_type or '').strip().lower()}"
        if key in seen_keys:
            continue
        seen_keys.add(key)
        combined.append(entry)

    combined.sort(
        key=lambda entry: (
            media_type_order.get(str(entry.media_type or "").lower(), 99),
            str(entry.title).lower(),
            str(entry.year or ""),
        )
    )
    return MediaCatalogResponse(data=combined[:limit])


@router.get("/users/me", response_model=UserPublicResponse)
async def get_user(user_public: UserPublic = Depends(user_authenticated)) -> UserPublicResponse:
    leader_card_id = await get_latest_leader_card_id_for_user(user_public.id)
    return UserPublicResponse(
        data=user_public.model_copy(update={"current_leader_card_id": leader_card_id})
    )


@router.get("/users/{user_id}", response_model=UserPublicResponse)
async def get_me(
    user_id: UserId, user_public: UserPublic = Depends(user_authenticated)
) -> UserPublicResponse:
    if user_public.id != user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Can't view details of this user")

    return UserPublicResponse(data=user_public)


@router.put("/users/{user_id}", response_model=UserPublicResponse)
async def update_user_details(
    user_id: UserId,
    user_to_update: UserToUpdate,
    user_public: UserPublic = Depends(user_authenticated),
) -> UserPublicResponse:
    if user_public.id != user_id and not is_admin_user(user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Can't change details of this user")

    await update_user(user_id, user_to_update)
    user_updated = await get_user_by_id(user_id)
    return UserPublicResponse(data=assert_some(user_updated))


@router.put("/users/{user_id}/password", response_model=SuccessResponse)
async def put_user_password(
    user_id: UserId,
    user_to_update: UserPasswordToUpdate,
    user_public: UserPublic = Depends(user_authenticated),
) -> SuccessResponse:
    if user_public.id != user_id and not is_admin_user(user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Can't change details of this user")
    await update_user_password(user_id, hash_password(user_to_update.password))
    return SuccessResponse()


@router.put("/users/{user_id}/account_type", response_model=SuccessResponse)
async def put_user_account_type(
    user_id: UserId,
    user_to_update: UserAccountTypeToUpdate,
    user_public: UserPublic = Depends(user_authenticated),
) -> SuccessResponse:
    if not is_admin_user(user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    await update_user_account_type(user_id, user_to_update.account_type)
    return SuccessResponse()


@router.put("/users/{user_id}/preferences", response_model=SuccessResponse)
async def put_user_preferences(
    user_id: UserId,
    body: UserPreferencesToUpdate,
    user_public: UserPublic = Depends(user_authenticated),
) -> SuccessResponse:
    if user_public.id != user_id and not is_admin_user(user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Can't change details of this user")
    await update_user_preferences(user_id, body)
    return SuccessResponse()


@router.post("/users/{user_id}/avatar", response_model=UserPublicResponse)
async def upload_user_avatar(
    user_id: UserId,
    file: UploadFile | None = None,
    user_public: UserPublic = Depends(user_authenticated),
) -> UserPublicResponse:
    if user_public.id != user_id and not is_admin_user(user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Can't change details of this user")

    user = await get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    old_avatar = user.avatar_url
    new_avatar: str | None = None

    if file is not None:
        assert file.filename is not None
        extension = os.path.splitext(file.filename)[1].lower()
        if extension not in (".png", ".jpg", ".jpeg", ".webp"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Avatar must be png, jpg, jpeg, or webp")

        filename = f"{uuid4()}{extension}"
        new_avatar = f"static/user-avatars/{filename}"
        await aiofiles.os.makedirs("static/user-avatars", exist_ok=True)
        async with aiofiles.open(new_avatar, "wb") as f:
            await f.write(await file.read())

    await update_user_preferences(
        user_id,
        UserPreferencesToUpdate(
            avatar_url=new_avatar,
            favorite_card_id=user.favorite_card_id,
            favorite_card_name=user.favorite_card_name,
            favorite_card_image_url=user.favorite_card_image_url,
            favorite_media=user.favorite_media,
            weapon_icon=user.weapon_icon,
        ),
    )

    if (
        old_avatar is not None
        and old_avatar.startswith("static/user-avatars/")
        and old_avatar != new_avatar
    ):
        try:
            await aiofiles.os.remove(old_avatar)
        except Exception:
            pass

    updated = await get_user_by_id(user_id)
    return UserPublicResponse(data=assert_some(updated))


@router.get("/users/{user_id}/career", response_model=LeaguePlayerCareerProfileResponse)
async def get_user_career(
    user_id: UserId,
    _: UserPublic = Depends(user_authenticated),
) -> LeaguePlayerCareerProfileResponse:
    profile = await get_user_career_profile(user_id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return LeaguePlayerCareerProfileResponse(data=profile)


@router.post("/users/register", response_model=TokenResponse)
async def register_user(user_to_register: UserToRegister) -> TokenResponse:
    if not config.allow_user_registration:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account creation is unavailable for now")

    if not await verify_captcha_token(user_to_register.captcha_token):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Failed to validate captcha")

    user = UserInsertable(
        email=user_to_register.email,
        password_hash=hash_password(user_to_register.password),
        name=user_to_register.name,
        created=datetime_utc.now(),
        account_type=UserAccountType.REGULAR,
    )
    if await check_whether_email_is_in_use(user.email):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email address already in use")

    user_created = await create_user(user)
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"user": user_created.email}, expires_delta=access_token_expires
    )
    return TokenResponse(
        data=Token(access_token=access_token, token_type="bearer", user_id=user_created.id)
    )


@router.post("/users/register_demo", response_model=TokenResponse)
async def register_demo_user(user_to_register: DemoUserToRegister) -> TokenResponse:
    if not config.allow_demo_user_registration:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Demo account creation is unavailable for now"
        )

    if not await verify_captcha_token(user_to_register.captcha_token):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Failed to validate captcha")

    username = f"demo-{uuid4()}"
    user = UserInsertable(
        email=f"{username}@example.org",
        password_hash=hash_password(str(uuid4())),
        name=username,
        created=datetime_utc.now(),
        account_type=UserAccountType.DEMO,
    )
    if await check_whether_email_is_in_use(user.email):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email address already in use")

    user_created = await create_user(user)
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"user": user_created.email}, expires_delta=access_token_expires
    )
    await setup_demo_account(user_created.id)
    return TokenResponse(
        data=Token(access_token=access_token, token_type="bearer", user_id=user_created.id)
    )
