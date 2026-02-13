from pydantic import BaseModel, Field

from bracket.models.db.account import UserAccountType
from bracket.models.db.league import SeasonMembershipRole
from bracket.utils.id_types import DeckId, TournamentId, UserId


class LeagueDeckUpsertBody(BaseModel):
    user_id: UserId | None = None
    tournament_id: TournamentId | None = None
    name: str
    leader: str
    base: str
    leader_image_url: str | None = None
    mainboard: dict[str, int] = Field(default_factory=dict)
    sideboard: dict[str, int] = Field(default_factory=dict)


class LeagueDeckImportCard(BaseModel):
    id: str
    count: int = Field(ge=1, le=99)


class LeagueDeckImportSwuDbBody(BaseModel):
    user_id: UserId | None = None
    name: str
    leader: str
    base: str
    deck: list[LeagueDeckImportCard] = Field(default_factory=list)
    sideboard: list[LeagueDeckImportCard] = Field(default_factory=list)


class LeaguePointsImportRow(BaseModel):
    user_email: str
    points_delta: float
    reason: str | None = None


class LeaguePointsImportBody(BaseModel):
    rows: list[LeaguePointsImportRow] = Field(default_factory=list)


class LeagueCardPoolUpdateBody(BaseModel):
    user_id: UserId | None = None
    card_id: str
    quantity: int = Field(ge=0, le=99)


class LeagueSeasonPrivilegesUpdateBody(BaseModel):
    role: SeasonMembershipRole = SeasonMembershipRole.PLAYER
    can_manage_points: bool = False
    can_manage_tournaments: bool = False


class LeagueAwardAccoladeBody(BaseModel):
    accolade: str = Field(min_length=1, max_length=120)
    notes: str | None = Field(default=None, max_length=280)


class LeagueCardPoolEntryView(BaseModel):
    user_id: UserId
    card_id: str
    quantity: int


class LeagueDeckView(BaseModel):
    id: DeckId
    season_id: int
    user_id: UserId
    user_name: str
    user_email: str
    tournament_id: TournamentId | None = None
    name: str
    leader: str
    base: str
    mainboard: dict[str, int] = Field(default_factory=dict)
    sideboard: dict[str, int] = Field(default_factory=dict)


class LeagueStandingsRow(BaseModel):
    user_id: UserId
    user_name: str
    user_email: str
    points: float = 0
    accolades: list[str] = Field(default_factory=list)
    role: SeasonMembershipRole | None = None
    can_manage_points: bool = False
    can_manage_tournaments: bool = False


class LeagueAdminUserView(BaseModel):
    user_id: UserId
    user_name: str
    user_email: str
    account_type: UserAccountType
    role: SeasonMembershipRole | None = None
    can_manage_points: bool = False
    can_manage_tournaments: bool = False
