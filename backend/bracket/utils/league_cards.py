import json
from collections.abc import Sequence
from urllib.request import urlopen

SWU_DB_SET_ENDPOINT = "https://api.swu-db.com/cards/{set_code}"


def fetch_swu_cards(set_codes: Sequence[str], timeout_s: int = 30) -> list[dict]:
    cards: list[dict] = []
    for set_code in set_codes:
        with urlopen(SWU_DB_SET_ENDPOINT.format(set_code=set_code.lower()), timeout=timeout_s) as response:  # noqa: S310 controlled host
            payload = json.loads(response.read().decode("utf-8"))
        data = payload.get("data", [])
        cards.extend(data if isinstance(data, list) else [data])
    return cards
