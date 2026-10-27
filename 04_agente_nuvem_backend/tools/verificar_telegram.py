"""Read-only Telegram credential check. Never sends messages or prints credentials."""
import argparse
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def check(config: Path) -> bool:
    source = config.read_text(encoding="utf-8-sig")
    values = {}
    for field in ("BOT_TOKEN", "CHAT_ID"):
        match = re.search(r'\b' + field + r'\[\]\s*=\s*"([^"]*)"', source)
        values[field] = match.group(1) if match else ""
    token, chat = values["BOT_TOKEN"], values["CHAT_ID"]
    valid = bool(re.fullmatch(r"[0-9]+:[A-Za-z0-9_-]+", token) and
                 21 <= len(token) <= 120 and re.fullmatch(r"-?[0-9]+", chat))
    print(json.dumps({"credentials_format_valid": valid}))
    if not valid:
        return False
    success = True
    for method, params in (("getMe", {}), ("getChat", {"chat_id": chat})):
        url = f"https://api.telegram.org/bot{token}/{method}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url, timeout=10) as response:
                payload = response.read(65537)
                if len(payload) > 65536:
                    raise ValueError("response limit")
                result = json.loads(payload)
                ok = result.get("ok") is True
                print(json.dumps({"method": method, "ok": ok}))
                success &= ok
        except urllib.error.HTTPError as error:
            print(json.dumps({"method": method, "ok": False, "http_status": error.code}))
            success = False
        except Exception as error:
            # Exception text can include URLs containing the token.
            print(json.dumps({"method": method, "ok": False, "error_type": type(error).__name__}))
            success = False
    return success


if __name__ == "__main__":
    default = Path(__file__).resolve().parents[1] / "02_agente_firmware/SmartConnect_Firmware/config.h"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=default)
    raise SystemExit(0 if check(parser.parse_args().config) else 1)
