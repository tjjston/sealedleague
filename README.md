# Sealed League

Sealed League is a customized fork of [evroon/bracket](https://github.com/evroon/bracket) focused on running league-style play for sealed deck formats (including Star Wars Unlimited workflows).

It keeps Bracket's tournament management foundation and adds league-specific features like season standings, sealed draft simulation, card-pool tracking, and deck submission/deckbuilding flows.

## What this repo includes

- Backend: FastAPI + async Python (`backend/`)
- Frontend: React + Vite + Mantine (`frontend/`)
- Dockerized app + Postgres for local/dev deployment (`docker-compose.yml`)
- League APIs and pages for:
- season standings/history
- card pool management
- deck save/import/submission
- sealed draft simulation

## Quick Start (Docker)

Run the full stack with Docker Compose:

```bash
docker compose up -d --build
```

App URL:

- `http://localhost:8400`

Default local credentials from `docker-compose.yml`:

- Admin email: `admin@sealedleague.local`
- Admin password: `change-me-now`

Important: change these values before using this outside local development.

Useful commands:

```bash
# Follow logs
docker compose logs -f sealedleague

# Stop stack
docker compose down

# Stop stack and remove DB volume
docker compose down -v
```

## Development (without Docker)

Prerequisites:

- Python 3.12+
- `uv`
- Node.js + `pnpm`
- PostgreSQL

Run frontend + backend together:

```bash
./run.sh
```

This starts:

- Frontend dev server (Vite)
- Backend on `http://localhost:8400`

You can also run each service separately:

```bash
# Backend
cd backend
ENVIRONMENT=DEVELOPMENT uv run gunicorn \
  -k bracket.uvicorn.RestartableUvicornWorker \
  bracket.app:app \
  --bind localhost:8400 \
  --workers 1 \
  --reload

# Frontend
cd frontend
pnpm install
pnpm run dev
```

## Database and helper commands

From `backend/`:

```bash
# Seed a development database
uv run ./cli.py create-dev-db

# Generate OpenAPI JSON
uv run ./cli.py generate-openapi

# Register a user interactively
uv run ./cli.py register-user
```

## Quality checks

From `backend/`:

```bash
# Formatting + type checks used in this repo
./check.sh

# Full precommit pipeline (lint/tests/openapi generation)
./precommit.sh
```

## Project layout

```text
backend/    FastAPI app, SQL models, league logic, tests
frontend/   React/Vite UI and league pages
docs/       Documentation site content
Dockerfile  Production-style image (builds frontend, serves via backend)
docker-compose.yml  Local stack (app + postgres)
```

## Upstream

This project is based on `evroon/bracket` and retains AGPL-3.0 licensing.

- Upstream repo: <https://github.com/evroon/bracket>
- License: [AGPL-3.0](LICENSE)
