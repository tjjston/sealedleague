#!/usr/bin/env python3
import argparse
import asyncio
import re
from typing import Any

from heliclockter import datetime_utc, timedelta

from bracket.database import database
from bracket.logic.ranking.calculation import recalculate_ranking_for_stage_item
from bracket.logic.ranking.elimination import update_inputs_in_subsequent_elimination_rounds
from bracket.logic.scheduling.builder import build_matches_for_stage_item
from bracket.models.db.account import UserAccountType
from bracket.models.db.league import SeasonMembershipRole
from bracket.models.db.match import MatchCreateBody
from bracket.models.db.player import PlayerBody
from bracket.models.db.ranking import RankingCreateBody
from bracket.models.db.round import RoundInsertable
from bracket.models.db.stage_item import StageItemCreateBody, StageType
from bracket.models.db.team import TeamInsertable
from bracket.models.db.tournament import TournamentBody
from bracket.models.league import LeagueSeasonPrivilegesUpdateBody
from bracket.schema import clubs, players_x_teams, teams, users, users_x_clubs
from bracket.sql.league import (
    create_season,
    ensure_user_registered_as_participant,
    insert_points_ledger_delta,
    set_season_tournaments,
    upsert_card_pool_entry,
    upsert_deck,
    upsert_season_membership,
    upsert_tournament_application,
)
from bracket.sql.matches import sql_create_match
from bracket.sql.players import get_player_by_name, insert_player, recalculate_tournament_records
from bracket.sql.rankings import get_default_rankings_in_tournament, sql_create_ranking
from bracket.sql.rounds import sql_create_round
from bracket.sql.stage_item_inputs import sql_set_team_id_for_stage_item_input
from bracket.sql.stage_items import (
    get_stage_item,
    sql_create_stage_item_with_empty_inputs,
)
from bracket.sql.tournaments import sql_create_tournament
from bracket.utils.id_types import TournamentId, UserId
from bracket.utils.league_cards import (
    DEFAULT_SWU_SET_CODES,
    fetch_swu_cards_cached,
    normalize_card_for_deckbuilding,
)
from bracket.utils.security import hash_password

WEAPON_ICONS = [
    "blaster_pistol",
    "blaster_rifle",
    "lightsaber_blue",
    "lightsaber_red",
    "lightsaber_green",
    "lightsaber_purple",
    "wrist_rockets",
    "electrostaff",
]

FAVORITE_MEDIA = [
    "A New Hope (1977)",
    "The Empire Strikes Back (1980)",
    "Return of the Jedi (1983)",
    "The Phantom Menace (1999)",
    "Attack of the Clones (2002)",
    "Revenge of the Sith (2005)",
    "The Clone Wars (2008)",
    "The Force Awakens (2015)",
    "Rogue One (2016)",
    "The Last Jedi (2017)",
]


def slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower())
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    return normalized or "event"


def build_mainboard(pool_cards: list[dict], start_index: int, size: int = 30) -> dict[str, int]:
    if len(pool_cards) < 1:
        return {}

    board: dict[str, int] = {}
    for offset in range(size):
        card = pool_cards[(start_index + offset) % len(pool_cards)]
        card_id = str(card.get("card_id") or "").strip().lower()
        if card_id == "":
            continue
        board[card_id] = min(3, board.get(card_id, 0) + 1)
    return board


def build_card_pool_distribution(
    pool_cards: list[dict],
    start_index: int,
    total_cards: int = 120,
) -> dict[str, int]:
    quantities: dict[str, int] = {}
    if len(pool_cards) < 1:
        return quantities

    for offset in range(total_cards):
        card = pool_cards[(start_index + offset) % len(pool_cards)]
        card_id = str(card.get("card_id") or "").strip().lower()
        if card_id == "":
            continue
        quantities[card_id] = quantities.get(card_id, 0) + 1
    return quantities


def determine_score(seed1: int, seed2: int, round_index: int) -> tuple[int, int]:
    if abs(seed1 - seed2) <= 1 and round_index % 3 == 2:
        return 1, 1
    if seed1 <= seed2:
        return 2, 1
    return 1, 2


async def get_tournament_users(tournament_id: TournamentId) -> list[dict[str, Any]]:
    rows = await database.fetch_all(
        """
        SELECT DISTINCT u.id, u.name, u.email, u.account_type
        FROM tournaments t
        JOIN users_x_clubs uxc ON uxc.club_id = t.club_id
        JOIN users u ON u.id = uxc.user_id
        WHERE t.id = :tournament_id
        ORDER BY u.id ASC
        """,
        values={"tournament_id": int(tournament_id)},
    )
    return [dict(row._mapping) for row in rows]


async def ensure_sample_users_for_club(
    club_id: int,
    user_count: int,
    default_password: str,
) -> list[dict[str, Any]]:
    sample_users: list[dict[str, Any]] = []
    for index in range(1, user_count + 1):
        email = f"sample.player.{index:02d}@sealedleague.local"
        name = f"Sample Player {index:02d}"
        user = await database.fetch_one(
            "SELECT id, name, email, account_type FROM users WHERE lower(email)=lower(:email)",
            values={"email": email},
        )
        if user is None:
            created = datetime_utc.now()
            password_hash = hash_password(default_password)
            favorite_media = FAVORITE_MEDIA[(index - 1) % len(FAVORITE_MEDIA)]
            weapon_icon = WEAPON_ICONS[(index - 1) % len(WEAPON_ICONS)]
            user_id = await database.execute(
                query=users.insert(),
                values={
                    "email": email,
                    "name": name,
                    "password_hash": password_hash,
                    "created": created,
                    "account_type": UserAccountType.REGULAR.value,
                    "favorite_media": favorite_media,
                    "weapon_icon": weapon_icon,
                },
            )
            user = await database.fetch_one(
                "SELECT id, name, email, account_type FROM users WHERE id = :user_id",
                values={"user_id": int(user_id)},
            )

        assert user is not None
        relation_row = await database.fetch_one(
            """
            SELECT id
            FROM users_x_clubs
            WHERE club_id = :club_id
              AND user_id = :user_id
            LIMIT 1
            """,
            values={"club_id": club_id, "user_id": int(user._mapping["id"])},
        )
        if relation_row is None:
            await database.execute(
                query=users_x_clubs.insert(),
                values={
                    "club_id": club_id,
                    "user_id": int(user._mapping["id"]),
                    "relation": "COLLABORATOR",
                },
            )

        sample_users.append(dict(user._mapping))
    return sample_users


async def get_changed_by_user_id(club_id: int, fallback_user_id: int) -> UserId:
    row = await database.fetch_one(
        """
        SELECT u.id
        FROM users u
        JOIN users_x_clubs uxc ON uxc.user_id = u.id
        WHERE uxc.club_id = :club_id
          AND u.account_type = 'ADMIN'
        ORDER BY u.id ASC
        LIMIT 1
        """,
        values={"club_id": club_id},
    )
    if row is None:
        return UserId(fallback_user_id)
    return UserId(int(row._mapping["id"]))


async def create_event_tournament(
    *,
    club_id: int,
    name: str,
    start_time: datetime_utc,
    dashboard_suffix: str,
) -> TournamentId:
    endpoint = f"{slugify(name)}-{dashboard_suffix}"
    tournament_body = TournamentBody(
        club_id=club_id,
        name=name,
        start_time=start_time,
        dashboard_public=False,
        dashboard_endpoint=endpoint,
        players_can_be_in_multiple_teams=False,
        auto_assign_courts=False,
        duration_minutes=20,
        margin_minutes=5,
    )
    tournament_id = await sql_create_tournament(tournament_body)
    await sql_create_ranking(tournament_id, RankingCreateBody(), position=0)
    return tournament_id


async def resolve_tournament_for_seed(requested_tournament_id: int | None) -> TournamentId:
    if requested_tournament_id is not None:
        tournament_exists = (
            await database.fetch_val(
                """
                SELECT EXISTS(
                    SELECT 1
                    FROM tournaments
                    WHERE id = :tournament_id
                )
                """,
                values={"tournament_id": requested_tournament_id},
            )
            is True
        )
        if tournament_exists:
            return TournamentId(requested_tournament_id)

        existing = await database.fetch_all(
            """
            SELECT id, name
            FROM tournaments
            ORDER BY id ASC
            LIMIT 25
            """
        )
        existing_ids = [str(int(row._mapping["id"])) for row in existing]
        if len(existing_ids) < 1:
            raise ValueError(
                f"Tournament {requested_tournament_id} not found and no tournaments exist yet. "
                "Run without --tournament-id to auto-create a seed tournament."
            )
        raise ValueError(
            f"Tournament {requested_tournament_id} not found. Existing tournament IDs: "
            + ", ".join(existing_ids)
        )

    first_tournament_row = await database.fetch_one(
        """
        SELECT id
        FROM tournaments
        ORDER BY id ASC
        LIMIT 1
        """
    )
    if first_tournament_row is not None:
        return TournamentId(int(first_tournament_row._mapping["id"]))

    owner_row = await database.fetch_one(
        """
        SELECT id
        FROM users
        ORDER BY CASE WHEN account_type = 'ADMIN' THEN 0 ELSE 1 END, id ASC
        LIMIT 1
        """
    )
    if owner_row is None:
        raise ValueError("No users found. Create an admin user before seeding sample data.")
    owner_user_id = int(owner_row._mapping["id"])

    created = datetime_utc.now()
    club_id = await database.execute(
        query=clubs.insert(),
        values={
            "name": f"Sample League Club {created.strftime('%Y-%m-%d %H:%M:%S')}",
            "created": created,
        },
    )
    await database.execute(
        query=users_x_clubs.insert(),
        values={
            "club_id": int(club_id),
            "user_id": owner_user_id,
            "relation": "OWNER",
        },
    )

    tournament_id = await create_event_tournament(
        club_id=int(club_id),
        name="Sample Seed Tournament",
        start_time=created,
        dashboard_suffix=created.strftime("%Y%m%d%H%M%S"),
    )
    print(f"Auto-created seed tournament: {int(tournament_id)}")
    return tournament_id


async def create_courts_for_tournament(tournament_id: TournamentId, count: int = 5) -> list[int]:
    court_ids: list[int] = []
    for index in range(1, count + 1):
        court_id = await database.fetch_val(
            """
            INSERT INTO courts (name, tournament_id)
            VALUES (:name, :tournament_id)
            RETURNING id
            """,
            values={
                "name": f"Court {index}",
                "tournament_id": int(tournament_id),
            },
        )
        court_ids.append(int(court_id))
    return court_ids


async def create_players_and_teams_for_tournament(
    tournament_id: TournamentId,
    participants: list[dict[str, Any]],
) -> tuple[dict[int, int], dict[int, int]]:
    user_to_team: dict[int, int] = {}
    team_to_user: dict[int, int] = {}

    for participant in participants:
        user_id = int(participant["id"])
        user_name = str(participant["name"])
        await insert_player(PlayerBody(name=user_name, active=True), tournament_id)
        player = await get_player_by_name(user_name, tournament_id)
        if player is None:
            continue

        team_id = await database.execute(
            query=teams.insert(),
            values=TeamInsertable(
                created=datetime_utc.now(),
                name=user_name,
                tournament_id=tournament_id,
                active=True,
            ).model_dump(),
        )
        await database.execute(
            query=players_x_teams.insert(),
            values={"player_id": int(player.id), "team_id": int(team_id)},
        )
        user_to_team[user_id] = int(team_id)
        team_to_user[int(team_id)] = user_id

    return user_to_team, team_to_user


async def assign_stage_item_inputs_to_teams(
    tournament_id: TournamentId,
    stage_item_id: int,
    team_ids: list[int],
) -> None:
    input_rows = await database.fetch_all(
        """
        SELECT id
        FROM stage_item_inputs
        WHERE stage_item_id = :stage_item_id
        ORDER BY slot ASC, id ASC
        """,
        values={"stage_item_id": stage_item_id},
    )
    for index, row in enumerate(input_rows):
        if index >= len(team_ids):
            break
        await sql_set_team_id_for_stage_item_input(
            tournament_id,
            int(row._mapping["id"]),
            team_ids[index],
        )


async def update_match_with_result(
    match_id: int,
    *,
    score1: int,
    score2: int,
    start_time: datetime_utc,
    court_id: int,
    position_in_schedule: int,
) -> None:
    await database.execute(
        """
        UPDATE matches
        SET
            stage_item_input1_score = :score1,
            stage_item_input2_score = :score2,
            start_time = :start_time,
            court_id = :court_id,
            position_in_schedule = :position_in_schedule,
            duration_minutes = 20,
            margin_minutes = 5
        WHERE id = :match_id
        """,
        values={
            "match_id": int(match_id),
            "score1": score1,
            "score2": score2,
            "start_time": start_time,
            "court_id": int(court_id),
            "position_in_schedule": int(position_in_schedule),
        },
    )


async def award_event_points(
    *,
    season_id: int,
    tournament_id: TournamentId,
    changed_by_user_id: UserId,
    event_label: str,
    ordered_user_ids: list[int],
) -> None:
    if len(ordered_user_ids) < 1:
        return

    champion_user_id = UserId(ordered_user_ids[0])
    await insert_points_ledger_delta(
        season_id,
        champion_user_id,
        changed_by_user_id,
        points_delta=6.0,
        reason=f"TOURNAMENT_WIN:1:{event_label}",
    )

    placement_points = [3.0, 2.0, 1.0]
    for index, points in enumerate(placement_points, start=1):
        if len(ordered_user_ids) < index:
            break
        await insert_points_ledger_delta(
            season_id,
            UserId(ordered_user_ids[index - 1]),
            changed_by_user_id,
            points_delta=points,
            reason=f"TOURNAMENT_PLACEMENT:1:{event_label}:P{index}",
        )

    for user_id in ordered_user_ids[:8]:
        await insert_points_ledger_delta(
            season_id,
            UserId(user_id),
            changed_by_user_id,
            points_delta=1.0,
            reason=f"PRIZE_PACKS:1:{event_label}",
        )


async def create_round_robin_event(
    *,
    club_id: int,
    season_id: int,
    changed_by_user_id: UserId,
    participants: list[dict[str, Any]],
    season_deck_ids: dict[int, int],
    start_time: datetime_utc,
    week_index: int,
    dashboard_suffix: str,
) -> TournamentId:
    event_name = f"Sample Season 1 - Week {week_index} Round Robin"
    tournament_id = await create_event_tournament(
        club_id=club_id,
        name=event_name,
        start_time=start_time,
        dashboard_suffix=dashboard_suffix,
    )
    court_ids = await create_courts_for_tournament(tournament_id, count=5)
    user_to_team, team_to_user = await create_players_and_teams_for_tournament(
        tournament_id, participants
    )

    stage_id = await database.fetch_val(
        """
        INSERT INTO stages (name, tournament_id, is_active)
        VALUES (:name, :tournament_id, :is_active)
        RETURNING id
        """,
        values={
            "name": f"Week {week_index} Stage",
            "tournament_id": int(tournament_id),
            "is_active": True,
        },
    )
    ranking = await get_default_rankings_in_tournament(tournament_id)
    stage_item = await sql_create_stage_item_with_empty_inputs(
        tournament_id,
        StageItemCreateBody(
            stage_id=int(stage_id),
            name=f"Week {week_index} Round Robin",
            type=StageType.ROUND_ROBIN,
            team_count=len(participants),
            ranking_id=ranking.id,
        ),
    )
    team_ids = [user_to_team[int(participant["id"])] for participant in participants]
    await assign_stage_item_inputs_to_teams(tournament_id, int(stage_item.id), team_ids)
    await build_matches_for_stage_item(stage_item, tournament_id)

    stage_item_with_rounds = await get_stage_item(tournament_id, stage_item.id)
    seed_by_team_id = {team_id: seed for seed, team_id in enumerate(team_ids)}
    input_to_team_id = {
        int(stage_input.id): int(stage_input.team_id)
        for stage_input in stage_item_with_rounds.inputs
        if stage_input.team_id is not None
    }

    sorted_rounds = sorted(stage_item_with_rounds.rounds, key=lambda item: int(item.id))
    for round_index, round_ in enumerate(sorted_rounds):
        round_start_time = start_time + timedelta(minutes=25 * round_index)
        sorted_matches = sorted(
            [match for match in round_.matches if match is not None],
            key=lambda item: int(item.id),
        )
        for match_index, match in enumerate(sorted_matches):
            team1 = input_to_team_id.get(int(match.stage_item_input1_id or 0))
            team2 = input_to_team_id.get(int(match.stage_item_input2_id or 0))
            if team1 is None or team2 is None:
                continue
            score1, score2 = determine_score(
                seed_by_team_id.get(team1, 999),
                seed_by_team_id.get(team2, 999),
                round_index,
            )
            await update_match_with_result(
                int(match.id),
                score1=score1,
                score2=score2,
                start_time=round_start_time,
                court_id=court_ids[match_index % len(court_ids)],
                position_in_schedule=match_index,
            )

    updated_stage_item = await get_stage_item(tournament_id, stage_item.id)
    await recalculate_ranking_for_stage_item(tournament_id, updated_stage_item)
    await recalculate_tournament_records(tournament_id)

    standings = await database.fetch_all(
        """
        SELECT id, wins, draws, losses, name
        FROM teams
        WHERE tournament_id = :tournament_id
        ORDER BY wins DESC, draws DESC, losses ASC, name ASC
        """,
        values={"tournament_id": int(tournament_id)},
    )
    ordered_user_ids = [
        team_to_user[int(row._mapping["id"])]
        for row in standings
        if int(row._mapping["id"]) in team_to_user
    ]

    for participant in participants:
        user_id = int(participant["id"])
        deck_id = season_deck_ids.get(user_id)
        await upsert_tournament_application(
            tournament_id=tournament_id,
            user_id=UserId(user_id),
            season_id=season_id,
            deck_id=None if deck_id is None else int(deck_id),
        )

    await award_event_points(
        season_id=season_id,
        tournament_id=tournament_id,
        changed_by_user_id=changed_by_user_id,
        event_label=f"WEEK_{week_index}",
        ordered_user_ids=ordered_user_ids,
    )
    return tournament_id


async def create_finals_event(
    *,
    club_id: int,
    season_id: int,
    changed_by_user_id: UserId,
    participants: list[dict[str, Any]],
    season_deck_ids: dict[int, int],
    start_time: datetime_utc,
    dashboard_suffix: str,
) -> TournamentId:
    event_name = "Sample Season 1 - Finals (Swiss + Single Elim)"
    tournament_id = await create_event_tournament(
        club_id=club_id,
        name=event_name,
        start_time=start_time,
        dashboard_suffix=dashboard_suffix,
    )
    court_ids = await create_courts_for_tournament(tournament_id, count=5)
    user_to_team, team_to_user = await create_players_and_teams_for_tournament(
        tournament_id, participants
    )
    participant_team_ids = [user_to_team[int(participant["id"])] for participant in participants]
    seed_by_team_id = {team_id: index for index, team_id in enumerate(participant_team_ids)}

    ranking = await get_default_rankings_in_tournament(tournament_id)

    swiss_stage_id = await database.fetch_val(
        """
        INSERT INTO stages (name, tournament_id, is_active)
        VALUES (:name, :tournament_id, :is_active)
        RETURNING id
        """,
        values={
            "name": "Swiss Phase",
            "tournament_id": int(tournament_id),
            "is_active": False,
        },
    )
    swiss_stage_item = await sql_create_stage_item_with_empty_inputs(
        tournament_id,
        StageItemCreateBody(
            stage_id=int(swiss_stage_id),
            name="Finals Swiss",
            type=StageType.SWISS,
            team_count=len(participant_team_ids),
            ranking_id=ranking.id,
        ),
    )
    await assign_stage_item_inputs_to_teams(
        tournament_id,
        int(swiss_stage_item.id),
        participant_team_ids,
    )

    swiss_round_id = await sql_create_round(
        RoundInsertable(
            created=datetime_utc.now(),
            is_draft=False,
            stage_item_id=swiss_stage_item.id,
            name="Round 01",
        )
    )
    swiss_inputs = await database.fetch_all(
        """
        SELECT id
        FROM stage_item_inputs
        WHERE stage_item_id = :stage_item_id
        ORDER BY slot ASC, id ASC
        """,
        values={"stage_item_id": int(swiss_stage_item.id)},
    )
    swiss_input_ids = [int(row._mapping["id"]) for row in swiss_inputs]
    swiss_pairs = []
    for index in range(len(swiss_input_ids) // 2):
        swiss_pairs.append((swiss_input_ids[index], swiss_input_ids[-(index + 1)]))

    swiss_stage_data = await get_stage_item(tournament_id, swiss_stage_item.id)
    swiss_input_to_team = {
        int(stage_input.id): int(stage_input.team_id)
        for stage_input in swiss_stage_data.inputs
        if stage_input.team_id is not None
    }

    for match_index, (input1_id, input2_id) in enumerate(swiss_pairs):
        created_match = await sql_create_match(
            MatchCreateBody(
                round_id=swiss_round_id,
                court_id=None,
                stage_item_input1_id=input1_id,
                stage_item_input1_winner_from_match_id=None,
                stage_item_input2_id=input2_id,
                stage_item_input2_winner_from_match_id=None,
                duration_minutes=20,
                margin_minutes=5,
                custom_duration_minutes=None,
                custom_margin_minutes=None,
            )
        )
        team1 = swiss_input_to_team.get(input1_id)
        team2 = swiss_input_to_team.get(input2_id)
        if team1 is None or team2 is None:
            continue
        score1, score2 = determine_score(
            seed_by_team_id.get(team1, 999),
            seed_by_team_id.get(team2, 999),
            0,
        )
        await update_match_with_result(
            int(created_match.id),
            score1=score1,
            score2=score2,
            start_time=start_time,
            court_id=court_ids[match_index % len(court_ids)],
            position_in_schedule=match_index,
        )

    swiss_stage_data = await get_stage_item(tournament_id, swiss_stage_item.id)
    await recalculate_ranking_for_stage_item(tournament_id, swiss_stage_data)

    top_teams_rows = await database.fetch_all(
        """
        SELECT id, wins, draws, losses, name
        FROM teams
        WHERE tournament_id = :tournament_id
        ORDER BY wins DESC, draws DESC, losses ASC, name ASC
        LIMIT 8
        """,
        values={"tournament_id": int(tournament_id)},
    )
    top_8_team_ids = [int(row._mapping["id"]) for row in top_teams_rows]
    if len(top_8_team_ids) < 8:
        remaining = [team_id for team_id in participant_team_ids if team_id not in top_8_team_ids]
        top_8_team_ids.extend(remaining[: 8 - len(top_8_team_ids)])
    top_8_team_ids = top_8_team_ids[:8]

    elimination_stage_id = await database.fetch_val(
        """
        INSERT INTO stages (name, tournament_id, is_active)
        VALUES (:name, :tournament_id, :is_active)
        RETURNING id
        """,
        values={
            "name": "Single Elimination Phase",
            "tournament_id": int(tournament_id),
            "is_active": True,
        },
    )
    elimination_stage_item = await sql_create_stage_item_with_empty_inputs(
        tournament_id,
        StageItemCreateBody(
            stage_id=int(elimination_stage_id),
            name="Finals Bracket",
            type=StageType.SINGLE_ELIMINATION,
            team_count=8,
            ranking_id=ranking.id,
        ),
    )
    await assign_stage_item_inputs_to_teams(
        tournament_id,
        int(elimination_stage_item.id),
        top_8_team_ids,
    )
    await build_matches_for_stage_item(elimination_stage_item, tournament_id)

    elimination_seed_lookup = {team_id: index for index, team_id in enumerate(top_8_team_ids)}
    for round_index in range(3):
        elimination_data = await get_stage_item(tournament_id, elimination_stage_item.id)
        rounds = sorted(elimination_data.rounds, key=lambda item: int(item.id))
        if round_index >= len(rounds):
            break
        round_ = rounds[round_index]
        input_to_team = {
            int(stage_input.id): int(stage_input.team_id)
            for stage_input in elimination_data.inputs
            if stage_input.team_id is not None
        }
        matches_to_update: set[int] = set()
        sorted_matches = sorted(
            [match for match in round_.matches if match is not None],
            key=lambda item: int(item.id),
        )
        for match_index, match in enumerate(sorted_matches):
            input1_id = int(match.stage_item_input1_id or 0)
            input2_id = int(match.stage_item_input2_id or 0)
            team1 = input_to_team.get(input1_id)
            team2 = input_to_team.get(input2_id)
            if team1 is None or team2 is None:
                continue
            winner_is_team1 = (
                elimination_seed_lookup.get(team1, 999)
                <= elimination_seed_lookup.get(team2, 999)
            )
            if round_index == 2:
                score1, score2 = (2, 0) if winner_is_team1 else (0, 2)
            else:
                score1, score2 = (2, 1) if winner_is_team1 else (1, 2)
            await update_match_with_result(
                int(match.id),
                score1=score1,
                score2=score2,
                start_time=start_time + timedelta(minutes=25 * (round_index + 1)),
                court_id=court_ids[match_index % len(court_ids)],
                position_in_schedule=match_index,
            )
            matches_to_update.add(int(match.id))

        if round_index < len(rounds) - 1 and len(matches_to_update) > 0:
            elimination_data = await get_stage_item(tournament_id, elimination_stage_item.id)
            await update_inputs_in_subsequent_elimination_rounds(
                round_.id,
                elimination_data,
                matches_to_update,
            )

    elimination_data = await get_stage_item(tournament_id, elimination_stage_item.id)
    await recalculate_ranking_for_stage_item(tournament_id, elimination_data)
    await recalculate_tournament_records(tournament_id)

    standings = await database.fetch_all(
        """
        SELECT id, wins, draws, losses, name
        FROM teams
        WHERE tournament_id = :tournament_id
        ORDER BY wins DESC, draws DESC, losses ASC, name ASC
        """,
        values={"tournament_id": int(tournament_id)},
    )
    ordered_user_ids = [
        team_to_user[int(row._mapping["id"])]
        for row in standings
        if int(row._mapping["id"]) in team_to_user
    ]

    for participant in participants:
        user_id = int(participant["id"])
        deck_id = season_deck_ids.get(user_id)
        await upsert_tournament_application(
            tournament_id=tournament_id,
            user_id=UserId(user_id),
            season_id=season_id,
            deck_id=None if deck_id is None else int(deck_id),
        )

    await award_event_points(
        season_id=season_id,
        tournament_id=tournament_id,
        changed_by_user_id=changed_by_user_id,
        event_label="FINALS",
        ordered_user_ids=ordered_user_ids,
    )
    return tournament_id


async def seed_pool_and_decks_for_season(
    *,
    season_id: int,
    participants: list[dict[str, Any]],
    deck_cards: list[dict],
    leaders: list[dict],
    bases: list[dict],
    tournament_id_for_deck: TournamentId,
    total_cards: int,
) -> dict[int, int]:
    season_deck_ids: dict[int, int] = {}

    for index, participant in enumerate(participants):
        user_id = UserId(int(participant["id"]))
        user_name = str(participant["name"]).strip() or f"User {int(user_id)}"
        start_index = (index * 37) % len(deck_cards)

        await database.execute(
            """
            DELETE FROM card_pool_entries
            WHERE season_id = :season_id
              AND user_id = :user_id
            """,
            values={"season_id": season_id, "user_id": int(user_id)},
        )
        distribution = build_card_pool_distribution(
            deck_cards,
            start_index=start_index,
            total_cards=total_cards,
        )
        for card_id, quantity in distribution.items():
            await upsert_card_pool_entry(season_id, user_id, card_id, quantity)

        leader_id = (
            str(leaders[index % len(leaders)].get("card_id")).lower()
            if len(leaders) > 0
            else "sor-1"
        )
        base_id = (
            str(bases[index % len(bases)].get("card_id")).lower()
            if len(bases) > 0
            else "sor-21"
        )
        mainboard = build_mainboard(deck_cards, start_index, size=40)
        deck = await upsert_deck(
            season_id,
            user_id,
            tournament_id_for_deck,
            f"{user_name} Deck S{season_id}",
            leader_id,
            base_id,
            mainboard,
            {},
        )
        season_deck_ids[int(user_id)] = int(deck.id)

    return season_deck_ids


async def seed_for_tournament(
    tournament_id: TournamentId,
    target_season_name: str | None,
    sample_user_count: int,
    sample_password: str,
) -> None:
    tournament = await database.fetch_one(
        """
        SELECT id, club_id
        FROM tournaments
        WHERE id = :tournament_id
        """,
        values={"tournament_id": int(tournament_id)},
    )
    if tournament is None:
        raise ValueError(f"Tournament {int(tournament_id)} not found")
    club_id = int(tournament._mapping["club_id"])

    participants = await ensure_sample_users_for_club(
        club_id=club_id,
        user_count=sample_user_count,
        default_password=sample_password,
    )
    if len(participants) < 2:
        raise ValueError("Need at least 2 participants")

    changed_by_user_id = await get_changed_by_user_id(club_id, int(participants[0]["id"]))

    now = datetime_utc.now()
    stamp = now.strftime("%Y-%m-%d %H:%M:%S")
    source_season_name = f"Sample Source {stamp}"
    active_season_name = (
        target_season_name.strip()
        if target_season_name is not None and target_season_name.strip() != ""
        else f"Sample Season Active {stamp}"
    )
    season_one_name = f"Sample Season 1 {stamp}"

    source_season = await create_season(
        owner_tournament_id=tournament_id,
        name=source_season_name,
        is_active=False,
        tournament_ids=[tournament_id],
    )
    season_one = await create_season(
        owner_tournament_id=tournament_id,
        name=season_one_name,
        is_active=False,
        tournament_ids=[tournament_id],
    )
    active_season = await create_season(
        owner_tournament_id=tournament_id,
        name=active_season_name,
        is_active=True,
        tournament_ids=[tournament_id],
    )

    cards_raw = await asyncio.to_thread(fetch_swu_cards_cached, DEFAULT_SWU_SET_CODES, 12, 3600)
    normalized_cards = [normalize_card_for_deckbuilding(card) for card in cards_raw]
    leaders = [card for card in normalized_cards if str(card.get("type", "")).lower() == "leader"]
    bases = [card for card in normalized_cards if str(card.get("type", "")).lower() == "base"]
    deck_cards = [
        card
        for card in normalized_cards
        if str(card.get("type", "")).lower() not in {"leader", "base"}
    ]
    if len(deck_cards) < 1:
        raise ValueError("Card catalog unavailable, cannot seed sample data")

    for index, participant in enumerate(participants):
        user_id = UserId(int(participant["id"]))
        privileges = LeagueSeasonPrivilegesUpdateBody(
            role=SeasonMembershipRole.PLAYER,
            can_manage_points=False,
            can_manage_tournaments=False,
        )
        await upsert_season_membership(source_season.id, user_id, privileges)
        await upsert_season_membership(season_one.id, user_id, privileges)
        await upsert_season_membership(active_season.id, user_id, privileges)

        await insert_points_ledger_delta(
            source_season.id,
            user_id,
            changed_by_user_id,
            points_delta=float((index + 1) * 2),
            reason="SAMPLE_SEED:PREVIOUS_SEASON_POINTS",
        )

    source_deck_ids = await seed_pool_and_decks_for_season(
        season_id=source_season.id,
        participants=participants,
        deck_cards=deck_cards,
        leaders=leaders,
        bases=bases,
        tournament_id_for_deck=tournament_id,
        total_cards=120,
    )
    season_one_deck_ids = await seed_pool_and_decks_for_season(
        season_id=season_one.id,
        participants=participants,
        deck_cards=deck_cards,
        leaders=leaders,
        bases=bases,
        tournament_id_for_deck=tournament_id,
        total_cards=120,
    )
    active_deck_ids = await seed_pool_and_decks_for_season(
        season_id=active_season.id,
        participants=participants,
        deck_cards=deck_cards,
        leaders=leaders,
        bases=bases,
        tournament_id_for_deck=tournament_id,
        total_cards=120,
    )

    for participant in participants:
        user_id = UserId(int(participant["id"]))
        user_name = str(participant["name"])
        await ensure_user_registered_as_participant(
            tournament_id=tournament_id,
            user_id=user_id,
            participant_name=user_name,
            leader_image_url=None,
        )
        await upsert_tournament_application(
            tournament_id=tournament_id,
            user_id=user_id,
            season_id=active_season.id,
            deck_id=active_deck_ids.get(int(user_id)),
        )

    dashboard_suffix = now.strftime("%Y%m%d%H%M%S")
    season_start = now - timedelta(days=28)
    weekly_event_ids: list[TournamentId] = []
    for week_index in range(1, 4):
        event_id = await create_round_robin_event(
            club_id=club_id,
            season_id=season_one.id,
            changed_by_user_id=changed_by_user_id,
            participants=participants,
            season_deck_ids=season_one_deck_ids,
            start_time=season_start + timedelta(days=(week_index - 1) * 7),
            week_index=week_index,
            dashboard_suffix=f"{dashboard_suffix}-w{week_index}",
        )
        weekly_event_ids.append(event_id)

    finals_event_id = await create_finals_event(
        club_id=club_id,
        season_id=season_one.id,
        changed_by_user_id=changed_by_user_id,
        participants=participants,
        season_deck_ids=season_one_deck_ids,
        start_time=season_start + timedelta(days=21),
        dashboard_suffix=f"{dashboard_suffix}-finals",
    )

    await set_season_tournaments(
        season_one.id,
        [tournament_id, *weekly_event_ids, finals_event_id],
    )
    await set_season_tournaments(source_season.id, [tournament_id])
    await set_season_tournaments(active_season.id, [tournament_id])

    print(
        f"Seed complete | tournament={int(tournament_id)} | users={len(participants)} | "
        f"source_season={source_season.id} | season_one={season_one.id} | "
        f"active_season={active_season.id} | weekly_events={[int(x) for x in weekly_event_ids]} | "
        f"finals_event={int(finals_event_id)} | sample_password={sample_password}"
    )

    sample_pool_sizes = await database.fetch_all(
        """
        SELECT user_id, season_id, COALESCE(SUM(quantity), 0) AS card_count
        FROM card_pool_entries
        WHERE season_id IN (:source_season_id, :season_one_id, :active_season_id)
          AND user_id = ANY(:user_ids)
        GROUP BY user_id, season_id
        ORDER BY user_id ASC, season_id ASC
        """,
        values={
            "source_season_id": source_season.id,
            "season_one_id": season_one.id,
            "active_season_id": active_season.id,
            "user_ids": [int(participant["id"]) for participant in participants],
        },
    )
    pool_stats = [
        (
            int(row._mapping["user_id"]),
            int(row._mapping["season_id"]),
            int(row._mapping["card_count"]),
        )
        for row in sample_pool_sizes
    ]
    counts = [row[2] for row in pool_stats]
    if len(counts) > 0:
        print(
            "Card pool counts per user/season "
            f"(min/avg/max): {min(counts)}/{round(sum(counts) / len(counts), 2)}/{max(counts)}"
        )

    unique_team_counts = await database.fetch_all(
        """
        SELECT tournament_id, COUNT(*) AS team_count
        FROM teams
        WHERE tournament_id = ANY(:event_ids)
        GROUP BY tournament_id
        ORDER BY tournament_id
        """,
        values={"event_ids": [int(x) for x in [*weekly_event_ids, finals_event_id]]},
    )
    event_team_count = {
        int(row._mapping["tournament_id"]): int(row._mapping["team_count"])
        for row in unique_team_counts
    }
    print(f"Event team counts: {event_team_count}")


async def async_main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Seed league sample data: sample users, 120-card pools/decks, "
            "and season events with RR + Swiss/Single-Elim."
        )
    )
    parser.add_argument(
        "--tournament-id",
        type=int,
        default=None,
        help="Tournament ID to seed. If omitted, first tournament is used or one is auto-created.",
    )
    parser.add_argument("--season-name", type=str, default=None)
    parser.add_argument("--sample-users", type=int, default=10)
    parser.add_argument("--sample-password", type=str, default="sample-pass-123")
    args = parser.parse_args()

    if args.sample_users < 2:
        raise ValueError("--sample-users must be at least 2")

    await database.connect()
    try:
        tournament_id = await resolve_tournament_for_seed(args.tournament_id)
        await seed_for_tournament(
            tournament_id=tournament_id,
            target_season_name=args.season_name,
            sample_user_count=int(args.sample_users),
            sample_password=str(args.sample_password),
        )
    finally:
        await database.disconnect()


if __name__ == "__main__":
    asyncio.run(async_main())
