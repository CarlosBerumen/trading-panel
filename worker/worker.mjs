// Servicio gratuito (Cloudflare Workers) que le da a la página cotizaciones, búsqueda y noticias de cualquier ticker.
// Seguridad: solo GET, solo desde la página autorizada, destinos fijos, símbolos validados, sin claves ni datos guardados.
const SITE = 'https://carlosberumen.github.io';
const SYM = /^[A-Za-z0-9.^=_-]{1,20}$/;
const TXT = /^[\p{L}\p{N} .&'-]{1,40}$/u;
const UA = { 'User-Agent': 'Mozilla/5.0 (panel personal de analisis)' };
const day = s => new Date(s * 1000).toISOString().slice(0, 10);

function out(obj, status, origin) {
  const h = { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff',
    'cache-control': status === 200 ? 'public, max-age=300' : 'no-store' };
  if (origin === SITE) { h['access-control-allow-origin'] = SITE; h.vary = 'Origin'; }
  return new Response(JSON.stringify(obj), { status, headers: h });
}

async function up(f, url) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), 8000);
  try {
    const r = await f(url, { headers: UA, signal: c.signal });
    if (!r.ok) throw new Error('upstream ' + r.status);
    return r;
  } finally { clearTimeout(t); }
}

const dec = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
const tag = (x, n) => { const m = x.match(new RegExp('<' + n + '[^>]*>([\\s\\S]*?)</' + n + '>')); return m ? dec(m[1]) : ''; };

export function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => ({
    title: tag(m[1], 'title').slice(0, 200), link: tag(m[1], 'link'), src: tag(m[1], 'source').slice(0, 60), date: tag(m[1], 'pubDate').slice(0, 40),
  })).filter(i => i.title && /^https?:\/\//.test(i.link)).slice(0, 15);
}

export async function handle(req, f = fetch) {
  const u = new URL(req.url), o = req.headers.get('origin') || '';
  if (req.method !== 'GET') return out({ error: 'metodo no permitido' }, 405, o);
  if (o && o !== SITE) return out({ error: 'origen no permitido' }, 403, o);
  try {
    const p = u.pathname, s = (u.searchParams.get('symbol') || '').trim(), q = (u.searchParams.get('q') || '').trim();
    if (p === '/search') {
      if (!TXT.test(q)) return out({ error: 'consulta invalida' }, 400, o);
      const r = await (await up(f, 'https://query1.finance.yahoo.com/v1/finance/search?quotesCount=10&newsCount=0&q=' + encodeURIComponent(q))).json();
      const ok = ['EQUITY', 'ETF', 'CRYPTOCURRENCY'];
      return out((r.quotes || []).filter(x => ok.includes(x.quoteType) && SYM.test(x.symbol || '')).slice(0, 10)
        .map(x => ({ s: x.symbol, n: String(x.shortname || x.longname || x.symbol).slice(0, 60), x: String(x.exchDisp || '').slice(0, 20) })), 200, o);
    }
    if (p === '/prices') {
      if (!SYM.test(s)) return out({ error: 'simbolo invalido' }, 400, o);
      const r = (await (await up(f, 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(s) + '?range=5y&interval=1d')).json()).chart.result[0];
      const z = r.indicators.quote[0], t = [], c = [], h = [], l = [];
      r.timestamp.forEach((ts, i) => { const k = z.close[i]; if (!(k > 0)) return; t.push(day(ts)); c.push(k); h.push(z.high[i] > 0 ? z.high[i] : k); l.push(z.low[i] > 0 ? z.low[i] : k); });
      const m = r.meta || {};
      return out({ symbol: s.toUpperCase(), name: String(m.longName || m.shortName || s).slice(0, 80), currency: String(m.currency || '').slice(0, 5), exchange: String(m.exchangeName || '').slice(0, 20), t, c, h, l }, 200, o);
    }
    if (p === '/crypto') {
      const y = s.toUpperCase();
      if (!/^[A-Z0-9]{5,20}$/.test(y)) return out({ error: 'simbolo invalido' }, 400, o);
      let start = Date.now() - 5 * 365 * 864e5, rows = [];
      for (let i = 0; i < 3; i++) {
        const pg = await (await up(f, 'https://data-api.binance.vision/api/v3/klines?interval=1d&limit=1000&symbol=' + y + '&startTime=' + Math.floor(start))).json();
        rows = rows.concat(pg);
        if (pg.length < 1000) break;
        start = pg[pg.length - 1][0] + 1;
      }
      rows = rows.filter(k => k[6] < Date.now() && +k[4] > 0);
      return out({ symbol: y, name: y, currency: 'USDT', exchange: 'Binance', t: rows.map(k => day(k[0] / 1000)), c: rows.map(k => +k[4]), h: rows.map(k => +k[2]), l: rows.map(k => +k[3]) }, 200, o);
    }
    if (p === '/news') {
      if (!TXT.test(q)) return out({ error: 'consulta invalida' }, 400, o);
      const x = await (await up(f, 'https://news.google.com/rss/search?hl=es-419&gl=MX&ceid=MX:es-419&q=' + encodeURIComponent(q))).text();
      return out(parseRss(x), 200, o);
    }
    return out({ error: 'no encontrado' }, 404, o);
  } catch (e) {
    return out({ error: 'servicio de datos no disponible' }, 502, o);
  }
}

export default { fetch: req => handle(req) };
