"""Actualiza los datos diarios de la lista de seguimiento y escribe site/data/*.json.

Fuentes: Binance (host solo de datos de mercado, sin clave) para cripto y el punto de gráficos
de Yahoo Finance (no oficial) para acciones y ETFs. Si un ticker falla, se conserva su archivo anterior.
"""
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BINANCE = "https://data-api.binance.vision/api/v3/klines"
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/"
HEADERS = {"User-Agent": "Mozilla/5.0 (panel personal de analisis)"}
YEARS = 5
MIN_ROWS = 250
MAX_JUMP = 0.6
MAX_AGE_DAYS = 7
SAFE = re.compile(r"^[A-Za-z0-9._-]{1,20}$")
MARKETS = ("us", "mx", "cr")


def http_json(url, retries=3, pause=2.0):
    error = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=30) as r:
                return json.load(r)
        except Exception as e:  # red, 429, 451, JSON inválido
            error = e
            time.sleep(pause * (i + 1))
    raise RuntimeError("falló %s: %s" % (url.split("?")[0], error))


def _day(seconds):
    return datetime.fromtimestamp(seconds, tz=timezone.utc).strftime("%Y-%m-%d")


def fetch_binance(symbol, years=YEARS, get=http_json, now_ms=None):
    end = now_ms or int(time.time() * 1000)
    start = end - int(years * 365 * 86400 * 1000)
    klines = []
    while start < end:
        page = get("%s?symbol=%s&interval=1d&startTime=%d&limit=1000" % (BINANCE, symbol, start))
        if not page:
            break
        klines += page
        start = page[-1][0] + 1
        if len(page) < 1000:
            break
    klines = [k for k in klines if k[6] < end]  # descarta la vela de hoy, que aún no cierra
    return [(_day(k[0] / 1000), float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])) for k in klines]


def fetch_yahoo(symbol, years=YEARS, get=http_json):
    rango = "1y" if years <= 1 else "2y" if years <= 2 else "5y" if years <= 5 else "10y"
    data = get("%s%s?range=%s&interval=1d" % (YAHOO, urllib.parse.quote(symbol), rango))
    res = data["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    rows = []
    for i, t in enumerate(res["timestamp"]):
        c = q["close"][i]
        if c is None:
            continue
        rows.append((_day(t), q["open"][i] or c, q["high"][i] or c, q["low"][i] or c, c, q["volume"][i] or 0))
    return rows


def validate(rows, today=None):
    today = today or datetime.now(timezone.utc).date()
    if len(rows) < MIN_ROWS:
        raise ValueError("pocas filas: %d" % len(rows))
    prev_d = prev_c = None
    for d, o, h, l, c, _v in rows:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
            raise ValueError("fecha inválida: %s" % d)
        if prev_d is not None and d <= prev_d:
            raise ValueError("fechas no crecientes en %s" % d)
        for x in (o, h, l, c):
            if not (isinstance(x, (int, float)) and math.isfinite(x) and x > 0):
                raise ValueError("precio inválido en %s" % d)
        if l > h:
            raise ValueError("mínimo mayor que máximo en %s" % d)
        if prev_c and abs(c / prev_c - 1) > MAX_JUMP:
            raise ValueError("salto sospechoso en %s" % d)
        prev_d, prev_c = d, c
    if (today - date.fromisoformat(rows[-1][0])).days > MAX_AGE_DAYS:
        raise ValueError("datos desactualizados: %s" % rows[-1][0])


def to_payload(symbol, source, rows, now):
    return {
        "symbol": symbol,
        "source": source,
        "updated": now.isoformat(timespec="seconds"),
        "t": [r[0] for r in rows],
        "c": [round(r[4], 6) for r in rows],
        "h": [round(r[2], 6) for r in rows],
        "l": [round(r[3], 6) for r in rows],
    }


def write_atomic(path, obj):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def load_watchlist(path):
    items = json.loads(Path(path).read_text(encoding="utf-8"))
    for it in items:
        if not SAFE.match(it.get("symbol", "")) or it.get("market") not in MARKETS or not it.get("name"):
            raise ValueError("entrada inválida en la lista de seguimiento: %r" % (it,))
    return items


def main(root=ROOT, fetchers=None, now=None, pause=0.5):
    now = now or datetime.now(timezone.utc)
    fetchers = fetchers or {"cr": ("binance", fetch_binance), "us": ("yahoo", fetch_yahoo), "mx": ("yahoo", fetch_yahoo)}
    out = Path(root) / "site" / "data"
    out.mkdir(parents=True, exist_ok=True)
    entries, ok = [], 0
    for it in load_watchlist(Path(root) / "config" / "watchlist.json"):
        f = out / (it["symbol"] + ".json")
        source, fetch = fetchers[it["market"]]
        try:
            rows = fetch(it["symbol"])
            validate(rows, today=now.date())
            write_atomic(f, to_payload(it["symbol"], source, rows, now))
            ok += 1
            print("ok", it["symbol"], len(rows))
        except Exception as e:
            print("FALLO", it["symbol"], e, file=sys.stderr)
        if f.exists():
            d = json.loads(f.read_text(encoding="utf-8"))
            entries.append({"symbol": it["symbol"], "name": it["name"], "market": it["market"],
                            "file": f.name, "rows": len(d["c"]), "last": d["t"][-1]})
        time.sleep(pause)
    write_atomic(out / "manifest.json", {"updated": now.isoformat(timespec="seconds"), "symbols": entries})
    return ok


if __name__ == "__main__":
    sys.exit(0 if main() > 0 else 1)
