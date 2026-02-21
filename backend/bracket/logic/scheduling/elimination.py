from fastapi import HTTPException
from starlette import status

from bracket.models.db.match import Match, MatchCreateBody
from bracket.models.db.tournament import Tournament
from bracket.models.db.util import RoundWithMatches, StageItemWithRounds
from bracket.sql.matches import sql_create_match
from bracket.sql.rounds import get_rounds_for_stage_item
from bracket.sql.tournaments import sql_get_tournament
from bracket.utils.id_types import MatchId, StageItemInputId, TournamentId

MAX_ELIMINATION_TEAM_COUNT = 64


def _build_match(
    round_: RoundWithMatches,
    tournament: Tournament,
    *,
    stage_item_input1_id: StageItemInputId | None = None,
    stage_item_input2_id: StageItemInputId | None = None,
    stage_item_input1_winner_from_match_id: MatchId | None = None,
    stage_item_input2_winner_from_match_id: MatchId | None = None,
    stage_item_input1_loser_from_match_id: MatchId | None = None,
    stage_item_input2_loser_from_match_id: MatchId | None = None,
    stage_item_input1_score: int = 0,
    stage_item_input2_score: int = 0,
) -> MatchCreateBody:
    return MatchCreateBody(
        round_id=round_.id,
        court_id=None,
        stage_item_input1_id=stage_item_input1_id,
        stage_item_input2_id=stage_item_input2_id,
        stage_item_input1_winner_from_match_id=stage_item_input1_winner_from_match_id,
        stage_item_input2_winner_from_match_id=stage_item_input2_winner_from_match_id,
        stage_item_input1_loser_from_match_id=stage_item_input1_loser_from_match_id,
        stage_item_input2_loser_from_match_id=stage_item_input2_loser_from_match_id,
        stage_item_input1_score=stage_item_input1_score,
        stage_item_input2_score=stage_item_input2_score,
        duration_minutes=tournament.duration_minutes,
        margin_minutes=tournament.margin_minutes,
        custom_duration_minutes=None,
        custom_margin_minutes=None,
    )


def _get_bracket_size(team_count: int) -> int:
    if team_count < 1:
        return 0
    return 1 << (team_count - 1).bit_length()


def _seed_order(bracket_size: int) -> list[int]:
    if bracket_size == 1:
        return [1]

    previous = _seed_order(bracket_size // 2)
    return [
        seed
        for prev_seed in previous
        for seed in (prev_seed, bracket_size + 1 - prev_seed)
    ]


def determine_matches_first_round(
    round_: RoundWithMatches, stage_item: StageItemWithRounds, tournament: Tournament
) -> list[MatchCreateBody]:
    suggestions: list[MatchCreateBody] = []
    seeded_inputs = sorted(stage_item.inputs, key=lambda stage_input: stage_input.slot)
    bracket_size = _get_bracket_size(len(seeded_inputs))
    ordered_seeds = _seed_order(bracket_size)
    seed_lookup: dict[int, StageItemInputId] = {
        i + 1: stage_input.id for i, stage_input in enumerate(seeded_inputs)
    }

    for i in range(0, bracket_size, 2):
        seed_1 = ordered_seeds[i + 0]
        seed_2 = ordered_seeds[i + 1]
        input_1 = seed_lookup.get(seed_1)
        input_2 = seed_lookup.get(seed_2)

        if input_1 is None and input_2 is None:
            continue

        if input_1 is None and input_2 is not None:
            input_1, input_2 = input_2, None

        score_1 = 1 if input_1 is not None and input_2 is None else 0
        score_2 = 0
        suggestions.append(
            _build_match(
                round_,
                tournament,
                stage_item_input1_id=input_1,
                stage_item_input2_id=input_2,
                stage_item_input1_score=score_1,
                stage_item_input2_score=score_2,
            )
        )

    return suggestions


def determine_matches_subsequent_round(
    prev_matches: list[Match],
    round_: RoundWithMatches,
    tournament: Tournament,
) -> list[MatchCreateBody]:
    suggestions: list[MatchCreateBody] = []
    if len(prev_matches) % 2 != 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot generate elimination round from an odd number of matches",
        )

    for i in range(0, len(prev_matches), 2):
        first_match = prev_matches[i + 0]
        second_match = prev_matches[i + 1]

        suggestions.append(
            _build_match(
                round_,
                tournament,
                stage_item_input1_winner_from_match_id=first_match.id,
                stage_item_input2_winner_from_match_id=second_match.id,
            )
        )
    return suggestions


def determine_matches_from_losers(
    source_matches: list[Match], round_: RoundWithMatches, tournament: Tournament
) -> list[MatchCreateBody]:
    suggestions: list[MatchCreateBody] = []
    if len(source_matches) % 2 != 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot generate losers round from an odd number of matches",
        )

    for i in range(0, len(source_matches), 2):
        first_match = source_matches[i + 0]
        second_match = source_matches[i + 1]
        suggestions.append(
            _build_match(
                round_,
                tournament,
                stage_item_input1_loser_from_match_id=first_match.id,
                stage_item_input2_loser_from_match_id=second_match.id,
            )
        )

    return suggestions


def determine_matches_loser_winner_cross(
    losers_matches: list[Match],
    winners_matches: list[Match],
    round_: RoundWithMatches,
    tournament: Tournament,
) -> list[MatchCreateBody]:
    if len(losers_matches) != len(winners_matches):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Double elimination bracket shape mismatch",
        )

    suggestions: list[MatchCreateBody] = []
    for losers_match, winners_match in zip(losers_matches, winners_matches):
        suggestions.append(
            _build_match(
                round_,
                tournament,
                stage_item_input1_winner_from_match_id=losers_match.id,
                stage_item_input2_loser_from_match_id=winners_match.id,
            )
        )

    return suggestions


def determine_grand_final(
    winners_final_match: Match,
    losers_final_match: Match,
    round_: RoundWithMatches,
    tournament: Tournament,
) -> MatchCreateBody:
    return _build_match(
        round_,
        tournament,
        stage_item_input1_winner_from_match_id=winners_final_match.id,
        stage_item_input2_winner_from_match_id=losers_final_match.id,
    )


def determine_grand_final_reset(
    grand_final_match: Match,
    round_: RoundWithMatches,
    tournament: Tournament,
) -> MatchCreateBody:
    return _build_match(
        round_,
        tournament,
        stage_item_input1_winner_from_match_id=grand_final_match.id,
        stage_item_input2_loser_from_match_id=grand_final_match.id,
    )


async def _create_matches(suggestions: list[MatchCreateBody]) -> list[Match]:
    return [await sql_create_match(match) for match in suggestions]


def _validate_team_count_range(team_count: int, minimum: int) -> None:
    if not (minimum <= team_count <= MAX_ELIMINATION_TEAM_COUNT):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Number of teams invalid, should be between {minimum} "
                f"and {MAX_ELIMINATION_TEAM_COUNT}"
            ),
        )


async def build_single_elimination_stage_item(
    tournament_id: TournamentId, stage_item: StageItemWithRounds
) -> None:
    rounds = await get_rounds_for_stage_item(tournament_id, stage_item.id)
    tournament = await sql_get_tournament(tournament_id)

    assert len(rounds) > 0
    first_round = rounds[0]

    prev_matches = await _create_matches(
        determine_matches_first_round(first_round, stage_item, tournament)
    )

    for round_ in rounds[1:]:
        prev_matches = await _create_matches(
            determine_matches_subsequent_round(prev_matches, round_, tournament)
        )


async def build_double_elimination_stage_item(
    tournament_id: TournamentId, stage_item: StageItemWithRounds
) -> None:
    rounds = await get_rounds_for_stage_item(tournament_id, stage_item.id)
    tournament = await sql_get_tournament(tournament_id)

    winners_round_count = get_number_of_rounds_to_create_single_elimination(stage_item.team_count)
    losers_round_count = 2 * winners_round_count - 2
    total_round_count = winners_round_count + losers_round_count + 2
    if len(rounds) != total_round_count:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Double elimination for {stage_item.team_count} teams expects "
                f"{total_round_count} rounds"
            ),
        )

    winners_rounds = rounds[:winners_round_count]
    losers_rounds = rounds[winners_round_count : winners_round_count + losers_round_count]
    grand_final_round = rounds[-2]
    grand_final_reset_round = rounds[-1]

    winners_matches_per_round: list[list[Match]] = []
    winners_matches = await _create_matches(
        determine_matches_first_round(winners_rounds[0], stage_item, tournament)
    )
    winners_matches_per_round.append(winners_matches)
    for round_ in winners_rounds[1:]:
        winners_matches = await _create_matches(
            determine_matches_subsequent_round(winners_matches, round_, tournament)
        )
        winners_matches_per_round.append(winners_matches)

    losers_round_cursor = 0
    losers_matches = await _create_matches(
        determine_matches_from_losers(
            winners_matches_per_round[0], losers_rounds[losers_round_cursor], tournament
        )
    )
    losers_round_cursor += 1

    for winner_round_index in range(1, winners_round_count):
        winners_round_matches = winners_matches_per_round[winner_round_index]
        losers_matches = await _create_matches(
            determine_matches_loser_winner_cross(
                losers_matches,
                winners_round_matches,
                losers_rounds[losers_round_cursor],
                tournament,
            )
        )
        losers_round_cursor += 1

        is_last_winners_round = winner_round_index == winners_round_count - 1
        if not is_last_winners_round:
            losers_matches = await _create_matches(
                determine_matches_subsequent_round(
                    losers_matches, losers_rounds[losers_round_cursor], tournament
                )
            )
            losers_round_cursor += 1

    if losers_round_cursor != len(losers_rounds):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to construct all loser bracket rounds",
        )

    grand_final_match = await sql_create_match(
        determine_grand_final(
            winners_matches_per_round[-1][0], losers_matches[0], grand_final_round, tournament
        )
    )
    await sql_create_match(
        determine_grand_final_reset(
            grand_final_match, grand_final_reset_round, tournament
        )
    )


def get_number_of_rounds_to_create_single_elimination(team_count: int) -> int:
    if team_count < 1:
        return 0

    _validate_team_count_range(team_count, 2)
    bracket_size = _get_bracket_size(team_count)
    return bracket_size.bit_length() - 1


def get_number_of_rounds_to_create_double_elimination(team_count: int) -> int:
    if team_count < 1:
        return 0

    _validate_team_count_range(team_count, 3)
    # Winners bracket rounds + losers bracket rounds + grand final + potential reset.
    winners_round_count = get_number_of_rounds_to_create_single_elimination(team_count)
    losers_round_count = 2 * winners_round_count - 2
    return winners_round_count + losers_round_count + 2
