"""
Backup engine for the SayGG VPS Backup Bot.

Provides:
  dump_database(name, url)  -> Path to a .sql.gz file in tmp_dir
  archive_files(name, path) -> Path to a .tar.gz file in tmp_dir
  send_artifact(api, chat_id, path, caption, max_part)
                            -> Splits if > max_part bytes and uploads each
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

log = logging.getLogger("backup")


def _human(num: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    n = float(num)
    for u in units:
        if n < 1024 or u == units[-1]:
            return f"{n:.1f}{u}" if u != "B" else f"{int(n)}{u}"
        n /= 1024
    return f"{int(num)}B"


def _safe_name(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", s).strip("_") or "x"


def _ts() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _host() -> str:
    try:
        return subprocess.run(["hostname", "-s"], capture_output=True,
                              text=True, timeout=3).stdout.strip() or "vps"
    except Exception:  # noqa: BLE001
        return "vps"


@dataclass
class BackupResult:
    ok: bool
    path: str | None
    bytes: int
    detail: str


# --------------------------------------------------------------------- DB
def dump_database(name: str, url: str, tmp_dir: str) -> BackupResult:
    """pg_dump <url> | gzip > <tmp_dir>/<host>_<name>_<ts>.sql.gz"""
    if not shutil.which("pg_dump"):
        return BackupResult(False, None, 0,
                            "pg_dump not installed (apt install postgresql-client)")
    Path(tmp_dir).mkdir(parents=True, exist_ok=True)
    out = Path(tmp_dir) / f"{_host()}_{_safe_name(name)}_{_ts()}.sql.gz"
    log.info("dumping db '%s' -> %s", name, out)
    started = time.time()
    try:
        with open(out, "wb") as f:
            dump = subprocess.Popen(
                ["pg_dump", "--no-owner", "--no-privileges",
                 "--clean", "--if-exists", url],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
            gz = subprocess.Popen(
                ["gzip", "-9"], stdin=dump.stdout, stdout=f,
                stderr=subprocess.PIPE,
            )
            dump.stdout.close()  # type: ignore[union-attr]
            _, dump_err = dump.communicate(timeout=900)
            _, gz_err = gz.communicate(timeout=900)
        if dump.returncode != 0:
            try: out.unlink()
            except FileNotFoundError: pass
            msg = dump_err.decode("utf-8", "ignore").strip()[-400:]
            return BackupResult(False, None, 0, f"pg_dump exit {dump.returncode}: {msg}")
        if gz.returncode != 0:
            try: out.unlink()
            except FileNotFoundError: pass
            return BackupResult(False, None, 0,
                                f"gzip exit {gz.returncode}: "
                                f"{gz_err.decode('utf-8', 'ignore').strip()[-200:]}")
        size = out.stat().st_size
        elapsed = time.time() - started
        log.info("db '%s' dumped: %s in %.1fs", name, _human(size), elapsed)
        return BackupResult(True, str(out), size,
                            f"{_human(size)} in {elapsed:.1f}s")
    except subprocess.TimeoutExpired:
        try: out.unlink()
        except FileNotFoundError: pass
        return BackupResult(False, None, 0, "pg_dump timed out (>900s)")
    except Exception as e:  # noqa: BLE001
        try: out.unlink()
        except FileNotFoundError: pass
        return BackupResult(False, None, 0, f"error: {e}")


# ------------------------------------------------------------------- files
def archive_files(name: str, source_path: str, tmp_dir: str,
                  excludes: list[str]) -> BackupResult:
    """tar -czf <tmp_dir>/<host>_<name>_files_<ts>.tar.gz <source_path>"""
    if not shutil.which("tar"):
        return BackupResult(False, None, 0, "tar not installed")
    src = Path(source_path).resolve()
    if not src.exists():
        return BackupResult(False, None, 0, f"path not found: {source_path}")
    Path(tmp_dir).mkdir(parents=True, exist_ok=True)
    out = Path(tmp_dir) / f"{_host()}_{_safe_name(name)}_files_{_ts()}.tar.gz"
    log.info("archiving '%s' (%s) -> %s", name, src, out)
    started = time.time()
    cmd = ["tar"]
    for pat in excludes:
        cmd += ["--exclude", pat]
    cmd += ["-czf", str(out), "-C", str(src.parent), src.name]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
        # tar may write benign warnings to stderr (file changed while reading) -
        # treat exit code 1 with warnings as success when archive is non-empty.
        if proc.returncode not in (0, 1) or not out.exists() or out.stat().st_size == 0:
            try: out.unlink()
            except FileNotFoundError: pass
            return BackupResult(False, None, 0,
                                f"tar exit {proc.returncode}: "
                                f"{proc.stderr.strip()[-300:]}")
        size = out.stat().st_size
        elapsed = time.time() - started
        log.info("files '%s' archived: %s in %.1fs", name, _human(size), elapsed)
        return BackupResult(True, str(out), size,
                            f"{_human(size)} in {elapsed:.1f}s")
    except subprocess.TimeoutExpired:
        try: out.unlink()
        except FileNotFoundError: pass
        return BackupResult(False, None, 0, "tar timed out (>1800s)")
    except Exception as e:  # noqa: BLE001
        try: out.unlink()
        except FileNotFoundError: pass
        return BackupResult(False, None, 0, f"error: {e}")


# -------------------------------------------------------------- send file
def _split_file(path: str, max_part_bytes: int) -> list[str]:
    p = Path(path)
    parts: list[str] = []
    idx = 0
    with open(p, "rb") as src:
        while True:
            chunk = src.read(max_part_bytes)
            if not chunk:
                break
            part_path = f"{path}.part_{idx:03d}"
            with open(part_path, "wb") as dst:
                dst.write(chunk)
            parts.append(part_path)
            idx += 1
    return parts


def send_artifact(api, chat_id, path: str, caption: str,
                  max_part_bytes: int = 47_185_920) -> tuple[bool, str]:
    """Upload `path` to Telegram, splitting transparently if too big."""
    if not os.path.exists(path):
        return False, f"missing: {path}"
    size = os.path.getsize(path)
    base = os.path.basename(path)

    if size <= max_part_bytes:
        ok, info = api.send_document(chat_id, path,
                                     caption=f"{caption} · {_human(size)}")
        return ok, info

    # split + send each part
    parts = _split_file(path, max_part_bytes)
    n = len(parts)
    log.info("splitting %s into %d parts (max %s each)",
             base, n, _human(max_part_bytes))
    overall_ok = True
    last_err = ""
    for i, part in enumerate(parts, start=1):
        c = (f"{caption} · part {i}/{n} · {_human(os.path.getsize(part))}\n"
             f"Reassemble: cat {base}.part_* > {base}")
        ok, info = api.send_document(chat_id, part, caption=c)
        if not ok:
            overall_ok = False
            last_err = info
            log.error("part %d/%d failed: %s", i, n, info[:300])
            # don't abort — keep trying remaining parts so user has data
        try:
            os.unlink(part)
        except OSError:
            pass
    return overall_ok, last_err if not overall_ok else "ok"


def cleanup_tmp(tmp_dir: str, max_age_hours: int = 24) -> int:
    """Delete leftover backup files older than max_age_hours. Returns count."""
    if not os.path.isdir(tmp_dir):
        return 0
    cutoff = time.time() - max_age_hours * 3600
    removed = 0
    for f in os.listdir(tmp_dir):
        full = os.path.join(tmp_dir, f)
        try:
            if os.path.isfile(full) and os.path.getmtime(full) < cutoff:
                os.unlink(full)
                removed += 1
        except OSError:
            pass
    return removed


def disk_free(path: str = "/") -> tuple[int, int, int]:
    """Return (total, used, free) bytes for the filesystem holding `path`."""
    s = os.statvfs(path)
    total = s.f_blocks * s.f_frsize
    free = s.f_bavail * s.f_frsize
    used = total - free
    return total, used, free
