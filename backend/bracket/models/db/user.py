from __future__ import annotations

from typing import TYPE_CHECKING, Annotated

from heliclockter import datetime_utc
from pydantic import BaseModel, StringConstraints

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
    favorite_card_id: str | None = None
    favorite_card_name: str | None = None
    favorite_card_image_url: str | None = None
    favorite_media: str | None = None


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


class UserInDB(UserBase):
    id: UserId
    password_hash: str


class CardCatalogEntry(BaseModelORM):
    card_id: str
    name: str
    character_variant: str | None = None
    set_code: str
    image_url: str | None = None


class UserDirectoryEntry(BaseModelORM):
    user_id: UserId
    user_name: str
    avatar_url: str | None = None
    tournaments_won: int = 0
    tournaments_placed: int = 0
    favorite_media: str | None = None
    current_leader_card_id: str | None = None
    current_leader_name: str | None = None
    current_leader_image_url: str | None = None
