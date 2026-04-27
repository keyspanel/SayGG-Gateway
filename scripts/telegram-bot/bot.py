#!/usr/bin/env python3
"""
SayGG VPS Telegram Backup Bot
─────────────────────────────
Long-polls Telegram for messages from authorised owner chat IDs.
On /backup, /db, /files the bot runs send-backup.sh and ships the
archives straight to the chat. Stdlib-only — no pip install required.

Config is loaded from /etc/saygg-bot.env (chmod 600, root-only):
    BOT_TOKEN          token from @BotFather
    OWNER_CHAT_IDS     comma-separated numeric chat IDs (admins)
    PROJECT_DIR        defaults to /var/www/SayGG-Gateway
"""

import json
import os
import signal
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request

CONFIG_FILE = os.environ.get("SAYGG_BOT_ENV", "/etc/saygg-bot.env")


def load_env_file(path: str) -> None:
    if not os.path.isfile(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


load_env_file(CONFIG_FILE)

BOT_TOKEN = os.environ.get("BOT_TOKEN", "").strip()
OWNER_CHAT_IDS = {
    s.strip()
    for s in os.environ.get("OWNER_CHAT_IDS", "").split(",")
    if s.strip()
}
PROJECT_DIR = os.environ.get("PROJECT_DIR", "/var/www/SayGG-Gateway")
SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
SEND_BACKUP = os.path.join(SCRIPT_DIR, "send-backup.sh")

if not BOT_TOKEN:
    print("[bot] BOT_TOKEN missing in", CONFIG_FILE, file=sys.stderr)
    sys.exit(1)
if not OWNER_CHAT_IDS:
    print("[bot] OWNER_CHAT_IDS missing in", CONFIG_FILE, file=sys.stderr)
    sys.exit(1)

API = f"https://api.telegram.org/bot{BOT_TOKEN}"


def tg_call(method: str, params: dict | None = None, timeout: int = 70) -> dict:
    data = urllib.parse.urlencode(params or {}).encode()
    req = urllib.request.Request(f"{API}/{method}", data=data)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": e.read().decode("utf-8", "ignore")}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


def send_message(chat_id, text: str, parse_mode: str = "HTML") -> dict:
    return tg_call(
        "sendMessage",
        {
            "chat_id": chat_id,
            "text": text[:4000],
            "parse_mode": parse_mode,
            "disable_web_page_preview": "true",
        },
    )


def is_authorised(chat_id) -> bool:
    return str(chat_id) in OWNER_CHAT_IDS


HELP = (
    "<b>SayGG VPS Bot</b> — owner only.\n\n"
    "/backup  — full backup (database + project files)\n"
    "/db      — database backup only\n"
    "/files   — project files only\n"
    "/status  — server, disk &amp; PM2 status\n"
    "/help    — this message"
)


def run_send_backup(chat_id, mode: str) -> tuple[int, str]:
    env = os.environ.copy()
    env["TARGET_CHAT_ID"] = str(chat_id)
    proc = subprocess.Popen(
        ["/bin/bash", SEND_BACKUP, mode],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    out, _ = proc.communicate()
    return proc.returncode, out or ""


def cmd_status(chat_id) -> None:
    parts = []
    try:
        parts.append(subprocess.run(["uptime"], capture_output=True, text=True, timeout=5).stdout.strip())
    except Exception as e:  # noqa: BLE001
        parts.append(f"uptime err: {e}")
    try:
        parts.append(subprocess.run(["df", "-h", "/"], capture_output=True, text=True, timeout=5).stdout.strip())
    except Exception as e:  # noqa: BLE001
        parts.append(f"df err: {e}")
    try:
        parts.append(subprocess.run(["free", "-h"], capture_output=True, text=True, timeout=5).stdout.strip())
    except Exception as e:  # noqa: BLE001
        parts.append(f"free err: {e}")
    try:
        pm2 = subprocess.run(
            ["pm2", "list", "--no-color"], capture_output=True, text=True, timeout=10
        ).stdout.strip()
        parts.append(pm2[:1500] if pm2 else "(pm2 not running)")
    except Exception as e:  # noqa: BLE001
        parts.append(f"pm2 err: {e}")
    body = "\n\n".join(parts)
    send_message(chat_id, f"<b>Status</b>\n<pre>{body}</pre>")


def handle_command(chat_id, text: str) -> None:
    cmd = text.strip().split()[0].split("@")[0].lower()
    if cmd in ("/start", "/help"):
        send_message(chat_id, HELP)
    elif cmd == "/backup":
        send_message(chat_id, "📦 Building full backup… this can take a minute.")
        rc, out = run_send_backup(chat_id, "full")
        if rc == 0:
            send_message(chat_id, "✅ Full backup sent.")
        else:
            send_message(chat_id, f"❌ Backup failed:\n<pre>{(out or '(no output)')[-1500:]}</pre>")
    elif cmd == "/db":
        send_message(chat_id, "🗄 Backing up database…")
        rc, out = run_send_backup(chat_id, "db")
        send_message(
            chat_id,
            "✅ Database backup sent." if rc == 0 else f"❌ Failed:\n<pre>{out[-1500:]}</pre>",
        )
    elif cmd == "/files":
        send_message(chat_id, "📁 Archiving project files…")
        rc, out = run_send_backup(chat_id, "files")
        send_message(
            chat_id,
            "✅ Files backup sent." if rc == 0 else f"❌ Failed:\n<pre>{out[-1500:]}</pre>",
        )
    elif cmd == "/status":
        cmd_status(chat_id)
    elif cmd == "/whoami":
        send_message(chat_id, f"chat id: <code>{chat_id}</code>")
    else:
        send_message(chat_id, "Unknown command. Try /help")


_running = True


def _stop(*_):  # noqa: ANN001
    global _running
    _running = False


signal.signal(signal.SIGTERM, _stop)
signal.signal(signal.SIGINT, _stop)


def main() -> None:
    print(f"[bot] starting; owners={sorted(OWNER_CHAT_IDS)}")
    for cid in OWNER_CHAT_IDS:
        send_message(cid, "🟢 SayGG VPS bot online. Send /help for commands.")
    offset = 0
    while _running:
        try:
            r = tg_call("getUpdates", {"offset": offset, "timeout": 50}, timeout=70)
            if not r.get("ok"):
                print("[bot] getUpdates error:", r)
                time.sleep(5)
                continue
            for u in r.get("result", []):
                offset = u["update_id"] + 1
                msg = u.get("message") or u.get("edited_message") or {}
                chat = msg.get("chat") or {}
                cid = chat.get("id")
                text = msg.get("text") or ""
                if not cid or not text:
                    continue
                if not is_authorised(cid):
                    send_message(
                        cid,
                        f"⛔ Not authorised. Your chat id: <code>{cid}</code>",
                    )
                    print(f"[bot] unauthorised chat {cid}: {text[:80]}")
                    continue
                print(f"[bot] cmd from {cid}: {text[:120]}")
                try:
                    handle_command(cid, text)
                except Exception as e:  # noqa: BLE001
                    traceback.print_exc()
                    send_message(cid, f"Error: {e}")
        except Exception as e:  # noqa: BLE001
            print("[bot] loop error:", e)
            time.sleep(5)
    print("[bot] stopped")


if __name__ == "__main__":
    main()
