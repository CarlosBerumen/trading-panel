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
  assert.equal(it[0].title, 'Sube NVDA & Cia'); assert.equal(it.length, 15); assert.ok(it.every(i => /^https?:/.test(i.link)));
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
  assert.deepEqual([...hosts].sort(), ['news.google.com', 'query1.finance.yahoo.com']);
});
