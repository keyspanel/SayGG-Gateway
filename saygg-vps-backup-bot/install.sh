#!/bin/bash
# Installer for the SayGG VPS Backup Bot.
#
# Usage:   sudo bash install.sh
#
# - Copies the bot to /opt/saygg-vps-bot
# - Installs python3, curl, postgresql-client (apt)
# - Creates /etc/saygg-vps-bot/config.ini from the template if missing
# - Installs the saygg-vps-bot systemd unit and starts it
# Re-running the installer is safe: code is refreshed, config + state are kept.

set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run as root: sudo bash install.sh" >&2; exit 1
fi

SRC_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/saygg-vps-bot"
CONFIG_DIR="/etc/saygg-vps-bot"
STATE_DIR="/var/lib/saygg-vps-bot"
SERVICE="/etc/systemd/system/saygg-vps-bot.service"
LOG_FILE="/var/log/saygg-vps-bot.log"

c_grn='\033[1;32m'; c_blu='\033[1;34m'; c_ylw='\033[1;33m'; c_red='\033[1;31m'; c_rst='\033[0m'
say()  { printf "${c_blu}» %s${c_rst}\n" "$*"; }
ok()   { printf "${c_grn}✓ %s${c_rst}\n" "$*"; }
warn() { printf "${c_ylw}! %s${c_rst}\n" "$*"; }
err()  { printf "${c_red}✗ %s${c_rst}\n" "$*" >&2; }

say "Installing system dependencies (python3, curl, postgresql-client)…"
apt update -y >/dev/null
apt install -y python3 curl postgresql-client coreutils >/dev/null
ok "Dependencies ready"

say "Copying bot to $INSTALL_DIR…"
mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$STATE_DIR"
install -m 0644 "$SRC_DIR/bot.py"          "$INSTALL_DIR/bot.py"
install -m 0644 "$SRC_DIR/backup.py"       "$INSTALL_DIR/backup.py"
install -m 0644 "$SRC_DIR/telegram_api.py" "$INSTALL_DIR/telegram_api.py"
chmod 755 "$INSTALL_DIR"
chmod 700 "$STATE_DIR"
ok "Code installed"

if [[ ! -f "$CONFIG_DIR/config.ini" ]]; then
  install -m 0600 "$SRC_DIR/config.ini.example" "$CONFIG_DIR/config.ini"
  warn "A starter config was placed at $CONFIG_DIR/config.ini"
  warn "Edit it now to fill in your bot token, chat id, project paths and DB URLs:"
  warn "    sudo nano $CONFIG_DIR/config.ini"
  echo
  read -r -p "Press Enter when you've finished editing the config… " _
else
  ok "Existing config kept at $CONFIG_DIR/config.ini"
fi
chmod 600 "$CONFIG_DIR/config.ini"

# Quick sanity: at least one [database:*] and one [project:*] is present
if ! grep -qE '^\[database:' "$CONFIG_DIR/config.ini"; then
  warn "No [database:*] sections found — DB backups will be skipped."
fi
if ! grep -qE '^\[project:' "$CONFIG_DIR/config.ini"; then
  warn "No [project:*] sections found — file backups will be skipped."
fi
if grep -qE '^bot_token *= *REPLACE_WITH_BOT_TOKEN' "$CONFIG_DIR/config.ini"; then
  err "bot_token is still the placeholder. Edit the config and re-run."
  exit 1
fi
if grep -qE '^owner_chat_ids *= *REPLACE_WITH_YOUR_CHAT_ID' "$CONFIG_DIR/config.ini"; then
  err "owner_chat_ids is still the placeholder. Edit the config and re-run."
  exit 1
fi

say "Writing systemd unit…"
cat > "$SERVICE" <<EOF
[Unit]
Description=SayGG VPS Backup Bot (Telegram)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
Environment=SAYGG_VPS_BOT_CONFIG=$CONFIG_DIR/config.ini
Environment=SAYGG_VPS_BOT_STATE=$STATE_DIR
Environment=PYTHONUNBUFFERED=1
ExecStart=/usr/bin/python3 $INSTALL_DIR/bot.py
Restart=always
RestartSec=5
# Don't get killed too quickly during a long upload
TimeoutStopSec=120
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE

[Install]
WantedBy=multi-user.target
EOF

touch "$LOG_FILE"
chmod 640 "$LOG_FILE"

systemctl daemon-reload
systemctl enable saygg-vps-bot.service >/dev/null 2>&1 || true
systemctl restart saygg-vps-bot.service
sleep 2

if systemctl is-active --quiet saygg-vps-bot.service; then
  ok "Bot service is running"
else
  err "Bot service failed to start. See logs:"
  journalctl -u saygg-vps-bot --no-pager -n 30
  exit 1
fi

cat <<EOM

────────────────────────────────────────────────
${c_grn}Installation complete.${c_rst}

  Service status   :  systemctl status saygg-vps-bot
  Live logs        :  journalctl -u saygg-vps-bot -f
  Tail log file    :  tail -f $LOG_FILE
  Config file      :  $CONFIG_DIR/config.ini  (edit, then 'systemctl restart saygg-vps-bot')
  State / history  :  $STATE_DIR

In Telegram open your bot and send /menu.
You should also have received a "Bot online" message just now.
────────────────────────────────────────────────
EOM
