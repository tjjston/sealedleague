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


def export_csv_template(headers: list[str]) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    return output.getvalue()


def points_import_template() -> str:
    return export_csv_template(LEAGUE_POINTS_TEMPLATE_HEADERS)


def standings_export_template() -> str:
    return export_csv_template(LEAGUE_STANDINGS_TEMPLATE_HEADERS)
