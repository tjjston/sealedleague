from __future__ import annotations

from typing import TYPE_CHECKING, Annotated

from heliclockter import datetime_utc
from pydantic import BaseModel, Field, StringConstraints

from bracket.models.db.account import UserAccountType
from bracket.models.db.shared import BaseModelORM
from bracket.utils.id_types import UserId

if TYPE_CHECKING:
    from bracket.logic.subscriptions import Subscription


class UserBase(BaseModelORM):
    email: str
    name: str
    created: datetime_utc
    avatar_url: str | None = None
    favorite_card_id: str | None = None
    favorite_card_name: str | None = None
    favorite_card_image_url: str | None = None
    favorite_media: str | None = None
    avatar_fit_mode: str | None = None
    weapon_icon: str | None = None
    current_leader_card_id: str | None = None
    current_leader_name: str | None = None
    current_leader_image_url: str | None = None
    current_leader_aspects: list[str] = Field(default_factory=list)
    account_type: UserAccountType

    @property
    def subscription(self) -> Subscription:
        from bracket.logic.subscriptions import subscription_lookup

        return subscription_lookup[self.account_type]


class UserInsertable(UserBase):
    password_hash: str | None = None


class User(UserBase):
    id: UserId
    password_hash: str | None = None


class UserPublic(UserBase):
    id: UserId


class UserToUpdate(BaseModel):
    email: str
    name: str


class UserPreferencesToUpdate(BaseModel):
    avatar_url: str | None = None
    avatar_fit_mode: str | None = None
    favorite_card_id: str | None = None
    favorite_card_name: str | None = None
    favorite_card_image_url: str | None = None
    favorite_media: str | None = None
    weapon_icon: str | None = None


class UserPasswordToUpdate(BaseModel):
    password: Annotated[str, StringConstraints(min_length=8, max_length=48)]


class UserAccountTypeToUpdate(BaseModel):
    account_type: UserAccountType


class DemoUserToRegister(BaseModelORM):
    captcha_token: str


class UserToRegister(BaseModelORM):
    email: str
    name: str
    password: str
    captcha_token: str


class AdminUserToCreate(BaseModelORM):
    email: str
    name: str
    password: Annotated[str, StringConstraints(min_length=8, max_length=48)]
    account_type: UserAccountType = UserAccountType.REGULAR


class UserInDB(UserBase):
    id: UserId
    password_hash: str


class CardCatalogEntry(BaseModelORM):
    card_id: str
    name: str
    character_variant: str | None = None
    variant_type: str | None = None
    set_code: str
    image_url: str | None = None


class MediaCatalogEntry(BaseModelORM):
    title: str
    year: str | None = None
    media_type: str | None = None
    imdb_id: str | None = None
    poster_url: str | None = None


class UserCardPoolSummaryEntry(BaseModelORM):
    card_id: str
    name: str | None = None
    character_variant: str | None = None
    set_code: str | None = None
    image_url: str | None = None
    quantity: int = 0


class UserDirectoryEntry(BaseModelORM):
    user_id: UserId
    user_name: str
    avatar_url: str | None = None
    tournaments_won: int = 0
    tournaments_placed: int = 0
    total_saved_decks: int = 0
    total_cards_active_season: int = 0
    total_cards_career_pool: int = 0
    favorite_media: str | None = None
    favorite_card_id: str | None = None
    favorite_card_name: str | None = None
    favorite_card_image_url: str | None = None
    avatar_fit_mode: str | None = None
    current_leader_card_id: str | None = None
    current_leader_name: str | None = None
    current_leader_image_url: str | None = None
    weapon_icon: str | None = None
