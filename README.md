# Panel de análisis de tickers (automático)

Página web personal que analiza tickers con reglas tomadas de papers (tendencia, momentum, volatilidad,
backtest con costos, tamaño de posición, F-Score, rentabilidad bruta y Z'' de Altman). **No hay que subir CSV:**
un robot de GitHub descarga los datos cada día, los valida y publica la página con los datos ya cargados.

```
GitHub Actions (cada día 00:30 UTC)
  1. corre las pruebas (Python y JavaScript)
  2. descarga precios diarios: cripto (Binance, host de datos de mercado) y acciones/ETFs (Yahoo Finance)
  3. valida (fechas, precios, saltos, antigüedad) y guarda en site/data/*.json
  4. publica la carpeta site/ en GitHub Pages
Tu navegador abre la página y lee data/manifest.json y data/<ticker>.json del mismo sitio.
```

Información técnica basada en investigación académica. No es asesoría de inversión.

## Paso a paso

1. **Cuenta y seguridad.** Entra a tu cuenta de GitHub y activa la verificación en dos pasos
   (Settings → Password and authentication). Con el GitHub Student Developer Pack tienes GitHub Pro.
2. **Crea el repositorio.** New repository → nombre `trading-panel` → **Public** → sin README inicial.
   Público es lo recomendado: el repo no contiene claves ni datos personales, y así Pages funciona sin plan de pago.
3. **Sube el proyecto.** Descomprime el ZIP y sube TODO el contenido, incluida la carpeta oculta `.github`
   (en Windows: Explorador → Vista → Elementos ocultos). Opciones:
   - Web: Add file → Upload files → arrastra las carpetas y archivos → Commit changes.
   - Terminal: `git init`, `git add .`, `git commit -m "inicio"`, `git branch -M main`,
     `git remote add origin https://github.com/TU_USUARIO/trading-panel.git`, `git push -u origin main`.
4. **Activa Pages.** Settings → Pages → Build and deployment → Source: **GitHub Actions**.
5. **Primera ejecución.** Pestaña Actions → "Actualizar datos y publicar" → Run workflow. Tarda unos minutos.
   Revisa que pasen los tres pasos: Pruebas, Descargar y validar datos, Guardar datos nuevos; y luego el trabajo "publicar".
6. **Abre la página:** `https://TU_USUARIO.github.io/trading-panel/`. Arriba debe decir "último dato AAAA-MM-DD".
   Si dice "desactualizado", mira el registro de la acción.
7. **Dominio propio (opcional).** El paquete de estudiante incluye un dominio gratuito (Namecheap .me, según la
   página del paquete). Settings → Pages → Custom domain, y activa "Enforce HTTPS".

## Cambiar tu lista de seguimiento

Edita `config/watchlist.json`. Cada entrada: `symbol`, `name` y `market` (`us`, `mx` o `cr`).
- Acciones y ETFs de EE. UU.: `SPY`, `NVDA`. Mexicanas: `WALMEX.MX`. Cripto de Binance: `BTCUSDT`.
- Si el símbolo no existe o está mal escrito, el robot lo reporta como FALLO y no rompe a los demás.

## Seguridad (lista de control)

- Sin servidor ni base de datos: solo archivos estáticos. La página no guarda datos tuyos en ningún servidor.
- La página trae una política de seguridad de contenido (CSP) estricta: solo scripts propios, sin conexiones a otros sitios.
  GitHub Pages no permite cabeceras HTTP propias, así que la política va en la propia página.
- Los textos que vienen de los datos nunca se insertan como HTML; las rutas de datos se validan.
- El robot tiene permisos mínimos: puede escribir solo en el trabajo que guarda datos; las acciones están fijadas por SHA.
- Hoy no se necesita ninguna clave. Si en el futuro agregas una (por ejemplo un proveedor de datos), guárdala en
  Settings → Secrets and variables → Actions y nunca en el código.
- Actívalo en Settings: Dependabot alerts, Secret scanning y Push protection, y proteger la rama `main`.
- Dependabot (incluido en `.github/dependabot.yml`) propondrá actualizar las acciones y las dependencias cada semana.
- No subas capital, bitácora ni datos personales al repositorio público.

## Pruebas

Se ejecutan solas en cada publicación. Para correrlas en tu equipo (Python 3.12 y Node 22):

```
python -m pip install pytest
python -m pytest -q
npm ci --ignore-scripts
npm test
```

Cubren: descarga y validación de datos (fuentes simuladas), conservación del dato anterior si falla un ticker,
lista de seguimiento segura, indicadores y backtest (incluida la prueba de que no usa información futura),
F-Score, Z'' y tamaño de posición, y una prueba de humo de la página con un manifiesto hostil.

## Límites y pendientes (honestos)

- Las pruebas usan fuentes simuladas: no pude conectarme a Binance ni a Yahoo desde donde se construyó esto.
  **La primera ejecución real en GitHub es la prueba definitiva**; si Yahoo bloquea a los servidores de GitHub,
  el registro dirá FALLO y habrá que cambiar de proveedor (la función `fetchers` de `scripts/update_data.py` está pensada para eso).
- El punto de Yahoo no es una API oficial y puede cambiar.
- Los fundamentales (F-Score, Z'') se capturan a mano en la página; la descarga automática para EE. UU. desde la SEC es la siguiente fase.
- La pestaña de FIBRAs de México está pendiente: los datos están en el documento de investigación.
- Un backtest histórico no garantiza resultados futuros.
