import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import update_data as U  # noqa: E402

NOW = datetime(2026, 10, 2, tzinfo=timezone.utc)


def rows(n=300, end=date(2026, 10, 1), p=100.0, step=0.001):
    out = []
    for i in range(n):
        c = p * (1 + step) ** i
        out.append(((end - timedelta(days=n - 1 - i)).isoformat(), c * 0.99, c * 1.01, c * 0.98, c, 1000.0))
    return out


def test_validate_acepta_datos_buenos():
    U.validate(rows(), today=NOW.date())


def _mut(i, col, valor):
    r = [list(x) for x in rows()]
    r[i][col] = valor
    return [tuple(x) for x in r]


def _repetida():
    r = rows()
    r[100] = (r[99][0],) + r[100][1:]
    return r


@pytest.mark.parametrize("malos", [
    rows(100),                                  # pocas filas
    rows(300, end=date(2026, 9, 1)),            # desactualizado
    _repetida(),                                # fecha repetida
    list(reversed(rows())),                     # fechas decrecientes
    _mut(50, 4, -5.0),                          # precio negativo
    _mut(50, 4, float("nan")),                  # NaN
    _mut(50, 4, 1000.0),                        # salto de más de 60%
    _mut(50, 2, 1.0),                           # mínimo mayor que máximo
])
def test_validate_rechaza_datos_malos(malos):
    with pytest.raises(ValueError):
        U.validate(malos, today=NOW.date())


def test_binance_usa_host_de_datos_pagina_y_quita_vela_abierta():
    now_ms = 1_790_000_000_000
    day = 86_400_000
    def vela(i, cerrada=True):
        o = now_ms - (1200 - i) * day
        return [o, "10", "11", "9", "10.5", "1", (o + day - 1) if cerrada else now_ms + 1000]
    paginas = [[vela(i) for i in range(1000)], [vela(i) for i in range(1000, 1199)] + [vela(1199, False)]]
    urls = []
    def get(url):
        urls.append(url)
        return paginas[len(urls) - 1]
    filas = U.fetch_binance("BTCUSDT", get=get, now_ms=now_ms)
    assert len(urls) == 2 and all("data-api.binance.vision" in u for u in urls)
    assert len(filas) == 1199                      # la vela abierta no entra
    assert filas[0][4] == 10.5 and isinstance(filas[0][1], float)


def test_yahoo_omite_cierres_nulos_y_rellena_huecos():
    ts = [1_700_000_000 + i * 86_400 for i in range(3)]
    data = {"chart": {"result": [{"timestamp": ts, "indicators": {"quote": [{
        "open": [1, None, 3], "high": [2, 2, 4], "low": [1, 1, 3], "close": [1.5, None, 3.5], "volume": [10, 20, None]}]}}]}}
    filas = U.fetch_yahoo("SPY", get=lambda url: data)
    assert len(filas) == 2 and filas[1][1] == 3 and filas[1][5] == 0


def _proyecto(tmp_path, lista):
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "watchlist.json").write_text(json.dumps(lista))
    return tmp_path


def test_main_conserva_datos_previos_si_un_ticker_falla(tmp_path):
    lista = [{"symbol": "SPY", "name": "S&P", "market": "us"}, {"symbol": "BTCUSDT", "name": "BTC", "market": "cr"}]
    raiz = _proyecto(tmp_path, lista)
    previo = {"symbol": "BTCUSDT", "t": ["2026-09-30"], "c": [1.0], "h": [1.0], "l": [1.0]}
    (raiz / "site" / "data").mkdir(parents=True)
    (raiz / "site" / "data" / "BTCUSDT.json").write_text(json.dumps(previo))
    def roto(sym):
        raise RuntimeError("451")
    f = {"us": ("yahoo", lambda s: rows()), "cr": ("binance", roto), "mx": ("yahoo", roto)}
    assert U.main(raiz, fetchers=f, now=NOW, pause=0) == 1
    assert json.loads((raiz / "site/data/BTCUSDT.json").read_text()) == previo
    man = json.loads((raiz / "site/data/manifest.json").read_text())
    assert [s["symbol"] for s in man["symbols"]] == ["SPY", "BTCUSDT"]
    assert not list((raiz / "site/data").glob("*.tmp"))


def test_main_devuelve_cero_si_todo_falla(tmp_path):
    raiz = _proyecto(tmp_path, [{"symbol": "SPY", "name": "S&P", "market": "us"}])
    def roto(sym):
        raise RuntimeError("429")
    assert U.main(raiz, fetchers={"us": ("yahoo", roto)}, now=NOW, pause=0) == 0


def test_payload_solo_tiene_campos_esperados(tmp_path):
    raiz = _proyecto(tmp_path, [{"symbol": "SPY", "name": "S&P", "market": "us"}])
    U.main(raiz, fetchers={"us": ("yahoo", lambda s: rows())}, now=NOW, pause=0)
    d = json.loads((raiz / "site/data/SPY.json").read_text())
    assert set(d) == {"symbol", "source", "updated", "t", "c", "h", "l"}
    assert len(d["t"]) == len(d["c"]) == len(d["h"]) == len(d["l"]) == 300


@pytest.mark.parametrize("malo", [
    {"symbol": "../x", "name": "a", "market": "us"},
    {"symbol": "SPY", "name": "a", "market": "xx"},
    {"symbol": "SPY", "name": "", "market": "us"},
])
def test_lista_rechaza_entradas_inseguras(tmp_path, malo):
    raiz = _proyecto(tmp_path, [malo])
    with pytest.raises(ValueError):
        U.load_watchlist(raiz / "config" / "watchlist.json")


def test_lista_real_es_valida():
    items = U.load_watchlist(U.ROOT / "config" / "watchlist.json")
    assert len({i["symbol"] for i in items}) == len(items)
