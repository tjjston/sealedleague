#!/usr/bin/env bash
set -euo pipefail

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-sealedleague}"
POSTGRES_USER="${POSTGRES_USER:-sealedleague}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}"

BACKUP_DIR="${BACKUP_DIR:-/backups/postgres}"
KEEP_DAYS="${KEEP_DAYS:-30}"
BACKUP_HOUR_UTC="${BACKUP_HOUR_UTC:-03}"
BACKUP_MINUTE_UTC="${BACKUP_MINUTE_UTC:-00}"
RUN_ON_START="${RUN_ON_START:-true}"

if ! [[ "${KEEP_DAYS}" =~ ^[0-9]+$ ]]; then
  echo "KEEP_DAYS must be a non-negative integer" >&2
  exit 1
fi
if ! [[ "${BACKUP_HOUR_UTC}" =~ ^[0-9]{1,2}$ ]]; then
  echo "BACKUP_HOUR_UTC must be an integer from 0 to 23" >&2
  exit 1
fi
if ! [[ "${BACKUP_MINUTE_UTC}" =~ ^[0-9]{1,2}$ ]]; then
  echo "BACKUP_MINUTE_UTC must be an integer from 0 to 59" >&2
  exit 1
fi
if (( BACKUP_HOUR_UTC < 0 || BACKUP_HOUR_UTC > 23 )); then
  echo "BACKUP_HOUR_UTC must be between 0 and 23" >&2
  exit 1
fi
if (( BACKUP_MINUTE_UTC < 0 || BACKUP_MINUTE_UTC > 59 )); then
  echo "BACKUP_MINUTE_UTC must be between 0 and 59" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

wait_for_postgres() {
  until PGPASSWORD="${POSTGRES_PASSWORD}" pg_isready \
    -h "${POSTGRES_HOST}" \
    -p "${POSTGRES_PORT}" \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" >/dev/null 2>&1; do
    echo "Waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT}..."
    sleep 2
  done
}

run_backup() {
  local timestamp outfile checksum_file
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  outfile="${BACKUP_DIR}/sealedleague_${timestamp}.dump"
  checksum_file="${outfile}.sha256"

  echo "Creating backup at ${timestamp}..."
  PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
    -h "${POSTGRES_HOST}" \
    -p "${POSTGRES_PORT}" \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    -Fc > "${outfile}"

  sha256sum "${outfile}" > "${checksum_file}"

  if ln -sfn "$(basename "${outfile}")" "${BACKUP_DIR}/latest.dump" 2>/dev/null; then
    ln -sfn "$(basename "${checksum_file}")" "${BACKUP_DIR}/latest.dump.sha256" 2>/dev/null || true
  else
    cp -f "${outfile}" "${BACKUP_DIR}/latest.dump"
    cp -f "${checksum_file}" "${BACKUP_DIR}/latest.dump.sha256"
  fi

  find "${BACKUP_DIR}" -maxdepth 1 -type f -name "sealedleague_*.dump" -mtime +"${KEEP_DAYS}" -delete
  find "${BACKUP_DIR}" -maxdepth 1 -type f -name "sealedleague_*.dump.sha256" -mtime +"${KEEP_DAYS}" -delete

  echo "Backup created: ${outfile}"
  echo "Checksum: ${checksum_file}"
}

seconds_until_next_run() {
  local now_epoch today_target_epoch
  now_epoch="$(date -u +%s)"
  today_target_epoch="$(
    date -u -d "$(date -u +%Y-%m-%d) ${BACKUP_HOUR_UTC}:${BACKUP_MINUTE_UTC}:00" +%s
  )"

  if (( now_epoch >= today_target_epoch )); then
    echo "$((today_target_epoch + 86400 - now_epoch))"
  else
    echo "$((today_target_epoch - now_epoch))"
  fi
}

wait_for_postgres

case "${RUN_ON_START,,}" in
  1|true|yes|y)
    run_backup
    ;;
esac

while true; do
  sleep_seconds="$(seconds_until_next_run)"
  next_run="$(date -u -d "@$(( $(date -u +%s) + sleep_seconds ))" +%Y-%m-%dT%H:%M:%SZ)"
  echo "Next backup scheduled at ${next_run} UTC (in ${sleep_seconds}s)"
  sleep "${sleep_seconds}"
  run_backup
done
