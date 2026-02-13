import asyncio
from urllib.error import HTTPError, URLError

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette import status

from bracket.config import config
from bracket.models.db.user import UserPublic
from bracket.models.league_cards import (
    LeagueDraftSimulation,
    LeagueDraftSimulationBody,
    LeagueSearchCard,
    LeagueSearchCards,
)
from bracket.routes.auth import user_authenticated, user_authenticated_for_tournament
from bracket.routes.models import LeagueCardsResponse, LeagueDraftSimulationResponse
from bracket.utils.id_types import TournamentId
from bracket.utils.league_cards import (
    DEFAULT_SWU_SET_CODES,
    fetch_swu_cards_cached,
    filter_cards_for_deckbuilding,
    simulate_sealed_draft,
)

router = APIRouter(prefix=config.api_prefix)


@router.get("/tournaments/{tournament_id}/league/cards", response_model=LeagueCardsResponse)
async def search_league_cards(
    tournament_id: TournamentId,
    _: UserPublic = Depends(user_authenticated_for_tournament),
    query: str | None = Query(default=None, description="Search in name, rules text, and traits."),
    set_code: list[str] | None = Query(
        default=None, description="Filter by one or more set codes (e.g. sor, shd)."
    ),
    aspect: list[str] | None = Query(default=None, description="Require aspects to be present."),
    trait: list[str] | None = Query(default=None, description="Require traits to be present."),
    keyword: list[str] | None = Query(default=None, description="Require keywords to be present."),
    arena: list[str] | None = Query(default=None, description="Require arenas to be present."),
    card_type: str | None = Query(default=None, description="Exact type match."),
    rarity: str | None = Query(default=None, description="Exact rarity match."),
    name: str | None = Query(default=None, description="Search by card name."),
    rules: str | None = Query(default=None, description="Search in rules text."),
    cost: int | None = Query(default=None, ge=0, le=20, description="Exact card cost."),
    cost_min: int | None = Query(default=None, ge=0, le=20, description="Minimum card cost."),
    cost_max: int | None = Query(default=None, ge=0, le=20, description="Maximum card cost."),
    unique: bool | None = Query(default=None, description="Filter unique vs non-unique cards."),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=5000),
) -> LeagueCardsResponse:
    set_codes = set_code if set_code else list(DEFAULT_SWU_SET_CODES)

    try:
        raw_cards = await asyncio.to_thread(fetch_swu_cards_cached, set_codes)
    except (URLError, HTTPError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not fetch SWU card catalog: {exc}",
        ) from exc

    filtered_cards = filter_cards_for_deckbuilding(
        raw_cards,
        query=query,
        set_codes=set_codes,
        aspects=aspect,
        traits=trait,
        keywords=keyword,
        arenas=arena,
        card_type=card_type,
        rarity=rarity,
        name=name,
        rules=rules,
        cost=cost,
        cost_min=cost_min,
        cost_max=cost_max,
        unique=unique,
    )
    filtered_cards.sort(key=lambda card: (card["name"].lower(), card["card_id"]))

    paginated_cards = [
        LeagueSearchCard.model_validate(card) for card in filtered_cards[offset : offset + limit]
    ]
    return LeagueCardsResponse(
        data=LeagueSearchCards(count=len(filtered_cards), cards=paginated_cards)
    )


@router.post(
    "/tournaments/{tournament_id}/league/draft/simulate",
    response_model=LeagueDraftSimulationResponse,
)
async def simulate_draft(
    tournament_id: TournamentId,
    body: LeagueDraftSimulationBody,
    _: UserPublic = Depends(user_authenticated_for_tournament),
) -> LeagueDraftSimulationResponse:
    set_codes = body.set_codes if body.set_codes else list(DEFAULT_SWU_SET_CODES)
    try:
        raw_cards = await asyncio.to_thread(fetch_swu_cards_cached, set_codes)
    except (URLError, HTTPError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not fetch SWU card catalog: {exc}",
        ) from exc

    try:
        simulation = simulate_sealed_draft(raw_cards, set_codes=set_codes, pack_count=body.pack_count)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return LeagueDraftSimulationResponse(data=LeagueDraftSimulation.model_validate(simulation))


@router.post(
    "/league/draft/simulate",
    response_model=LeagueDraftSimulationResponse,
)
async def simulate_draft_global(
    body: LeagueDraftSimulationBody,
    _: UserPublic = Depends(user_authenticated),
) -> LeagueDraftSimulationResponse:
    set_codes = body.set_codes if body.set_codes else list(DEFAULT_SWU_SET_CODES)
    try:
        raw_cards = await asyncio.to_thread(fetch_swu_cards_cached, set_codes)
    except (URLError, HTTPError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not fetch SWU card catalog: {exc}",
        ) from exc

    try:
        simulation = simulate_sealed_draft(raw_cards, set_codes=set_codes, pack_count=body.pack_count)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return LeagueDraftSimulationResponse(data=LeagueDraftSimulation.model_validate(simulation))
