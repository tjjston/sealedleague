import csv
import io

LEAGUE_POINTS_TEMPLATE_HEADERS = [
    "season_name",
    "user_email",
    "points_delta",
    "reason",
    "tournament_name",
]

LEAGUE_STANDINGS_TEMPLATE_HEADERS = [
    "season_name",
    "user_email",
    "wins",
    "draws",
    "losses",
    "total_points",
    "deck_name",
    "deck_leader",
    "deck_base",
]

LEAGUE_CARD_POOL_TEMPLATE_HEADERS = [
    "season_name",
    "user_email",
    "card_id",
    "quantity",
]

LEAGUE_DECK_TEMPLATE_HEADERS = [
    "season_name",
    "user_email",
    "deck_name",
    "leader",
    "base",
    "mainboard_json",
    "sideboard_json",
    "tournament_name",
]

CARD_REFERENCE_TEMPLATE_HEADERS = [
    "card_id",
    "set_code",
    "number",
    "name",
    "type",
    "rarity",
]


class LeaguePointsImportRow(BaseModel):
    season_name: str
    user_email: str
    points_delta: float
    reason: str | None = None
    tournament_name: str | None = None


class LeagueStandingsExportRow(BaseModel):
    season_name: str
    user_email: str
    wins: int = Field(default=0, ge=0)
    draws: int = Field(default=0, ge=0)
    losses: int = Field(default=0, ge=0)
    total_points: float
    deck_name: str | None = None
    deck_leader: str | None = None
    deck_base: str | None = None


class LeagueCardPoolImportRow(BaseModel):
    season_name: str
    user_email: str
    card_id: str
    quantity: int = Field(ge=1)


def export_csv_template(headers: list[str]) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    return output.getvalue()


def points_import_template() -> str:
    return export_csv_template(LEAGUE_POINTS_TEMPLATE_HEADERS)


def standings_export_template() -> str:
    return export_csv_template(LEAGUE_STANDINGS_TEMPLATE_HEADERS)


def card_pool_import_template() -> str:
    return export_csv_template(LEAGUE_CARD_POOL_TEMPLATE_HEADERS)


def deck_import_template() -> str:
    return export_csv_template(LEAGUE_DECK_TEMPLATE_HEADERS)


def parse_points_import_csv(content: str) -> list[LeaguePointsImportRow]:
    reader = csv.DictReader(io.StringIO(content))
    return [LeaguePointsImportRow.model_validate(row) for row in reader]


def export_standings_csv(rows: Sequence[LeagueStandingsExportRow]) -> str:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=LEAGUE_STANDINGS_TEMPLATE_HEADERS)
    writer.writeheader()
    for row in rows:
        writer.writerow(row.model_dump())
    return output.getvalue()


def normalize_card_id(set_code: str, number: str | int) -> str:
    return f"{set_code.strip().lower()}-{str(number).strip()}"


def card_reference_export(cards: Iterable[dict[str, Any]]) -> str:
    """Export a compact card reference sheet that can back card_pool imports.

    This works with payloads from swu-db style APIs (keys like Set/Number/Name/Type/Rarity).
    """

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=CARD_REFERENCE_TEMPLATE_HEADERS)
    writer.writeheader()

    for card in cards:
        set_code = str(card.get("Set", "")).strip().lower()
        number = str(card.get("Number", "")).strip()
        writer.writerow(
            {
                "card_id": normalize_card_id(set_code=set_code, number=number),
                "set_code": set_code,
                "number": number,
                "name": card.get("Name", ""),
                "type": card.get("Type", ""),
                "rarity": card.get("Rarity", ""),
            }
        )

    return output.getvalue()
