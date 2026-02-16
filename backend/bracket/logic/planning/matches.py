from collections import defaultdict
from typing import NamedTuple

from heliclockter import timedelta

from bracket.models.db.match import (
    MatchRescheduleBody,
    MatchWithDetails,
    MatchWithDetailsDefinitive,
)
from bracket.models.db.tournament import Tournament
from bracket.models.db.util import StageWithStageItems
from bracket.sql.courts import get_all_courts_in_tournament
from bracket.sql.matches import (
    sql_reschedule_match_and_determine_duration_and_margin,
)
from bracket.sql.stages import get_full_tournament_details
from bracket.sql.tournaments import sql_get_tournament
from bracket.utils.id_types import CourtId, MatchId, TournamentId
from bracket.utils.types import assert_some


async def schedule_all_unscheduled_matches(
    tournament_id: TournamentId, stages: list[StageWithStageItems]
) -> None:
    tournament = await sql_get_tournament(tournament_id)
    courts = await get_all_courts_in_tournament(tournament_id)

    if len(stages) < 1 or len(courts) < 1:
        return

    time_last_match_from_previous_stage = tournament.start_time
    position_last_match_from_previous_stage = 0

    def get_slot_minutes(match: MatchWithDetailsDefinitive | MatchWithDetails) -> int:
        duration = (
            tournament.duration_minutes
            if match.custom_duration_minutes is None
            else match.custom_duration_minutes
        )
        margin = (
            tournament.margin_minutes if match.custom_margin_minutes is None else match.custom_margin_minutes
        )
        return duration + margin

    for stage in stages:
        stage_items = sorted(stage.stage_items, key=lambda x: x.name)
        stage_start_time = time_last_match_from_previous_stage
        stage_position_in_schedule = position_last_match_from_previous_stage

        for stage_item in stage_items:
            round_start_time = stage_start_time
            round_position_in_schedule = stage_position_in_schedule

            for round_ in sorted(stage_item.rounds, key=lambda r: r.id):
                matches = sorted(round_.matches, key=lambda m: m.id)
                if len(matches) < 1:
                    continue

                batch_start_time = round_start_time
                batches = [
                    matches[start : start + len(courts)] for start in range(0, len(matches), len(courts))
                ]

                for batch_offset, batch in enumerate(batches):
                    position_in_schedule = round_position_in_schedule + batch_offset
                    slot_end_time = batch_start_time

                    for court_index, match in enumerate(batch):
                        court = courts[court_index]
                        if match.start_time is None and match.position_in_schedule is None:
                            await sql_reschedule_match_and_determine_duration_and_margin(
                                court.id,
                                batch_start_time,
                                position_in_schedule,
                                match,
                                tournament,
                            )

                        slot_end_time = max(
                            slot_end_time,
                            batch_start_time + timedelta(minutes=get_slot_minutes(match)),
                        )

                    batch_start_time = slot_end_time

                round_start_time = batch_start_time
                round_position_in_schedule += len(batches)

            stage_start_time = round_start_time
            stage_position_in_schedule = round_position_in_schedule

        time_last_match_from_previous_stage = max(
            time_last_match_from_previous_stage, stage_start_time
        )
        position_last_match_from_previous_stage = max(
            position_last_match_from_previous_stage, stage_position_in_schedule
        )

    await update_start_times_of_matches(tournament_id)


class MatchPosition(NamedTuple):
    match: MatchWithDetailsDefinitive | MatchWithDetails
    position: float


def _get_slot_minutes_for_match(
    tournament: Tournament, match: MatchWithDetailsDefinitive | MatchWithDetails
) -> int:
    duration = (
        tournament.duration_minutes
        if match.custom_duration_minutes is None
        else match.custom_duration_minutes
    )
    margin = (
        tournament.margin_minutes if match.custom_margin_minutes is None else match.custom_margin_minutes
    )
    return duration + margin


async def reorder_matches_for_court(
    tournament: Tournament,
    scheduled_matches: list[MatchPosition],
    court_id: CourtId,
) -> None:
    matches_this_court = sorted(
        (match_pos for match_pos in scheduled_matches if match_pos.match.court_id == court_id),
        key=lambda mp: mp.position,
    )

    last_start_time = tournament.start_time
    for i, match_pos in enumerate(matches_this_court):
        await sql_reschedule_match_and_determine_duration_and_margin(
            court_id,
            last_start_time,
            position_in_schedule=i,
            match=match_pos.match,
            tournament=tournament,
        )
        last_start_time = last_start_time + timedelta(
            minutes=_get_slot_minutes_for_match(tournament, match_pos.match)
        )


async def handle_match_reschedule(
    tournament: Tournament, body: MatchRescheduleBody, match_id: MatchId
) -> None:
    if body.old_position == body.new_position and body.old_court_id == body.new_court_id:
        return

    stages = await get_full_tournament_details(tournament.id)
    scheduled_matches_old = get_scheduled_matches(stages)

    # For match in prev position: set new position
    scheduled_matches = []
    for match_pos in scheduled_matches_old:
        if match_pos.match.id == match_id:
            if (
                match_pos.position != body.old_position
                or match_pos.match.court_id != body.old_court_id
            ):
                raise ValueError("match_id doesn't match court id or position in schedule")

            offset = (
                -0.5
                if body.new_position < body.old_position or body.new_court_id != body.old_court_id
                else +0.5
            )
            scheduled_matches.append(
                MatchPosition(
                    match=match_pos.match.model_copy(update={"court_id": body.new_court_id}),
                    position=body.new_position + offset,
                )
            )
        else:
            scheduled_matches.append(match_pos)

    await reorder_matches_for_court(tournament, scheduled_matches, body.new_court_id)

    if body.new_court_id != body.old_court_id:
        await reorder_matches_for_court(tournament, scheduled_matches, body.old_court_id)

    await update_start_times_of_matches(tournament.id)


async def update_start_times_of_matches(tournament_id: TournamentId) -> None:
    stages = await get_full_tournament_details(tournament_id)
    tournament = await sql_get_tournament(tournament_id)
    scheduled_matches = get_scheduled_matches(stages)
    matches_by_position: dict[int, list[MatchWithDetailsDefinitive | MatchWithDetails]] = defaultdict(list)
    for match_pos in scheduled_matches:
        match = match_pos.match
        if match.court_id is None or match.position_in_schedule is None:
            continue
        matches_by_position[int(match.position_in_schedule)].append(match)

    if len(matches_by_position) < 1:
        return

    slot_start_time = tournament.start_time
    normalized_slot = 0
    for position in sorted(matches_by_position):
        slot_matches = sorted(
            matches_by_position[position],
            key=lambda match: (
                int(match.court_id or 0),
                int(match.id),
            ),
        )
        longest_slot_minutes = 0
        for match in slot_matches:
            await sql_reschedule_match_and_determine_duration_and_margin(
                assert_some(match.court_id),
                slot_start_time,
                position_in_schedule=normalized_slot,
                match=match,
                tournament=tournament,
            )
            longest_slot_minutes = max(
                longest_slot_minutes,
                _get_slot_minutes_for_match(tournament, match),
            )
        slot_start_time = slot_start_time + timedelta(minutes=longest_slot_minutes)
        normalized_slot += 1


def get_scheduled_matches(stages: list[StageWithStageItems]) -> list[MatchPosition]:
    return [
        MatchPosition(match=match, position=float(assert_some(match.position_in_schedule)))
        for stage in stages
        for stage_item in stage.stage_items
        for round_ in stage_item.rounds
        for match in round_.matches
        if match.start_time is not None
    ]


def get_scheduled_matches_per_court(
    stages: list[StageWithStageItems],
) -> dict[int, list[MatchPosition]]:
    scheduled_matches = get_scheduled_matches(stages)
    matches_per_court = defaultdict(list)

    for match_pos in scheduled_matches:
        if match_pos.match.court_id is not None:
            matches_per_court[match_pos.match.court_id].append(match_pos)

    return {
        court_id: sorted(matches, key=lambda mp: assert_some(mp.match.start_time))
        for court_id, matches in matches_per_court.items()
    }
