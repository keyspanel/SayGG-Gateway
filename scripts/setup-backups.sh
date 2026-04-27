#!/bin/bash
# Installs the nightly Postgres backup cron job.
# Run once on the VPS as root.

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/var/www/SayGG-Gateway}"
SCRIPT="$PROJECT_DIR/scripts/backup-db.sh"
LOG="/var/log/saygg-gateway-backup.log"

if [[ ! -f "$SCRIPT" ]]; then
  echo "Backup script not found at $SCRIPT" >&2
  exit 1
fi

chmod +x "$SCRIPT"
mkdir -p /var/backups/saygg-gateway/{daily,weekly}
touch "$LOG"
chmod 640 "$LOG"

# 02:30 every night → run backup, append output to log
CRON_LINE="30 2 * * * $SCRIPT >> $LOG 2>&1"

# Replace any previous line for this script, then add the new one
( crontab -l 2>/dev/null | grep -v -F "$SCRIPT" ; echo "$CRON_LINE" ) | crontab -

echo "✓ Nightly backup installed"
echo "  Schedule : 02:30 every day"
echo "  Script   : $SCRIPT"
echo "  Output   : /var/backups/saygg-gateway/{daily,weekly}/"
echo "  Log      : $LOG"
echo
echo "Run a backup right now to confirm it works:"
echo "  $SCRIPT"
