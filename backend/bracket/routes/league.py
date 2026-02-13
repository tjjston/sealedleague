from fastapi import APIRouter, Depends, HTTPException, Query
from starlette import status

from bracket.config import config
from bracket.models.db.user import UserPublic
from bracket.models.league import (
    LeagueAwardAccoladeBody,
    LeagueDeckImportSwuDbBody,
    LeagueCardPoolUpdateBody,
    LeagueDeckUpsertBody,
    LeaguePointsImportBody,
    LeagueSeasonPrivilegesUpdateBody,
)
from bracket.routes.auth import user_authenticated_for_tournament
from bracket.routes.models import (
    LeagueAdminUsersResponse,
    LeagueCardPoolEntriesResponse,
    LeagueDeckResponse,
    LeagueDecksResponse,
    LeagueSeasonStandingsResponse,
    SuccessResponse,
)
from bracket.sql.league import (
    delete_deck,
    get_card_pool_entries,
    get_deck_by_id,
    get_decks,
    get_league_admin_users,
    get_league_standings,
    get_or_create_active_season,
    get_user_id_by_email,
    insert_accolade,
    insert_points_ledger_delta,
    set_team_logo_for_user_in_tournament,
    upsert_card_pool_entry,
    upsert_deck,
    upsert_season_membership,
)
from bracket.utils.id_types import DeckId, TournamentId, UserId
from bracket.sql.tournaments import sql_get_tournament, sql_update_tournament
from bracket.models.db.tournament import TournamentUpdateBody

router = APIRouter(prefix=config.api_prefix)


def user_is_admin(user_public: UserPublic) -> bool:
    return config.admin_email is not None and user_public.email == config.admin_email


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
    "/tournaments/{tournament_id}/league/card_pool",
    response_model=LeagueCardPoolEntriesResponse,
)
async def get_card_pool(
    tournament_id: TournamentId,
    user_id: UserId | None = Query(default=None),
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
) -> LeagueCardPoolEntriesResponse:
    if can_manage_other_users(user_public, user_id) and not user_is_admin(user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = await get_or_create_active_season(tournament_id)
    if user_is_admin(user_public) and user_id is None:
        return LeagueCardPoolEntriesResponse(data=await get_card_pool_entries(season.id, None))

    target_user_id = (
        user_id if user_id is not None and user_is_admin(user_public) else user_public.id
    )
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
    if can_manage_other_users(user_public, body.user_id) and not user_is_admin(user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = await get_or_create_active_season(tournament_id)
    target_user_id = (
        body.user_id if body.user_id is not None and user_is_admin(user_public) else user_public.id
    )
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
    season = await get_or_create_active_season(tournament_id)
    if user_id is None:
        if user_is_admin(user_public):
            return LeagueDecksResponse(data=await get_decks(season.id))
        return LeagueDecksResponse(data=await get_decks(season.id, user_public.id))

    if can_manage_other_users(user_public, user_id) and not user_is_admin(user_public):
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
    if can_manage_other_users(user_public, body.user_id) and not user_is_admin(user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = await get_or_create_active_season(tournament_id)
    target_user_id = (
        body.user_id if body.user_id is not None and user_is_admin(user_public) else user_public.id
    )
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
        await set_team_logo_for_user_in_tournament(
            tournament_id=tournament_id,
            user_id=target_user_id,
            logo_path=body.leader_image_url,
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
    season = await get_or_create_active_season(tournament_id)
    deck = await get_deck_by_id(deck_id)
    if deck is None or deck.season_id != season.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found")

    if deck.user_id != user_public.id and not user_is_admin(user_public):
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
    if not user_is_admin(user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = await get_or_create_active_season(tournament_id)
    users = await get_league_admin_users(tournament_id, season.id)
    return LeagueAdminUsersResponse(data=users)


@router.put(
    "/tournaments/{tournament_id}/league/admin/users/{user_id}/season_privileges",
    response_model=SuccessResponse,
)
async def put_season_privileges(
    tournament_id: TournamentId,
    user_id: UserId,
    body: LeagueSeasonPrivilegesUpdateBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
) -> SuccessResponse:
    if not user_is_admin(user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = await get_or_create_active_season(tournament_id)
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
    if not user_is_admin(user_public):
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
    season = await get_or_create_active_season(tournament_id)
    deck = await get_deck_by_id(deck_id)
    if deck is None or deck.season_id != season.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deck not found")
    if deck.user_id != user_public.id and not user_is_admin(user_public):
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
    if can_manage_other_users(user_public, body.user_id) and not user_is_admin(user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")

    season = await get_or_create_active_season(tournament_id)
    target_user_id = (
        body.user_id if body.user_id is not None and user_is_admin(user_public) else user_public.id
    )

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
    if not user_is_admin(user_public):
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


@router.post("/tournaments/{tournament_id}/league/admin/import/standings", response_model=SuccessResponse)
async def import_standings_template(
    tournament_id: TournamentId,
    body: LeaguePointsImportBody,
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
) -> SuccessResponse:
    if not user_is_admin(user_public):
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


@router.get("/tournaments/{tournament_id}/league/admin/export/tournament_format")
async def export_tournament_format(
    tournament_id: TournamentId,
    user_public: UserPublic = Depends(user_authenticated_for_tournament),
) -> dict:
    if not user_is_admin(user_public):
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
    if not user_is_admin(user_public):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Admin access required")
    await sql_update_tournament(tournament_id, body)
    return SuccessResponse()

