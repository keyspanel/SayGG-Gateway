#!/bin/bash
# SayGG Gateway — one-stop project manager
# Usage:
#   ./scripts/manage.sh                 # interactive menu
#   ./scripts/manage.sh deploy          # pull + install + build + restart
#   ./scripts/manage.sh restart         # restart pm2 process
#   ./scripts/manage.sh status          # status + health check
#   ./scripts/manage.sh logs            # tail pm2 logs
#   ./scripts/manage.sh doctor          # check + auto-fix env
#   ./scripts/manage.sh clean-restart   # full clean + reinstall + rebuild
#   ./scripts/manage.sh backup          # run a Postgres backup right now
#   ./scripts/manage.sh restore <file>  # restore from a backup file
#   ./scripts/manage.sh subdomain       # change/setup the subdomain (interactive)

set -uo pipefail

PROJECT_DIR="${PROJECT_DIR:-/var/www/SayGG-Gateway}"
PM2_NAME="${PM2_NAME:-saygg-gateway}"
APP_PORT="${APP_PORT:-5000}"

c_reset='\033[0m'; c_red='\033[1;31m'; c_grn='\033[1;32m'
c_ylw='\033[1;33m'; c_blu='\033[1;34m'; c_dim='\033[2m'

say()  { printf "${c_blu}» %s${c_reset}\n" "$*"; }
ok()   { printf "${c_grn}✓ %s${c_reset}\n" "$*"; }
warn() { printf "${c_ylw}! %s${c_reset}\n" "$*"; }
err()  { printf "${c_red}✗ %s${c_reset}\n" "$*" >&2; }

cd "$PROJECT_DIR" || { err "Project dir not found: $PROJECT_DIR"; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || { err "Missing command: $1"; return 1; }
}

ensure_packages() {
  say "Checking required system packages…"
  local missing=()
  for c in node npm git pm2 nginx pg_dump psql curl; do
    command -v "$c" >/dev/null 2>&1 || missing+=("$c")
  done
  if [[ ${#missing[@]} -eq 0 ]]; then
    ok "All required commands are present"
  else
    warn "Missing: ${missing[*]} — installing…"
    apt update -y
    for m in "${missing[@]}"; do
      case "$m" in
        node|npm)   curl -fsSL https://deb.nodesource.com/setup_20.x | bash -; apt install -y nodejs ;;
        pm2)        npm install -g pm2 ;;
        nginx)      apt install -y nginx ;;
        pg_dump|psql) apt install -y postgresql-client ;;
        git)        apt install -y git ;;
        curl)       apt install -y curl ;;
      esac
    done
    ok "Packages ready"
  fi
}

deploy() {
  ensure_packages
  say "Pulling latest from GitHub…"
  git fetch --all
  git reset --hard origin/main
  ok "Code updated"

  say "Installing npm packages…"
  npm install --no-audit --no-fund
  ok "Packages installed"

  say "Building frontend…"
  npm run build
  ok "Build complete"

  say "Restarting PM2 process…"
  pm2 restart "$PM2_NAME" --update-env || pm2 start ecosystem.config.cjs
  pm2 save
  sleep 2
  status_only
  ok "Deploy finished"
}

restart() {
  say "Restarting $PM2_NAME…"
  pm2 restart "$PM2_NAME" --update-env || pm2 start ecosystem.config.cjs
  pm2 save
  sleep 2
  status_only
}

status_only() {
  pm2 status | grep -E "(name|$PM2_NAME)" || true
  echo
  say "Health check:"
  if curl -sf "http://127.0.0.1:$APP_PORT/api/health" >/dev/null; then
    ok "API responds 200 on http://127.0.0.1:$APP_PORT/api/health"
  else
    err "API not responding on port $APP_PORT"
    return 1
  fi
}

logs() {
  pm2 logs "$PM2_NAME" --lines 60
}

doctor() {
  say "Running diagnostics…"
  ensure_packages

  if [[ ! -f .env ]]; then
    err ".env missing — copying from .env.example"
    cp .env.example .env
    warn "Edit .env and fill in DATABASE_URL + JWT_SECRET, then re-run."
    return 1
  fi

  local DB_URL
  DB_URL="$(grep -E '^DATABASE_URL=' .env | head -n1 | cut -d= -f2-)"
  if [[ -z "$DB_URL" ]]; then
    err "DATABASE_URL not set in .env"
    return 1
  fi

  say "Testing Postgres connection…"
  if psql "$DB_URL" -c "SELECT 1;" >/dev/null 2>&1; then
    ok "Postgres reachable"
  else
    err "Cannot connect to Postgres with DATABASE_URL"
    return 1
  fi

  if [[ ! -d node_modules ]]; then
    warn "node_modules missing — installing"
    npm install --no-audit --no-fund
  fi

  if [[ ! -d client/dist ]]; then
    warn "client/dist missing — building"
    npm run build
  fi

  if ! pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    warn "PM2 process not running — starting"
    pm2 start ecosystem.config.cjs
    pm2 save
  fi

  status_only
  ok "Doctor complete"
}

clean_restart() {
  warn "This will delete node_modules, client/dist, and reinstall everything."
  read -r -p "Continue? [y/N] " yn
  [[ "$yn" =~ ^[Yy]$ ]] || { warn "Aborted"; return 0; }

  say "Stopping PM2 process…"
  pm2 stop "$PM2_NAME" 2>/dev/null || true

  say "Removing node_modules and build…"
  rm -rf node_modules client/dist package-lock.json.bak

  say "Reinstalling…"
  npm install --no-audit --no-fund

  say "Rebuilding…"
  npm run build

  say "Restarting…"
  pm2 restart "$PM2_NAME" --update-env || pm2 start ecosystem.config.cjs
  pm2 save
  sleep 2
  status_only
  ok "Clean restart finished"
}

backup_now() {
  bash "$PROJECT_DIR/scripts/backup-db.sh"
}

restore() {
  local FILE="${1:-}"
  if [[ -z "$FILE" || ! -f "$FILE" ]]; then
    err "Usage: $0 restore <path-to-backup.sql.gz>"
    return 1
  fi
  warn "This will OVERWRITE the current database with $FILE"
  read -r -p "Type 'restore' to confirm: " yn
  [[ "$yn" == "restore" ]] || { warn "Aborted"; return 0; }

  local DB_URL
  DB_URL="$(grep -E '^DATABASE_URL=' .env | head -n1 | cut -d= -f2-)"
  pm2 stop "$PM2_NAME" 2>/dev/null || true
  if [[ "$FILE" == *.gz ]]; then
    gunzip -c "$FILE" | psql "$DB_URL"
  else
    psql "$DB_URL" -f "$FILE"
  fi
  pm2 restart "$PM2_NAME" --update-env || pm2 start ecosystem.config.cjs
  pm2 save
  ok "Restore finished"
}

subdomain() {
  bash "$PROJECT_DIR/scripts/change-subdomain.sh"
}

bot_install() {
  bash "$PROJECT_DIR/scripts/telegram-bot/install-bot.sh"
}

bot_status() {
  systemctl status saygg-bot --no-pager || warn "saygg-bot service not installed yet"
}

bot_logs() {
  journalctl -u saygg-bot -n 60 -f
}

bot_send() {
  local mode="${1:-full}"
  bash "$PROJECT_DIR/scripts/telegram-bot/send-backup.sh" "$mode"
}

menu() {
  while true; do
    echo
    printf "${c_blu}== SayGG Gateway · Manager ==${c_reset}\n"
    echo "  1) Deploy latest from GitHub"
    echo "  2) Restart app"
    echo "  3) Status + health check"
    echo "  4) Tail logs"
    echo "  5) Doctor (check + auto-fix)"
    echo "  6) Clean reinstall + rebuild"
    echo "  7) Run backup now"
    echo "  8) Change subdomain"
    echo "  9) Install / reinstall Telegram bot"
    echo " 10) Telegram bot status"
    echo " 11) Telegram bot logs"
    echo " 12) Send full backup to Telegram now"
    echo "  q) Quit"
    read -r -p "Choose: " opt
    case "$opt" in
      1) deploy ;;
      2) restart ;;
      3) status_only ;;
      4) logs ;;
      5) doctor ;;
      6) clean_restart ;;
      7) backup_now ;;
      8) subdomain ;;
      9) bot_install ;;
      10) bot_status ;;
      11) bot_logs ;;
      12) bot_send full ;;
      q|Q) exit 0 ;;
      *) warn "Unknown option" ;;
    esac
  done
}

case "${1:-menu}" in
  deploy)         deploy ;;
  restart)        restart ;;
  status)         status_only ;;
  logs)           logs ;;
  doctor)         doctor ;;
  clean-restart)  clean_restart ;;
  backup)         backup_now ;;
  restore)        shift; restore "${1:-}" ;;
  subdomain)      subdomain ;;
  bot-install)    bot_install ;;
  bot-status)     bot_status ;;
  bot-logs)       bot_logs ;;
  bot-send)       shift; bot_send "${1:-full}" ;;
  menu|"")        menu ;;
  *)              err "Unknown command: $1"; exit 1 ;;
esac
