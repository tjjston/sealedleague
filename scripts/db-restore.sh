#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

DEFAULT_BACKUP_DIR="${REPO_ROOT}/backups/postgres"
DUMP_FILE="${1:-${DEFAULT_BACKUP_DIR}/latest.dump}"

if [[ ! -f "${DUMP_FILE}" ]]; then
  echo "Dump file not found: ${DUMP_FILE}" >&2
  echo "Usage: $0 /path/to/sealedleague_YYYYmmddTHHMMSSZ.dump" >&2
  exit 1
fi

if [[ "${FORCE_RESTORE:-0}" != "1" ]]; then
  echo "This will erase and replace database contents using: ${DUMP_FILE}"
  read -r -p "Type RESTORE to continue: " confirmation
  if [[ "${confirmation}" != "RESTORE" ]]; then
    echo "Restore cancelled."
    exit 1
  fi
fi

docker compose ps postgres >/dev/null

# Prevent writes during restore.
docker compose stop sealedleague >/dev/null 2>&1 || true

docker compose exec -T postgres sh -lc '
  set -e
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '\''$POSTGRES_DB'\'' AND pid <> pg_backend_pid();"
  dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"
  createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
'

cat "${DUMP_FILE}" | docker compose exec -T postgres sh -lc \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges'

docker compose start sealedleague >/dev/null 2>&1 || true

echo "Restore completed from: ${DUMP_FILE}"
