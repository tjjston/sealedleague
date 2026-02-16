import json
from typing import Literal

from heliclockter import datetime_utc
from pydantic import BaseModel, Field, field_validator

from bracket.models.db.account import UserAccountType
from bracket.models.db.league import SeasonMembershipRole
from bracket.utils.id_types import DeckId, MatchId, TournamentId, UserId


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
    season_id: int | None = None
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
    season_id: int | None = None
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
    tournaments_submitted: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0
    matches: int = 0
    win_percentage: float = 0

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


class LeagueUpcomingOpponentView(BaseModel):
    tournament_id: TournamentId
    match_id: MatchId
    stage_item_name: str | None = None
    start_time: datetime_utc | None = None
    court_name: str | None = None
    my_team_name: str | None = None
    opponent_team_name: str | None = None


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


class LeagueRecalculateView(BaseModel):
    success: bool = True
    recalculated_at: str
    duration_ms: int = 0


class LeagueAdminUserView(BaseModel):
    user_id: UserId
    user_name: str
    user_email: str
    account_type: UserAccountType
    role: SeasonMembershipRole | None = None
    can_manage_points: bool = False
    can_manage_tournaments: bool = False


class LeagueSeasonRecord(BaseModel):
    season_id: int
    season_name: str
    wins: int = 0
    draws: int = 0
    losses: int = 0
    matches: int = 0
    win_percentage: float = 0


class LeagueAspectUsage(BaseModel):
    aspect: str
    count: int


class LeagueFavoriteCard(BaseModel):
    card_id: str
    name: str | None = None
    image_url: str | None = None
    uses: int = 0


class LeaguePlayerCareerProfile(BaseModel):
    user_id: UserId
    user_name: str
    user_email: str
    account_type: UserAccountType
    overall_wins: int = 0
    overall_draws: int = 0
    overall_losses: int = 0
    overall_matches: int = 0
    overall_win_percentage: float = 0
    season_records: list[LeagueSeasonRecord] = Field(default_factory=list)
    most_used_aspects: list[LeagueAspectUsage] = Field(default_factory=list)
    favorite_card: LeagueFavoriteCard | None = None


class LeagueDistributionBucket(BaseModel):
    label: str
    count: int


class LeagueSeasonDraftOrderItem(BaseModel):
    pick_number: int
    user_id: UserId
    user_name: str
    previous_points: float = 0
    previous_wins: int = 0
    previous_draws: int = 0
    previous_losses: int = 0
    previous_matches: int = 0
    picked_source_user_id: UserId | None = None
    picked_source_user_name: str | None = None


class LeagueSeasonDraftCardBase(BaseModel):
    source_user_id: UserId
    source_user_name: str
    total_cards: int = 0
    previous_points: float = 0
    previous_wins: int = 0
    previous_draws: int = 0
    previous_losses: int = 0
    previous_matches: int = 0
    by_cost: list[LeagueDistributionBucket] = Field(default_factory=list)
    by_type: list[LeagueDistributionBucket] = Field(default_factory=list)
    by_aspect: list[LeagueDistributionBucket] = Field(default_factory=list)
    by_trait: list[LeagueDistributionBucket] = Field(default_factory=list)
    by_rarity: list[LeagueDistributionBucket] = Field(default_factory=list)
    claimed_by_user_id: UserId | None = None
    claimed_by_user_name: str | None = None


class LeagueSeasonDraftView(BaseModel):
    from_season_id: int | None = None
    from_season_name: str | None = None
    to_season_id: int | None = None
    to_season_name: str | None = None
    draft_order: list[LeagueSeasonDraftOrderItem] = Field(default_factory=list)
    card_bases: list[LeagueSeasonDraftCardBase] = Field(default_factory=list)


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


class LeagueSeasonDraftPickBody(BaseModel):
    from_season_id: int
    to_season_id: int
    target_user_id: UserId
    source_user_id: UserId


class LeagueCommunicationUpsertBody(BaseModel):
    kind: Literal["NOTE", "ANNOUNCEMENT", "RULE"]
    title: str = Field(min_length=1, max_length=180)
    body: str = Field(min_length=1, max_length=6000)
    pinned: bool = False


class LeagueCommunicationUpdateBody(BaseModel):
    kind: Literal["NOTE", "ANNOUNCEMENT", "RULE"] | None = None
    title: str | None = Field(default=None, min_length=1, max_length=180)
    body: str | None = Field(default=None, min_length=1, max_length=6000)
    pinned: bool | None = None


class LeagueProjectedScheduleItemUpsertBody(BaseModel):
    round_label: str | None = Field(default=None, max_length=120)
    starts_at: datetime_utc | None = None
    title: str = Field(min_length=1, max_length=180)
    details: str | None = Field(default=None, max_length=4000)
    status: str | None = Field(default=None, max_length=80)
    sort_order: int = Field(default=0, ge=0, le=1000)


class LeagueProjectedScheduleItemUpdateBody(BaseModel):
    round_label: str | None = Field(default=None, max_length=120)
    starts_at: datetime_utc | None = None
    title: str | None = Field(default=None, min_length=1, max_length=180)
    details: str | None = Field(default=None, max_length=4000)
    status: str | None = Field(default=None, max_length=80)
    sort_order: int | None = Field(default=None, ge=0, le=1000)


class LeagueTournamentApplicationView(BaseModel):
    user_id: UserId
    user_name: str
    user_email: str
    tournament_id: TournamentId
    season_id: int | None = None
    deck_id: DeckId | None = None
    deck_name: str | None = None
    deck_leader: str | None = None
    deck_base: str | None = None
    status: str


class LeagueCommunicationView(BaseModel):
    id: int
    tournament_id: TournamentId
    kind: Literal["NOTE", "ANNOUNCEMENT", "RULE"]
    title: str
    body: str
    pinned: bool = False
    created_by_user_id: UserId | None = None
    created_by_user_name: str | None = None
    created: datetime_utc
    updated: datetime_utc


class LeagueProjectedScheduleItemView(BaseModel):
    id: int
    tournament_id: TournamentId
    round_label: str | None = None
    starts_at: datetime_utc | None = None
    title: str
    details: str | None = None
    status: str | None = None
    sort_order: int = 0
    created_by_user_id: UserId | None = None
    created_by_user_name: str | None = None
    created: datetime_utc
    updated: datetime_utc
