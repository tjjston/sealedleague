import re
from collections.abc import Mapping


def _to_positive_int(value: object) -> int:
    try:
        parsed = int(value)  # pyright: ignore [reportArgumentType]
    except (TypeError, ValueError):
        return 0
    return parsed if parsed > 0 else 0


def to_swudb_card_id(card_id: str | None) -> str:
    normalized = str(card_id or "").strip().lower().replace("_", "-")
    if normalized == "":
        return ""

    set_code, separator, remainder = normalized.partition("-")
    if separator == "" or set_code == "" or remainder == "":
        return normalized.replace("-", "_").upper()

    first_token = remainder.split("-", 1)[0].strip()
    parsed = re.fullmatch(r"0*(\d+)([a-z]*)", first_token)
    if parsed is None:
        return f"{set_code}_{remainder}".upper()

    number = int(parsed.group(1))
    suffix = parsed.group(2).lower()
    # Foil variants in local IDs (`...f`) should resolve to canonical SWUDB card IDs.
    suffix = "" if suffix == "f" else suffix
    return f"{set_code}_{number:03d}{suffix}".upper()


def _build_swudb_entries(card_map: Mapping[str, int]) -> list[dict[str, int | str]]:
    aggregated: dict[str, int] = {}
    for card_id, raw_count in card_map.items():
        count = _to_positive_int(raw_count)
        if count <= 0:
            continue
        normalized_id = to_swudb_card_id(card_id)
        if normalized_id == "":
            continue
        aggregated[normalized_id] = aggregated.get(normalized_id, 0) + count

    return [
        {"id": card_id, "count": count}
        for card_id, count in sorted(aggregated.items(), key=lambda item: item[0])
    ]


def build_swudb_deck_export(
    *,
    name: str,
    leader: str,
    base: str,
    mainboard: Mapping[str, int],
    sideboard: Mapping[str, int],
    author: str | None = None,
) -> dict:
    metadata: dict[str, str] = {"name": name}
    if author is not None and author.strip() != "":
        metadata["author"] = author.strip()

    return {
        "metadata": metadata,
        # Keep root-level name for compatibility with existing import/export consumers.
        "name": name,
        "leader": {"id": to_swudb_card_id(leader), "count": 1},
        "base": {"id": to_swudb_card_id(base), "count": 1},
        "deck": _build_swudb_entries(mainboard),
        "sideboard": _build_swudb_entries(sideboard),
    }
