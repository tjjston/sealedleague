import re

import pytest
from fastapi import HTTPException

from bracket.logic.scheduling.elimination import (
    determine_matches_first_round,
    get_number_of_rounds_to_create_double_elimination,
    get_number_of_rounds_to_create_single_elimination,
)
from bracket.logic.scheduling.round_robin import get_number_of_rounds_to_create_round_robin
from bracket.models.db.stage_item import StageType
from bracket.models.db.stage_item_inputs import StageItemInputEmpty
from bracket.models.db.tournament import Tournament
from bracket.models.db.util import RoundWithMatches, StageItemWithRounds
from bracket.utils.dummy_records import DUMMY_MOCK_TIME, DUMMY_TOURNAMENT
from bracket.utils.id_types import (
    RoundId,
    StageId,
    StageItemId,
    StageItemInputId,
    TournamentId,
)


def test_number_of_rounds_round_robin() -> None:
    assert get_number_of_rounds_to_create_round_robin(0) == 0
    assert get_number_of_rounds_to_create_round_robin(2) == 1
    assert get_number_of_rounds_to_create_round_robin(4) == 3
    assert get_number_of_rounds_to_create_round_robin(6) == 5


def test_number_of_rounds_single_elimination() -> None:
    assert get_number_of_rounds_to_create_single_elimination(0) == 0
    assert get_number_of_rounds_to_create_single_elimination(2) == 1
    assert get_number_of_rounds_to_create_single_elimination(3) == 2
    assert get_number_of_rounds_to_create_single_elimination(4) == 2
    assert get_number_of_rounds_to_create_single_elimination(5) == 3
    assert get_number_of_rounds_to_create_single_elimination(8) == 3
    assert get_number_of_rounds_to_create_single_elimination(9) == 4
    assert get_number_of_rounds_to_create_single_elimination(16) == 4
    assert get_number_of_rounds_to_create_single_elimination(32) == 5
    assert get_number_of_rounds_to_create_single_elimination(33) == 6

    err_msg = re.escape("400: Number of teams invalid, should be between 2 and 64")
    with pytest.raises(HTTPException, match=err_msg):
        get_number_of_rounds_to_create_single_elimination(65)

    with pytest.raises(HTTPException, match=err_msg):
        get_number_of_rounds_to_create_single_elimination(1)


def test_number_of_rounds_double_elimination() -> None:
    assert get_number_of_rounds_to_create_double_elimination(0) == 0
    assert get_number_of_rounds_to_create_double_elimination(3) == 6
    assert get_number_of_rounds_to_create_double_elimination(4) == 6
    assert get_number_of_rounds_to_create_double_elimination(5) == 9
    assert get_number_of_rounds_to_create_double_elimination(7) == 9
    assert get_number_of_rounds_to_create_double_elimination(8) == 9
    assert get_number_of_rounds_to_create_double_elimination(9) == 12
    assert get_number_of_rounds_to_create_double_elimination(16) == 12
    assert get_number_of_rounds_to_create_double_elimination(32) == 15
    assert get_number_of_rounds_to_create_double_elimination(33) == 18

    err_msg = re.escape("400: Number of teams invalid, should be between 3 and 64")
    with pytest.raises(HTTPException, match=err_msg):
        get_number_of_rounds_to_create_double_elimination(2)

    with pytest.raises(HTTPException, match=err_msg):
        get_number_of_rounds_to_create_double_elimination(65)


def test_single_elimination_first_round_creates_seeded_byes() -> None:
    tournament_id = TournamentId(-10)
    stage_item_id = StageItemId(-11)
    tournament = Tournament(**DUMMY_TOURNAMENT.model_dump(), id=tournament_id)
    round_ = RoundWithMatches(
        id=RoundId(-12),
        created=DUMMY_MOCK_TIME,
        is_draft=False,
        name="Round 01",
        stage_item_id=stage_item_id,
        matches=[],
    )
    stage_item = StageItemWithRounds(
        stage_id=StageId(-13),
        type=StageType.SINGLE_ELIMINATION,
        team_count=5,
        ranking_id=None,
        inputs=[
            StageItemInputEmpty(
                id=StageItemInputId(seed),
                slot=seed,
                tournament_id=tournament_id,
                stage_item_id=stage_item_id,
            )
            for seed in range(1, 6)
        ],
        id=stage_item_id,
        created=DUMMY_MOCK_TIME,
        name="Single Elimination",
        rounds=[],
    )

    matches = determine_matches_first_round(round_, stage_item, tournament)
    assert len(matches) == 4
    assert matches[0].stage_item_input1_id == StageItemInputId(1)
    assert matches[0].stage_item_input2_id is None
    assert matches[0].stage_item_input1_score == 1
    assert matches[1].stage_item_input1_id == StageItemInputId(4)
    assert matches[1].stage_item_input2_id == StageItemInputId(5)
    assert matches[2].stage_item_input1_id == StageItemInputId(2)
    assert matches[2].stage_item_input2_id is None
    assert matches[2].stage_item_input1_score == 1
    assert matches[3].stage_item_input1_id == StageItemInputId(3)
    assert matches[3].stage_item_input2_id is None
    assert matches[3].stage_item_input1_score == 1
