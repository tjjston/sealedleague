# Sealed League

Sealed League is a customized fork of [evroon/bracket](https://github.com/evroon/bracket) focused on running Star Wars Unlimited league play:

- seasonal card pools
- deckbuilding from card pools
- tournament deck submissions
- season standings and card-pool draft rotation
- player career profiles and league admin tools

## What Is In This Repo

- `backend/`: FastAPI app, SQL layer, league logic, migrations, seed tooling
- `frontend/`: React + Vite + Mantine UI
- `docker-compose.yml`: local app + Postgres stack
- `backend/scripts/seed_league_sample_data.py`: sample seasons/users/events/decks generator

## Core Features

### Deckbuilder

- Search + filters across card metadata
- Sortable table columns
- Card pool quantity editing
- Deck/sideboard quantity tracking
- SWUDB JSON import/export
- Card-pool validation highlights + save confirmation
- Multiple saved decks per user per season (deck-name based)

### Tournament Entries

- Users submit saved decks from `Entries`
- Users see current submission + submitted players/decks
- Users see next opponent when event is active

### Players And Profiles

- Player directory shows avatar, current leader, tournaments won/placed, card totals, favorite media, and weapon icon
- Player profile shows overall record, season records, most-used aspects, and favorite card

### Seasons

- Create/set active/edit/delete seasons (admin)
- Season standings + cumulative standings
- Season card-pool draft rotation page (admin)

### Results

- Match result entry by admin or participating players
- Elimination bracket view + champions summary

### Account Settings

- Edit Details tab includes name/email/password/language
- Profile tab includes favorite card/media/avatar/weapon icon

## Roles And Permissions

- `ADMIN` users can manage clubs/tournaments/seasons/admin tools.
- `USER` (regular) users can use deckbuilder, view players, submit tournament decks, and report eligible match results.
- Demo account creation is disabled in this project (`ALLOW_DEMO_USER_REGISTRATION=false` by default in compose).

## Quick Start (Docker, Recommended)

### Prerequisites

- Docker + Docker Compose

### Start

```bash
cp .env.example .env
# edit .env with real secrets/origins before starting
export GIT_COMMIT="$(git rev-parse --short=12 HEAD)"
docker compose up -d --build
```

App URL:

- `http://localhost:8400`

Admin credentials now come from `.env` (`ADMIN_EMAIL` and `ADMIN_PASSWORD`).

### Useful Docker Commands

```bash
# Follow logs
docker compose logs -f sealedleague

# Restart app only
docker compose up -d --force-recreate sealedleague

# Stop stack
docker compose down

# Stop + remove DB volume
docker compose down -v
```

### Database Backups (Recommended Before Every Update)

Automatic daily snapshots are enabled by default through the `postgres-backup` service in `docker-compose.yml`.

- Default schedule: `03:00 UTC` daily
- Default retention: `30 days`
- Output directory: `backups/postgres/`

You can change these in `.env`:

```env
BACKUP_KEEP_DAYS=30
BACKUP_HOUR_UTC=03
BACKUP_MINUTE_UTC=00
BACKUP_RUN_ON_START=true
```

Create a snapshot:

```bash
./scripts/db-backup.sh
```

Restore from latest snapshot:

```bash
./scripts/db-restore.sh
```

Restore from a specific snapshot:

```bash
./scripts/db-restore.sh ./backups/postgres/sealedleague_YYYYmmddTHHMMSSZ.dump
```

Run daily snapshots with cron (example: 03:00 UTC, keep 30 days):

```bash
0 3 * * * cd /path/to/sealedleague && KEEP_DAYS=30 ./scripts/db-backup.sh >> /var/log/sealedleague-db-backup.log 2>&1
```

View backup service logs:

```bash
docker compose logs -f postgres-backup
```

Notes:

- Backups are written to `backups/postgres/` by default (both automated service and manual script).
- `db-restore.sh` stops the app container, replaces DB contents, then starts the app again.
- Avoid `docker compose down -v` unless you explicitly want to delete DB data.

### Server Update Flow (Always Build Current Commit)

```bash
git fetch --all --prune
git checkout master
git pull --ff-only origin master

export GIT_COMMIT="$(git rev-parse --short=12 HEAD)"
docker compose build --pull sealedleague
docker compose up -d --force-recreate sealedleague

# Verify the running container build commit:
docker inspect sealedleague-app --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}'
```

## First-Time Setup Flow (UI)

1. Sign in as admin.
2. Go to `Clubs` and create/select your club.
3. Create a tournament tied to that club.
4. Go to `League Admin` / `Season Standings` and create or activate the season you want.
5. Users register accounts (or admin creates users), then build decks in `Deckbuilder`.
6. Users submit decks in the tournament `Entries` page.
7. Admin schedules rounds/stages and runs events.

## Seed Sample Data (Recommended For Testing)

This script creates sample users, seasons, card pools, decks, weekly events, and finals.

### Command

```bash
docker compose exec sealedleague sh -lc "\
  cd /app && \
  PYTHONPATH=/app ./.venv/bin/python scripts/seed_league_sample_data.py \
    --season-name 'Season Sample Seed' \
    --sample-users 10 \
    --sample-password 'sample-pass-123' \
"
```

Notes:

- `--tournament-id` is optional now.
- If omitted, the script uses the first tournament in DB, or auto-creates one if none exist.
- You can still pass a specific tournament ID, e.g. `--tournament-id 5`.
- Sample users created as: `sample.player.01@sealedleague.local` ... `sample.player.10@sealedleague.local`

## SWUDB Import Notes

Deckbuilder import supports typical SWUDB JSON shape, including:

- `metadata.name`
- `leader.id`
- `base.id`
- `deck[]` and `sideboard[]`

Import updates current deck state (name, leader, base, mainboard, sideboard) and saves it.

## Local Development (Without Docker)

Prerequisites:

- Python + `uv`
- Node.js + `pnpm`
- PostgreSQL

### Run both frontend and backend

```bash
./run.sh
```

### Run separately

```bash
# Backend
cd backend
ENVIRONMENT=DEVELOPMENT uv run gunicorn \
  -k bracket.uvicorn.RestartableUvicornWorker \
  bracket.app:app \
  --bind localhost:8400 \
  --workers 2 \
  --reload

# Frontend
cd frontend
pnpm install
pnpm run dev
```

## Backend Helper Commands

From `backend/`:

```bash
# Create development DB
uv run ./cli.py create-dev-db

# Generate OpenAPI file
uv run ./cli.py generate-openapi

# Register user interactively
uv run ./cli.py register-user

# Formatting/type checks
./check.sh

# Full local precommit pipeline
./precommit.sh
```

## Troubleshooting

### Browser shows stale UI after code changes

- Run `docker compose up -d --force-recreate sealedleague`
- Hard refresh browser (`Ctrl+Shift+R`)

### App feels frozen or blank on pages

- Check logs: `docker compose logs sealedleague --tail=200`
- If worker timeouts repeat, verify worker config in `docker-compose.yml`:
  - `GUNICORN_CMD_ARGS` should include `--workers 2`
  - Keep `--timeout 120` during local debugging of heavy endpoints
- Rebuild/restart after config or image changes:
  - `docker compose up -d --build --force-recreate sealedleague`

### Timeout and latency runbook

- Watch timeout errors:
  - `docker compose logs sealedleague --tail=200 | rg "WORKER TIMEOUT|SIGKILL|SIGABRT"`
- Sample API latency metrics:
  - `curl -s http://localhost:8400/api/metrics | rg "bracket_response_time\\{.*(season_history|season_standings)"`
- Force an admin recalc when standings look stale:
  - `POST /api/tournaments/{id}/league/recalculate_records`

### Slow first card loads

- First request warms card caches; later loads should be faster
- Ensure Docker has enough memory/CPU

## Upstream And License

Based on [evroon/bracket](https://github.com/evroon/bracket).

License: [AGPL-3.0](LICENSE)
