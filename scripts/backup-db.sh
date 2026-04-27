#!/bin/bash
# SayGG Gateway — Postgres nightly backup
# Usage: ./scripts/backup-db.sh
# Safe to run via cron. Keeps the last 14 daily backups + 8 weekly.

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/var/www/SayGG-Gateway}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/saygg-gateway}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"

ENV_FILE="$PROJECT_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "[backup] .env not found at $ENV_FILE" >&2
  exit 1
fi

# Load DATABASE_URL from .env (without exporting other shell-unsafe lines)
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[backup] DATABASE_URL is missing in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"

TS="$(date +%Y%m%d_%H%M%S)"
DOW="$(date +%u)"  # 1=Mon..7=Sun
DAILY_FILE="$BACKUP_DIR/daily/gateway_${TS}.sql.gz"

echo "[backup] dumping → $DAILY_FILE"
pg_dump --no-owner --no-privileges --clean --if-exists "$DATABASE_URL" \
  | gzip -9 > "$DAILY_FILE"

# Sunday → also copy to weekly
if [[ "$DOW" == "7" ]]; then
  WEEKLY_FILE="$BACKUP_DIR/weekly/gateway_${TS}.sql.gz"
  cp "$DAILY_FILE" "$WEEKLY_FILE"
  echo "[backup] weekly copy → $WEEKLY_FILE"
fi

# Rotate
cd "$BACKUP_DIR/daily"
ls -1t gateway_*.sql.gz 2>/dev/null | tail -n +"$((KEEP_DAILY + 1))" | xargs -r rm -f
cd "$BACKUP_DIR/weekly"
ls -1t gateway_*.sql.gz 2>/dev/null | tail -n +"$((KEEP_WEEKLY + 1))" | xargs -r rm -f

# Sanity check
SIZE="$(du -h "$DAILY_FILE" | cut -f1)"
echo "[backup] OK ($SIZE)"
