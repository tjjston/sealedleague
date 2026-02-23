from fastapi import APIRouter, Depends, HTTPException
from heliclockter import datetime_utc
from starlette import status

from bracket.config import config
from bracket.database import database
from bracket.logic.planning.conflicts import handle_conflicts
from bracket.logic.planning.matches import update_start_times_of_matches
from bracket.logic.planning.rounds import (
    MatchTimingAdjustmentInfeasible,
    get_all_scheduling_operations_for_swiss_round,
    get_draft_round,
)
from bracket.logic.ranking.calculation import recalculate_ranking_for_stage_item
from bracket.logic.ranking.elimination import (
    auto_advance_byes_in_elimination_stage_item,
    update_inputs_in_complete_elimination_stage_item,
)
from bracket.logic.scheduling.builder import (
    build_matches_for_stage_item,
)
from bracket.logic.scheduling.upcoming_matches import get_upcoming_matches_for_swiss
from bracket.logic.subscriptions import check_requirement
from bracket.models.db.match import MatchCreateBody, MatchFilter, SuggestedMatch
from bracket.models.db.round import RoundInsertable
from bracket.models.db.stage_item import (
    StageItemActivateNextBody,
    StageItemCreateBody,
    StageItemUpdateBody,
    StageItemWinnerConfirmationBody,
    StageType,
)
from bracket.models.db.tournament import Tournament
from bracket.models.db.user import UserPublic
from bracket.models.db.util import StageItemWithRounds
from bracket.routes.auth import (
    user_authenticated_for_tournament,
)
from bracket.routes.models import SuccessResponse
from bracket.routes.util import disallow_archived_tournament, stage_item_dependency
from bracket.sql.courts import get_all_courts_in_tournament
from bracket.sql.matches import (
    null_unreported_matchups_in_stage_item,
    sql_create_match,
    sql_reschedule_match_and_determine_duration_and_margin,
)
from bracket.sql.rounds import (
    get_next_round_name,
    get_round_by_id,
    set_round_active_or_draft,
    sql_create_round,
)
from bracket.sql.shared import sql_delete_stage_item_with_foreign_keys
from bracket.sql.stage_items import (
    get_stage_item,
    sql_clear_stage_item_winner_confirmation,
    sql_confirm_stage_item_winner,
    sql_create_stage_item_with_empty_inputs,
)
from bracket.sql.stages import get_full_tournament_details
from bracket.sql.tournaments import sql_get_tournament
from bracket.sql.validation import check_foreign_keys_belong_to_tournament
from bracket.utils.errors import (
    ForeignKey,
    check_foreign_key_violation,
)
from bracket.utils.id_types import StageItemId, TournamentId

router = APIRouter(prefix=config.api_prefix)


def match_has_reported_result(match: object) -> bool:
    score1 = int(getattr(match, "stage_item_input1_score", 0) or 0)
    score2 = int(getattr(match, "stage_item_input2_score", 0) or 0)
    return not (score1 == 0 and score2 == 0)


def get_stage_item_winner_from_current_standings(
    stage_item: StageItemWithRounds,
) -> tuple[int, str]:
    ranked_inputs = sorted(
        [
            input_
            for input_ in stage_item.inputs
            if getattr(getattr(input_, "team", None), "name", None) is not None
        ],
        key=lambda input_: (
            -float(getattr(input_, "points", 0) or 0),
            -int(getattr(input_, "wins", 0) or 0),
            -int(getattr(input_, "draws", 0) or 0),
            int(getattr(input_, "losses", 0) or 0),
            str(getattr(getattr(input_, "team", None), "name", "") or "").lower(),
        ),
    )
    if len(ranked_inputs) < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No ranked teams found for this event",
        )

    winner_input = ranked_inputs[0]
    winner_team = getattr(winner_input, "team", None)
    winner_team_id = int(getattr(winner_team, "id", 0) or 0)
    winner_team_name = str(getattr(winner_team, "name", "") or "").strip()
    if winner_team_id <= 0 or winner_team_name == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not determine winner from current standings",
        )
    return winner_team_id, winner_team_name


@router.delete(
    "/tournaments/{tournament_id}/stage_items/{stage_item_id}", response_model=SuccessResponse
)
async def delete_stage_item(
    tournament_id: TournamentId,
    stage_item_id: StageItemId,
    _: UserPublic = Depends(user_authenticated_for_tournament),
    __: StageItemWithRounds = Depends(stage_item_dependency),
) -> SuccessResponse:
    with check_foreign_key_violation(
        {ForeignKey.matches_stage_item_input1_id_fkey, ForeignKey.matches_stage_item_input2_id_fkey}
    ):
        await sql_delete_stage_item_with_foreign_keys(stage_item_id)
    await update_start_times_of_matches(tournament_id)
    return SuccessResponse()


@router.post("/tournaments/{tournament_id}/stage_items", response_model=SuccessResponse)
async def create_stage_item(
    tournament_id: TournamentId,
    stage_body: StageItemCreateBody,
    user: UserPublic = Depends(user_authenticated_for_tournament),
) -> SuccessResponse:
    await check_foreign_keys_belong_to_tournament(stage_body, tournament_id)
    if stage_body.type == StageType.SINGLE_ELIMINATION and not (2 <= stage_body.team_count <= 64):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Single elimination supports team counts between 2 and 64",
        )
    if stage_body.type == StageType.DOUBLE_ELIMINATION and not (
        3 <= stage_body.team_count <= 64
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Double elimination supports team counts between 3 and 64",
        )

    stages = await get_full_tournament_details(tournament_id)
    existing_stage_items = [stage_item for stage in stages for stage_item in stage.stage_items]
    check_requirement(existing_stage_items, user, "max_stage_items")

    stage_item = await sql_create_stage_item_with_empty_inputs(tournament_id, stage_body)
    await build_matches_for_stage_item(stage_item, tournament_id)
    return SuccessResponse()


@router.put(
    "/tournaments/{tournament_id}/stage_items/{stage_item_id}", response_model=SuccessResponse
)
async def update_stage_item(
    tournament_id: TournamentId,
    stage_item_id: StageItemId,
    stage_item_body: StageItemUpdateBody,
    _: UserPublic = Depends(user_authenticated_for_tournament),
    __: Tournament = Depends(disallow_archived_tournament),
    stage_item: StageItemWithRounds = Depends(stage_item_dependency),
) -> SuccessResponse:
    if stage_item is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not find all stages",
        )

    query = """
        UPDATE stage_items
        SET name = :name
        WHERE stage_items.id = :stage_item_id
    """
    await database.execute(
        query=query,
        values={"stage_item_id": stage_item_id, "name": stage_item_body.name},
    )
    await recalculate_ranking_for_stage_item(tournament_id, stage_item)
    if stage_item.type in {StageType.SINGLE_ELIMINATION, StageType.DOUBLE_ELIMINATION}:
        await update_inputs_in_complete_elimination_stage_item(tournament_id, stage_item.id)
    return SuccessResponse()


@router.put(
    "/tournaments/{tournament_id}/stage_items/{stage_item_id}/winner_confirmation",
    response_model=SuccessResponse,
)
async def put_stage_item_winner_confirmation(
    tournament_id: TournamentId,
    stage_item_id: StageItemId,
    body: StageItemWinnerConfirmationBody,
    user: UserPublic = Depends(user_authenticated_for_tournament),
    _: Tournament = Depends(disallow_archived_tournament),
    stage_item: StageItemWithRounds = Depends(stage_item_dependency),
) -> SuccessResponse:
    if not body.confirmed:
        await sql_clear_stage_item_winner_confirmation(stage_item_id)
        return SuccessResponse()

    non_draft_matches = [
        match
        for round_ in stage_item.rounds
        if not round_.is_draft
        for match in round_.matches
    ]
    if len(non_draft_matches) < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot confirm winner: this event has no reported matchups",
        )

    has_pending_matches = any(not match_has_reported_result(match) for match in non_draft_matches)
    if has_pending_matches:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot confirm winner while unreported matchups remain. Use end early if needed.",
        )

    await recalculate_ranking_for_stage_item(tournament_id, stage_item)
    refreshed_stage_item = await get_stage_item(tournament_id, stage_item_id)
    winner_team_id, winner_team_name = get_stage_item_winner_from_current_standings(
        refreshed_stage_item
    )
    await sql_confirm_stage_item_winner(
        stage_item_id,
        winner_team_id,
        winner_team_name,
        user,
        ended_early=False,
    )
    return SuccessResponse()


@router.post(
    "/tournaments/{tournament_id}/stage_items/{stage_item_id}/end_early",
    response_model=SuccessResponse,
)
async def end_stage_item_early(
    tournament_id: TournamentId,
    stage_item_id: StageItemId,
    user: UserPublic = Depends(user_authenticated_for_tournament),
    _: Tournament = Depends(disallow_archived_tournament),
    stage_item: StageItemWithRounds = Depends(stage_item_dependency),
) -> SuccessResponse:
    if stage_item.type in {StageType.SINGLE_ELIMINATION, StageType.DOUBLE_ELIMINATION}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ending early is only supported for Swiss, Round Robin, and regular season events",
        )

    non_draft_matches = [
        match
        for round_ in stage_item.rounds
        if not round_.is_draft
        for match in round_.matches
    ]
    if len(non_draft_matches) < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot end early: this event has no matchups",
        )

    has_pending_matches = any(not match_has_reported_result(match) for match in non_draft_matches)
    if not has_pending_matches:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This event is already complete. Confirm the winner instead.",
        )

    await null_unreported_matchups_in_stage_item(tournament_id, stage_item_id)
    refreshed_stage_item = await get_stage_item(tournament_id, stage_item_id)
    await recalculate_ranking_for_stage_item(tournament_id, refreshed_stage_item)
    refreshed_stage_item = await get_stage_item(tournament_id, stage_item_id)
    winner_team_id, winner_team_name = get_stage_item_winner_from_current_standings(
        refreshed_stage_item
    )
    await sql_confirm_stage_item_winner(
        stage_item_id,
        winner_team_id,
        winner_team_name,
        user,
        ended_early=True,
    )
    return SuccessResponse()


@router.post(
    "/tournaments/{tournament_id}/stage_items/{stage_item_id}/start_next_round",
    response_model=SuccessResponse,
)
async def start_next_round(
    tournament_id: TournamentId,
    stage_item_id: StageItemId,
    active_next_body: StageItemActivateNextBody,
    stage_item: StageItemWithRounds = Depends(stage_item_dependency),
    user: UserPublic = Depends(user_authenticated_for_tournament),
    elo_diff_threshold: int = 200,
    iterations: int = 2_000,
    only_recommended: bool = False,
    _: Tournament = Depends(disallow_archived_tournament),
) -> SuccessResponse:
    if stage_item.type in {StageType.SINGLE_ELIMINATION, StageType.DOUBLE_ELIMINATION}:
        await update_inputs_in_complete_elimination_stage_item(tournament_id, stage_item_id)
        stage_item = await get_stage_item(tournament_id, stage_item_id)
        stage_item = await auto_advance_byes_in_elimination_stage_item(
            tournament_id,
            stage_item,
            await sql_get_tournament(tournament_id),
        )
        await recalculate_ranking_for_stage_item(tournament_id, stage_item)
        return SuccessResponse()

    if stage_item.type is not StageType.SWISS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Starting the next round is only supported for Swiss stage items. "
                "Elimination stages advance automatically when match scores are reported."
            ),
        )

    draft_round = get_draft_round(stage_item)
    if draft_round is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="There is already a draft round in this stage item, please delete it first",
        )

    match_filter = MatchFilter(
        elo_diff_threshold=elo_diff_threshold,
        only_recommended=only_recommended,
        limit=1,
        iterations=iterations,
    )
    all_matches_to_schedule = get_upcoming_matches_for_swiss(match_filter, stage_item)
    if len(all_matches_to_schedule) < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No more matches to schedule, all combinations of teams have been added already",
        )

    stages = await get_full_tournament_details(tournament_id)
    existing_rounds = [
        round_
        for stage in stages
        for stage_item in stage.stage_items
        for round_ in stage_item.rounds
    ]
    check_requirement(existing_rounds, user, "max_rounds")

    round_id = await sql_create_round(
        RoundInsertable(
            created=datetime_utc.now(),
            is_draft=True,
            stage_item_id=stage_item_id,
            name=await get_next_round_name(tournament_id, stage_item_id),
        ),
    )
    draft_round = await get_round_by_id(tournament_id, round_id)
    tournament = await sql_get_tournament(tournament_id)
    courts = await get_all_courts_in_tournament(tournament_id)

    limit = len(courts) - len(draft_round.matches)
    for ___ in range(limit):
        stage_item = await get_stage_item(tournament_id, stage_item_id)
        draft_round = next(round_ for round_ in stage_item.rounds if round_.is_draft)
        all_matches_to_schedule = get_upcoming_matches_for_swiss(
            match_filter, stage_item, draft_round
        )
        if len(all_matches_to_schedule) < 1:
            break

        match = all_matches_to_schedule[0]
        assert isinstance(match, SuggestedMatch)

        assert draft_round.id and match.stage_item_input1.id and match.stage_item_input2.id
        await sql_create_match(
            MatchCreateBody(
                round_id=draft_round.id,
                stage_item_input1_id=match.stage_item_input1.id,
                stage_item_input2_id=match.stage_item_input2.id,
                court_id=None,
                stage_item_input1_winner_from_match_id=None,
                stage_item_input2_winner_from_match_id=None,
                duration_minutes=tournament.duration_minutes,
                margin_minutes=tournament.margin_minutes,
                custom_duration_minutes=None,
                custom_margin_minutes=None,
            ),
        )

    draft_round = await get_round_by_id(tournament_id, round_id)
    try:
        stages = await get_full_tournament_details(tournament_id)
        court_ids = [court.id for court in courts]

        rescheduling_operations = get_all_scheduling_operations_for_swiss_round(
            court_ids, stages, tournament, draft_round.matches, active_next_body.adjust_to_time
        )

        # TODO: if safe: await asyncio.gather(*rescheduling_operations)
        for op in rescheduling_operations:
            await sql_reschedule_match_and_determine_duration_and_margin(*op)
    except MatchTimingAdjustmentInfeasible as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    await set_round_active_or_draft(draft_round.id, tournament_id, is_draft=False)
    await handle_conflicts(await get_full_tournament_details(tournament_id))
    return SuccessResponse()
