import json
import time
from collections.abc import Sequence
from threading import Lock
from urllib.request import urlopen

SWU_DB_SET_ENDPOINT = "https://api.swu-db.com/cards/{set_code}"
DEFAULT_SWU_SET_CODES: tuple[str, ...] = ("sor", "shd", "twi", "jtl", "lof", "ibh", "sec", "law")
_SWU_CACHE: dict[str, tuple[float, list[dict]]] = {}
_SWU_CACHE_LOCK = Lock()


def fetch_swu_cards(set_codes: Sequence[str], timeout_s: int = 30) -> list[dict]:
    cards: list[dict] = []
    for set_code in set_codes:
        with urlopen(
            SWU_DB_SET_ENDPOINT.format(set_code=set_code.lower()),
            timeout=timeout_s,
        ) as response:  # noqa: S310 controlled host
            payload = json.loads(response.read().decode("utf-8"))
        data = payload.get("data", [])
        cards.extend(data if isinstance(data, list) else [data])
    return cards


def fetch_swu_cards_cached(
    set_codes: Sequence[str], timeout_s: int = 30, cache_ttl_s: int = 900
) -> list[dict]:
    cards: list[dict] = []
    stale_codes: list[str] = []
    now = time.monotonic()

    normalized_set_codes = [set_code.strip().lower() for set_code in set_codes if set_code.strip()]
    for set_code in normalized_set_codes:
        cached = _SWU_CACHE.get(set_code)
        if cached is not None and now - cached[0] < cache_ttl_s:
            cards.extend(cached[1])
        else:
            stale_codes.append(set_code)

    if stale_codes:
        fetched = fetch_swu_cards(stale_codes, timeout_s=timeout_s)
        by_set: dict[str, list[dict]] = {set_code: [] for set_code in stale_codes}
        for card in fetched:
            card_set = str(card.get("Set", "")).strip().lower()
            if card_set in by_set:
                by_set[card_set].append(card)

        with _SWU_CACHE_LOCK:
            for set_code in stale_codes:
                set_cards = by_set.get(set_code, [])
                _SWU_CACHE[set_code] = (time.monotonic(), set_cards)
                cards.extend(set_cards)

    return cards


def normalize_card_id(set_code: str, number: str | int) -> str:
    return f"{set_code.strip().lower()}-{str(number).strip()}"


def normalize_card_for_deckbuilding(raw: dict) -> dict:
    set_code = str(raw.get("Set", "")).strip().lower()
    number = str(raw.get("Number", "")).strip()

    def list_of_strings(value: object) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item).strip() for item in value if str(item).strip()]

    return {
        "card_id": normalize_card_id(set_code=set_code, number=number),
        "set_code": set_code,
        "number": number,
        "name": str(raw.get("Name", "")).strip(),
        "type": str(raw.get("Type", "")).strip(),
        "rarity": str(raw.get("Rarity", "")).strip(),
        "aspects": list_of_strings(raw.get("Aspects")),
        "traits": list_of_strings(raw.get("Traits")),
        "keywords": list_of_strings(raw.get("Keywords")),
        "arenas": list_of_strings(raw.get("Arenas")),
        "rules_text": str(raw.get("FrontText", "")).strip(),
        "cost": raw.get("Cost"),
        "power": raw.get("Power"),
        "hp": raw.get("HP"),
        "unique": bool(raw.get("Unique", False)),
    }


def filter_cards_for_deckbuilding(
    cards: Sequence[dict],
    *,
    query: str | None = None,
    set_codes: Sequence[str] | None = None,
    aspects: Sequence[str] | None = None,
    traits: Sequence[str] | None = None,
    keywords: Sequence[str] | None = None,
    arenas: Sequence[str] | None = None,
    card_type: str | None = None,
    rarity: str | None = None,
    unique: bool | None = None,
) -> list[dict]:
    normalized_cards = [normalize_card_for_deckbuilding(card) for card in cards]

    normalized_set_codes = {code.strip().lower() for code in (set_codes or []) if code.strip()}
    normalized_aspects = {value.strip().lower() for value in (aspects or []) if value.strip()}
    normalized_traits = {value.strip().lower() for value in (traits or []) if value.strip()}
    normalized_keywords = {value.strip().lower() for value in (keywords or []) if value.strip()}
    normalized_arenas = {value.strip().lower() for value in (arenas or []) if value.strip()}
    normalized_card_type = card_type.strip().lower() if card_type else None
    normalized_rarity = rarity.strip().lower() if rarity else None
    normalized_query = query.strip().lower() if query else None

    filtered: list[dict] = []
    for card in normalized_cards:
        card_set = card["set_code"].lower()
        card_type_value = card["type"].lower()
        card_rarity = card["rarity"].lower()
        card_aspects = {value.lower() for value in card["aspects"]}
        card_traits = {value.lower() for value in card["traits"]}
        card_keywords = {value.lower() for value in card["keywords"]}
        card_arenas = {value.lower() for value in card["arenas"]}

        if normalized_set_codes and card_set not in normalized_set_codes:
            continue
        if normalized_card_type and card_type_value != normalized_card_type:
            continue
        if normalized_rarity and card_rarity != normalized_rarity:
            continue
        if unique is not None and card["unique"] is not unique:
            continue
        if normalized_aspects and not normalized_aspects.issubset(card_aspects):
            continue
        if normalized_traits and not normalized_traits.issubset(card_traits):
            continue
        if normalized_keywords and not normalized_keywords.issubset(card_keywords):
            continue
        if normalized_arenas and not normalized_arenas.issubset(card_arenas):
            continue
        if normalized_query:
            haystack = " ".join(
                [
                    card["name"].lower(),
                    card["rules_text"].lower(),
                    card_type_value,
                    " ".join(card_aspects),
                    " ".join(card_traits),
                    " ".join(card_keywords),
                ]
            )
            if normalized_query not in haystack:
                continue

        filtered.append(card)

    return filtered
