import json

from pydantic import BaseModel, Field, field_validator

from bracket.models.db.account import UserAccountType
from bracket.models.db.league import SeasonMembershipRole
from bracket.utils.id_types import DeckId, TournamentId, UserId


class LeagueDeckUpsertBody(BaseModel):
    user_id: UserId | None = None
    tournament_id: TournamentId | None = None
    season_id: int | None = None
    name: str
    leader: str
    base: str
    leader_image_url: str | None = None
    mainboard: dict[str, int] = Field(default_factory=dict)
    sideboard: dict[str, int] = Field(default_factory=dict)

    @field_validator("mainboard", "sideboard", mode="before")
    @classmethod
    def sanitize_board(cls, value: object) -> dict[str, int]:
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except (TypeError, ValueError):
                return {}
        if not isinstance(value, dict):
            return {}

        sanitized: dict[str, int] = {}
        for card_id, count in value.items():
            try:
                normalized_count = int(count)
            except (TypeError, ValueError):
                continue
            if normalized_count > 0:
                sanitized[str(card_id)] = normalized_count
        return sanitized


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


class LeagueParticipantSubmissionBody(BaseModel):
    participant_name: str | None = None
    season_id: int | None = None
    deck_name: str
    leader: str
    base: str
    leader_image_url: str | None = None
    mainboard: dict[str, int] = Field(default_factory=dict)
    sideboard: dict[str, int] = Field(default_factory=dict)

    @field_validator("mainboard", "sideboard", mode="before")
    @classmethod
    def sanitize_submission_board(cls, value: object) -> dict[str, int]:
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except (TypeError, ValueError):
                return {}
        if not isinstance(value, dict):
            return {}

        sanitized: dict[str, int] = {}
        for card_id, count in value.items():
            try:
                normalized_count = int(count)
            except (TypeError, ValueError):
                continue
            if normalized_count > 0:
                sanitized[str(card_id)] = normalized_count
        return sanitized


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

    @field_validator("mainboard", "sideboard", mode="before")
    @classmethod
    def parse_json_boards(cls, value: object) -> dict[str, int]:
        if isinstance(value, dict):
            return {str(key): int(count) for key, count in value.items()}
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, dict):
                    return {str(key): int(count) for key, count in parsed.items()}
            except (TypeError, ValueError):
                return {}
        return {}


class LeagueStandingsRow(BaseModel):
    user_id: UserId
    user_name: str
    user_email: str
    points: float = 0
    tournament_wins: int = 0
    tournament_placements: int = 0
    prize_packs: int = 0
    accolades: list[str] = Field(default_factory=list)
    role: SeasonMembershipRole | None = None
    can_manage_points: bool = False
    can_manage_tournaments: bool = False


class LeagueSeasonStandingsView(BaseModel):
    season_id: int
    season_name: str
    is_active: bool
    standings: list[LeagueStandingsRow] = Field(default_factory=list)


class LeagueSeasonHistoryView(BaseModel):
    seasons: list[LeagueSeasonStandingsView] = Field(default_factory=list)
    cumulative: list[LeagueStandingsRow] = Field(default_factory=list)


class LeagueAdminUserView(BaseModel):
    user_id: UserId
    user_name: str
    user_email: str
    account_type: UserAccountType
    role: SeasonMembershipRole | None = None
    can_manage_points: bool = False
    can_manage_tournaments: bool = False


class LeagueSeasonCreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    is_active: bool = False
    tournament_ids: list[TournamentId] = Field(default_factory=list)


class LeagueSeasonUpdateBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None
    tournament_ids: list[TournamentId] | None = None


class LeagueSeasonAdminView(BaseModel):
    season_id: int
    name: str
    is_active: bool
    tournament_ids: list[TournamentId] = Field(default_factory=list)


class LeagueSeasonPointAdjustmentBody(BaseModel):
    points_delta: float
    reason: str | None = None


class LeagueTournamentApplicationBody(BaseModel):
    season_id: int | None = None
    deck_id: DeckId | None = None
    participant_name: str | None = None
    leader_image_url: str | None = None


class LeagueTournamentApplicationView(BaseModel):
    user_id: UserId
    user_name: str
    user_email: str
    tournament_id: TournamentId
    season_id: int | None = None
    deck_id: DeckId | None = None
    status: str
