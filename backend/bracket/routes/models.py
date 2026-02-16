from pydantic import BaseModel

from bracket.logic.scheduling.handle_stage_activation import StageItemInputUpdate
from bracket.models.db.club import Club
from bracket.models.db.court import Court
from bracket.models.db.match import Match, SuggestedMatch
from bracket.models.db.player import Player
from bracket.models.db.ranking import Ranking
from bracket.models.league import (
    LeagueSeasonAdminView,
    LeagueAdminUserView,
    LeagueCardPoolEntryView,
    LeagueCommunicationView,
    LeagueDeckView,
    LeagueProjectedScheduleItemView,
    LeagueSeasonDraftView,
    LeagueSeasonHistoryView,
    LeagueRecalculateView,
    LeagueTournamentApplicationView,
    LeagueStandingsRow,
    LeaguePlayerCareerProfile,
    LeagueUpcomingOpponentView,
)
from bracket.models.league_cards import LeagueDraftSimulation, LeagueSearchCards
from bracket.models.db.stage_item_inputs import (
    StageItemInputOptionFinal,
    StageItemInputOptionTentative,
)
from bracket.models.db.team import FullTeamWithPlayers, Team
from bracket.models.db.tournament import Tournament
from bracket.models.db.user import UserPublic
from bracket.models.db.user import CardCatalogEntry, MediaCatalogEntry, UserDirectoryEntry
from bracket.models.db.util import StageWithStageItems
from bracket.routes.auth import Token
from bracket.utils.id_types import StageId, StageItemId


class SuccessResponse(BaseModel):
    success: bool = True


class DataResponse[DataT](BaseModel):
    data: DataT


class ClubsResponse(DataResponse[list[Club]]):
    pass


class ClubResponse(DataResponse[Club | None]):
    pass


class TournamentResponse(DataResponse[Tournament]):
    pass


class TournamentsResponse(DataResponse[list[Tournament]]):
    pass


class PaginatedPlayers(BaseModel):
    count: int
    players: list[Player]


class PlayersResponse(DataResponse[PaginatedPlayers]):
    pass


class SinglePlayerResponse(DataResponse[Player]):
    pass


class StagesWithStageItemsResponse(DataResponse[list[StageWithStageItems]]):
    pass


class UpcomingMatchesResponse(DataResponse[list[SuggestedMatch]]):
    pass


class SingleMatchResponse(DataResponse[Match]):
    pass


class PaginatedTeams(BaseModel):
    count: int
    teams: list[FullTeamWithPlayers]


class TeamsWithPlayersResponse(DataResponse[PaginatedTeams]):
    pass


class SingleTeamResponse(DataResponse[Team]):
    pass


class UserPublicResponse(DataResponse[UserPublic]):
    pass


class UsersResponse(DataResponse[list[UserPublic]]):
    pass


class UserDirectoryResponse(DataResponse[list[UserDirectoryEntry]]):
    pass


class CardCatalogResponse(DataResponse[list[CardCatalogEntry]]):
    pass


class MediaCatalogResponse(DataResponse[list[MediaCatalogEntry]]):
    pass


class TokenResponse(DataResponse[Token]):
    pass


class CourtsResponse(DataResponse[list[Court]]):
    pass


class SingleCourtResponse(DataResponse[Court]):
    pass


class RankingsResponse(DataResponse[list[Ranking]]):
    pass


class StageItemInputOptionsResponse(
    DataResponse[dict[StageId, list[StageItemInputOptionTentative | StageItemInputOptionFinal]]]
):
    pass


class StageRankingResponse(DataResponse[dict[StageItemId, list[StageItemInputUpdate]]]):
    pass


class LeagueCardsResponse(DataResponse[LeagueSearchCards]):
    pass


class LeagueCardPoolEntriesResponse(DataResponse[list[LeagueCardPoolEntryView]]):
    pass


class LeagueDeckResponse(DataResponse[LeagueDeckView]):
    pass


class LeagueDecksResponse(DataResponse[list[LeagueDeckView]]):
    pass


class LeagueSeasonStandingsResponse(DataResponse[list[LeagueStandingsRow]]):
    pass


class LeagueSeasonHistoryResponse(DataResponse[LeagueSeasonHistoryView]):
    pass


class LeagueRecalculateResponse(DataResponse[LeagueRecalculateView]):
    pass


class LeagueAdminUsersResponse(DataResponse[list[LeagueAdminUserView]]):
    pass


class LeagueDraftSimulationResponse(DataResponse[LeagueDraftSimulation]):
    pass


class LeagueAdminSeasonsResponse(DataResponse[list[LeagueSeasonAdminView]]):
    pass


class LeagueTournamentApplicationsResponse(DataResponse[list[LeagueTournamentApplicationView]]):
    pass


class LeagueUpcomingOpponentResponse(DataResponse[LeagueUpcomingOpponentView | None]):
    pass


class LeaguePlayerCareerProfileResponse(DataResponse[LeaguePlayerCareerProfile]):
    pass


class LeagueSeasonDraftResponse(DataResponse[LeagueSeasonDraftView]):
    pass


class LeagueCommunicationsResponse(DataResponse[list[LeagueCommunicationView]]):
    pass


class LeagueCommunicationResponse(DataResponse[LeagueCommunicationView]):
    pass


class LeagueProjectedScheduleResponse(DataResponse[list[LeagueProjectedScheduleItemView]]):
    pass


class LeagueProjectedScheduleItemResponse(DataResponse[LeagueProjectedScheduleItemView]):
    pass
