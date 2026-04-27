#!/usr/bin/env python3
"""
SayGG VPS Backup Bot — standalone, multi-project, Telegram-driven.

Highlights
──────────
• Backs up multiple projects (files via tar.gz) and multiple Postgres
  databases (pg_dump|gzip) defined in /etc/saygg-vps-bot/config.ini.
• On-demand: tap an inline button or send /backup, /databases, /files,
  or /project to get the archive in chat instantly.
• Scheduled: a background scheduler runs at the times listed in the
  [schedule] section and ships a full backup automatically.
• Stable: every command runs in a try/except, big work runs in a worker
  thread so the polling loop never blocks, and a global lock prevents
  two backups from clashing.
• Self-healing: if Telegram or Postgres briefly fail, the loop sleeps
  and retries instead of dying. systemd will restart the process if it
  ever does exit.

Run as:  python3 bot.py
Service: see install.sh (creates saygg-vps-bot.service)
"""
from __future__ import annotations

import configparser
import json
import logging
import os
import signal
import subprocess
import sys
import threading
import time
import traceback
from collections import deque
from datetime import datetime
from pathlib import Path

from telegram_api import TelegramAPI, keyboard
from backup import (
    archive_files, cleanup_tmp, disk_free, dump_database,
    send_artifact,
)

# ------------------------------------------------------------------ paths
HERE = Path(__file__).resolve().parent
DEFAULT_CONFIG = "/etc/saygg-vps-bot/config.ini"
CONFIG_PATH = os.environ.get("SAYGG_VPS_BOT_CONFIG",
                             str(HERE / "config.ini"))
if not Path(CONFIG_PATH).exists() and Path(DEFAULT_CONFIG).exists():
    CONFIG_PATH = DEFAULT_CONFIG

STATE_DIR = Path(os.environ.get("SAYGG_VPS_BOT_STATE",
                                "/var/lib/saygg-vps-bot"))
HISTORY_FILE = STATE_DIR / "history.json"
OFFSET_FILE = STATE_DIR / "offset"

# --------------------------------------------------------------- logging
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("bot")


# --------------------------------------------------------------- config
class Cfg:
    def __init__(self, path: str):
        self.path = path
        self.cp = configparser.ConfigParser()
        if not self.cp.read(path):
            raise SystemExit(f"Config file not found: {path}")

        tg = self.cp["telegram"]
        self.bot_token = tg.get("bot_token", "").strip()
        self.owner_chat_ids = {
            s.strip() for s in tg.get("owner_chat_ids", "").split(",")
            if s.strip()
        }
        if not self.bot_token or not self.owner_chat_ids:
            raise SystemExit("[telegram] bot_token and owner_chat_ids are required")

        bk = self.cp["backup"] if self.cp.has_section("backup") else {}
        self.tmp_dir = bk.get("tmp_dir", "/tmp/saygg-vps-bot") if isinstance(bk, dict) \
            else self.cp.get("backup", "tmp_dir", fallback="/tmp/saygg-vps-bot")
        self.max_part = int(self.cp.get("backup", "max_part_bytes",
                                        fallback="47185920"))
        excludes_raw = self.cp.get("backup", "exclude_patterns",
                                   fallback="node_modules,.git,client/dist,*.log,__pycache__,.cache")
        self.excludes = [e.strip() for e in excludes_raw.split(",") if e.strip()]

        self.schedule_times: list[str] = []
        self.schedule_mode = "full"
        if self.cp.has_section("schedule"):
            t = self.cp.get("schedule", "times", fallback="")
            self.schedule_times = [s.strip() for s in t.split(",") if s.strip()]
            self.schedule_mode = self.cp.get("schedule", "mode", fallback="full").strip()

        # projects
        self.projects: dict[str, dict] = {}
        for sec in self.cp.sections():
            if sec.startswith("project:"):
                key = sec.split(":", 1)[1].strip()
                self.projects[key] = {
                    "label": self.cp.get(sec, "label", fallback=key),
                    "path": self.cp.get(sec, "path", fallback=""),
                    "pm2_name": self.cp.get(sec, "pm2_name", fallback=""),
                }
        # databases
        self.databases: dict[str, dict] = {}
        for sec in self.cp.sections():
            if sec.startswith("database:"):
                key = sec.split(":", 1)[1].strip()
                self.databases[key] = {
                    "label": self.cp.get(sec, "label", fallback=key),
                    "url": self.cp.get(sec, "url", fallback=""),
                }


# -------------------------------------------------------------- history
def history_load() -> list[dict]:
    try:
        return json.loads(HISTORY_FILE.read_text())
    except Exception:  # noqa: BLE001
        return []


def history_append(entry: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    items = deque(history_load(), maxlen=50)
    items.append(entry)
    HISTORY_FILE.write_text(json.dumps(list(items), indent=2))


def offset_load() -> int:
    try:
        return int(OFFSET_FILE.read_text().strip())
    except Exception:  # noqa: BLE001
        return 0


def offset_save(v: int) -> None:
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        OFFSET_FILE.write_text(str(v))
    except Exception as e:  # noqa: BLE001
        log.warning("could not save offset: %s", e)


# --------------------------------------------------------------- helpers
def fmt_size(n: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    x = float(n)
    for u in units:
        if x < 1024 or u == units[-1]:
            return f"{x:.1f}{u}" if u != "B" else f"{int(x)}{u}"
        x /= 1024
    return f"{int(n)}B"


# ---------------------------------------------------------------- worker
class BackupWorker:
    """Serialises all backup operations behind a single lock."""

    def __init__(self, cfg: Cfg, api: TelegramAPI):
        self.cfg = cfg
        self.api = api
        self.lock = threading.Lock()
        self.last_status: str = "no backup yet"

    def _record(self, mode: str, ok: bool, detail: str) -> None:
        history_append({
            "ts": datetime.now().isoformat(timespec="seconds"),
            "mode": mode,
            "ok": ok,
            "detail": detail[:300],
        })
        self.last_status = f"{'OK' if ok else 'FAIL'} · {mode} · {detail[:120]}"

    # ----- atomic ops
    def _backup_one_db(self, chat_id, key: str, db: dict) -> bool:
        if not db["url"]:
            self.api.send_message(chat_id, f"⏭ DB <b>{db['label']}</b>: no URL configured")
            return False
        self.api.send_chat_action(chat_id, "upload_document")
        res = dump_database(key, db["url"], self.cfg.tmp_dir)
        if not res.ok:
            self.api.send_message(chat_id, f"❌ DB <b>{db['label']}</b>: {res.detail}")
            return False
        ok, info = send_artifact(
            self.api, chat_id, res.path, f"🗄 DB · {db['label']}",
            max_part_bytes=self.cfg.max_part,
        )
        try: os.unlink(res.path)  # type: ignore[arg-type]
        except OSError: pass
        if not ok:
            self.api.send_message(chat_id, f"❌ Upload failed for <b>{db['label']}</b>: {info[:200]}")
        return ok

    def _backup_one_files(self, chat_id, key: str, proj: dict) -> bool:
        if not proj["path"]:
            self.api.send_message(chat_id, f"⏭ Project <b>{proj['label']}</b>: no path configured")
            return False
        if not os.path.exists(proj["path"]):
            self.api.send_message(chat_id, f"⏭ Project <b>{proj['label']}</b>: path missing — {proj['path']}")
            return False
        self.api.send_chat_action(chat_id, "upload_document")
        res = archive_files(key, proj["path"], self.cfg.tmp_dir, self.cfg.excludes)
        if not res.ok:
            self.api.send_message(chat_id, f"❌ Files <b>{proj['label']}</b>: {res.detail}")
            return False
        ok, info = send_artifact(
            self.api, chat_id, res.path, f"📁 Files · {proj['label']}",
            max_part_bytes=self.cfg.max_part,
        )
        try: os.unlink(res.path)  # type: ignore[arg-type]
        except OSError: pass
        if not ok:
            self.api.send_message(chat_id, f"❌ Upload failed for <b>{proj['label']}</b>: {info[:200]}")
        return ok

    # ----- public ops, all guarded by the lock
    def backup_all_databases(self, chat_id) -> None:
        if not self.lock.acquire(blocking=False):
            self.api.send_message(chat_id, "⏳ Another backup is already running. Try again in a minute.")
            return
        started = time.time()
        ok_count = 0
        try:
            for key, db in self.cfg.databases.items():
                if self._backup_one_db(chat_id, key, db):
                    ok_count += 1
            elapsed = int(time.time() - started)
            detail = f"{ok_count}/{len(self.cfg.databases)} dbs in {elapsed}s"
            self._record("databases", ok_count == len(self.cfg.databases), detail)
            self.api.send_message(chat_id, f"✅ Databases done · {detail}")
        finally:
            cleanup_tmp(self.cfg.tmp_dir, max_age_hours=1)
            self.lock.release()

    def backup_all_files(self, chat_id) -> None:
        if not self.lock.acquire(blocking=False):
            self.api.send_message(chat_id, "⏳ Another backup is already running. Try again in a minute.")
            return
        started = time.time()
        ok_count = 0
        try:
            for key, proj in self.cfg.projects.items():
                if self._backup_one_files(chat_id, key, proj):
                    ok_count += 1
            elapsed = int(time.time() - started)
            detail = f"{ok_count}/{len(self.cfg.projects)} projects in {elapsed}s"
            self._record("files", ok_count == len(self.cfg.projects), detail)
            self.api.send_message(chat_id, f"✅ Files done · {detail}")
        finally:
            cleanup_tmp(self.cfg.tmp_dir, max_age_hours=1)
            self.lock.release()

    def backup_full(self, chat_id) -> None:
        if not self.lock.acquire(blocking=False):
            self.api.send_message(chat_id, "⏳ Another backup is already running. Try again in a minute.")
            return
        started = time.time()
        ok_db = 0; ok_fi = 0
        try:
            self.api.send_message(chat_id, "🚀 <b>Full backup started</b>\nSending databases first, then project files…")
            for key, db in self.cfg.databases.items():
                if self._backup_one_db(chat_id, key, db):
                    ok_db += 1
            for key, proj in self.cfg.projects.items():
                if self._backup_one_files(chat_id, key, proj):
                    ok_fi += 1
            elapsed = int(time.time() - started)
            detail = (f"{ok_db}/{len(self.cfg.databases)} dbs, "
                      f"{ok_fi}/{len(self.cfg.projects)} projects, {elapsed}s")
            full_ok = (ok_db == len(self.cfg.databases) and
                       ok_fi == len(self.cfg.projects))
            self._record("full", full_ok, detail)
            tag = "✅" if full_ok else "⚠️"
            self.api.send_message(chat_id, f"{tag} <b>Full backup finished</b>\n{detail}")
        finally:
            cleanup_tmp(self.cfg.tmp_dir, max_age_hours=1)
            self.lock.release()

    def backup_one_project_files(self, chat_id, key: str) -> None:
        proj = self.cfg.projects.get(key)
        if not proj:
            self.api.send_message(chat_id, f"Unknown project: {key}")
            return
        if not self.lock.acquire(blocking=False):
            self.api.send_message(chat_id, "⏳ Another backup is already running.")
            return
        try:
            ok = self._backup_one_files(chat_id, key, proj)
            self._record(f"files:{key}", ok, "single project")
            if ok:
                self.api.send_message(chat_id, f"✅ Files for <b>{proj['label']}</b> sent.")
        finally:
            cleanup_tmp(self.cfg.tmp_dir, max_age_hours=1)
            self.lock.release()

    def backup_one_database(self, chat_id, key: str) -> None:
        db = self.cfg.databases.get(key)
        if not db:
            self.api.send_message(chat_id, f"Unknown database: {key}")
            return
        if not self.lock.acquire(blocking=False):
            self.api.send_message(chat_id, "⏳ Another backup is already running.")
            return
        try:
            ok = self._backup_one_db(chat_id, key, db)
            self._record(f"db:{key}", ok, "single database")
            if ok:
                self.api.send_message(chat_id, f"✅ DB <b>{db['label']}</b> sent.")
        finally:
            cleanup_tmp(self.cfg.tmp_dir, max_age_hours=1)
            self.lock.release()


# ---------------------------------------------------------------- menus
def main_menu_kb(cfg: Cfg) -> dict:
    rows = [
        [("🚀  Full backup (DBs + Files)", "full")],
        [("🗄  All databases", "all_db"), ("📁  All project files", "all_fi")],
        [("📦  Per-project files ▸", "menu_pf"),
         ("🗃  Per-database ▸", "menu_pdb")],
        [("🩺  Status", "status"), ("📊  Disk", "disk")],
        [("⏱  Last backup", "last"), ("ℹ️  Help", "help")],
    ]
    return keyboard(rows)


def per_project_files_kb(cfg: Cfg) -> dict:
    rows = []
    for key, p in cfg.projects.items():
        rows.append([(f"📁  {p['label']}", f"pf:{key}")])
    rows.append([("« Back", "menu_main")])
    return keyboard(rows)


def per_database_kb(cfg: Cfg) -> dict:
    rows = []
    for key, d in cfg.databases.items():
        rows.append([(f"🗄  {d['label']}", f"pdb:{key}")])
    rows.append([("« Back", "menu_main")])
    return keyboard(rows)


def help_text(cfg: Cfg) -> str:
    proj_lines = "\n".join(f"  • <code>{k}</code> — {p['label']} ({p['path'] or 'no path'})"
                           for k, p in cfg.projects.items()) or "  (none configured)"
    db_lines = "\n".join(f"  • <code>{k}</code> — {d['label']}"
                         for k, d in cfg.databases.items()) or "  (none configured)"
    sched = ", ".join(cfg.schedule_times) or "(disabled)"
    return (
        "<b>SayGG VPS Backup Bot</b>\n\n"
        "<b>Commands</b>\n"
        "/menu — show button menu\n"
        "/backup — full backup of every database + every project\n"
        "/databases — back up all databases\n"
        "/files — back up all project files\n"
        "/project &lt;key&gt; — back up one project's files\n"
        "/db &lt;key&gt; — back up one database\n"
        "/status — server, disk &amp; PM2 status\n"
        "/disk — disk usage only\n"
        "/last — last backup result\n"
        "/whoami — show your chat id\n\n"
        f"<b>Projects</b>\n{proj_lines}\n\n"
        f"<b>Databases</b>\n{db_lines}\n\n"
        f"<b>Schedule</b>: {sched} ({cfg.schedule_mode})"
    )


# ----------------------------------------------------------- status helpers
def server_status_text() -> str:
    parts: list[str] = []
    try:
        parts.append(subprocess.run(["uptime"], capture_output=True,
                                    text=True, timeout=4).stdout.strip())
    except Exception as e:  # noqa: BLE001
        parts.append(f"uptime: {e}")
    try:
        parts.append(subprocess.run(["free", "-h"], capture_output=True,
                                    text=True, timeout=4).stdout.strip())
    except Exception as e:  # noqa: BLE001
        parts.append(f"free: {e}")
    try:
        pm2 = subprocess.run(["pm2", "list", "--no-color"],
                             capture_output=True, text=True, timeout=10).stdout.strip()
        parts.append(pm2[:1800] if pm2 else "(pm2 not running)")
    except FileNotFoundError:
        parts.append("(pm2 not installed)")
    except Exception as e:  # noqa: BLE001
        parts.append(f"pm2: {e}")
    return "\n\n".join(parts)


def disk_text() -> str:
    try:
        out = subprocess.run(["df", "-h"], capture_output=True,
                             text=True, timeout=4).stdout.strip()
        return out[:1800]
    except Exception as e:  # noqa: BLE001
        return f"df error: {e}"


# --------------------------------------------------------------- dispatch
class Dispatcher:
    def __init__(self, cfg: Cfg, api: TelegramAPI, worker: BackupWorker):
        self.cfg = cfg
        self.api = api
        self.worker = worker

    def auth(self, chat_id) -> bool:
        return str(chat_id) in self.cfg.owner_chat_ids

    # spawn worker thread for any long-running op
    def _spawn(self, target, *args) -> None:
        t = threading.Thread(target=target, args=args, daemon=True)
        t.start()

    def handle_message(self, chat_id, text: str) -> None:
        text = text.strip()
        cmd = text.split()[0].split("@")[0].lower()
        rest = text[len(cmd):].strip()

        if cmd in ("/start", "/menu"):
            self.api.send_message(chat_id, help_text(self.cfg),
                                  reply_markup=main_menu_kb(self.cfg))
        elif cmd == "/help":
            self.api.send_message(chat_id, help_text(self.cfg))
        elif cmd == "/backup":
            self._spawn(self.worker.backup_full, chat_id)
        elif cmd == "/databases":
            self._spawn(self.worker.backup_all_databases, chat_id)
        elif cmd == "/files":
            self._spawn(self.worker.backup_all_files, chat_id)
        elif cmd == "/project":
            if not rest:
                self.api.send_message(chat_id, "Usage: /project &lt;key&gt;\n"
                                               + ", ".join(self.cfg.projects.keys()))
                return
            self._spawn(self.worker.backup_one_project_files, chat_id, rest)
        elif cmd == "/db":
            if not rest:
                self.api.send_message(chat_id, "Usage: /db &lt;key&gt;\n"
                                               + ", ".join(self.cfg.databases.keys()))
                return
            self._spawn(self.worker.backup_one_database, chat_id, rest)
        elif cmd == "/status":
            self.api.send_message(chat_id, f"<pre>{server_status_text()}</pre>")
        elif cmd == "/disk":
            self.api.send_message(chat_id, f"<pre>{disk_text()}</pre>")
        elif cmd == "/last":
            self.api.send_message(chat_id, f"Last: {self.worker.last_status}")
        elif cmd == "/whoami":
            self.api.send_message(chat_id, f"chat id: <code>{chat_id}</code>")
        else:
            self.api.send_message(chat_id, "Unknown command. /menu for the button menu.")

    def handle_callback(self, chat_id, message_id, data: str, callback_id) -> None:
        # Always acknowledge the callback first so Telegram stops the spinner
        self.api.answer_callback(callback_id)

        if data == "menu_main":
            self.api.edit_message(chat_id, message_id, help_text(self.cfg),
                                  reply_markup=main_menu_kb(self.cfg))
            return
        if data == "menu_pf":
            self.api.edit_message(chat_id, message_id,
                                  "<b>Per-project files</b>\nPick one to back up.",
                                  reply_markup=per_project_files_kb(self.cfg))
            return
        if data == "menu_pdb":
            self.api.edit_message(chat_id, message_id,
                                  "<b>Per-database</b>\nPick one to back up.",
                                  reply_markup=per_database_kb(self.cfg))
            return
        if data == "help":
            self.api.edit_message(chat_id, message_id, help_text(self.cfg),
                                  reply_markup=main_menu_kb(self.cfg))
            return
        if data == "status":
            self.api.send_message(chat_id, f"<pre>{server_status_text()}</pre>")
            return
        if data == "disk":
            self.api.send_message(chat_id, f"<pre>{disk_text()}</pre>")
            return
        if data == "last":
            self.api.send_message(chat_id, f"Last: {self.worker.last_status}")
            return
        if data == "full":
            self._spawn(self.worker.backup_full, chat_id); return
        if data == "all_db":
            self._spawn(self.worker.backup_all_databases, chat_id); return
        if data == "all_fi":
            self._spawn(self.worker.backup_all_files, chat_id); return
        if data.startswith("pf:"):
            self._spawn(self.worker.backup_one_project_files, chat_id, data[3:]); return
        if data.startswith("pdb:"):
            self._spawn(self.worker.backup_one_database, chat_id, data[4:]); return
        self.api.send_message(chat_id, f"Unknown action: {data}")


# --------------------------------------------------------------- scheduler
class Scheduler(threading.Thread):
    """Background thread that triggers scheduled backups based on config.times."""
    daemon = True

    def __init__(self, cfg: Cfg, worker: BackupWorker):
        super().__init__()
        self.cfg = cfg
        self.worker = worker
        self._stop = threading.Event()
        self._last_fire: dict[str, str] = {}  # time -> YYYY-MM-DD it fired

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        if not self.cfg.schedule_times:
            log.info("scheduler: no times configured, scheduler idle")
            return
        log.info("scheduler started; times=%s mode=%s",
                 self.cfg.schedule_times, self.cfg.schedule_mode)
        while not self._stop.is_set():
            try:
                now = datetime.now()
                hhmm = now.strftime("%H:%M")
                today = now.strftime("%Y-%m-%d")
                if hhmm in self.cfg.schedule_times and self._last_fire.get(hhmm) != today:
                    self._last_fire[hhmm] = today
                    log.info("scheduler firing %s backup at %s", self.cfg.schedule_mode, hhmm)
                    target_chat = next(iter(self.cfg.owner_chat_ids))
                    if self.cfg.schedule_mode == "db":
                        self.worker.backup_all_databases(target_chat)
                    elif self.cfg.schedule_mode == "files":
                        self.worker.backup_all_files(target_chat)
                    else:
                        self.worker.backup_full(target_chat)
            except Exception:  # noqa: BLE001
                log.exception("scheduler tick error")
            # sleep 30s, but break early if stop is signalled
            self._stop.wait(30)


# ------------------------------------------------------------------ main
_run = True


def _stop_handler(*_):  # noqa: ANN001
    global _run
    _run = False
    log.info("stop signal received")


def main() -> int:
    log.info("config: %s", CONFIG_PATH)
    cfg = Cfg(CONFIG_PATH)
    api = TelegramAPI(cfg.bot_token)

    me = api.get_me()
    if not me.get("ok"):
        log.error("Telegram getMe failed: %s", me)
        return 2
    log.info("connected as @%s (%s)", me["result"].get("username"), me["result"].get("id"))

    worker = BackupWorker(cfg, api)
    dispatch = Dispatcher(cfg, api, worker)
    sched = Scheduler(cfg, worker)
    sched.start()

    signal.signal(signal.SIGTERM, _stop_handler)
    signal.signal(signal.SIGINT, _stop_handler)

    for cid in cfg.owner_chat_ids:
        api.send_message(cid, "🟢 <b>SayGG VPS Backup Bot online</b>\nTap /menu",
                         reply_markup=main_menu_kb(cfg))

    offset = offset_load()
    consecutive_errors = 0

    while _run:
        try:
            r = api.get_updates(offset=offset, timeout=50)
            if not r.get("ok"):
                consecutive_errors += 1
                wait = min(60, 2 ** consecutive_errors)
                log.warning("getUpdates failed (%s), retry in %ds", r.get("error"), wait)
                time.sleep(wait)
                continue
            consecutive_errors = 0
            for u in r.get("result", []):
                offset = u["update_id"] + 1
                offset_save(offset)
                try:
                    msg = u.get("message") or u.get("edited_message")
                    cb = u.get("callback_query")
                    if msg:
                        chat = msg.get("chat") or {}
                        cid = chat.get("id")
                        text = msg.get("text") or ""
                        if not cid or not text:
                            continue
                        if not dispatch.auth(cid):
                            api.send_message(cid,
                                             f"⛔ Not authorised. Your chat id: <code>{cid}</code>")
                            log.info("unauthorised chat %s: %s", cid, text[:80])
                            continue
                        log.info("msg from %s: %s", cid, text[:120])
                        dispatch.handle_message(cid, text)
                    elif cb:
                        cid = (cb.get("message") or {}).get("chat", {}).get("id")
                        msg_id = (cb.get("message") or {}).get("message_id")
                        data = cb.get("data") or ""
                        callback_id = cb.get("id")
                        if not dispatch.auth(cid):
                            api.answer_callback(callback_id, "Not authorised", show_alert=True)
                            continue
                        log.info("cb from %s: %s", cid, data[:60])
                        dispatch.handle_callback(cid, msg_id, data, callback_id)
                except Exception:  # noqa: BLE001
                    log.exception("update handler crashed (continuing)")
                    traceback.print_exc()
        except Exception:  # noqa: BLE001
            log.exception("polling loop error (continuing)")
            time.sleep(3)

    sched.stop()
    log.info("bye")
    return 0


if __name__ == "__main__":
    sys.exit(main())
