import io
import csv

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from starlette.responses import Response
from starlette import status

from bracket.config import config
from bracket.models.db.user import UserPublic
from bracket.models.league import (
    LeagueAwardAccoladeBody,
    LeagueSeasonCreateBody,
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
from bracket.routes.auth import user_authenticated_for_tournament
from bracket.routes.models import (
    LeagueAdminSeasonsResponse,
    LeagueTournamentApplicationsResponse,
    LeagueAdminUsersResponse,
    LeagueCardPoolEntriesResponse,
    LeagueDeckResponse,
    LeagueDecksResponse,
    LeagueSeasonHistoryResponse,
    LeagueSeasonStandingsResponse,
    SuccessResponse,
)
from bracket.sql.league import (
    create_season,
    delete_season,
    delete_deck,
    ensure_user_registered_as_participant,
    get_card_pool_entries,
    get_deck_by_id,
    get_decks,
    get_league_admin_users,
    get_league_standings,
    get_season_by_id,
    get_tournament_applications,
    get_or_create_season_by_name,
    get_or_create_active_season,
    get_seasons_for_tournament,
    get_user_id_by_email,
    insert_accolade,
    insert_points_ledger_delta,
    list_admin_seasons_for_tournament,
    set_team_logo_for_user_in_tournament,
    upsert_tournament_application,
    update_season,
    upsert_card_pool_entry,
    upsert_deck,
    upsert_season_membership,
    user_is_league_admin,
)
from bracket.utils.id_types import DeckId, TournamentId, UserId
from bracket.utils.logging import logger
from bracket.sql.tournaments import sql_get_tournament, sql_update_tournament
from bracket.models.db.tournament import TournamentUpdateBody

router = APIRouter(prefix=config.api_prefix)


def user_is_admin(user_public: UserPublic) -> bool:
    return config.admin_email is not None and user_public.email == config.admin_email


async def user_is_league_admin_for_tournament(
    tournament_id: TournamentId, user_public: UserPublic
) -> bool:
    if user_is_admin(user_public):
        return True
    return await user_is_league_admin(tournament_id, user_public.id)


def can_manage_other_users(current_user: UserPublic, target_user_id: UserId | None) -> bool:
    return target_user_id is not None and target_user_id != current_user.id


@router.get(
    "/tournaments/{tournament_id}/league/season_standings",
    response_model=LeagueSeasonStandingsResponse,
)
async def get_season_standings(
    tournament_id: TournamentId,
    _: UserPublic = Depends(user_authenticated_for_tournament),
) -> LeagueSeasonStandingsResponse:
    season = await get_or_create_active_season(tournament_id)
    standings = await get_league_standings(tournament_id, season.id)
    return LeagueSeasonStandingsResponse(data=standings)


@router.get(
    "/tournaments/{tournament_id}/league/season_history",
    response_model=LeagueSeasonHistoryResponse,
)
async def get_season_history(
    tournament_id: TournamentId,
    _: UserPublic = Depends(user_authenticated_for_tournament),
) -> LeagueSeasonHistoryResponse:
    seasons = await get_seasons_for_tournament(tournament_id)
    season_views = []
    for season in seasons:
        season_views.append(
            {
                "season_id": season.id,
                "season_name": season.name,
                "is_active": season.is_active,
                "standings": await get_league_standings(tournament_id, season.id),
            }
        )
    cumulative = await get_league_standings(tournament_id, None)
    return LeagueSeasonHistoryResponse(data={"seasons": season_views, "cumulative": cumulative})


@router.get(
    "/tournaments/{tournament_id}/league/card_pool",
    response_model=LeagueCardPoolEntriesResponse,
)
async def get_card_pool(
    tournament_id: TournamentId,
    user_id: UserId | None = Query(default=None),
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
) -> LeagueCardPoolEntriesResponse:
    has_admin_access = await user_is_league_admin_for_tournament(tournament_id, user_public)
    if can_manage_other_users(user_public, user_id) and not has_admin_access:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = await get_or_create_active_season(tournament_id)
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
) -> SuccessResponse:
    has_admin_access = await user_is_league_admin_for_tournament(tournament_id, user_public)
    if can_manage_other_users(user_public, body.user_id) and not has_admin_access:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = await get_or_create_active_season(tournament_id)
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
) -> LeagueDecksResponse:
    has_admin_access = await user_is_league_admin_for_tournament(tournament_id, user_public)
    season = await get_or_create_active_season(tournament_id)
    if user_id is None:
        if has_admin_access:
            return LeagueDecksResponse(data=await get_decks(season.id))
        return LeagueDecksResponse(data=await get_decks(season.id, user_public.id))

    if can_manage_other_users(user_public, user_id) and not has_admin_access:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    return LeagueDecksResponse(data=await get_decks(season.id, user_id))


@router.post(
    "/tournaments/{tournament_id}/league/decks",
    response_model=LeagueDeckResponse,
)
async def post_deck(
    tournament_id: TournamentId,
    body: LeagueDeckUpsertBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
) -> SuccessResponse:
    has_admin_access = await user_is_league_admin_for_tournament(tournament_id, user_public)
    season = await get_or_create_active_season(tournament_id)
    deck = await get_deck_by_id(deck_id)
    if deck is None or deck.season_id != season.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found")

    if deck.user_id != user_public.id and not has_admin_access:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Cannot delete this deck")

    await delete_deck(deck_id)
    return SuccessResponse()


@router.get(
    "/tournaments/{tournament_id}/league/admin/users",
    response_model=LeagueAdminUsersResponse,
)
async def list_league_admin_users(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
) -> LeagueAdminUsersResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = await get_or_create_active_season(tournament_id)
    users = await get_league_admin_users(tournament_id, season.id)
    return LeagueAdminUsersResponse(data=users)


@router.get(
    "/tournaments/{tournament_id}/league/admin/seasons",
    response_model=LeagueAdminSeasonsResponse,
)
async def list_admin_seasons(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
) -> LeagueAdminSeasonsResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    return LeagueAdminSeasonsResponse(data=await list_admin_seasons_for_tournament(tournament_id))


@router.post(
    "/tournaments/{tournament_id}/league/admin/seasons",
    response_model=SuccessResponse,
)
async def post_admin_season(
    tournament_id: TournamentId,
    body: LeagueSeasonCreateBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
) -> SuccessResponse:
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

    if body.deck_id is not None:
        deck = await get_deck_by_id(body.deck_id)
        if deck is None or deck.user_id != user_public.id:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid deck selection")

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
        deck_id=body.deck_id,
    )
    return SuccessResponse()


@router.get(
    "/tournaments/{tournament_id}/league/applications/me",
    response_model=LeagueTournamentApplicationsResponse,
)
async def get_my_tournament_application(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
) -> LeagueTournamentApplicationsResponse:
    data = await get_tournament_applications(tournament_id, user_public.id)
    return LeagueTournamentApplicationsResponse(data=data)


@router.get(
    "/tournaments/{tournament_id}/league/admin/applications",
    response_model=LeagueTournamentApplicationsResponse,
)
async def list_tournament_applications(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
) -> dict:
    has_admin_access = await user_is_league_admin_for_tournament(tournament_id, user_public)
    season = await get_or_create_active_season(tournament_id)
    deck = await get_deck_by_id(deck_id)
    if deck is None or deck.season_id != season.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found")
    if deck.user_id != user_public.id and not has_admin_access:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Cannot export this deck")

    return {
        "name": deck.name,
        "leader": {"id": deck.leader, "count": 1},
        "base": {"id": deck.base, "count": 1},
        "deck": [{"id": card_id, "count": count} for card_id, count in deck.mainboard.items()],
        "sideboard": [
            {"id": card_id, "count": count} for card_id, count in deck.sideboard.items()
        ],
    }


@router.post("/tournaments/{tournament_id}/league/decks/import/swudb", response_model=LeagueDeckResponse)
async def import_deck_swudb(
    tournament_id: TournamentId,
    body: LeagueDeckImportSwuDbBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
) -> LeagueDeckResponse:
    has_admin_access = await user_is_league_admin_for_tournament(tournament_id, user_public)
    if can_manage_other_users(user_public, body.user_id) and not has_admin_access:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = await get_or_create_active_season(tournament_id)
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
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
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
) -> SuccessResponse:
    if not await user_is_league_admin_for_tournament(tournament_id, user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    await sql_update_tournament(tournament_id, body)
    return SuccessResponse()
