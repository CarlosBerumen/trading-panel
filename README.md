# Panel de análisis de tickers

Panel personal que analiza acciones, ETFs y cripto con reglas tomadas de papers académicos. Cada lectura indica cuánta evidencia la respalda.

**Aviso:** información técnica con fines educativos. No es asesoría de inversión; un resultado histórico no garantiza resultados futuros.

## Cómo funciona

- Un robot de GitHub Actions corre cada día a las 00:30 UTC: ejecuta las pruebas, descarga precios diarios (cripto desde Binance, acciones y ETFs desde Yahoo Finance), los valida y los guarda en `site/data`.
- La carpeta `site/` se publica con GitHub Pages. La página lee los datos del mismo sitio; no hay servidor, base de datos ni claves.
- La lista de seguimiento está en `config/watchlist.json`.

## Qué calcula

Tendencia con medias móviles, momentum 12-1, rupturas de máximos, volatilidad, backtest con costos, tamaño de posición por riesgo fijo, F-Score de Piotroski, rentabilidad bruta y Z'' de Altman.

## Pruebas

Con Python 3.12 y Node 22: `python -m pytest -q` y `npm ci --ignore-scripts && npm test`.

## Límites

- Yahoo Finance no ofrece una API oficial y puede cambiar o bloquear descargas.
- Un backtest histórico no garantiza resultados futuros.
