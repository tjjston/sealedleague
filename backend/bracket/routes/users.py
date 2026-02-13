import os
from uuid import uuid4

import aiofiles
import aiofiles.os

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from heliclockter import datetime_utc, timedelta
from starlette import status

from bracket.config import config
from bracket.logic.subscriptions import setup_demo_account
from bracket.models.db.account import UserAccountType
from bracket.models.db.user import (
    CardCatalogEntry,
    DemoUserToRegister,
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


@router.get("/users", response_model=UsersResponse)
async def list_users(user_public: UserPublic = Depends(user_authenticated)) -> UsersResponse:
    if not is_admin_user(user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    return UsersResponse(data=await get_users())


@router.get("/users/directory", response_model=UserDirectoryResponse)
async def list_user_directory(_: UserPublic = Depends(user_authenticated)) -> UserDirectoryResponse:
    entries = await get_user_directory()
    leader_ids = sorted(
        {
            entry.current_leader_card_id.lower()
            for entry in entries
            if entry.current_leader_card_id is not None and entry.current_leader_card_id != ""
        }
    )
    card_lookup: dict[str, dict] = {}
    if len(leader_ids) > 0:
        cards = [normalize_card_for_deckbuilding(card) for card in fetch_swu_cards_cached(DEFAULT_SWU_SET_CODES)]
        card_lookup = {str(card["card_id"]).lower(): card for card in cards}

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
                favorite_media=entry.favorite_media,
                current_leader_card_id=entry.current_leader_card_id,
                current_leader_name=None if leader_card is None else str(leader_card.get("name") or ""),
                current_leader_image_url=None if leader_card is None else leader_card.get("image_url"),
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
    cards = [normalize_card_for_deckbuilding(card) for card in fetch_swu_cards_cached(DEFAULT_SWU_SET_CODES)]
    filtered = [
        card
        for card in cards
        if normalized_query == ""
        or normalized_query in str(card.get("name", "")).lower()
        or normalized_query in str(card.get("character_variant", "")).lower()
        or normalized_query in str(card.get("card_id", "")).lower()
    ]
    filtered.sort(key=lambda card: str(card.get("name", "")).lower())
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


@router.get("/users/me", response_model=UserPublicResponse)
async def get_user(user_public: UserPublic = Depends(user_authenticated)) -> UserPublicResponse:
    return UserPublicResponse(data=user_public)


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
