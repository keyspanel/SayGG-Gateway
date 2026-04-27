#!/bin/bash
# Build backup(s) and ship them to a Telegram chat.
#
# Usage:
#   send-backup.sh full   # database + project files (default)
#   send-backup.sh db
#   send-backup.sh files
#
# Reads config from /etc/saygg-bot.env:
#   BOT_TOKEN          telegram bot token
#   OWNER_CHAT_IDS     comma-separated chat IDs; first one is the cron target
#   PROJECT_DIR        /var/www/SayGG-Gateway
#
# When called by the bot's listener it inherits TARGET_CHAT_ID so the
# requester (not just the first owner) gets the file.

set -uo pipefail

PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

MODE="${1:-full}"
ENV_FILE="${SAYGG_BOT_ENV:-/etc/saygg-bot.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a; source "$ENV_FILE"; set +a
fi

PROJECT_DIR="${PROJECT_DIR:-/var/www/SayGG-Gateway}"
TMP_DIR="${TMP_DIR:-/tmp/saygg-bot}"
MAX_PART_BYTES="${MAX_PART_BYTES:-47185920}"   # 45 MB; Telegram bots cap at 50 MB
TARGET_CHAT_ID="${TARGET_CHAT_ID:-${OWNER_CHAT_IDS%%,*}}"

if [[ -z "${BOT_TOKEN:-}" ]]; then
  echo "BOT_TOKEN missing (check $ENV_FILE)" >&2; exit 1
fi
if [[ -z "${TARGET_CHAT_ID:-}" ]]; then
  echo "TARGET_CHAT_ID/OWNER_CHAT_IDS missing" >&2; exit 1
fi

API="https://api.telegram.org/bot${BOT_TOKEN}"
mkdir -p "$TMP_DIR"

TS="$(date +%Y%m%d_%H%M%S)"
HOST="$(hostname -s 2>/dev/null || hostname)"

human() {
  if command -v numfmt >/dev/null 2>&1; then
    numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "${1}B"
  else
    echo "${1}B"
  fi
}

tg_message() {
  curl -sf -X POST "$API/sendMessage" \
    --data-urlencode "chat_id=$TARGET_CHAT_ID" \
    --data-urlencode "text=$1" >/dev/null || true
}

tg_document() {
  local file="$1" caption="${2:-}"
  curl -sf -X POST "$API/sendDocument" \
    -F "chat_id=${TARGET_CHAT_ID}" \
    -F "caption=${caption}" \
    -F "document=@${file}" >/dev/null
}

send_chunked() {
  local file="$1" label="$2"
  local size; size=$(stat -c%s "$file")
  if (( size <= MAX_PART_BYTES )); then
    tg_document "$file" "$label · $(human "$size")"
    return $?
  fi
  local base; base=$(basename "$file")
  local prefix="${TMP_DIR}/${base}.part_"
  rm -f "${prefix}"*
  split -b "$MAX_PART_BYTES" -d -a 3 "$file" "$prefix"
  local parts=( "${prefix}"* )
  local n=${#parts[@]}
  local i=1
  for p in "${parts[@]}"; do
    tg_document "$p" "$label · part ${i}/${n} — reassemble with: cat ${base}.part_* > ${base}"
    i=$((i + 1))
  done
  rm -f "${prefix}"*
}

backup_db() {
  if ! command -v pg_dump >/dev/null 2>&1; then
    tg_message "❌ pg_dump not installed on the VPS"
    return 1
  fi
  local DB_URL
  DB_URL="$(grep -E '^DATABASE_URL=' "$PROJECT_DIR/.env" 2>/dev/null | head -n1 | cut -d= -f2-)"
  if [[ -z "$DB_URL" ]]; then
    tg_message "❌ DATABASE_URL not found in $PROJECT_DIR/.env"
    return 1
  fi
  local OUT="${TMP_DIR}/${HOST}_db_${TS}.sql.gz"
  echo "[backup] dumping database -> $OUT"
  if ! pg_dump --no-owner --no-privileges --clean --if-exists "$DB_URL" | gzip -9 > "$OUT"; then
    tg_message "❌ pg_dump failed"
    rm -f "$OUT"
    return 1
  fi
  send_chunked "$OUT" "🗄 DB backup · ${HOST} · ${TS}"
  rm -f "$OUT"
}

backup_files() {
  local OUT="${TMP_DIR}/${HOST}_files_${TS}.tar.gz"
  echo "[backup] archiving $PROJECT_DIR -> $OUT"
  # Skip junk that bloats the archive but keep .env, ecosystem.config.cjs,
  # nginx config copies, scripts/ and source. node_modules + dist + .git are
  # rebuildable from source.
  if ! tar -czf "$OUT" \
        --exclude='node_modules' \
        --exclude='client/dist' \
        --exclude='.git' \
        --exclude='.cache' \
        --exclude='*.log' \
        -C "$(dirname "$PROJECT_DIR")" "$(basename "$PROJECT_DIR")" 2>/dev/null
  then
    tg_message "❌ tar failed"
    rm -f "$OUT"
    return 1
  fi
  send_chunked "$OUT" "📁 Files backup · ${HOST} · ${TS}"
  rm -f "$OUT"
}

case "$MODE" in
  full)  backup_db; backup_files ;;
  db)    backup_db ;;
  files) backup_files ;;
  *)     echo "Unknown mode: $MODE" >&2; exit 1 ;;
esac
