from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from starlette import status

from bracket.config import config
from bracket.database import database
from bracket.logic.planning.conflicts import handle_conflicts
from bracket.logic.planning.matches import (
    get_scheduled_matches,
    handle_match_reschedule,
    reorder_matches_for_court,
    schedule_all_unscheduled_matches,
)
from bracket.logic.ranking.calculation import (
    recalculate_ranking_for_stage_item,
)
from bracket.logic.ranking.elimination import (
    auto_advance_byes_in_elimination_stage_item,
    update_inputs_in_subsequent_elimination_rounds,
)
from bracket.logic.scheduling.upcoming_matches import (
    get_draft_round_in_stage_item,
    get_upcoming_matches_for_swiss,
)
from bracket.models.db.match import (
    Match,
    MatchBody,
    MatchDeckSelectionBody,
    MatchKarabastBundle,
    MatchKarabastDeckExport,
    MatchKarabastGameNameBody,
    MatchCreateBody,
    MatchCreateBodyFrontend,
    MatchFilter,
    MatchRescheduleBody,
    MatchWithDetails,
)
from bracket.models.db.stage_item import StageType
from bracket.models.db.tournament import Tournament
from bracket.models.db.user import UserPublic
from bracket.routes.auth import (
    is_admin_user,
    user_authenticated_for_tournament,
    user_authenticated_for_tournament_member,
)
from bracket.routes.models import (
    MatchKarabastBundleResponse,
    SingleMatchResponse,
    SuccessResponse,
    UpcomingMatchesResponse,
)
from bracket.routes.util import disallow_archived_tournament, match_dependency
from bracket.sql.courts import get_all_courts_in_tournament
from bracket.sql.league import (
    get_deck_by_id,
    get_decks_for_tournament_club_users,
    get_decks_for_tournament_scope,
    get_tournament_applications,
)
from bracket.sql.matches import (
    sql_create_match,
    sql_delete_match,
    sql_update_match_deck_ids,
    sql_update_karabast_game_name,
    sql_update_match,
)
from bracket.sql.players import recalculate_tournament_records
from bracket.sql.rounds import get_round_by_id
from bracket.sql.stage_items import get_stage_item, sql_clear_stage_item_winner_confirmation
from bracket.sql.stages import get_full_tournament_details
from bracket.sql.tournaments import sql_get_tournament
from bracket.sql.validation import check_foreign_keys_belong_to_tournament
from bracket.utils.id_types import DeckId, MatchId, StageItemId, TournamentId
from bracket.utils.swudb import build_swudb_deck_export
from bracket.utils.types import assert_some

router = APIRouter(prefix=config.api_prefix)


async def user_is_participant_in_match(
    tournament_id: TournamentId, user: UserPublic, match: Match
) -> bool:
    target_name = user.name.strip().lower()
    if target_name == "":
        return False

    team_ids: list[int] = []
    for stage_input in [match.stage_item_input1, match.stage_item_input2]:
        if stage_input is None:
            continue
        team_id = getattr(stage_input, "team_id", None)
        if team_id is not None:
            team_ids.append(int(team_id))
        team = getattr(stage_input, "team", None)
        if team is None:
            continue
        team_name = str(getattr(team, "name", "")).strip().lower()
        if team_name == target_name:
            return True

    if len(team_ids) < 1:
        input_ids = [
            int(input_id)
            for input_id in [match.stage_item_input1_id, match.stage_item_input2_id]
            if input_id is not None
        ]
        if len(input_ids) > 0:
            input_rows = await database.fetch_all(
                """
                SELECT team_id
                FROM stage_item_inputs
                WHERE id = ANY(:input_ids)
                  AND tournament_id = :tournament_id
                  AND team_id IS NOT NULL
                """,
                values={"input_ids": input_ids, "tournament_id": int(tournament_id)},
            )
            team_ids.extend(
                int(row._mapping["team_id"])
                for row in input_rows
                if row is not None and row._mapping["team_id"] is not None
            )

    if len(team_ids) < 1:
        return False

    first_team_id = team_ids[0]
    second_team_id = team_ids[1] if len(team_ids) > 1 else team_ids[0]
    row = await database.fetch_one(
        """
        SELECT 1
        FROM players p
        JOIN players_x_teams pxt ON pxt.player_id = p.id
        WHERE p.tournament_id = :tournament_id
          AND lower(trim(p.name)) = lower(trim(:user_name))
          AND (pxt.team_id = :team_id_1 OR pxt.team_id = :team_id_2)
        LIMIT 1
        """,
        values={
            "tournament_id": int(tournament_id),
            "user_name": user.name,
            "team_id_1": first_team_id,
            "team_id_2": second_team_id,
        },
    )
    return row is not None


def normalize_person_name(value: str | None) -> str:
    return str(value or "").strip().lower()


def get_stage_input_participant_names(stage_input: Any) -> set[str]:
    names: set[str] = set()
    if stage_input is None:
        return names

    team = getattr(stage_input, "team", None)
    team_name = normalize_person_name(getattr(team, "name", None))
    if team_name != "":
        names.add(team_name)

    players = getattr(team, "players", None)
    if isinstance(players, list):
        for player in players:
            player_name = normalize_person_name(getattr(player, "name", None))
            if player_name != "":
                names.add(player_name)
    return names


async def user_is_participant_in_stage_input(
    tournament_id: TournamentId,
    user: UserPublic,
    stage_input: Any,
) -> bool:
    target_name = normalize_person_name(user.name)
    if target_name == "":
        return False

    participant_names = get_stage_input_participant_names(stage_input)
    if target_name in participant_names:
        return True

    team_id = getattr(stage_input, "team_id", None)
    if team_id is None:
        return False

    row = await database.fetch_one(
        """
        SELECT 1
        FROM players p
        JOIN players_x_teams pxt ON pxt.player_id = p.id
        WHERE p.tournament_id = :tournament_id
          AND lower(trim(p.name)) = lower(trim(:user_name))
          AND pxt.team_id = :team_id
        LIMIT 1
        """,
        values={
            "tournament_id": int(tournament_id),
            "user_name": user.name,
            "team_id": int(team_id),
        },
    )
    return row is not None


async def validate_deck_selection_for_stage_input(
    deck_id: DeckId,
    stage_input: Any,
    side_label: str,
) -> Any:
    deck = await get_deck_by_id(deck_id)
    if deck is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Could not find deck with id {int(deck_id)}",
        )

    participant_names = get_stage_input_participant_names(stage_input)
    if len(participant_names) < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot assign a deck to {side_label} before that side has a resolved player",
        )

    if normalize_person_name(deck.user_name) not in participant_names:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Selected deck does not belong to {side_label}",
        )
    return deck


def normalize_karabast_game_name(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized if normalized != "" else None


def default_karabast_game_name(tournament_id: TournamentId, match_id: MatchId) -> str:
    return f"SL-{int(tournament_id)}-M{int(match_id)}"


async def get_match_with_details_for_tournament(
    tournament_id: TournamentId, match_id: MatchId
) -> MatchWithDetails:
    stages = await get_full_tournament_details(tournament_id, no_draft_rounds=False)
    for stage in stages:
        for stage_item in stage.stage_items:
            for round_ in stage_item.rounds:
                for match in round_.matches:
                    if int(match.id) == int(match_id):
                        return match
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Could not find match with id {match_id}",
    )


async def ensure_regular_season_match_has_submitted_decks(
    tournament_id: TournamentId, match: Match
) -> None:
    applications = await get_tournament_applications(tournament_id)
    applications_by_name = {
        normalize_person_name(application.user_name): application for application in applications
    }

    missing_names: list[str] = []
    for stage_input in [match.stage_item_input1, match.stage_item_input2]:
        team_name = str(getattr(getattr(stage_input, "team", None), "name", "")).strip()
        if team_name == "":
            continue
        application = applications_by_name.get(normalize_person_name(team_name))
        if application is None or application.deck_id is None:
            missing_names.append(team_name)

    if len(missing_names) < 1:
        return

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            "All players in a regular season matchup must submit a deck before entering scores. "
            f"Missing submission: {', '.join(sorted(set(missing_names)))}"
        ),
    )


def has_reported_result(input1_score: int, input2_score: int) -> bool:
    return int(input1_score) != 0 or int(input2_score) != 0


async def maybe_snapshot_match_decks_on_score_submission(
    tournament_id: TournamentId,
    match: MatchWithDetails,
    match_body: MatchBody,
    scores_changed: bool,
) -> None:
    if not scores_changed:
        return
    if not has_reported_result(
        int(match_body.stage_item_input1_score), int(match_body.stage_item_input2_score)
    ):
        return

    current_deck_1_id = (
        int(match.stage_item_input1_deck_id) if match.stage_item_input1_deck_id is not None else None
    )
    current_deck_2_id = (
        int(match.stage_item_input2_deck_id) if match.stage_item_input2_deck_id is not None else None
    )
    if current_deck_1_id is not None and current_deck_2_id is not None:
        return

    applications = await get_tournament_applications(tournament_id)
    applications_by_name = {
        normalize_person_name(application.user_name): application for application in applications
    }
    next_deck_ids = [current_deck_1_id, current_deck_2_id]
    stage_inputs = [match.stage_item_input1, match.stage_item_input2]

    for index, stage_input in enumerate(stage_inputs):
        if next_deck_ids[index] is not None:
            continue

        team_name = str(getattr(getattr(stage_input, "team", None), "name", "")).strip()
        if team_name == "":
            continue

        application = applications_by_name.get(normalize_person_name(team_name))
        if application is None or application.deck_id is None:
            continue

        selected_deck = await get_deck_by_id(DeckId(int(application.deck_id)))
        if selected_deck is None:
            continue

        participant_names = get_stage_input_participant_names(stage_input)
        selected_deck_owner = normalize_person_name(getattr(selected_deck, "user_name", None))
        if selected_deck_owner == "" or selected_deck_owner not in participant_names:
            continue

        next_deck_ids[index] = int(selected_deck.id)

    if next_deck_ids[0] == current_deck_1_id and next_deck_ids[1] == current_deck_2_id:
        return

    await sql_update_match_deck_ids(
        match.id,
        DeckId(next_deck_ids[0]) if next_deck_ids[0] is not None else None,
        DeckId(next_deck_ids[1]) if next_deck_ids[1] is not None else None,
    )


async def maybe_auto_complete_double_elimination_reset(
    tournament_id: TournamentId,
    stage_item: Any,
    updated_match_id: MatchId,
    tournament: Tournament,
) -> None:
    ordered_rounds = sorted(stage_item.rounds, key=lambda round_: int(round_.id))
    if len(ordered_rounds) < 2:
        return

    grand_final_round = ordered_rounds[-2]
    reset_round = ordered_rounds[-1]
    if len(grand_final_round.matches) != 1 or len(reset_round.matches) != 1:
        return

    grand_final_match = grand_final_round.matches[0]
    reset_match = reset_round.matches[0]
    if int(grand_final_match.id) != int(updated_match_id):
        return
    if grand_final_match.stage_item_input1_score == grand_final_match.stage_item_input2_score:
        return

    winners_bracket_champion_won = (
        grand_final_match.stage_item_input1_score > grand_final_match.stage_item_input2_score
    )
    if not winners_bracket_champion_won:
        return

    if reset_match.stage_item_input1_score != 0 or reset_match.stage_item_input2_score != 0:
        return

    await sql_update_match(
        reset_match.id,
        MatchBody(
            round_id=reset_match.round_id,
            stage_item_input1_score=1,
            stage_item_input2_score=0,
            court_id=reset_match.court_id,
            custom_duration_minutes=reset_match.custom_duration_minutes,
            custom_margin_minutes=reset_match.custom_margin_minutes,
        ),
        tournament,
    )
    refreshed_stage_item = await get_stage_item(tournament_id, stage_item.id)
    await recalculate_ranking_for_stage_item(tournament_id, refreshed_stage_item)


@router.get(
    "/tournaments/{tournament_id}/stage_items/{stage_item_id}/upcoming_matches",
    response_model=UpcomingMatchesResponse,
)
async def get_matches_to_schedule(
    tournament_id: TournamentId,
    stage_item_id: StageItemId,
    elo_diff_threshold: int = 200,
    iterations: int = 2_000,
    only_recommended: bool = False,
    limit: int = 50,
    _: UserPublic = Depends(user_authenticated_for_tournament),
) -> UpcomingMatchesResponse:
    match_filter = MatchFilter(
        elo_diff_threshold=elo_diff_threshold,
        only_recommended=only_recommended,
        limit=limit,
        iterations=iterations,
    )

    draft_round, stage_item = await get_draft_round_in_stage_item(tournament_id, stage_item_id)
    courts = await get_all_courts_in_tournament(tournament_id)
    if len(courts) <= len(draft_round.matches):
        return UpcomingMatchesResponse(data=[])

    return UpcomingMatchesResponse(
        data=get_upcoming_matches_for_swiss(match_filter, stage_item, draft_round)
    )


@router.delete("/tournaments/{tournament_id}/matches/{match_id}", response_model=SuccessResponse)
async def delete_match(
    tournament_id: TournamentId,
    _: UserPublic = Depends(user_authenticated_for_tournament),
    __: Tournament = Depends(disallow_archived_tournament),
    match: Match = Depends(match_dependency),
) -> SuccessResponse:
    round_ = await get_round_by_id(tournament_id, match.round_id)
    stage_item = await get_stage_item(tournament_id, round_.stage_item_id)

    if not round_.is_draft or stage_item.type != StageType.SWISS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only delete matches from draft rounds in Swiss stage items",
        )

    await sql_delete_match(match.id)

    stage_item = await get_stage_item(tournament_id, round_.stage_item_id)

    await recalculate_ranking_for_stage_item(tournament_id, stage_item)
    await recalculate_tournament_records(tournament_id)
    return SuccessResponse()


@router.post("/tournaments/{tournament_id}/matches", response_model=SingleMatchResponse)
async def create_match(
    tournament_id: TournamentId,
    match_body: MatchCreateBodyFrontend,
    _: UserPublic = Depends(user_authenticated_for_tournament),
    __: Tournament = Depends(disallow_archived_tournament),
) -> SingleMatchResponse:
    await check_foreign_keys_belong_to_tournament(match_body, tournament_id)

    round_ = await get_round_by_id(tournament_id, match_body.round_id)
    stage_item = await get_stage_item(tournament_id, round_.stage_item_id)

    if not round_.is_draft or stage_item.type != StageType.SWISS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only create matches in draft rounds of Swiss stage items",
        )

    tournament = await sql_get_tournament(tournament_id)
    body_with_durations = MatchCreateBody(
        **match_body.model_dump(),
        duration_minutes=tournament.duration_minutes,
        margin_minutes=tournament.margin_minutes,
    )

    return SingleMatchResponse(data=await sql_create_match(body_with_durations))


@router.post("/tournaments/{tournament_id}/schedule_matches", response_model=SuccessResponse)
async def schedule_matches(
    tournament_id: TournamentId,
    _: UserPublic = Depends(user_authenticated_for_tournament),
    __: Tournament = Depends(disallow_archived_tournament),
) -> SuccessResponse:
    stages = await get_full_tournament_details(tournament_id)
    await schedule_all_unscheduled_matches(tournament_id, stages)
    return SuccessResponse()


@router.post(
    "/tournaments/{tournament_id}/matches/{match_id}/reschedule", response_model=SuccessResponse
)
async def reschedule_match(
    tournament_id: TournamentId,
    match_id: MatchId,
    body: MatchRescheduleBody,
    tournament: Tournament = Depends(disallow_archived_tournament),
    _: UserPublic = Depends(user_authenticated_for_tournament),
) -> SuccessResponse:
    await check_foreign_keys_belong_to_tournament(body, tournament_id)
    await handle_match_reschedule(tournament, body, match_id)
    await handle_conflicts(await get_full_tournament_details(tournament_id))
    return SuccessResponse()


@router.put(
    "/tournaments/{tournament_id}/matches/{match_id}/karabast_game_name",
    response_model=SuccessResponse,
)
async def put_karabast_game_name(
    tournament_id: TournamentId,
    match_id: MatchId,
    body: MatchKarabastGameNameBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
    tournament: Tournament = Depends(disallow_archived_tournament),
) -> SuccessResponse:
    _ = tournament

    match = await get_match_with_details_for_tournament(tournament_id, match_id)
    if not is_admin_user(user_public):
        if not await user_is_participant_in_match(tournament_id, user_public, match):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="You can only edit Karabast lobby name for matches you are playing in",
            )

    await sql_update_karabast_game_name(
        match_id,
        normalize_karabast_game_name(body.karabast_game_name),
    )
    return SuccessResponse()


@router.put(
    "/tournaments/{tournament_id}/matches/{match_id}/decks",
    response_model=SuccessResponse,
)
async def put_match_decks(
    tournament_id: TournamentId,
    match_id: MatchId,
    body: MatchDeckSelectionBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
    _: Tournament = Depends(disallow_archived_tournament),
) -> SuccessResponse:
    match = await get_match_with_details_for_tournament(tournament_id, match_id)

    current_deck_1_id = (
        int(match.stage_item_input1_deck_id) if match.stage_item_input1_deck_id is not None else None
    )
    current_deck_2_id = (
        int(match.stage_item_input2_deck_id) if match.stage_item_input2_deck_id is not None else None
    )
    requested_deck_1_id = (
        int(body.stage_item_input1_deck_id) if body.stage_item_input1_deck_id is not None else None
    )
    requested_deck_2_id = (
        int(body.stage_item_input2_deck_id) if body.stage_item_input2_deck_id is not None else None
    )

    changed_deck_1 = requested_deck_1_id != current_deck_1_id
    changed_deck_2 = requested_deck_2_id != current_deck_2_id

    if not is_admin_user(user_public):
        can_edit_side_1 = await user_is_participant_in_stage_input(
            tournament_id,
            user_public,
            match.stage_item_input1,
        )
        can_edit_side_2 = await user_is_participant_in_stage_input(
            tournament_id,
            user_public,
            match.stage_item_input2,
        )
        if (changed_deck_1 and not can_edit_side_1) or (changed_deck_2 and not can_edit_side_2):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="You can only edit deck selection for matches you are playing in",
            )

    if requested_deck_1_id is not None:
        await validate_deck_selection_for_stage_input(
            DeckId(requested_deck_1_id),
            match.stage_item_input1,
            "player 1",
        )
    if requested_deck_2_id is not None:
        await validate_deck_selection_for_stage_input(
            DeckId(requested_deck_2_id),
            match.stage_item_input2,
            "player 2",
        )

    await sql_update_match_deck_ids(
        match_id,
        DeckId(requested_deck_1_id) if requested_deck_1_id is not None else None,
        DeckId(requested_deck_2_id) if requested_deck_2_id is not None else None,
    )
    return SuccessResponse()


@router.get(
    "/tournaments/{tournament_id}/matches/{match_id}/karabast_bundle",
    response_model=MatchKarabastBundleResponse,
)
async def get_karabast_bundle(
    tournament_id: TournamentId,
    match_id: MatchId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
    tournament: Tournament = Depends(disallow_archived_tournament),
) -> MatchKarabastBundleResponse:
    _ = tournament

    match = await get_match_with_details_for_tournament(tournament_id, match_id)
    if not is_admin_user(user_public):
        if not await user_is_participant_in_match(tournament_id, user_public, match):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="You can only export Karabast data for matches you are playing in",
            )

    applications = await get_tournament_applications(tournament_id)
    application_by_name = {
        normalize_person_name(application.user_name): application for application in applications
    }
    scoped_fallback_decks = await get_decks_for_tournament_scope(tournament_id)
    club_user_fallback_decks = await get_decks_for_tournament_club_users(tournament_id)
    fallback_decks: list[Any] = []
    seen_deck_ids: set[int] = set()
    for fallback_deck in [*scoped_fallback_decks, *club_user_fallback_decks]:
        fallback_deck_id = int(getattr(fallback_deck, "id", 0))
        if fallback_deck_id in seen_deck_ids:
            continue
        seen_deck_ids.add(fallback_deck_id)
        fallback_decks.append(fallback_deck)
    fallback_deck_by_user_name: dict[str, Any] = {}
    for fallback_deck in fallback_decks:
        key = normalize_person_name(getattr(fallback_deck, "user_name", None))
        if key == "" or key in fallback_deck_by_user_name:
            continue
        fallback_deck_by_user_name[key] = fallback_deck

    players: list[MatchKarabastDeckExport] = []
    stage_inputs = [match.stage_item_input1, match.stage_item_input2]
    selected_match_deck_ids = [match.stage_item_input1_deck_id, match.stage_item_input2_deck_id]
    for slot, stage_input in enumerate(stage_inputs, start=1):
        team_name = str(getattr(getattr(stage_input, "team", None), "name", "")).strip() or None
        team_name_key = normalize_person_name(team_name)
        application = (
            application_by_name.get(team_name_key) if team_name is not None else None
        )
        selected_user_id = application.user_id if application is not None else None
        selected_user_name = application.user_name if application is not None else None
        selected_deck_id = (
            int(application.deck_id)
            if application is not None and application.deck_id is not None
            else None
        )
        deck_export: dict | None = None
        deck_name: str | None = None
        selected_deck: Any | None = None

        forced_match_deck_id = selected_match_deck_ids[slot - 1]
        if forced_match_deck_id is not None:
            selected_deck_id = int(forced_match_deck_id)
        if selected_deck_id is not None:
            selected_deck = await get_deck_by_id(selected_deck_id)
            if selected_deck is not None:
                selected_user_id = getattr(selected_deck, "user_id", selected_user_id)
                selected_user_name = getattr(selected_deck, "user_name", selected_user_name)
        if selected_deck is None and forced_match_deck_id is None and team_name_key != "":
            fallback_deck = fallback_deck_by_user_name.get(team_name_key)
            if fallback_deck is not None:
                selected_deck = fallback_deck
                selected_deck_id = int(getattr(fallback_deck, "id", 0)) or None
                selected_user_id = getattr(fallback_deck, "user_id", selected_user_id)
                selected_user_name = getattr(fallback_deck, "user_name", selected_user_name)

        if selected_deck is not None:
            deck_name = str(getattr(selected_deck, "name", "")).strip() or None
            deck_export = build_swudb_deck_export(
                name=str(getattr(selected_deck, "name", "Deck")),
                leader=str(getattr(selected_deck, "leader", "")),
                base=str(getattr(selected_deck, "base", "")),
                mainboard=getattr(selected_deck, "mainboard", {}) or {},
                sideboard=getattr(selected_deck, "sideboard", {}) or {},
                author=selected_user_name,
            )

        players.append(
            MatchKarabastDeckExport(
                slot=slot,
                team_name=team_name,
                user_id=selected_user_id,
                user_name=selected_user_name,
                deck_id=selected_deck_id,
                deck_name=deck_name,
                deck_export=deck_export,
            )
        )

    game_name = (
        normalize_karabast_game_name(match.karabast_game_name)
        or default_karabast_game_name(tournament_id, match.id)
    )
    return MatchKarabastBundleResponse(
        data=MatchKarabastBundle(match_id=match.id, game_name=game_name, players=players)
    )


@router.put("/tournaments/{tournament_id}/matches/{match_id}", response_model=SuccessResponse)
async def update_match_by_id(
    tournament_id: TournamentId,
    match_id: MatchId,
    match_body: MatchBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament_member),
    __: Tournament = Depends(disallow_archived_tournament),
) -> SuccessResponse:
    match_with_details = await get_match_with_details_for_tournament(tournament_id, match_id)

    if not is_admin_user(user_public):
        if not await user_is_participant_in_match(tournament_id, user_public, match_with_details):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="You can only submit scores for matches you are playing in",
            )
        match_body = MatchBody(
            round_id=match_with_details.round_id,
            stage_item_input1_score=match_body.stage_item_input1_score,
            stage_item_input2_score=match_body.stage_item_input2_score,
            court_id=match_with_details.court_id,
            custom_duration_minutes=match_with_details.custom_duration_minutes,
            custom_margin_minutes=match_with_details.custom_margin_minutes,
        )

    await check_foreign_keys_belong_to_tournament(match_body, tournament_id)
    tournament = await sql_get_tournament(tournament_id)
    round_ = await get_round_by_id(tournament_id, match_with_details.round_id)
    stage_item = await get_stage_item(tournament_id, round_.stage_item_id)

    if stage_item.type == StageType.REGULAR_SEASON_MATCHUP:
        await ensure_regular_season_match_has_submitted_decks(tournament_id, match_with_details)

    scores_changed = (
        int(match_body.stage_item_input1_score) != int(match_with_details.stage_item_input1_score)
        or int(match_body.stage_item_input2_score) != int(match_with_details.stage_item_input2_score)
    )

    await sql_update_match(match_id, match_body, tournament)
    await maybe_snapshot_match_decks_on_score_submission(
        tournament_id, match_with_details, match_body, scores_changed
    )

    if scores_changed:
        await sql_clear_stage_item_winner_confirmation(stage_item.id)

    if (
        match_body.custom_duration_minutes != match_with_details.custom_duration_minutes
        or match_body.custom_margin_minutes != match_with_details.custom_margin_minutes
    ):
        tournament = await sql_get_tournament(tournament_id)
        scheduled_matches = get_scheduled_matches(await get_full_tournament_details(tournament_id))
        await reorder_matches_for_court(
            tournament, scheduled_matches, assert_some(match_with_details.court_id)
        )

    if stage_item.type in {StageType.SINGLE_ELIMINATION, StageType.DOUBLE_ELIMINATION}:
        refreshed_stage_item = await get_stage_item(tournament_id, round_.stage_item_id)
        await update_inputs_in_subsequent_elimination_rounds(
            round_.id, refreshed_stage_item, {match_id}
        )
        refreshed_stage_item = await get_stage_item(tournament_id, round_.stage_item_id)
        refreshed_stage_item = await auto_advance_byes_in_elimination_stage_item(
            tournament_id, refreshed_stage_item, tournament
        )
        if stage_item.type == StageType.DOUBLE_ELIMINATION:
            await maybe_auto_complete_double_elimination_reset(
                tournament_id, refreshed_stage_item, match_id, tournament
            )
        refreshed_stage_item = await get_stage_item(tournament_id, round_.stage_item_id)
        await recalculate_ranking_for_stage_item(tournament_id, refreshed_stage_item)
    else:
        await recalculate_ranking_for_stage_item(tournament_id, stage_item)

    await recalculate_tournament_records(tournament_id)
    return SuccessResponse()
