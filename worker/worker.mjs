// Servicio gratuito (Cloudflare Workers) para el panel: cotizaciones, búsqueda, noticias, análisis de apertura, opciones y titulares.
// Seguridad: solo GET, solo desde la página autorizada, destinos fijos, entradas validadas, sin claves ni datos guardados.
const SITE = 'https://carlosberumen.github.io';
const SYM = /^[A-Za-z0-9.^=_-]{1,20}$/;
const TXT = /^[\p{L}\p{N} .&'-]{1,40}$/u;
const UA = { 'User-Agent': 'Mozilla/5.0 (panel personal de analisis; github.com/CarlosBerumen/trading-panel)' };
const day = s => new Date(s * 1000).toISOString().slice(0, 10);
const enc = encodeURIComponent;
const FEEDS = { fj: 'https://www.financialjuice.com/feed.ashx?xy=rss', zh: 'https://feeds.feedburner.com/zerohedge/feed' };

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
    title: tag(m[1], 'title').slice(0, 200), link: tag(m[1], 'link'), src: (tag(m[1], 'source') || tag(m[1], 'News:Source')).slice(0, 60), date: tag(m[1], 'pubDate').slice(0, 40),
  })).filter(i => i.title && /^https?:\/\//.test(i.link)).slice(0, 15);
}

export function parseAtom(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
    const link = (m[1].match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    return { title: tag(m[1], 'title').slice(0, 120), link, date: tag(m[1], 'updated').slice(0, 25) };
  }).filter(i => /^https:\/\/www\.sec\.gov\//.test(i.link)).slice(0, 12);
}

export function readOptions(j) {
  const d = (j && j.data) || {}, spot = +(d.current_price || d.close || d.last_trade_price) || 0;
  const rows = (d.options || []).map(x => {
    const m = /^(.*?)(\d{6})([CP])(\d{8})$/.exec(String(x.option || '')); if (!m) return null;
    return { exp: '20' + m[2].slice(0, 2) + '-' + m[2].slice(2, 4) + '-' + m[2].slice(4, 6), t: m[3], k: +m[4] / 1000,
      bid: +x.bid || 0, ask: +x.ask || 0, iv: +x.iv || 0, d: +x.delta || 0, v: +x.volume || 0, oi: +x.open_interest || 0 };
  }).filter(Boolean);
  const exps = [...new Set(rows.map(r => r.exp))].sort(), near = exps.slice(0, 2);
  const sum = (t, k) => rows.filter(r => r.t === t).reduce((a, r) => a + r[k], 0);
  const sel = rows.filter(r => near.includes(r.exp) && (!spot || Math.abs(r.k / spot - 1) <= 0.08)).sort((a, b) => a.exp.localeCompare(b.exp) || a.k - b.k || a.t.localeCompare(b.t)).slice(0, 80);
  return { spot, expirations: exps.slice(0, 8), pcVol: sum('C', 'v') ? sum('P', 'v') / sum('C', 'v') : null, pcOI: sum('C', 'oi') ? sum('P', 'oi') / sum('C', 'oi') : null, rows: sel };
}

const plain = h => dec(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<\/(p|h\d|li|div|tr)>|<br\s*\/?>/gi, '\n')).replace(/[ \t\u00a0]+/g, ' ');

export function readMorning(html) {
  const archive = [...html.matchAll(/<a[^>]+href="([^"]*MarketAnalysis\.aspx\?Id=\d+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => ({ title: dec(m[2]).slice(0, 140), url: new URL(m[1], 'https://www.rttnews.com').href }))
    .filter(a => a.title && a.url.startsWith('https://www.rttnews.com/')).slice(0, 6);
  const t = plain(html), cut = t.indexOf('More Daily Market Analysis'), body = cut > 0 ? t.slice(0, cut) : t;
  const dm = body.match(/[A-Z][a-z]+ \d{1,2}, \d{4} \d{1,2}:\d{2} ET/); if (!dm) return null;
  const before = body.slice(0, dm.index).split('\n').map(x => x.trim()).filter(Boolean);
  return { title: (before[before.length - 1] || '').slice(0, 160), date: dm[0], url: 'https://www.rttnews.com/content/marketanalysis.aspx', archive, text: body.slice(dm.index + dm[0].length) };
}

const UP = /\b(spik\w*|surg\w*|jump\w*|climb\w*|rall\w*|gain\w*|higher|advanc\w*|soar\w*|upside|strength|rise|rises|rising|rose|highs?)\b/i;
const DOWN = /\b(drop\w*|fall\w*|fell|slump\w*|tumbl\w*|declin\w*|lower|slid\w*|sank|retreat\w*|plung\w*|rout|weak\w*|pressure)\b/i;
const dir = s => { const u = UP.test(s), d = DOWN.test(s); return u && !d ? 'up' : d && !u ? 'down' : u && d ? 'mixed' : 'flat'; };
// Reglas de sentido económico: tema del texto y activos que suelen moverse con él (+1 mismo sentido, -1 sentido contrario, 0 a vigilar)
const RULES = [
  ['yields', 'Rendimientos de bonos del Tesoro', /(treasur|ten-year|10-year|bond|note)[^.]*yields?|yields?[^.]*(treasur|ten-year|note|bond)/i,
    [['TLT', 'Bonos del Tesoro a 20+ años', -1], ['ITB', 'Constructoras de vivienda', -1], ['XLRE', 'Bienes raíces', -1], ['FUNO11.MX', 'FIBRA Uno', -1], ['XLU', 'Servicios públicos', -1]]],
  ['oil', 'Petróleo', /\b(crude|oil prices?|oil futures|brent|wti)\b/i,
    [['XLE', 'Energía', 1], ['XOM', 'Exxon Mobil', 1], ['OXY', 'Occidental', 1], ['JETS', 'Aerolíneas', -1], ['DAL', 'Delta', -1], ['UAL', 'United', -1]]],
  ['gold', 'Oro', /\bgold\b/i, [['GLD', 'Oro (ETF)', 1], ['GDX', 'Mineras de oro', 1], ['NEM', 'Newmont', 1]]],
  ['chips', 'Semiconductores', /semiconductor|chipmaker|chip-related|chip stocks/i,
    [['SMH', 'Semiconductores (ETF)', 1], ['NVDA', 'NVIDIA', 1], ['AVGO', 'Broadcom', 1], ['TSM', 'TSMC', 1], ['AMD', 'AMD', 1]]],
  ['net', 'Redes y tecnología', /networking/i, [['ANET', 'Arista Networks', 1], ['CSCO', 'Cisco', 1], ['QQQ', 'Nasdaq 100', 1]]],
  ['air', 'Aerolíneas', /airline/i, [['JETS', 'Aerolíneas (ETF)', 1], ['DAL', 'Delta', 1], ['UAL', 'United', 1]]],
  ['banks', 'Bancos y financieras', /\b(banks?|bank stocks|financial (?:stocks|shares)|financials)\b/i, [['XLF', 'Financieras', 1], ['JPM', 'JPMorgan', 1]]],
  ['usd', 'Dólar', /\bU\.S\. dollar\b|dollar index/i, [['UUP', 'Dólar (ETF)', 1], ['MXN=X', 'Dólar frente al peso', 1], ['FXE', 'Euro (ETF)', -1]]],
  ['crypto', 'Cripto', /bitcoin|crypto|\bether\b|stablecoin/i, [['BTC-USD', 'Bitcoin', 1], ['COIN', 'Coinbase', 1], ['MSTR', 'Strategy', 1], ['IBIT', 'ETF de bitcoin', 1]]],
  ['health', 'Salud y farmacéuticas', /\bFDA\b|biotech|drug|pharma/i, [['XLV', 'Salud', 1], ['NVO', 'Novo Nordisk', 1], ['LLY', 'Eli Lilly', 1]]],
  ['defense', 'Defensa', /defen[cs]e|missile|navy|pentagon|military/i, [['ITA', 'Aeroespacial y defensa', 1], ['LMT', 'Lockheed Martin', 1], ['RTX', 'RTX', 1]]],
  ['tariffs', 'Aranceles', /tariff/i, [['EWW', 'México (ETF)', -1]]],
  ['france', 'Deuda y política de Francia', /(French|France)[^.]*(debt|bond|yield|political)/i, [['EWQ', 'Francia (ETF)', 1], ['FXE', 'Euro (ETF)', 1]]],
  ['fed', 'Política de la Fed', /\b(Fed|Federal Reserve|FOMC)\b/i, [['TLT', 'Bonos largos', 0], ['SPY', 'S&P 500', 0], ['XLF', 'Financieras', 0]]],
];
const NAMES = [['Nvidia', 'NVDA'], ['Apple', 'AAPL'], ['Microsoft', 'MSFT'], ['Amazon', 'AMZN'], ['Alphabet', 'GOOGL'], ['Meta Platforms', 'META'], ['Tesla', 'TSLA'], ['Boeing', 'BA'],
  ['Raytheon', 'RTX'], ['Lockheed', 'LMT'], ['Walmart', 'WMT'], ['Exxon', 'XOM'], ['Chevron', 'CVX'], ['JPMorgan', 'JPM'], ['Goldman Sachs', 'GS'], ['Coinbase', 'COIN'],
  ['Novo Nordisk', 'NVO'], ['Eli Lilly', 'LLY'], ['Pfizer', 'PFE'], ['Intel', 'INTC'], ['Broadcom', 'AVGO'], ['Cisco', 'CSCO'], ['Oracle', 'ORCL'], ['Netflix', 'NFLX'],
  ['Accenture', 'ACN'], ['Paramount', 'PSKY'], ['Warner Bros', 'WBD'], ['Verizon', 'VZ'], ['T-Mobile', 'TMUS'], ['AT&T', 'T'], ['Micron', 'MU']];

export function analyze(text) {
  const sents = text.split(/(?<=[.!?])\s+/).filter(x => x.length > 20), temas = [];
  for (const [id, titulo, re, assets] of RULES) {
    const hit = sents.filter(x => re.test(x)); if (!hit.length) continue;
    const up = hit.filter(x => dir(x) === 'up').length, dn = hit.filter(x => dir(x) === 'down').length, d = up > dn ? 'up' : dn > up ? 'down' : 'mixed';
    temas.push({ id, titulo, dir: d, activos: assets.map(([s, n, g]) => ({ s, n, e: !g || d === 'mixed' ? 'vigilar' : (d === 'up' ? g : -g) > 0 ? 'beneficio' : 'presión' })) });
  }
  const empresas = NAMES.map(([n, s]) => { const hit = sents.filter(x => x.includes(n)); return hit.length ? { s, n, dir: dir(hit.join(' ')) } : null; }).filter(Boolean);
  return { temas, empresas, aviso: 'Lectura automática por reglas simples; no es un modelo de lenguaje ni una recomendación. El texto original es de RTTNews.' };
}

async function news(f, q, s) {
  const srcs = ['https://news.google.com/rss/search?hl=es-419&gl=MX&ceid=MX:es-419&q=' + enc(q), 'https://www.bing.com/news/search?format=rss&q=' + enc(q)];
  if (s) srcs.push('https://feeds.finance.yahoo.com/rss/2.0/headline?lang=en-US&region=US&s=' + enc(s));
  const det = [];
  for (const u of srcs) {
    const h = new URL(u).host;
    try { const it = parseRss(await (await up(f, u)).text()); if (it.length) return { items: it }; det.push(h + ':vacio'); }
    catch (e) { det.push(h + ':' + ((/upstream (\d+)/.exec(String(e.message)) || [])[1] || 'error')); }
  }
  return { items: [], det };
}

export async function handle(req, f = fetch) {
  const u = new URL(req.url), o = req.headers.get('origin') || '';
  if (req.method !== 'GET') return out({ error: 'metodo no permitido' }, 405, o);
  if (o && o !== SITE) return out({ error: 'origen no permitido' }, 403, o);
  try {
    const p = u.pathname, s = (u.searchParams.get('symbol') || '').trim(), q = (u.searchParams.get('q') || '').trim();
    if (p === '/search') {
      if (!TXT.test(q)) return out({ error: 'consulta invalida' }, 400, o);
      const r = await (await up(f, 'https://query1.finance.yahoo.com/v1/finance/search?quotesCount=10&newsCount=0&q=' + enc(q))).json();
      const ok = ['EQUITY', 'ETF', 'CRYPTOCURRENCY', 'INDEX', 'CURRENCY', 'FUTURE', 'MUTUALFUND'];
      return out((r.quotes || []).filter(x => ok.includes(x.quoteType) && SYM.test(x.symbol || '')).slice(0, 10)
        .map(x => ({ s: x.symbol, n: String(x.shortname || x.longname || x.symbol).slice(0, 60), x: String(x.exchDisp || '').slice(0, 20), t: String(x.quoteType).slice(0, 12) })), 200, o);
    }
    if (p === '/prices') {
      if (!SYM.test(s)) return out({ error: 'simbolo invalido' }, 400, o);
      const r = (await (await up(f, 'https://query1.finance.yahoo.com/v8/finance/chart/' + enc(s) + '?range=5y&interval=1d')).json()).chart.result[0];
      const z = r.indicators.quote[0], t = [], c = [], h = [], l = [];
      r.timestamp.forEach((ts, i) => { const k = z.close[i]; if (!(k > 0)) return; t.push(day(ts)); c.push(k); h.push(z.high[i] > 0 ? z.high[i] : k); l.push(z.low[i] > 0 ? z.low[i] : k); });
      const m = r.meta || {};
      return out({ symbol: s.toUpperCase(), name: String(m.longName || m.shortName || s).slice(0, 80), currency: String(m.currency || '').slice(0, 5), exchange: String(m.exchangeName || '').slice(0, 20), type: String(m.instrumentType || '').slice(0, 12), t, c, h, l }, 200, o);
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
      return out({ symbol: y, name: y, currency: 'USDT', exchange: 'Binance', type: 'CRYPTOCURRENCY', t: rows.map(k => day(k[0] / 1000)), c: rows.map(k => +k[4]), h: rows.map(k => +k[2]), l: rows.map(k => +k[3]) }, 200, o);
    }
    if (p === '/news') {
      if (!TXT.test(q) || (s && !SYM.test(s))) return out({ error: 'consulta invalida' }, 400, o);
      const r = await news(f, q, s);
      if (r.items.length || r.det.every(d => d.endsWith(':vacio'))) return out(r.items, 200, o);
      return out({ error: 'noticias no disponibles', detalle: r.det }, 502, o);
    }
    if (p === '/morning') {
      const m = readMorning(await (await up(f, 'https://www.rttnews.com/content/marketanalysis.aspx')).text());
      if (!m) return out({ error: 'estructura no reconocida' }, 502, o);
      const { text, ...pub } = m;
      return out({ source: 'RTTNews', ...pub, ...analyze(text) }, 200, o);
    }
    if (p === '/options') {
      if (!SYM.test(s)) return out({ error: 'simbolo invalido' }, 400, o);
      const j = await (await up(f, 'https://cdn.cboe.com/api/global/delayed_quotes/options/' + enc(s.toUpperCase().replace(/^\^/, '_')) + '.json')).json();
      return out({ symbol: s.toUpperCase(), ...readOptions(j) }, 200, o);
    }
    if (p === '/feed') {
      const url = FEEDS[u.searchParams.get('src')];
      if (!url) return out({ error: 'fuente invalida' }, 400, o);
      return out(parseRss(await (await up(f, url)).text()), 200, o);
    }
    if (p === '/insiders') {
      if (!SYM.test(s)) return out({ error: 'simbolo invalido' }, 400, o);
      return out(parseAtom(await (await up(f, 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=4&count=12&output=atom&CIK=' + enc(s))).text()), 200, o);
    }
    return out({ error: 'no encontrado' }, 404, o);
  } catch (e) {
    return out({ error: 'servicio de datos no disponible' }, 502, o);
  }
}

export default { fetch: req => handle(req) };
