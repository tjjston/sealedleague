from enum import auto

from heliclockter import datetime_utc

from bracket.models.db.shared import BaseModelORM
from bracket.utils.id_types import (
    CardPoolEntryId,
    DeckId,
    SeasonId,
    SeasonMembershipId,
    SeasonPointsLedgerId,
    TournamentId,
    UserId,
)
from bracket.utils.types import EnumAutoStr


class SeasonMembershipRole(EnumAutoStr):
    PLAYER = auto()
    ADMIN = auto()


class SeasonInsertable(BaseModelORM):
    tournament_id: TournamentId
    name: str
    created: datetime_utc
    start_time: datetime_utc | None = None
    end_time: datetime_utc | None = None
    is_active: bool = True


class Season(SeasonInsertable):
    id: SeasonId


class SeasonMembershipInsertable(BaseModelORM):
    season_id: SeasonId
    user_id: UserId
    role: SeasonMembershipRole = SeasonMembershipRole.PLAYER
    can_manage_points: bool = False
    can_manage_tournaments: bool = False
    created: datetime_utc


class SeasonMembership(SeasonMembershipInsertable):
    id: SeasonMembershipId


class SeasonPointsLedgerInsertable(BaseModelORM):
    season_id: SeasonId
    user_id: UserId
    changed_by_user_id: UserId | None = None
    tournament_id: TournamentId | None = None
    points_delta: float
    reason: str | None = None
    created: datetime_utc


class SeasonPointsLedger(SeasonPointsLedgerInsertable):
    id: SeasonPointsLedgerId


class CardPoolEntryInsertable(BaseModelORM):
    season_id: SeasonId
    user_id: UserId
    card_id: str
    quantity: int
    created: datetime_utc


class CardPoolEntry(CardPoolEntryInsertable):
    id: CardPoolEntryId


class DeckInsertable(BaseModelORM):
    season_id: SeasonId
    user_id: UserId
    tournament_id: TournamentId | None = None
    name: str
    leader: str
    base: str
    mainboard: dict[str, int]
    sideboard: dict[str, int]
    created: datetime_utc
    updated: datetime_utc


class Deck(DeckInsertable):
    id: DeckId
