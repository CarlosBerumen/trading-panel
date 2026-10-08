const test = require('node:test');
const assert = require('node:assert/strict');
const SITE = 'https://carlosberumen.github.io';
const W = () => import('../worker/worker.mjs');
const get = (p, h = {}, m = 'GET') => new Request('https://w.example' + p, { method: m, headers: h });
const json = o => new Response(JSON.stringify(o), { status: 200 });
const yahoo = () => json({ chart: { result: [{ meta: { longName: 'NVIDIA Corp', currency: 'USD', exchangeName: 'NMS' },
  timestamp: [1700000000, 1700086400, 1700172800, 1700259200],
  indicators: { quote: [{ close: [10, null, 12, 13], high: [11, null, 13, 14], low: [9, null, 11, null], open: [], volume: [] }] } }] } });

test('prices: normaliza, descarta huecos y solo da CORS a la página autorizada', async () => {
  const { handle } = await W();
  const r = await handle(get('/prices?symbol=nvda', { origin: SITE }), async () => yahoo());
  const d = await r.json();
  assert.equal(r.status, 200); assert.equal(d.symbol, 'NVDA'); assert.equal(d.name, 'NVIDIA Corp');
  assert.deepEqual(d.c, [10, 12, 13]); assert.deepEqual(d.l, [9, 11, 13]); assert.equal(d.t.length, 3);
  assert.equal(r.headers.get('access-control-allow-origin'), SITE);
  const sin = await handle(get('/prices?symbol=NVDA'), async () => yahoo());
  assert.equal(sin.headers.get('access-control-allow-origin'), null);
});

test('rechaza símbolos y consultas peligrosos sin llamar al exterior', async () => {
  const { handle } = await W(); let n = 0; const f = async () => { n++; return yahoo(); };
  for (const p of ['/prices?symbol=../etc', '/prices?symbol=' + 'A'.repeat(21), '/prices?symbol=a%20b', '/prices', '/crypto?symbol=btc/usdt', '/search?q=%3Cscript%3E', '/news?q=' + 'x'.repeat(41)])
    assert.equal((await handle(get(p), f)).status, 400, p);
  assert.equal(n, 0);
});

test('solo GET y solo desde la página autorizada', async () => {
  const { handle } = await W();
  assert.equal((await handle(get('/prices?symbol=SPY', {}, 'POST'), async () => yahoo())).status, 405);
  assert.equal((await handle(get('/prices?symbol=SPY', { origin: 'https://malo.example' }), async () => yahoo())).status, 403);
  assert.equal((await handle(get('/otra', { origin: SITE }), async () => yahoo())).status, 404);
});

test('un fallo externo devuelve 502 genérico sin detalles internos', async () => {
  const { handle } = await W();
  const r = await handle(get('/prices?symbol=SPY'), async () => { throw new Error('secreto interno 10.0.0.1'); });
  assert.equal(r.status, 502); assert.doesNotMatch(await r.text(), /secreto|10\.0/);
  const r2 = await handle(get('/prices?symbol=SPY'), async () => new Response('x', { status: 429 }));
  assert.equal(r2.status, 502);
});

test('search: filtra tipos y símbolos raros', async () => {
  const { handle } = await W();
  const f = async () => json({ quotes: [{ symbol: 'NVDA', shortname: 'NVIDIA', exchDisp: 'NASDAQ', quoteType: 'EQUITY' },
    { symbol: 'WALMEX.MX', longname: 'Wal-Mart de Mexico', exchDisp: 'Mexico', quoteType: 'EQUITY' },
    { symbol: 'EVIL<>', shortname: 'x', quoteType: 'EQUITY' }, { symbol: 'OPT1', quoteType: 'OPTION' }] });
  const d = await (await handle(get('/search?q=nvidia'), f)).json();
  assert.deepEqual(d.map(x => x.s), ['NVDA', 'WALMEX.MX']);
});

test('news: lee RSS, limpia HTML y descarta enlaces que no son http(s)', async () => {
  const { handle, parseRss } = await W();
  const xml = '<rss><item><title><![CDATA[Sube <b>NVDA</b> &amp; Cia]]></title><link>https://ok.example/a</link><source url="x">Fuente</source><pubDate>Sat, 04 Oct 2026</pubDate></item>'
    + '<item><title>Malo</title><link>javascript:alert(1)</link></item>' + '<item><title>Otro</title><link>https://ok.example/b</link></item>'.repeat(20) + '</rss>';
  const it = parseRss(xml);
  assert.equal(it[0].title, 'Sube NVDA & Cia'); assert.equal(it.length, 21); assert.ok(it.every(i => /^https?:/.test(i.link)));
  const d = await (await handle(get('/news?q=NVIDIA'), async () => new Response(xml))).json();
  assert.equal(d.length, 15);
});

test('crypto: pagina en el host de datos y descarta la vela abierta', async () => {
  const { handle } = await W(); const urls = []; const now = Date.now(), dia = 864e5;
  const vela = (i, abierta) => [now - (1100 - i) * dia, '10', '11', '9', '10.5', '1', abierta ? now + 1e6 : now - (1100 - i) * dia + dia - 1];
  const pg = [Array.from({ length: 1000 }, (_, i) => vela(i)), [...Array.from({ length: 99 }, (_, i) => vela(1000 + i)), vela(1099, true)]];
  const r = await handle(get('/crypto?symbol=btcusdt'), async u => { urls.push(u); return json(pg[urls.length - 1]); });
  const d = await r.json();
  assert.equal(d.symbol, 'BTCUSDT'); assert.equal(d.c.length, 1099); assert.ok(urls.every(u => u.startsWith('https://data-api.binance.vision/')));
});

test('solo se contactan destinos permitidos', async () => {
  const { handle } = await W(); const hosts = new Set();
  const f = async u => { hosts.add(new URL(u).host); return u.includes('news.google') ? new Response('<rss/>') : u.includes('v8/finance') ? yahoo() : json({ quotes: [] }); };
  for (const p of ['/search?q=spy', '/prices?symbol=SPY', '/news?q=spy']) await handle(get(p), f);
  assert.deepEqual([...hosts].sort(), ['news.google.com', 'query1.finance.yahoo.com', 'www.bing.com']);
});


const rss = (t, l) => '<rss><item><title>' + t + '</title><link>' + l + '</link><source url="x">Fuente</source><pubDate>hoy</pubDate></item></rss>';

test('search: ahora incluye índices, futuros y divisas y devuelve el tipo', async () => {
  const { handle } = await W();
  const f = async () => json({ quotes: [{ symbol: '^GSPC', shortname: 'S&P 500', quoteType: 'INDEX', exchDisp: 'SNP' }, { symbol: 'ES=F', shortname: 'E-mini', quoteType: 'FUTURE' },
    { symbol: 'MXN=X', shortname: 'USD/MXN', quoteType: 'CURRENCY' }, { symbol: 'X1', quoteType: 'OPTION' }, { symbol: '<bad>', quoteType: 'INDEX' }] });
  const d = await (await handle(get('/search?q=sp'), f)).json();
  assert.deepEqual(d.map(x => [x.s, x.t]), [['^GSPC', 'INDEX'], ['ES=F', 'FUTURE'], ['MXN=X', 'CURRENCY']]);
});

test('news: si Google falla usa Bing y luego Yahoo; informa solo códigos', async () => {
  const { handle } = await W(); const hosts = [];
  const f = async u => { hosts.push(new URL(u).host); return u.includes('feeds.finance') ? new Response(rss('Sube GFNORTEO', 'https://ok.example/n')) : new Response('x', { status: 503 }); };
  const d = await (await handle(get('/news?q=Banorte&symbol=GFNORTEO.MX'), f)).json();
  assert.equal(d[0].title, 'Sube GFNORTEO'); assert.deepEqual(hosts, ['news.google.com', 'www.bing.com', 'feeds.finance.yahoo.com']);
  const r = await handle(get('/news?q=Banorte&symbol=GFNORTEO.MX'), async () => { throw new Error('boom 10.0.0.1'); });
  const e = await r.json();
  assert.equal(r.status, 502); assert.deepEqual(e.detalle, ['news.google.com:error', 'www.bing.com:error', 'feeds.finance.yahoo.com:error']);
  assert.doesNotMatch(JSON.stringify(e), /10\.0\.0\.1/);
  const g = await (await handle(get('/news?q=Banorte'), async u => (u.includes('google') ? new Response('x', { status: 429 }) : new Response(rss('Bing', 'https://b.example/'))))).json();
  assert.equal(g[0].title, 'Bing');
  assert.equal((await handle(get('/news?q=a&symbol=../x'), async () => new Response('<rss/>'))).status, 400);
});

// Texto propio de prueba (no es contenido de RTTNews) con la misma estructura de la página
const PAG = `<html><body><nav>Home Markets</nav><h1>Market Analysis</h1><div>Beyond the Numbers</div><h2>Oil Slump And Strong Chips Lift Wall Street</h2><div>October 05, 2026 08:57 ET</div>
<p>Yields on the ten-year Treasury note spiked to multi-decade highs and traders remain cautious.</p>
<p>Crude oil prices slumped after a reserve release, while airline stocks came under pressure.</p>
<p>Semiconductor stocks surged and Nvidia climbed to a three-month high.</p>
<p>Gold futures are climbing again as investors wait for the Federal Reserve minutes.</p>
<p>Boeing shares fell after a delay announced this morning.</p>
<div>More Daily Market Analysis</div>
<ul><li><a href="https://www.rttnews.com/Content/MarketAnalysis.aspx?Id=4576">Oil Slump And Strong Chips Lift Wall Street</a></li><li><a href="/Content/MarketAnalysis.aspx?Id=4575">Futures Point Higher</a></li><li><a href="javascript:alert(1)">malo</a></li></ul>
<footer>Copyright RTTNews</footer></body></html>`;

test('morning: devuelve título, fecha, enlace y temas propios, sin copiar el texto del artículo', async () => {
  const { handle } = await W(); const urls = [];
  const r = await handle(get('/morning', { origin: SITE }), async u => { urls.push(u); return new Response(PAG); });
  const d = await r.json(); const t = id => d.temas.find(x => x.id === id);
  assert.equal(r.status, 200); assert.equal(d.title, 'Oil Slump And Strong Chips Lift Wall Street'); assert.match(d.date, /October 05, 2026 08:57 ET/);
  assert.equal(d.url, 'https://www.rttnews.com/content/marketanalysis.aspx');
  assert.equal(t('yields').dir, 'up'); assert.equal(t('yields').activos.find(a => a.s === 'TLT').e, 'presión');
  assert.equal(t('oil').dir, 'down'); assert.equal(t('oil').activos.find(a => a.s === 'XLE').e, 'presión'); assert.equal(t('oil').activos.find(a => a.s === 'JETS').e, 'beneficio');
  assert.equal(t('chips').activos.find(a => a.s === 'NVDA').e, 'beneficio'); assert.equal(t('gold').dir, 'up'); assert.ok(t('fed').activos.every(a => a.e === 'vigilar'));
  assert.deepEqual(d.empresas.map(e => [e.s, e.dir]).sort(), [['BA', 'down'], ['NVDA', 'up']]);
  assert.equal(d.archive.length, 2); assert.ok(d.archive.every(a => a.url.startsWith('https://www.rttnews.com/')));
  assert.doesNotMatch(JSON.stringify(d), /reserve release|three-month high|multi-decade/);
  assert.deepEqual(urls, ['https://www.rttnews.com/content/marketanalysis.aspx']);
  assert.equal((await handle(get('/morning'), async () => new Response('<html><body>nada</body></html>'))).status, 502);
  assert.equal((await handle(get('/morning'), async () => new Response('x', { status: 403 }))).status, 502);
});

test('options: lee la cadena de Cboe, calcula put/call y filtra cerca del precio', async () => {
  const { handle } = await W(); const urls = [];
  const op = (e, t, k, v) => ({ option: 'SPY' + e + t + String(k * 1000).padStart(8, '0'), bid: 1, ask: 1.2, iv: 0.2, delta: t === 'C' ? 0.5 : -0.5, volume: v, open_interest: 10 });
  const j = { data: { current_price: 500, options: [op('261120', 'C', 500, 100), op('261120', 'P', 500, 150), op('261120', 'C', 700, 5), op('261218', 'C', 505, 1), op('261016', 'P', 495, 50), { option: 'raro' }] } };
  const d = await (await handle(get('/options?symbol=spy'), async u => { urls.push(u); return json(j); })).json();
  assert.equal(d.spot, 500); assert.deepEqual(d.expirations, ['2026-10-16', '2026-11-20', '2026-12-18']);
  assert.equal(d.rows.length, 3); assert.ok(d.rows.every(r => Math.abs(r.k / 500 - 1) <= 0.08));       // solo las 2 fechas más cercanas y se descarta la de 700
  assert.ok(Math.abs(d.pcVol - (150 + 50) / (100 + 5 + 1)) < 1e-9);
  assert.equal(urls[0], 'https://cdn.cboe.com/api/global/delayed_quotes/options/SPY.json');
  await handle(get('/options?symbol=%5EGSPC'.replace('GSPC', 'SPX')), async u => { urls.push(u); return json(j); });
  assert.equal(urls[1], 'https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json');
});

test('feed e insiders: solo fuentes fijas y enlaces https de destino conocido', async () => {
  const { handle } = await W(); const urls = [];
  const f = async u => { urls.push(u); return u.includes('sec.gov') ? new Response('<feed><entry><title>4 - Statement of changes</title><link href="https://www.sec.gov/Archives/x"/><updated>2026-10-01T10:00:00-04:00</updated></entry><entry><title>x</title><link href="javascript:1"/></entry></feed>') : new Response(rss('Titular', 'https://fj.example/a')); };
  assert.equal((await (await handle(get('/feed?src=fj'), f)).json())[0].title, 'Titular');
  assert.equal((await handle(get('/feed?src=http://malo'), f)).status, 400);
  const d = await (await handle(get('/insiders?symbol=NVDA'), f)).json();
  assert.equal(d.length, 1); assert.match(d[0].link, /^https:\/\/www\.sec\.gov\//);
  assert.deepEqual(urls.map(u => new URL(u).host), ['www.financialjuice.com', 'www.sec.gov']);
});

test('weekly: convierte el informe en temas y activos sin copiar frases', async () => {
  const { buildWeekly } = await import('../scripts/weekly.mjs');
  const txt = 'Weekly Market Recap October 02, 2026\nEquities rose as semiconductor stocks surged this week.\nCrude oil prices fell sharply last week.\nAirline shares gained on lower fuel costs.\nTreasury yields declined across the curve.';
  const d = buildWeekly(txt, { url: 'https://am.jpmorgan.com/x.pdf', now: '2026-10-05T00:00:00Z' });
  const t = id => d.temas.find(x => x.id === id);
  assert.equal(d.fecha, 'October 02, 2026'); assert.equal(t('oil').dir, 'down'); assert.equal(t('oil').activos.find(a => a.s === 'JETS').e, 'beneficio');
  assert.equal(t('chips').dir, 'up'); assert.equal(t('yields').dir, 'down'); assert.equal(t('yields').activos.find(a => a.s === 'TLT').e, 'beneficio');
  assert.doesNotMatch(JSON.stringify(d), /fuel costs|surged this week/); assert.match(d.aviso, /J\.P\. Morgan/);
});


test('sortNews: ordena de la más reciente a la más antigua y descarta lo viejo si hay suficientes recientes', async () => {
  const { sortNews } = await W(); const now = Date.parse('2026-10-07T12:00:00Z'), d = n => new Date(now - n * 864e5).toUTCString();
  const it = [['viejo', 200], ['mes', 30], ['hoy', 0], ['ayer', 1], ['sem', 7], ['dos', 2], ['tres', 3], ['sinfecha', null]].map(([title, n]) => ({ title, link: 'https://x.example/' + title, date: n === null ? 'hoy mismo' : d(n) }));
  assert.deepEqual(sortNews(it, now).map(i => i.title), ['hoy', 'ayer', 'dos', 'tres', 'sem', 'mes']);               // 6 recientes: se descarta lo viejo y lo que no tiene fecha
  const pocos = it.filter(i => ['viejo', 'mes', 'hoy'].includes(i.title));
  assert.deepEqual(sortNews(pocos, now).map(i => i.title), ['hoy', 'mes', 'viejo']);                              // con pocas recientes se conservan, ordenadas
});

test('prices: ahora devuelve 10 años de rango y el cierre ajustado por dividendos', async () => {
  const { handle } = await W(); const urls = [];
  const f = async u => { urls.push(u); return json({ chart: { result: [{ meta: { currency: 'USD' }, timestamp: [1700000000, 1700086400, 1700172800],
    indicators: { quote: [{ close: [10, 11, 12], high: [11, 12, 13], low: [9, 10, 11] }], adjclose: [{ adjclose: [9.5, null, 11.8] }] } }] } }); };
  const d = await (await handle(get('/prices?symbol=DIA'), f)).json();
  assert.match(urls[0], /range=10y/); assert.deepEqual(d.c, [10, 11, 12]); assert.deepEqual(d.a, [9.5, 11, 11.8]);
});
