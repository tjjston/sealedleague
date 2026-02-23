#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

BACKUP_DIR="${1:-${BACKUP_DIR:-${REPO_ROOT}/backups/postgres}}"
KEEP_DAYS="${KEEP_DAYS:-30}"

mkdir -p "${BACKUP_DIR}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
outfile="${BACKUP_DIR}/sealedleague_${timestamp}.dump"
checksum_file="${outfile}.sha256"

docker compose ps postgres >/dev/null

docker compose exec -T postgres sh -lc \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "${outfile}"

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
