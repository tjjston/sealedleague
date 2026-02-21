from bracket.models.db.match import Match, MatchBody
from bracket.models.db.stage_item_inputs import StageItemInput
from bracket.models.db.tournament import Tournament
from bracket.models.db.util import StageItemWithRounds
from bracket.sql.matches import (
    sql_set_input_ids_for_match,
    sql_update_match,
)
from bracket.sql.stage_items import get_stage_item
from bracket.utils.id_types import (
    MatchId,
    RoundId,
    StageItemId,
    TournamentId,
)


def get_inputs_to_update_in_subsequent_elimination_rounds(
    current_round_id: RoundId,
    stage_item: StageItemWithRounds,
    match_ids: set[MatchId] | None = None,
) -> dict[MatchId, Match]:
    """
    Determine the updates of stage item input IDs in the elimination tree.

    Crucial aspect is that entering a winner for a match will influence matches of subsequent
    rounds, because of the tree-like structure of elimination stage items.
    """
    current_round = next(round_ for round_ in stage_item.rounds if round_.id == current_round_id)
    affected_matches: dict[MatchId, Match] = {
        match.id: match
        for match in current_round.matches
        if match_ids is None or match.id in match_ids
    }
    subsequent_rounds = [round_ for round_ in stage_item.rounds if round_.id > current_round.id]
    subsequent_rounds.sort(key=lambda round_: round_.id)
    subsequent_matches = [match for round_ in subsequent_rounds for match in round_.matches]

    for subsequent_match in subsequent_matches:
        updated_inputs: list[StageItemInput | None] = [
            subsequent_match.stage_item_input1,
            subsequent_match.stage_item_input2,
        ]
        original_inputs = updated_inputs.copy()

        if subsequent_match.stage_item_input1_winner_from_match_id is not None and (
            affected_match1 := affected_matches.get(
                subsequent_match.stage_item_input1_winner_from_match_id
            )
        ):
            updated_inputs[0] = affected_match1.get_winner()
        elif subsequent_match.stage_item_input1_loser_from_match_id is not None and (
            affected_match1 := affected_matches.get(
                subsequent_match.stage_item_input1_loser_from_match_id
            )
        ):
            updated_inputs[0] = affected_match1.get_loser()

        if subsequent_match.stage_item_input2_winner_from_match_id is not None and (
            affected_match2 := affected_matches.get(
                subsequent_match.stage_item_input2_winner_from_match_id
            )
        ):
            updated_inputs[1] = affected_match2.get_winner()
        elif subsequent_match.stage_item_input2_loser_from_match_id is not None and (
            affected_match2 := affected_matches.get(
                subsequent_match.stage_item_input2_loser_from_match_id
            )
        ):
            updated_inputs[1] = affected_match2.get_loser()

        if original_inputs != updated_inputs:
            input_ids = [input_.id if input_ else None for input_ in updated_inputs]

            affected_matches[subsequent_match.id] = subsequent_match.model_copy(
                update={
                    "stage_item_input1_id": input_ids[0],
                    "stage_item_input2_id": input_ids[1],
                    "stage_item_input1": updated_inputs[0],
                    "stage_item_input2": updated_inputs[1],
                }
            )

    # All affected matches need to be updated except for the inputs.
    return {
        match_id: match
        for match_id, match in affected_matches.items()
        if match_ids is None or match.id not in match_ids
    }


async def update_inputs_in_subsequent_elimination_rounds(
    current_round_id: RoundId,
    stage_item: StageItemWithRounds,
    match_ids: set[MatchId] | None = None,
) -> None:
    updates = get_inputs_to_update_in_subsequent_elimination_rounds(
        current_round_id, stage_item, match_ids
    )
    for _, match in updates.items():
        await sql_set_input_ids_for_match(
            match.round_id, match.id, [match.stage_item_input1_id, match.stage_item_input2_id]
        )


async def update_inputs_in_complete_elimination_stage_item(
    tournament_id: TournamentId,
    stage_item_id: StageItemId,
) -> None:
    stage_item = await get_stage_item(tournament_id, stage_item_id)
    round_ids = sorted((round_.id for round_ in stage_item.rounds), key=lambda round_id: int(round_id))
    for round_id in round_ids:
        stage_item = await get_stage_item(tournament_id, stage_item_id)
        match_ids_in_round = {
            match.id
            for round_ in stage_item.rounds
            if round_.id == round_id
            for match in round_.matches
        }
        await update_inputs_in_subsequent_elimination_rounds(
            round_id,
            stage_item,
            match_ids_in_round,
        )


async def auto_advance_byes_in_elimination_stage_item(
    tournament_id: TournamentId,
    stage_item: StageItemWithRounds,
    tournament: Tournament,
) -> StageItemWithRounds:
    """
    Automatically resolve elimination matches that have exactly one known input.
    This is used for seeded byes so higher seeds advance without manual score entry.
    """
    while True:
        candidate_match: Match | None = None

        for round_ in sorted(stage_item.rounds, key=lambda current: int(current.id)):
            for match in round_.matches:
                has_input1 = match.stage_item_input1_id is not None
                has_input2 = match.stage_item_input2_id is not None
                has_single_input = has_input1 != has_input2
                has_no_result_yet = (
                    match.stage_item_input1_score == match.stage_item_input2_score
                )
                if has_single_input and has_no_result_yet:
                    candidate_match = match
                    break
            if candidate_match is not None:
                break

        if candidate_match is None:
            return stage_item

        score_1 = 1 if candidate_match.stage_item_input1_id is not None else 0
        score_2 = 1 if candidate_match.stage_item_input2_id is not None else 0
        await sql_update_match(
            candidate_match.id,
            MatchBody(
                round_id=candidate_match.round_id,
                stage_item_input1_score=score_1,
                stage_item_input2_score=score_2,
                court_id=candidate_match.court_id,
                custom_duration_minutes=candidate_match.custom_duration_minutes,
                custom_margin_minutes=candidate_match.custom_margin_minutes,
            ),
            tournament,
        )

        stage_item = await get_stage_item(tournament_id, stage_item.id)
        await update_inputs_in_subsequent_elimination_rounds(
            candidate_match.round_id, stage_item, {candidate_match.id}
        )
        stage_item = await get_stage_item(tournament_id, stage_item.id)
