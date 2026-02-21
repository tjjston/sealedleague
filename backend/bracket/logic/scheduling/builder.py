from fastapi import HTTPException

from bracket.logic.ranking.calculation import recalculate_ranking_for_stage_item
from bracket.logic.ranking.elimination import (
    auto_advance_byes_in_elimination_stage_item,
    update_inputs_in_complete_elimination_stage_item,
)
from bracket.logic.scheduling.elimination import (
    build_double_elimination_stage_item,
    build_single_elimination_stage_item,
    get_number_of_rounds_to_create_single_elimination,
)
from bracket.logic.scheduling.round_robin import (
    build_round_robin_stage_item,
    get_number_of_rounds_to_create_round_robin,
)
from bracket.models.db.round import RoundInsertable
from bracket.models.db.stage_item import StageItem, StageType
from bracket.models.db.stage_item_inputs import (
    StageItemInputFinal,
    StageItemInputOptionFinal,
    StageItemInputOptionTentative,
    StageItemInputTentative,
)
from bracket.models.db.team import FullTeamWithPlayers
from bracket.models.db.util import StageWithStageItems
from bracket.sql.rounds import sql_create_round
from bracket.sql.stage_items import get_stage_item
from bracket.sql.tournaments import sql_get_tournament
from bracket.utils.id_types import StageId, StageItemId, TournamentId
from tests.integration_tests.mocks import MOCK_NOW


async def create_rounds_for_new_stage_item(
    _tournament_id: TournamentId, stage_item: StageItem
) -> None:
    round_names: list[str]
    match stage_item.type:
        case StageType.ROUND_ROBIN:
            rounds_count = get_number_of_rounds_to_create_round_robin(stage_item.team_count)
            round_names = [f"Round {index}" for index in range(1, rounds_count + 1)]
        case StageType.REGULAR_SEASON_MATCHUP:
            rounds_count = get_number_of_rounds_to_create_round_robin(stage_item.team_count)
            round_names = [f"Round {index}" for index in range(1, rounds_count + 1)]
        case StageType.SINGLE_ELIMINATION:
            rounds_count = get_number_of_rounds_to_create_single_elimination(stage_item.team_count)
            round_names = [f"Round {index}" for index in range(1, rounds_count + 1)]
        case StageType.DOUBLE_ELIMINATION:
            winners_round_count = get_number_of_rounds_to_create_single_elimination(
                stage_item.team_count
            )
            losers_round_count = 2 * winners_round_count - 2
            round_names = (
                [f"WB Round {index}" for index in range(1, winners_round_count + 1)]
                + [f"LB Round {index}" for index in range(1, losers_round_count + 1)]
                + ["Grand Final", "Grand Final Reset"]
            )
        case StageType.SWISS:
            return None
        case other:
            raise NotImplementedError(f"No round creation implementation for {other}")

    for round_name in round_names:
        await sql_create_round(
            RoundInsertable(
                created=MOCK_NOW,
                is_draft=False,
                stage_item_id=stage_item.id,
                name=round_name,
            ),
        )


async def build_matches_for_stage_item(stage_item: StageItem, tournament_id: TournamentId) -> None:
    await create_rounds_for_new_stage_item(tournament_id, stage_item)
    stage_item_with_rounds = await get_stage_item(tournament_id, stage_item.id)

    match stage_item.type:
        case StageType.ROUND_ROBIN:
            await build_round_robin_stage_item(tournament_id, stage_item_with_rounds)
        case StageType.REGULAR_SEASON_MATCHUP:
            await build_round_robin_stage_item(tournament_id, stage_item_with_rounds)
        case StageType.SINGLE_ELIMINATION:
            await build_single_elimination_stage_item(tournament_id, stage_item_with_rounds)
        case StageType.DOUBLE_ELIMINATION:
            await build_double_elimination_stage_item(tournament_id, stage_item_with_rounds)
        case StageType.SWISS:
            return None

        case _:
            raise HTTPException(
                400, f"Cannot automatically create matches for stage type {stage_item.type}"
            )

    stage_item_with_rounds = await get_stage_item(tournament_id, stage_item.id)
    if stage_item.type in {StageType.SINGLE_ELIMINATION, StageType.DOUBLE_ELIMINATION}:
        await update_inputs_in_complete_elimination_stage_item(
            tournament_id, stage_item_with_rounds.id
        )
        stage_item_with_rounds = await auto_advance_byes_in_elimination_stage_item(
            tournament_id,
            stage_item_with_rounds,
            await sql_get_tournament(tournament_id),
        )

    await recalculate_ranking_for_stage_item(tournament_id, stage_item_with_rounds)


def determine_available_inputs(
    teams: list[FullTeamWithPlayers],
    stages: list[StageWithStageItems],
) -> dict[StageId, list[StageItemInputOptionTentative | StageItemInputOptionFinal]]:
    """
    Returns available inputs for the given stage.

    Inputs are either from:
    - Teams directly
    - Previous ROUND_ROBIN, REGULAR_SEASON_MATCHUP, or SWISS stage items (tentative options)
    """
    all_team_options = {
        team.id: StageItemInputOptionFinal(team_id=team.id, already_taken=False) for team in teams
    }
    # Add inputs from non-elimination stage items that can be used in the next stage.
    # Elimination stage items have no "outputs" but are final.
    all_tentative_options = {
        (stage_item.id, winner_position): StageItemInputOptionTentative(
            winner_from_stage_item_id=stage_item.id,
            winner_position=winner_position,
            already_taken=False,
        )
        for stage in stages
        for stage_item in stage.stage_items
        if stage_item.type in {
            StageType.ROUND_ROBIN,
            StageType.REGULAR_SEASON_MATCHUP,
            StageType.SWISS,
        }
        for winner_position in range(1, stage_item.team_count + 1)
    }

    # Determine which inputs have been used (set `already_taken` to True)
    for stage in stages:
        for stage_item in stage.stage_items:
            for input_ in stage_item.inputs:
                match input_:
                    case StageItemInputFinal() as final if input_.team_id in all_team_options:
                        all_team_options[final.team_id].already_taken = True

                    case StageItemInputTentative() as tentative:
                        if (key := tentative.get_lookup_key()) in all_tentative_options:
                            all_tentative_options[key].already_taken = True

    # Loop through stage items once more to assemble the final results and make sure
    # tentative inputs are only available after the stage item that they originate from.
    # We start with all teams but not tentative inputs.
    results_teams = all_team_options.copy()
    results_tentative: dict[tuple[StageItemId, int], StageItemInputOptionTentative] = {}
    results = {}

    for stage in stages:
        results[stage.id] = list(results_teams.values()) + list(results_tentative.values())

        # Add options for subsequent stage items for the tentative "outputs" from this round
        for stage_item in stage.stage_items:
            for (option_stage_item_id, option_win_pos), option in all_tentative_options.items():
                if option_stage_item_id == stage_item.id:
                    results_tentative[(option_stage_item_id, option_win_pos)] = option

    return results
