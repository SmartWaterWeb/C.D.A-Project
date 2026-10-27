"""Read-only Telegram credential check. Never sends messages or prints credentials."""
import argparse
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def _extract_value(source: str, field: str) -> str:
    # Suporta tanto #define TELEGRAM_BOT_TOKEN "..." (secrets.h atual)
    # quanto BOT_TOKEN[] = "..." (formato legado)
    patterns = [
        rf'#\s*define\s+TELEGRAM_{field}\s+"([^"]*)"',
        rf'#\s*define\s+{field}\s+"([^"]*)"',
        rf'\bTELEGRAM_{field}\[\]\s*=\s*"([^"]*)"',
        rf'\b{field}\[\]\s*=\s*"([^"]*)"',
    ]
    for pattern in patterns:
        match = re.search(pattern, source)
        if match:
            return match.group(1).strip()
    return ""


def check(config: Path) -> bool:
    if not config.exists():
        print(json.dumps({"config_found": False, "expected_file": str(config.name)}))
        return False
    source = config.read_text(encoding="utf-8-sig")
    token = _extract_value(source, "BOT_TOKEN")
    chat = _extract_value(source, "CHAT_ID")
    valid = bool(
        re.fullmatch(r"[0-9]+:[A-Za-z0-9_-]+", token)
        and 21 <= len(token) <= 120
        and re.fullmatch(r"-?[0-9]+", chat)
    )
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
    repo_root = Path(__file__).resolve().parents[2]
    default = repo_root / "02_agente_firmware/caixadagua_esp32/secrets.h"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=default)
    raise SystemExit(0 if check(parser.parse_args().config) else 1)
