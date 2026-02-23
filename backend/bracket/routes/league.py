import asyncio
import io
import csv
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from heliclockter import datetime_utc
from starlette.responses import Response
from starlette import status

from bracket.config import config
from bracket.database import database
from bracket.logic.scheduling.round_robin import get_round_robin_combinations
from bracket.schema import courts
from bracket.models.db.court import CourtInsertable
from bracket.models.db.match import MatchCreateBody
from bracket.models.db.player import PlayerBody
from bracket.models.db.ranking import RankingCreateBody
from bracket.models.db.round import RoundInsertable
from bracket.models.db.stage_item import StageItemCreateBody, StageType
from bracket.models.db.tournament import TournamentBody, TournamentUpdateBody
from bracket.models.db.user import UserPublic
from bracket.models.league import (
    LeagueAwardAccoladeBody,
    LeagueStandingsRow,
    LeagueCommunicationUpdateBody,
    LeagueCommunicationUpsertBody,
    LeagueDashboardBackgroundSettingsUpdateBody,
    LeagueProjectedScheduleItemUpdateBody,
    LeagueProjectedScheduleItemUpsertBody,
    LeagueSeasonCreateBody,
    LeagueSeasonDraftPickBody,
    LeagueSeasonPointAdjustmentBody,
    LeagueSeasonUpdateBody,
    LeagueTournamentApplicationBody,
    LeagueDeckImportSwuDbBody,
    LeagueParticipantSubmissionBody,
    LeagueCardPoolUpdateBody,
    LeagueDeckUpsertBody,
    LeaguePointsImportBody,
    LeagueSeasonPrivilegesUpdateBody,
)
from bracket.routes.auth import is_admin_user, user_authenticated_for_tournament_member
from bracket.routes.models import (
    LeagueCommunicationResponse,
    LeagueCommunicationsResponse,
    LeagueDashboardBackgroundSettingsResponse,
    LeagueAdminSeasonsResponse,
    LeagueTournamentApplicationsResponse,
    LeagueUpcomingOpponentResponse,
    LeagueAdminUsersResponse,
    LeagueCardPoolEntriesResponse,
    LeagueDeckResponse,
    LeagueDecksResponse,
    LeagueMetaAnalysisResponse,
    LeagueRecalculateResponse,
    LeagueProjectedScheduleEventCreateResponse,
    LeagueSeasonHistoryResponse,
    LeagueProjectedScheduleItemResponse,
    LeagueProjectedScheduleResponse,
    LeagueSeasonStandingsResponse,
    LeagueSeasonDraftResponse,
    SuccessResponse,
)
from bracket.sql.league import (
    apply_season_draft_pick,
    confirm_season_draft_results,
    create_league_communication,
    create_projected_schedule_item,
    create_season,
    delete_league_communication,
    delete_projected_schedule_item,
    delete_season,
    delete_deck,
    delete_tournament_application,
    ensure_user_registered_as_participant,
    get_card_pool_entries,
    get_card_pool_entries_for_tournament_scope,
    get_deck_by_id,
    get_decks,
    get_decks_for_tournament_club_users,
    get_decks_for_tournament_scope,
    get_league_admin_users,
    get_league_meta_analysis,
    get_league_standings,
    get_season_draft_view,
    get_season_by_id,
    get_tournament_applications,
    get_next_opponent_for_user_in_tournament,
    get_or_create_season_by_name,
    get_or_create_active_season,
    get_projected_schedule_item_by_id,
    get_tournament_ids_for_season,
    list_league_communications,
    get_dashboard_background_settings,
    list_projected_schedule_items,
    sync_projected_schedule_tournament_statuses,
    get_seasons_for_tournament,
    get_user_id_by_email,
    insert_accolade,
    insert_points_ledger_delta,
    list_admin_seasons_for_tournament,
    set_team_logo_for_user_in_tournament,
    set_season_tournaments,
    reset_season_draft_results,
    upsert_tournament_application,
    update_season,
    update_league_communication,
    upsert_dashboard_background_settings,
    update_projected_schedule_item,
    upsert_card_pool_entry,
    upsert_deck,
    upsert_season_membership,
    user_is_league_admin,
)
from bracket.utils.id_types import DeckId, TournamentId, UserId
from bracket.utils.logging import logger
from bracket.utils.swudb import build_swudb_deck_export
from bracket.sql.players import (
    ensure_tournament_records_fresh,
    insert_player,
    recalculate_tournament_records,
)
from bracket.sql.rankings import sql_create_ranking
from bracket.sql.rounds import sql_create_round
from bracket.sql.stage_item_inputs import sql_set_team_id_for_stage_item_input
from bracket.sql.stage_items import get_stage_item, sql_create_stage_item_with_empty_inputs
from bracket.sql.stages import sql_create_stage
from bracket.sql.matches import sql_create_match
from bracket.sql.teams import get_teams_with_members
from bracket.sql.tournaments import sql_create_tournament, sql_get_tournament, sql_update_tournament
from bracket.sql.users import get_user_by_id, get_users_for_club

router = APIRouter(prefix=config.api_prefix)


async def user_is_league_admin_for_tournament(
    tournament_id: TournamentId, user_public: UserPublic
) -> bool:
    if is_admin_user(user_public):
        return True
    return await user_is_league_admin(tournament_id, user_public.id)


def can_manage_other_users(current_user: UserPublic, target_user_id: UserId | None) -> bool:
    return target_user_id is not None and target_user_id != current_user.id


def sanitize_standings_for_non_admin(rows: list[LeagueStandingsRow]) -> list[LeagueStandingsRow]:
    return [
        row.model_copy(
            update={
                "role": None,
                "can_manage_points": False,
                "can_manage_tournaments": False,
            }
        )
        for row in rows
    ]


def normalize_person_name(value: str | None) -> str:
    return str(value or "").strip().lower()


async def normalize_projected_schedule_participant_ids(
    tournament_id: TournamentId,
    participant_user_ids: list[UserId] | None,
    season_id: int | None = None,
) -> list[int] | None:
    if participant_user_ids is None:
        return None

    normalized_ids: list[int] = []
    seen_ids: set[int] = set()
    for user_id in participant_user_ids:
        normalized_id = int(user_id)
        if normalized_id <= 0 or normalized_id in seen_ids:
            continue
        seen_ids.add(normalized_id)
        normalized_ids.append(normalized_id)

    if len(normalized_ids) < 1:
        return []

    season = await resolve_season_for_tournament(tournament_id, season_id)
    current_users = await get_league_admin_users(tournament_id, season.id)
    allowed_user_ids = {int(user.user_id) for user in current_users}
    invalid_user_ids = [user_id for user_id in normalized_ids if user_id not in allowed_user_ids]
    if len(invalid_user_ids) > 0:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "One or more selected participants are not in the current user pool",
        )

    return normalized_ids


async def maybe_build_regular_season_matchup_event(
    source_tournament_id: TournamentId,
    source_tournament: Any,
    created_tournament_id: TournamentId,
    schedule_item: Any,
    club_users: list[Any],
) -> None:
    if schedule_item.event_template != "REGULAR_SEASON_MATCHUP":
        return

    selected_participant_ids = [
        int(user_id)
        for user_id in (schedule_item.participant_user_ids or [])
        if user_id is not None
    ]
    if len(selected_participant_ids) > 0:
        name_by_user_id: dict[int, str] = {
            int(user.id): str(user.name).strip() for user in club_users if str(user.name).strip() != ""
        }
        if schedule_item.season_id is not None:
            season_users = await get_league_admin_users(source_tournament_id, int(schedule_item.season_id))
            for user in season_users:
                user_name = str(user.user_name).strip()
                if user_name == "":
                    continue
                name_by_user_id[int(user.user_id)] = user_name

        participant_tuples: list[tuple[int, str]] = []
        seen_user_ids: set[int] = set()
        for selected_user_id in selected_participant_ids:
            if selected_user_id in seen_user_ids:
                continue
            seen_user_ids.add(selected_user_id)
            participant_name = name_by_user_id.get(selected_user_id, "").strip()
            if participant_name == "":
                selected_user = await get_user_by_id(selected_user_id)
                participant_name = (
                    str(selected_user.name).strip() if selected_user is not None else ""
                )
            if participant_name != "":
                participant_tuples.append((selected_user_id, participant_name))
    elif schedule_item.season_id is not None:
        season_users = await get_league_admin_users(source_tournament_id, int(schedule_item.season_id))
        participant_tuples = [
            (int(user.user_id), str(user.user_name).strip())
            for user in season_users
            if user.role is not None and str(user.user_name).strip() != ""
        ]
    else:
        participant_tuples = [
            (int(user.id), str(user.name).strip()) for user in club_users if str(user.name).strip() != ""
        ]

    participants_by_name: dict[str, tuple[int, str]] = {}
    for user_id, participant_name in participant_tuples:
        normalized_name = normalize_person_name(participant_name)
        if normalized_name == "":
            continue
        participants_by_name.setdefault(normalized_name, (user_id, participant_name))

    if len(participants_by_name) < 2:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Regular season matchup requires at least 2 participants",
        )

    for user_id, participant_name in participants_by_name.values():
        await ensure_user_registered_as_participant(
            tournament_id=created_tournament_id,
            user_id=user_id,
            participant_name=participant_name,
        )

    all_teams = await get_teams_with_members(created_tournament_id, only_active_teams=True)
    participants_lookup = set(participants_by_name.keys())
    participant_teams = [
        team
        for team in all_teams
        if normalize_person_name(team.name) in participants_lookup
    ]
    participant_teams.sort(key=lambda team: (str(team.name).strip().lower(), int(team.id)))

    if len(participant_teams) < 2:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Regular season matchup requires at least 2 participant teams",
        )
    if len(participant_teams) > 64:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Regular season matchup supports at most 64 participants",
        )

    created_stage = await sql_create_stage(created_tournament_id)
    created_stage_item = await sql_create_stage_item_with_empty_inputs(
        created_tournament_id,
        StageItemCreateBody(
            stage_id=created_stage.id,
            name="Regular Season Matchup",
            type=StageType.REGULAR_SEASON_MATCHUP,
            team_count=len(participant_teams),
            ranking_id=None,
        ),
    )
    stage_item_with_inputs = await get_stage_item(created_tournament_id, created_stage_item.id)
    sorted_inputs = sorted(stage_item_with_inputs.inputs, key=lambda input_: int(input_.slot))
    for index, stage_input in enumerate(sorted_inputs):
        await sql_set_team_id_for_stage_item_input(
            created_tournament_id,
            stage_input.id,
            participant_teams[index].id,
        )

    week_index = (
        int(schedule_item.regular_season_week_index)
        if schedule_item.regular_season_week_index is not None
        else max(1, int(schedule_item.sort_order) + 1)
    )
    total_games_per_opponent = (
        int(schedule_item.regular_season_games_per_opponent)
        if schedule_item.regular_season_games_per_opponent is not None
        else 1
    )
    games_per_week = (
        int(schedule_item.regular_season_games_per_week)
        if schedule_item.regular_season_games_per_week is not None
        else 1
    )
    if total_games_per_opponent < 1:
        total_games_per_opponent = 1
    if games_per_week < 1:
        games_per_week = 1

    round_id = await sql_create_round(
        RoundInsertable(
            created=datetime_utc.now(),
            is_draft=False,
            stage_item_id=created_stage_item.id,
            name=f"Week {week_index}",
        )
    )

    pairings_by_round = get_round_robin_combinations(len(participant_teams))
    if len(pairings_by_round) < 1:
        return

    rounds_per_cycle = len(pairings_by_round)
    normalized_week_index = max(1, week_index)
    cycle_index = (normalized_week_index - 1) // rounds_per_cycle
    pairings_round_index = (normalized_week_index - 1) % rounds_per_cycle
    games_played_before_week = cycle_index * games_per_week
    remaining_games_for_pair = max(0, total_games_per_opponent - games_played_before_week)
    games_this_week = min(games_per_week, remaining_games_for_pair)
    if games_this_week < 1:
        return
    pairings = pairings_by_round[pairings_round_index]

    input_ids_by_slot_index = [stage_input.id for stage_input in sorted_inputs]
    for left_index, right_index in pairings:
        if left_index >= len(input_ids_by_slot_index) or right_index >= len(input_ids_by_slot_index):
            continue

        for game_index in range(games_this_week):
            left_input_id = input_ids_by_slot_index[left_index]
            right_input_id = input_ids_by_slot_index[right_index]
            game_number = games_played_before_week + game_index + 1
            if game_number % 2 == 0:
                left_input_id, right_input_id = right_input_id, left_input_id

            await sql_create_match(
                MatchCreateBody(
                    round_id=round_id,
                    stage_item_input1_id=left_input_id,
                    stage_item_input1_winner_from_match_id=None,
                    stage_item_input2_id=right_input_id,
                    stage_item_input2_winner_from_match_id=None,
                    court_id=None,
                    duration_minutes=source_tournament.duration_minutes,
                    margin_minutes=source_tournament.margin_minutes,
                    custom_duration_minutes=None,
                    custom_margin_minutes=None,
                )
            )


async def resolve_season_for_tournament(
    tournament_id: TournamentId,
    season_id: int | None,
):
    if season_id is None:
        seasons = await list_admin_seasons_for_tournament(tournament_id)
        if len(seasons) > 0:
            active = next((season for season in seasons if bool(season.is_active)), None)
            if active is not None:
                active_season = await get_season_by_id(active.season_id)
                if active_season is not None:
                    return active_season
            most_recent = max(seasons, key=lambda season: int(season.season_id))
            recent_season = await get_season_by_id(most_recent.season_id)
            if recent_season is not None:
                return recent_season
        return await get_or_create_active_season(tournament_id)

    season = await get_season_by_id(season_id)
    if season is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Season not found")

    available_seasons = await list_admin_seasons_for_tournament(tournament_id)
    if int(season.id) not in {int(item.season_id) for item in available_seasons}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Season does not belong to this tournament")
    return season


@router.get(
    "/tournaments/{tournament_id}/league/season_standings",
    response_model=LeagueSeasonStandingsResponse,
)
async def get_season_standings(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueSeasonStandingsResponse:
    has_admin_access = await user_is_league_admin_for_tournament(tournament_id, user_public)
    await ensure_tournament_records_fresh(tournament_id)
    season = await get_or_create_active_season(tournament_id)
    standings = await get_league_standings(tournament_id, season.id)
    if not has_admin_access:
        standings = sanitize_standings_for_non_admin(standings)
    return LeagueSeasonStandingsResponse(data=standings)


@router.get(
    "/tournaments/{tournament_id}/league/season_history",
    response_model=LeagueSeasonHistoryResponse,
)
async def get_season_history(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueSeasonHistoryResponse:
    has_admin_access = await user_is_league_admin_for_tournament(tournament_id, user_public)
    await ensure_tournament_records_fresh(tournament_id)
    await get_or_create_active_season(tournament_id)
    seasons = await get_seasons_for_tournament(tournament_id)
    standings_results = await asyncio.gather(
        *(get_league_standings(tournament_id, season.id) for season in seasons),
        get_league_standings(tournament_id, None),
    )
    standings_by_season = standings_results[:-1]
    cumulative = standings_results[-1]
    if not has_admin_access:
        standings_by_season = [
            sanitize_standings_for_non_admin(season_rows) for season_rows in standings_by_season
        ]
        cumulative = sanitize_standings_for_non_admin(cumulative)
    season_views = []
    for season, season_standings in zip(seasons, standings_by_season, strict=False):
        season_views.append(
            {
                "season_id": season.id,
                "season_name": season.name,
                "is_active": season.is_active,
                "standings": season_standings,
            }
        )
    return LeagueSeasonHistoryResponse(data={"seasons": season_views, "cumulative": cumulative})


@router.get(
    "/tournaments/{tournament_id}/league/meta_analysis",
    response_model=LeagueMetaAnalysisResponse,
)
async def get_meta_analysis(
    tournament_id: TournamentId,
    season_id: int | None = Query(default=None),
    _: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueMetaAnalysisResponse:
    season = await resolve_season_for_tournament(tournament_id, season_id)
    data = await get_league_meta_analysis(season_id=season.id, season_name=season.name)
    return LeagueMetaAnalysisResponse(data=data)


@router.get(
    "/tournaments/{tournament_id}/league/communications",
    response_model=LeagueCommunicationsResponse,
)
async def get_league_communications(
    tournament_id: TournamentId,
    _: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueCommunicationsResponse:
    return LeagueCommunicationsResponse(data=await list_league_communications(tournament_id))


@router.get(
    "/tournaments/{tournament_id}/league/dashboard_background",
    response_model=LeagueDashboardBackgroundSettingsResponse,
)
async def get_league_dashboard_background(
    tournament_id: TournamentId,
    _: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueDashboardBackgroundSettingsResponse:
    return LeagueDashboardBackgroundSettingsResponse(
        data=await get_dashboard_background_settings(tournament_id)
    )


@router.put(
    "/tournaments/{tournament_id}/league/admin/dashboard_background",
    response_model=LeagueDashboardBackgroundSettingsResponse,
)
async def put_league_dashboard_background(
    tournament_id: TournamentId,
    body: LeagueDashboardBackgroundSettingsUpdateBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueDashboardBackgroundSettingsResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    updated = await upsert_dashboard_background_settings(tournament_id, body, user_public.id)
    return LeagueDashboardBackgroundSettingsResponse(data=updated)


@router.post(
    "/tournaments/{tournament_id}/league/admin/communications",
    response_model=LeagueCommunicationResponse,
)
async def post_league_communication(
    tournament_id: TournamentId,
    body: LeagueCommunicationUpsertBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueCommunicationResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    created = await create_league_communication(tournament_id, body, user_public.id)
    return LeagueCommunicationResponse(data=created)


@router.put(
    "/tournaments/{tournament_id}/league/admin/communications/{communication_id}",
    response_model=LeagueCommunicationResponse,
)
async def put_league_communication(
    tournament_id: TournamentId,
    communication_id: int,
    body: LeagueCommunicationUpdateBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueCommunicationResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    updated = await update_league_communication(tournament_id, communication_id, body)
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Communication entry not found")
    return LeagueCommunicationResponse(data=updated)


@router.delete(
    "/tournaments/{tournament_id}/league/admin/communications/{communication_id}",
    response_model=SuccessResponse,
)
async def delete_admin_league_communication(
    tournament_id: TournamentId,
    communication_id: int,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    await delete_league_communication(tournament_id, communication_id)
    return SuccessResponse()


@router.get(
    "/tournaments/{tournament_id}/league/projected_schedule",
    response_model=LeagueProjectedScheduleResponse,
)
async def get_projected_schedule(
    tournament_id: TournamentId,
    _: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueProjectedScheduleResponse:
    await sync_projected_schedule_tournament_statuses(tournament_id)
    return LeagueProjectedScheduleResponse(data=await list_projected_schedule_items(tournament_id))


@router.post(
    "/tournaments/{tournament_id}/league/admin/projected_schedule",
    response_model=LeagueProjectedScheduleItemResponse,
)
async def post_projected_schedule_item(
    tournament_id: TournamentId,
    body: LeagueProjectedScheduleItemUpsertBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueProjectedScheduleItemResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    if body.season_id is not None:
        await resolve_season_for_tournament(tournament_id, body.season_id)
    body = body.model_copy(
        update={
            "participant_user_ids": await normalize_projected_schedule_participant_ids(
                tournament_id, body.participant_user_ids, body.season_id
            )
        }
    )
    created = await create_projected_schedule_item(tournament_id, body, user_public.id)
    return LeagueProjectedScheduleItemResponse(data=created)


@router.put(
    "/tournaments/{tournament_id}/league/admin/projected_schedule/{schedule_item_id}",
    response_model=LeagueProjectedScheduleItemResponse,
)
async def put_projected_schedule_item(
    tournament_id: TournamentId,
    schedule_item_id: int,
    body: LeagueProjectedScheduleItemUpdateBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueProjectedScheduleItemResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    if body.season_id is not None:
        await resolve_season_for_tournament(tournament_id, body.season_id)
    if "participant_user_ids" in body.model_fields_set:
        effective_season_id = body.season_id
        if effective_season_id is None:
            existing_item = await get_projected_schedule_item_by_id(tournament_id, schedule_item_id)
            if existing_item is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Projected schedule item not found")
            effective_season_id = existing_item.season_id
        body = body.model_copy(
            update={
                "participant_user_ids": await normalize_projected_schedule_participant_ids(
                    tournament_id, body.participant_user_ids, effective_season_id
                )
            }
        )
    updated = await update_projected_schedule_item(tournament_id, schedule_item_id, body)
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Projected schedule item not found")
    return LeagueProjectedScheduleItemResponse(data=updated)


@router.delete(
    "/tournaments/{tournament_id}/league/admin/projected_schedule/{schedule_item_id}",
    response_model=SuccessResponse,
)
async def delete_admin_projected_schedule_item(
    tournament_id: TournamentId,
    schedule_item_id: int,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    await delete_projected_schedule_item(tournament_id, schedule_item_id)
    return SuccessResponse()


@router.post(
    "/tournaments/{tournament_id}/league/admin/projected_schedule/{schedule_item_id}/create_event",
    response_model=LeagueProjectedScheduleEventCreateResponse,
)
async def post_create_projected_schedule_event(
    tournament_id: TournamentId,
    schedule_item_id: int,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueProjectedScheduleEventCreateResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    schedule_item = await get_projected_schedule_item_by_id(tournament_id, schedule_item_id)
    if schedule_item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Projected schedule item not found")

    if schedule_item.linked_tournament_id is not None:
        existing_event = await sql_get_tournament(schedule_item.linked_tournament_id)
        return LeagueProjectedScheduleEventCreateResponse(
            data={
                "schedule_item_id": int(schedule_item.id),
                "tournament_id": int(existing_event.id),
                "tournament_name": existing_event.name,
            }
        )

    source_tournament = await sql_get_tournament(tournament_id)
    event_name = f"{source_tournament.name} - {schedule_item.title}".strip()
    if event_name == "":
        event_name = f"{source_tournament.name} Event"

    event_start_time = (
        schedule_item.starts_at if schedule_item.starts_at is not None else datetime_utc.now()
    )

    event_body = TournamentBody(
        club_id=source_tournament.club_id,
        name=event_name[:180],
        start_time=event_start_time,
        dashboard_public=False,
        dashboard_endpoint=None,
        players_can_be_in_multiple_teams=source_tournament.players_can_be_in_multiple_teams,
        auto_assign_courts=source_tournament.auto_assign_courts,
        duration_minutes=source_tournament.duration_minutes,
        margin_minutes=source_tournament.margin_minutes,
    )

    async with database.transaction():
        created_tournament_id = await sql_create_tournament(event_body)
        if schedule_item.season_id is not None:
            tournament_ids_for_season = await get_tournament_ids_for_season(int(schedule_item.season_id))
            if int(created_tournament_id) not in {
                int(season_tournament_id) for season_tournament_id in tournament_ids_for_season
            }:
                await set_season_tournaments(
                    int(schedule_item.season_id),
                    [*tournament_ids_for_season, created_tournament_id],
                )
        await sql_create_ranking(created_tournament_id, RankingCreateBody(), position=0)
        await database.execute(
            query=courts.insert(),
            values=CourtInsertable(
                name="Field",
                created=datetime_utc.now(),
                tournament_id=created_tournament_id,
            ).model_dump(),
        )
        club_users = await get_users_for_club(source_tournament.club_id)
        for club_user in club_users:
            player_name = club_user.name.strip()
            if player_name == "":
                continue
            await insert_player(PlayerBody(name=player_name, active=True), created_tournament_id)
        await maybe_build_regular_season_matchup_event(
            source_tournament_id=tournament_id,
            source_tournament=source_tournament,
            created_tournament_id=created_tournament_id,
            schedule_item=schedule_item,
            club_users=club_users,
        )
        await update_projected_schedule_item(
            tournament_id,
            schedule_item_id,
            LeagueProjectedScheduleItemUpdateBody(linked_tournament_id=created_tournament_id),
        )

    created_event = await sql_get_tournament(created_tournament_id)
    await sync_projected_schedule_tournament_statuses(tournament_id)
    return LeagueProjectedScheduleEventCreateResponse(
        data={
            "schedule_item_id": int(schedule_item.id),
            "tournament_id": int(created_event.id),
            "tournament_name": created_event.name,
        }
    )


@router.get(
    "/tournaments/{tournament_id}/league/card_pool",
    response_model=LeagueCardPoolEntriesResponse,
)
async def get_card_pool(
    tournament_id: TournamentId,
    user_id: UserId | None = Query(default=None),
    season_id: int | None = Query(default=None),
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueCardPoolEntriesResponse:
    has_admin_access = await user_is_league_admin_for_tournament(tournament_id, user_public)
    if can_manage_other_users(user_public, user_id) and not has_admin_access:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    if season_id is None:
        if has_admin_access and user_id is None:
            return LeagueCardPoolEntriesResponse(
                data=await get_card_pool_entries_for_tournament_scope(tournament_id, None)
            )
        target_user_id = user_id if user_id is not None and has_admin_access else user_public.id
        return LeagueCardPoolEntriesResponse(
            data=await get_card_pool_entries_for_tournament_scope(tournament_id, target_user_id)
        )

    season = await resolve_season_for_tournament(tournament_id, season_id)
    if has_admin_access and user_id is None:
        return LeagueCardPoolEntriesResponse(data=await get_card_pool_entries(season.id, None))

    target_user_id = user_id if user_id is not None and has_admin_access else user_public.id
    return LeagueCardPoolEntriesResponse(data=await get_card_pool_entries(season.id, target_user_id))


@router.put(
    "/tournaments/{tournament_id}/league/card_pool",
    response_model=SuccessResponse,
)
async def put_card_pool_entry(
    tournament_id: TournamentId,
    body: LeagueCardPoolUpdateBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    has_admin_access = await user_is_league_admin_for_tournament(tournament_id, user_public)
    if can_manage_other_users(user_public, body.user_id) and not has_admin_access:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = await resolve_season_for_tournament(tournament_id, body.season_id)
    target_user_id = body.user_id if body.user_id is not None and has_admin_access else user_public.id
    await upsert_card_pool_entry(season.id, target_user_id, body.card_id, body.quantity)
    return SuccessResponse()


@router.get(
    "/tournaments/{tournament_id}/league/decks",
    response_model=LeagueDecksResponse,
)
async def list_decks(
    tournament_id: TournamentId,
    user_id: UserId | None = Query(default=None),
    season_id: int | None = Query(default=None),
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueDecksResponse:
    await ensure_tournament_records_fresh(tournament_id)
    has_admin_access = await user_is_league_admin_for_tournament(tournament_id, user_public)
    if season_id is None:
        if user_id is None:
            if has_admin_access:
                decks = await get_decks_for_tournament_scope(tournament_id)
                if len(decks) < 1:
                    decks = await get_decks_for_tournament_club_users(tournament_id)
                return LeagueDecksResponse(data=decks)
            decks = await get_decks_for_tournament_scope(tournament_id, user_public.id)
            if len(decks) < 1:
                decks = await get_decks_for_tournament_club_users(tournament_id, user_public.id)
            return LeagueDecksResponse(data=decks)

        if can_manage_other_users(user_public, user_id) and not has_admin_access:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
        decks = await get_decks_for_tournament_scope(tournament_id, user_id)
        if len(decks) < 1:
            decks = await get_decks_for_tournament_club_users(tournament_id, user_id)
        return LeagueDecksResponse(data=decks)

    season = await resolve_season_for_tournament(tournament_id, season_id)
    if user_id is None:
        if has_admin_access:
            return LeagueDecksResponse(data=await get_decks(season.id))
        return LeagueDecksResponse(data=await get_decks(season.id, user_public.id))

    if can_manage_other_users(user_public, user_id) and not has_admin_access:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    return LeagueDecksResponse(data=await get_decks(season.id, user_id))


@router.delete(
    "/tournaments/{tournament_id}/league/apply",
    response_model=SuccessResponse,
)
async def delete_tournament_application_entry(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    await delete_tournament_application(tournament_id, user_public.id)
    return SuccessResponse()


@router.post(
    "/tournaments/{tournament_id}/league/recalculate_records",
    response_model=LeagueRecalculateResponse,
)
async def post_recalculate_records(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueRecalculateResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    duration_ms = await recalculate_tournament_records(tournament_id)
    return LeagueRecalculateResponse(
        data={
            "success": True,
            "recalculated_at": datetime_utc.now().isoformat(),
            "duration_ms": duration_ms,
        }
    )


@router.post(
    "/tournaments/{tournament_id}/league/decks",
    response_model=LeagueDeckResponse,
)
async def post_deck(
    tournament_id: TournamentId,
    body: LeagueDeckUpsertBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueDeckResponse:
    has_admin_access = await user_is_league_admin_for_tournament(tournament_id, user_public)
    if can_manage_other_users(user_public, body.user_id) and not has_admin_access:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = (
        await get_season_by_id(body.season_id)
        if body.season_id is not None
        else await get_or_create_active_season(tournament_id)
    )
    if season is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Season not found")
    target_user_id = body.user_id if body.user_id is not None and has_admin_access else user_public.id
    deck = await upsert_deck(
        season.id,
        target_user_id,
        body.tournament_id or tournament_id,
        body.name,
        body.leader,
        body.base,
        body.mainboard,
        body.sideboard,
    )
    if body.leader_image_url is not None:
        try:
            await set_team_logo_for_user_in_tournament(
                tournament_id=tournament_id,
                user_id=target_user_id,
                logo_path=body.leader_image_url,
            )
        except Exception as exc:
            logger.warning(f"Failed to sync team logo from deck save: {exc}")
    return LeagueDeckResponse(data=deck)


@router.post(
    "/tournaments/{tournament_id}/league/submit_entry",
    response_model=LeagueDeckResponse,
)
async def submit_league_entry(
    tournament_id: TournamentId,
    body: LeagueParticipantSubmissionBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueDeckResponse:
    participant_name = (
        body.participant_name.strip() if body.participant_name is not None else user_public.name.strip()
    )
    if participant_name == "":
        participant_name = user_public.name

    season = (
        await get_season_by_id(body.season_id)
        if body.season_id is not None
        else await get_or_create_active_season(tournament_id)
    )
    if season is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Season not found")
    deck = await upsert_deck(
        season.id,
        user_public.id,
        tournament_id,
        body.deck_name,
        body.leader,
        body.base,
        body.mainboard,
        body.sideboard,
    )
    if body.leader_image_url is not None:
        try:
            await set_team_logo_for_user_in_tournament(
                tournament_id=tournament_id,
                user_id=user_public.id,
                logo_path=body.leader_image_url,
            )
        except Exception as exc:
            logger.warning(f"Failed to sync team logo from participant submission: {exc}")
    await ensure_user_registered_as_participant(
        tournament_id=tournament_id,
        user_id=user_public.id,
        participant_name=participant_name,
        leader_image_url=body.leader_image_url,
    )
    await upsert_tournament_application(
        tournament_id=tournament_id,
        user_id=user_public.id,
        season_id=season.id,
        deck_id=deck.id,
    )
    return LeagueDeckResponse(data=deck)


@router.delete(
    "/tournaments/{tournament_id}/league/decks/{deck_id}",
    response_model=SuccessResponse,
)
async def remove_deck(
    tournament_id: TournamentId,
    deck_id: DeckId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    has_admin_access = await user_is_league_admin_for_tournament(tournament_id, user_public)
    deck = await get_deck_by_id(deck_id)
    if deck is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found")

    if deck.user_id != user_public.id and not has_admin_access:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Cannot delete this deck")

    await delete_deck(deck_id)
    return SuccessResponse()


@router.get(
    "/tournaments/{tournament_id}/league/seasons",
    response_model=LeagueAdminSeasonsResponse,
)
async def list_league_seasons(
    tournament_id: TournamentId,
    _: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueAdminSeasonsResponse:
    seasons = await list_admin_seasons_for_tournament(tournament_id)
    if len(seasons) < 1:
        await get_or_create_active_season(tournament_id)
        seasons = await list_admin_seasons_for_tournament(tournament_id)
    return LeagueAdminSeasonsResponse(data=seasons)


@router.get(
    "/tournaments/{tournament_id}/league/admin/users",
    response_model=LeagueAdminUsersResponse,
)
async def list_league_admin_users(
    tournament_id: TournamentId,
    season_id: int | None = Query(default=None),
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueAdminUsersResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = await resolve_season_for_tournament(tournament_id, season_id)
    users = await get_league_admin_users(tournament_id, season.id)
    return LeagueAdminUsersResponse(data=users)


@router.get(
    "/tournaments/{tournament_id}/league/admin/seasons",
    response_model=LeagueAdminSeasonsResponse,
)
async def list_admin_seasons(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueAdminSeasonsResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    seasons = await list_admin_seasons_for_tournament(tournament_id)
    if len(seasons) < 1:
        await get_or_create_active_season(tournament_id)
        seasons = await list_admin_seasons_for_tournament(tournament_id)
    return LeagueAdminSeasonsResponse(data=seasons)


@router.get(
    "/tournaments/{tournament_id}/league/season_draft",
    response_model=LeagueSeasonDraftResponse,
)
async def get_season_draft(
    tournament_id: TournamentId,
    _: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueSeasonDraftResponse:
    return LeagueSeasonDraftResponse(data=await get_season_draft_view(tournament_id))


@router.get(
    "/tournaments/{tournament_id}/league/admin/season_draft",
    response_model=LeagueSeasonDraftResponse,
)
async def get_admin_season_draft(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueSeasonDraftResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    return LeagueSeasonDraftResponse(data=await get_season_draft_view(tournament_id))


@router.post(
    "/tournaments/{tournament_id}/league/admin/season_draft/pick",
    response_model=SuccessResponse,
)
async def post_admin_season_draft_pick(
    tournament_id: TournamentId,
    body: LeagueSeasonDraftPickBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    from_season = await get_season_by_id(body.from_season_id)
    to_season = await get_season_by_id(body.to_season_id)
    if from_season is None or to_season is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Season not found")

    from_tournaments = await get_tournament_ids_for_season(from_season.id)
    to_tournaments = await get_tournament_ids_for_season(to_season.id)
    if int(tournament_id) not in {int(value) for value in from_tournaments}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Previous season does not belong to this tournament")
    if int(tournament_id) not in {int(value) for value in to_tournaments}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Target season does not belong to this tournament")
    if int(from_season.id) == int(to_season.id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Draft requires two different seasons")

    try:
        await apply_season_draft_pick(
            tournament_id=tournament_id,
            from_season_id=from_season.id,
            to_season_id=to_season.id,
            target_user_id=body.target_user_id,
            source_user_id=body.source_user_id,
            changed_by_user_id=user_public.id,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return SuccessResponse()


@router.post(
    "/tournaments/{tournament_id}/league/admin/season_draft/confirm",
    response_model=SuccessResponse,
)
async def post_admin_season_draft_confirm(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    draft_view = await get_season_draft_view(tournament_id)
    if draft_view.from_season_id is None or draft_view.to_season_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No eligible season transition for draft confirmation.")
    try:
        await confirm_season_draft_results(
            tournament_id=tournament_id,
            from_season_id=int(draft_view.from_season_id),
            to_season_id=int(draft_view.to_season_id),
            changed_by_user_id=user_public.id,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return SuccessResponse()


@router.post(
    "/tournaments/{tournament_id}/league/admin/season_draft/reset",
    response_model=SuccessResponse,
)
async def post_admin_season_draft_reset(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    draft_view = await get_season_draft_view(tournament_id)
    if draft_view.from_season_id is None or draft_view.to_season_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No eligible season transition for draft reset.")
    await reset_season_draft_results(
        from_season_id=int(draft_view.from_season_id),
        to_season_id=int(draft_view.to_season_id),
    )
    return SuccessResponse()


@router.post(
    "/tournaments/{tournament_id}/league/admin/seasons",
    response_model=SuccessResponse,
)
async def post_admin_season(
    tournament_id: TournamentId,
    body: LeagueSeasonCreateBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    await create_season(
        owner_tournament_id=tournament_id,
        name=body.name,
        is_active=body.is_active,
        tournament_ids=body.tournament_ids,
    )
    return SuccessResponse()


@router.put(
    "/tournaments/{tournament_id}/league/admin/seasons/{season_id}",
    response_model=SuccessResponse,
)
async def put_admin_season(
    tournament_id: TournamentId,
    season_id: int,
    body: LeagueSeasonUpdateBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    season = await update_season(
        tournament_id=tournament_id,
        season_id=season_id,
        name=body.name,
        is_active=body.is_active,
        tournament_ids=body.tournament_ids,
    )
    if season is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Season not found")
    return SuccessResponse()


@router.delete(
    "/tournaments/{tournament_id}/league/admin/seasons/{season_id}",
    response_model=SuccessResponse,
)
async def delete_admin_season(
    tournament_id: TournamentId,
    season_id: int,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    await delete_season(season_id)
    return SuccessResponse()


@router.post(
    "/tournaments/{tournament_id}/league/admin/seasons/{season_id}/users/{user_id}/points",
    response_model=SuccessResponse,
)
async def post_admin_adjust_points(
    tournament_id: TournamentId,
    season_id: int,
    user_id: UserId,
    body: LeagueSeasonPointAdjustmentBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    season = await get_season_by_id(season_id)
    if season is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Season not found")
    await insert_points_ledger_delta(
        season_id=season.id,
        user_id=user_id,
        changed_by_user_id=user_public.id,
        points_delta=body.points_delta,
        reason=body.reason,
    )
    return SuccessResponse()


@router.post(
    "/tournaments/{tournament_id}/league/apply",
    response_model=SuccessResponse,
)
async def post_tournament_application(
    tournament_id: TournamentId,
    body: LeagueTournamentApplicationBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    has_admin_access = await user_is_league_admin_for_tournament(tournament_id, user_public)
    if can_manage_other_users(user_public, body.user_id) and not has_admin_access:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    target_user_id = (
        body.user_id if body.user_id is not None and has_admin_access else user_public.id
    )
    target_user_name = user_public.name
    if int(target_user_id) != int(user_public.id):
        target_user = await get_user_by_id(target_user_id)
        if target_user is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Target user not found")
        target_user_name = target_user.name

    season = (
        await get_season_by_id(body.season_id)
        if body.season_id is not None
        else await get_or_create_active_season(tournament_id)
    )
    if season is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Season not found")

    if body.deck_id is not None:
        deck = await get_deck_by_id(body.deck_id)
        if deck is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found")
        if not has_admin_access and deck.user_id != user_public.id:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid deck selection")
        if has_admin_access and deck.user_id != target_user_id:
            if body.user_id is None:
                target_user_id = deck.user_id
                target_user = await get_user_by_id(target_user_id)
                target_user_name = target_user.name if target_user is not None else target_user_name
            else:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Selected deck does not belong to the specified user",
                )

    participant_name = (
        body.participant_name.strip()
        if body.participant_name is not None
        else str(target_user_name).strip()
    )
    if participant_name == "":
        participant_name = str(target_user_name)

    await ensure_user_registered_as_participant(
        tournament_id=tournament_id,
        user_id=target_user_id,
        participant_name=participant_name,
        leader_image_url=body.leader_image_url,
    )
    await upsert_tournament_application(
        tournament_id=tournament_id,
        user_id=target_user_id,
        season_id=season.id,
        deck_id=body.deck_id,
    )
    return SuccessResponse()


@router.get(
    "/tournaments/{tournament_id}/league/applications/me",
    response_model=LeagueTournamentApplicationsResponse,
)
async def get_my_tournament_application(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueTournamentApplicationsResponse:
    data = await get_tournament_applications(tournament_id, user_public.id)
    return LeagueTournamentApplicationsResponse(data=data)


@router.get(
    "/tournaments/{tournament_id}/league/next_opponent",
    response_model=LeagueUpcomingOpponentResponse,
)
async def get_next_opponent(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueUpcomingOpponentResponse:
    data = await get_next_opponent_for_user_in_tournament(tournament_id, user_public.name)
    return LeagueUpcomingOpponentResponse(data=data)


@router.get(
    "/tournaments/{tournament_id}/league/applications",
    response_model=LeagueTournamentApplicationsResponse,
)
async def list_tournament_applications_public(
    tournament_id: TournamentId,
    _: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueTournamentApplicationsResponse:
    data = await get_tournament_applications(tournament_id)
    return LeagueTournamentApplicationsResponse(data=data)


@router.get(
    "/tournaments/{tournament_id}/league/admin/applications",
    response_model=LeagueTournamentApplicationsResponse,
)
async def list_tournament_applications(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueTournamentApplicationsResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    data = await get_tournament_applications(tournament_id)
    return LeagueTournamentApplicationsResponse(data=data)


@router.put(
    "/tournaments/{tournament_id}/league/admin/users/{user_id}/season_privileges",
    response_model=SuccessResponse,
)
async def put_season_privileges(
    tournament_id: TournamentId,
    user_id: UserId,
    body: LeagueSeasonPrivilegesUpdateBody,
    season_id: int | None = Query(default=None),
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = (
        await get_season_by_id(season_id)
        if season_id is not None
        else await get_or_create_active_season(tournament_id)
    )
    if season is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Season not found")
    await upsert_season_membership(season.id, user_id, body)
    return SuccessResponse()


@router.post(
    "/tournaments/{tournament_id}/league/admin/users/{user_id}/accolades",
    response_model=SuccessResponse,
)
async def post_accolade(
    tournament_id: TournamentId,
    user_id: UserId,
    body: LeagueAwardAccoladeBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = await get_or_create_active_season(tournament_id)
    await insert_accolade(season.id, user_id, user_public.id, body.accolade, body.notes)
    return SuccessResponse()


@router.get("/tournaments/{tournament_id}/league/decks/{deck_id}/export/swudb")
async def export_deck_swudb(
    tournament_id: TournamentId,
    deck_id: DeckId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> dict:
    has_admin_access = await user_is_league_admin_for_tournament(tournament_id, user_public)
    season = await get_or_create_active_season(tournament_id)
    deck = await get_deck_by_id(deck_id)
    if deck is None or deck.season_id != season.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found")
    if deck.user_id != user_public.id and not has_admin_access:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Cannot export this deck")

    return build_swudb_deck_export(
        name=deck.name,
        leader=deck.leader,
        base=deck.base,
        mainboard=deck.mainboard,
        sideboard=deck.sideboard,
        author=user_public.name,
    )


@router.post("/tournaments/{tournament_id}/league/decks/import/swudb", response_model=LeagueDeckResponse)
async def import_deck_swudb(
    tournament_id: TournamentId,
    body: LeagueDeckImportSwuDbBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> LeagueDeckResponse:
    has_admin_access = await user_is_league_admin_for_tournament(tournament_id, user_public)
    if can_manage_other_users(user_public, body.user_id) and not has_admin_access:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = await resolve_season_for_tournament(tournament_id, body.season_id)
    target_user_id = body.user_id if body.user_id is not None and has_admin_access else user_public.id

    mainboard = {entry.id: entry.count for entry in body.deck}
    sideboard = {entry.id: entry.count for entry in body.sideboard}
    deck = await upsert_deck(
        season.id,
        target_user_id,
        tournament_id,
        body.name,
        body.leader,
        body.base,
        mainboard,
        sideboard,
    )
    return LeagueDeckResponse(data=deck)


@router.get("/tournaments/{tournament_id}/league/admin/export/standings")
async def export_standings_template(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> dict:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    season = await get_or_create_active_season(tournament_id)
    standings = await get_league_standings(tournament_id, season.id)
    return {
        "template_type": "league_standings_points_adjustments",
        "rows": [
            {
                "user_email": row.user_email,
                "current_points": row.points,
                "points_delta": 0,
                "reason": "",
            }
            for row in standings
        ],
    }


@router.get("/tournaments/{tournament_id}/league/admin/export/season_standings.csv")
async def export_standings_csv(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> Response:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = await get_or_create_active_season(tournament_id)
    standings = await get_league_standings(tournament_id, season.id)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "season_name",
            "rank",
            "user_name",
            "user_email",
            "points",
            "event_wins",
            "tournament_wins",
            "tournament_placements",
            "prize_packs",
            "role",
            "can_manage_points",
            "can_manage_tournaments",
            "accolades",
            "points_delta",
            "reason",
        ]
    )
    for index, row in enumerate(standings, start=1):
        writer.writerow(
            [
                season.name,
                index,
                row.user_name,
                row.user_email,
                row.points,
                row.event_wins,
                row.tournament_wins,
                row.tournament_placements,
                row.prize_packs,
                row.role.value if row.role is not None else "",
                row.can_manage_points,
                row.can_manage_tournaments,
                " | ".join(row.accolades),
                "",
                "",
            ]
        )

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="season-standings-{tournament_id}.csv"'
        },
    )


@router.post("/tournaments/{tournament_id}/league/admin/import/standings", response_model=SuccessResponse)
async def import_standings_template(
    tournament_id: TournamentId,
    body: LeaguePointsImportBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    season = await get_or_create_active_season(tournament_id)

    for row in body.rows:
        user_id = await get_user_id_by_email(row.user_email)
        if user_id is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Could not find user with email {row.user_email}",
            )
        await insert_points_ledger_delta(
            season_id=season.id,
            user_id=user_id,
            changed_by_user_id=user_public.id,
            points_delta=row.points_delta,
            reason=row.reason,
        )
    return SuccessResponse()


@router.post("/tournaments/{tournament_id}/league/admin/import/standings.csv", response_model=SuccessResponse)
async def import_standings_csv(
    tournament_id: TournamentId,
    file: UploadFile = File(...),
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season_default = await get_or_create_active_season(tournament_id)
    raw_bytes = await file.read()
    decoded = raw_bytes.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(decoded))

    for row in reader:
        user_email = (row.get("user_email") or "").strip()
        if user_email == "":
            continue
        target_user_id = await get_user_id_by_email(user_email)
        if target_user_id is None:
            continue

        season_name = (row.get("season_name") or "").strip()
        season = (
            await get_or_create_season_by_name(tournament_id, season_name)
            if season_name != ""
            else season_default
        )

        def parse_int(field: str) -> int:
            value = (row.get(field) or "").strip()
            if value == "":
                return 0
            try:
                return max(0, int(value))
            except ValueError:
                return 0

        def parse_float(field: str) -> float:
            value = (row.get(field) or "").strip()
            if value == "":
                return 0.0
            try:
                return float(value)
            except ValueError:
                return 0.0

        tournament_wins = parse_int("tournament_wins")
        tournament_placements = parse_int("tournament_placements")
        prize_packs = parse_int("prize_packs")
        points_delta = parse_float("points_delta")
        reason = (row.get("reason") or "").strip() or None

        if tournament_wins > 0:
            await insert_points_ledger_delta(
                season.id,
                target_user_id,
                user_public.id,
                float(tournament_wins * 3),
                reason=f"TOURNAMENT_WIN:{tournament_wins}",
            )
        if tournament_placements > 0:
            await insert_points_ledger_delta(
                season.id,
                target_user_id,
                user_public.id,
                float(tournament_placements),
                reason=f"TOURNAMENT_PLACEMENT:{tournament_placements}",
            )
        if prize_packs > 0:
            await insert_points_ledger_delta(
                season.id,
                target_user_id,
                user_public.id,
                0,
                reason=f"PRIZE_PACKS:{prize_packs}",
            )
        if points_delta != 0:
            await insert_points_ledger_delta(
                season.id,
                target_user_id,
                user_public.id,
                points_delta,
                reason=reason,
            )
    return SuccessResponse()


@router.get("/tournaments/{tournament_id}/league/admin/export/tournament_format")
async def export_tournament_format(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> dict:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    tournament = await sql_get_tournament(tournament_id)
    return {
        "template_type": "tournament_format",
        "data": tournament.model_dump(),
    }


@router.post("/tournaments/{tournament_id}/league/admin/import/tournament_format", response_model=SuccessResponse)
async def import_tournament_format(
    tournament_id: TournamentId,
    body: TournamentUpdateBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
) -> SuccessResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    await sql_update_tournament(tournament_id, body)
    return SuccessResponse()
