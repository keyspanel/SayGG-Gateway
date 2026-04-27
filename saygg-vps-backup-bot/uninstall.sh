#!/bin/bash
# Cleanly remove the SayGG VPS Backup Bot.
# Keeps /etc/saygg-vps-bot/config.ini and /var/lib/saygg-vps-bot by default.
# Pass --purge to delete those too.
set -euo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run as root: sudo bash uninstall.sh [--purge]" >&2; exit 1
fi

PURGE=0
[[ "${1:-}" == "--purge" ]] && PURGE=1

systemctl disable --now saygg-vps-bot.service 2>/dev/null || true
rm -f /etc/systemd/system/saygg-vps-bot.service
systemctl daemon-reload

rm -rf /opt/saygg-vps-bot
echo "✓ Bot code and service removed."

if [[ $PURGE -eq 1 ]]; then
  rm -rf /etc/saygg-vps-bot /var/lib/saygg-vps-bot /var/log/saygg-vps-bot.log
  echo "✓ Config + state + logs purged."
else
  echo "  (config kept at /etc/saygg-vps-bot, state at /var/lib/saygg-vps-bot)"
  echo "  Pass --purge to delete those too."
fi
