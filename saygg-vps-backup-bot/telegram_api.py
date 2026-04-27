"""
Tiny Telegram Bot API wrapper.

- HTTP JSON calls go through urllib (stdlib only).
- File uploads (sendDocument) shell out to `curl` because it streams large
  multipart bodies far more reliably than a hand-rolled urllib uploader.
"""
from __future__ import annotations

import json
import logging
import shlex
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

log = logging.getLogger("telegram")


class TelegramAPI:
    def __init__(self, token: str, request_timeout: int = 70):
        self.token = token
        self.timeout = request_timeout
        self.api = f"https://api.telegram.org/bot{token}"

    # ---------------------------------------------------------------- core
    def _post(self, method: str, params: dict[str, Any] | None = None,
              timeout: int | None = None) -> dict:
        body = urllib.parse.urlencode(params or {}, doseq=True).encode()
        req = urllib.request.Request(f"{self.api}/{method}", data=body)
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return {"ok": False, "error": e.read().decode("utf-8", "ignore"),
                    "status": e.code}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e)}

    # ----------------------------------------------------------------- API
    def get_updates(self, offset: int = 0, timeout: int = 50) -> dict:
        return self._post("getUpdates",
                          {"offset": offset, "timeout": timeout},
                          timeout=timeout + 20)

    def send_message(self, chat_id, text: str, parse_mode: str = "HTML",
                     reply_markup: dict | None = None,
                     disable_preview: bool = True) -> dict:
        params: dict[str, Any] = {
            "chat_id": chat_id,
            "text": text[:4096],
            "parse_mode": parse_mode,
            "disable_web_page_preview": "true" if disable_preview else "false",
        }
        if reply_markup is not None:
            params["reply_markup"] = json.dumps(reply_markup)
        return self._post("sendMessage", params)

    def edit_message(self, chat_id, message_id, text: str,
                     parse_mode: str = "HTML",
                     reply_markup: dict | None = None) -> dict:
        params: dict[str, Any] = {
            "chat_id": chat_id,
            "message_id": message_id,
            "text": text[:4096],
            "parse_mode": parse_mode,
            "disable_web_page_preview": "true",
        }
        if reply_markup is not None:
            params["reply_markup"] = json.dumps(reply_markup)
        return self._post("editMessageText", params)

    def answer_callback(self, callback_id, text: str = "",
                        show_alert: bool = False) -> dict:
        return self._post("answerCallbackQuery", {
            "callback_query_id": callback_id,
            "text": text[:200],
            "show_alert": "true" if show_alert else "false",
        })

    def send_chat_action(self, chat_id, action: str = "upload_document") -> dict:
        return self._post("sendChatAction", {"chat_id": chat_id, "action": action})

    def get_me(self) -> dict:
        return self._post("getMe", {})

    # ----------------------------------------------------------- file send
    def send_document(self, chat_id, file_path: str, caption: str = "",
                      retries: int = 2) -> tuple[bool, str]:
        """Upload a file to Telegram via curl. Returns (ok, output)."""
        cmd = [
            "curl", "-sS", "--fail", "--max-time", "600",
            "-X", "POST", f"{self.api}/sendDocument",
            "-F", f"chat_id={chat_id}",
            "-F", f"caption={caption[:1024]}",
            "-F", f"document=@{file_path}",
        ]
        last_err = ""
        for attempt in range(retries + 1):
            try:
                proc = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=900,
                )
                if proc.returncode == 0:
                    return True, proc.stdout
                last_err = proc.stderr or proc.stdout
                log.warning("sendDocument attempt %d failed: %s",
                            attempt + 1, last_err.strip()[:200])
                time.sleep(2 + attempt * 3)
            except subprocess.TimeoutExpired:
                last_err = "timeout (>900s)"
                log.warning("sendDocument timed out (attempt %d)", attempt + 1)
            except Exception as e:  # noqa: BLE001
                last_err = str(e)
                log.warning("sendDocument error: %s", last_err)
                time.sleep(2)
        return False, last_err


def keyboard(rows: list[list[tuple[str, str]]]) -> dict:
    """Helper: build an inline keyboard from [[(label, callback_data), ...], ...]"""
    return {
        "inline_keyboard": [
            [{"text": label, "callback_data": data} for label, data in row]
            for row in rows
        ]
    }
