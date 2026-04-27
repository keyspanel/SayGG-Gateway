#!/bin/bash
# One-shot installer for the SayGG Telegram backup bot.
# - Installs python3 / curl / postgresql-client if missing
# - Writes /etc/saygg-bot.env (chmod 600)
# - Installs a systemd service that keeps the listener running
# - Adds a cron entry that ships a full backup every night at 03:00
#
# Re-run safely: existing config is kept; service + cron are refreshed.

set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run as root (sudo)" >&2; exit 1
fi

PROJECT_DIR="${PROJECT_DIR:-/var/www/SayGG-Gateway}"
BOT_DIR="$PROJECT_DIR/scripts/telegram-bot"
ENV_FILE="/etc/saygg-bot.env"
SERVICE="/etc/systemd/system/saygg-bot.service"
LOG_DIR="/var/log"

if [[ ! -d "$BOT_DIR" ]]; then
  echo "Bot files not found at $BOT_DIR — did you git pull?" >&2; exit 1
fi

echo "» Installing dependencies (python3, curl, postgresql-client)…"
apt update -y >/dev/null
apt install -y python3 curl postgresql-client coreutils >/dev/null

chmod +x "$BOT_DIR"/*.sh "$BOT_DIR"/bot.py

if [[ ! -f "$ENV_FILE" ]]; then
  echo
  echo "── First-time setup ──"
  echo "1. Create a bot in Telegram: open @BotFather, /newbot, copy the token."
  echo "2. Get your numeric chat id: open @userinfobot, it replies with your id."
  echo
  read -r -p "Paste BOT_TOKEN: " TOKEN
  read -r -p "Paste OWNER chat id (numeric, e.g. 123456789): " CHAT
  if [[ -z "$TOKEN" || -z "$CHAT" ]]; then
    echo "Both values are required." >&2; exit 1
  fi
  cat > "$ENV_FILE" <<EOF
BOT_TOKEN=$TOKEN
OWNER_CHAT_IDS=$CHAT
PROJECT_DIR=$PROJECT_DIR
EOF
  chmod 600 "$ENV_FILE"
  echo "✓ Wrote $ENV_FILE (chmod 600)"
else
  echo "» Existing config at $ENV_FILE — keeping it."
  echo "  (edit it directly to add more chat ids or rotate the token)"
fi

echo "» Writing systemd unit…"
cat > "$SERVICE" <<EOF
[Unit]
Description=SayGG VPS Telegram Backup Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/python3 $BOT_DIR/bot.py
Restart=always
RestartSec=5
User=root
StandardOutput=append:$LOG_DIR/saygg-bot.log
StandardError=append:$LOG_DIR/saygg-bot.log

[Install]
WantedBy=multi-user.target
EOF

touch "$LOG_DIR/saygg-bot.log" "$LOG_DIR/saygg-bot-cron.log"
chmod 640 "$LOG_DIR/saygg-bot.log" "$LOG_DIR/saygg-bot-cron.log"

systemctl daemon-reload
systemctl enable saygg-bot.service >/dev/null 2>&1 || true
systemctl restart saygg-bot.service

echo "» Installing nightly cron (03:00 full backup)…"
CRON_LINE="0 3 * * * $BOT_DIR/send-backup.sh full >> $LOG_DIR/saygg-bot-cron.log 2>&1"
( crontab -l 2>/dev/null | grep -v -F "$BOT_DIR/send-backup.sh" ; echo "$CRON_LINE" ) | crontab -

sleep 2
echo
if systemctl is-active --quiet saygg-bot.service; then
  echo "✓ Bot is running."
else
  echo "! Bot failed to start. See: journalctl -u saygg-bot -n 40 --no-pager"
  exit 1
fi

echo
echo "── Done ──"
echo "  Service     : systemctl status saygg-bot"
echo "  Live logs   : journalctl -u saygg-bot -f"
echo "  Cron log    : tail -f $LOG_DIR/saygg-bot-cron.log"
echo "  Cron        : $CRON_LINE"
echo
echo "Open your bot in Telegram and send /backup to test. You should also"
echo "have received a 'bot online' message just now."
