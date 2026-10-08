// Prueba de humo: carga la página real con un fetch simulado y revisa que funcione y que sea segura.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = path.join(__dirname, '..', 'site');
const dia = i => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
const datos = (sym, ultimo) => {
  const n = 320, c = Array.from({ length: n }, (_, i) => 100 + i * 0.2 + 5 * Math.sin(i / 9));
  const t = Array.from({ length: n }, (_, i) => dia(i));
  if (ultimo) t[n - 1] = ultimo;
  return { symbol: sym, source: 'test', updated: '2026-10-01T00:00:00+00:00', t, c, h: c.map(x => x * 1.01), l: c.map(x => x * 0.99) };
};

async function abrir(manifest, archivos) {
  const errores = [], pedidos = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errores.push(e.message));
  const dom = new JSDOM(fs.readFileSync(path.join(SITE, 'index.html'), 'utf8'), {
    url: 'http://localhost/', runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true,
  });
  const w = dom.window;
  w.fetch = async url => {
    pedidos.push(url);
    const cuerpo = url.endsWith('manifest.json') ? manifest : archivos[url.replace('data/', '')];
    return cuerpo ? { ok: true, status: 200, json: async () => cuerpo } : { ok: false, status: 404, json: async () => ({}) };
  };
  for (const f of ['core.js', 'app.js']) {   // como scripts clásicos: comparten el ámbito global igual que en el navegador
    const el = w.document.createElement('script');
    el.textContent = fs.readFileSync(path.join(SITE, f), 'utf8');
    w.document.body.appendChild(el);
  }
  for (let i = 0; i < 50 && !w.document.querySelector('#t .row'); i++) await new Promise(r => setTimeout(r, 20));
  return { w, errores, pedidos };
}

test('estructura segura: sin scripts en línea y con CSP estricta', () => {
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  const dom = new JSDOM(html);
  assert.equal(dom.window.document.querySelectorAll('script:not([src])').length, 0);
  const csp = dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
  assert.match(csp, /default-src 'none'/); assert.match(csp, /script-src 'self'/); assert.match(csp, /connect-src 'self' https:\/\/\*\.workers\.dev;/);
  assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline/);
  assert.doesNotMatch(html, /\son\w+=/i);
  const app = fs.readFileSync(path.join(SITE, 'app.js'), 'utf8');
  assert.doesNotMatch(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''), /https?:\/\/(?!www\.w3\.org)/);   // sin recursos externos en el HTML
  assert.doesNotMatch(app, /fetch\(\s*['"`]https?:/);                                                                 // ninguna petición directa a otros sitios
  assert.doesNotMatch(app, /\beval\(|new Function\(|document\.write|XMLHttpRequest|WebSocket|\.innerHTML\s*=\s*[^;]*\+\s*(?:m|d|r|i)\./);
});

test('carga sola el ticker y muestra el análisis técnico sin errores', async () => {
  const m = { updated: '2026-10-01T00:00:00+00:00', symbols: [
    { symbol: 'SPY', name: 'ETF S&P 500', market: 'us', file: 'SPY.json', rows: 320, last: '2025-11-16' },
    { symbol: 'BTCUSDT', name: 'Bitcoin', market: 'cr', file: 'BTCUSDT.json', rows: 320, last: '2025-11-16' }] };
  const { w, errores, pedidos } = await abrir(m, { 'SPY.json': datos('SPY'), 'BTCUSDT.json': datos('BTCUSDT') });
  const d = w.document;
  assert.deepEqual(errores, []);
  assert.equal(d.querySelectorAll('#sym option').length, 2);
  assert.match(d.getElementById('t').textContent, /Tendencia/);
  assert.match(d.getElementById('t').textContent, /Momentum 12-1/);
  assert.equal(d.querySelector('#tabs [aria-selected="true"]').textContent, 'Técnico');
  assert.ok(d.querySelector('#t svg path'));
  assert.ok(pedidos.includes('data/manifest.json') && pedidos.indexOf('data/SPY.json') > pedidos.indexOf('data/manifest.json'));
  d.getElementById('sym').value = 'BTCUSDT.json';
  d.getElementById('sym').dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 50));
  assert.equal(d.querySelector('[data-m][aria-pressed="true"]').dataset.m, 'cr');
});

test('un manifiesto hostil no inyecta HTML ni pide rutas fuera de data/', async () => {
  const m = { updated: 'x', symbols: [
    { symbol: '<img src=x onerror=alert(1)>', name: '<script>alert(2)</script>', market: 'us', file: 'SPY.json', rows: 1, last: '<b>' },
    { symbol: 'EVIL', name: 'evil', market: 'us', file: '../../secreto.json', rows: 1, last: '2025-01-01' }] };
  const { w, errores, pedidos } = await abrir(m, { 'SPY.json': datos('SPY') });
  const d = w.document;
  assert.equal(d.querySelectorAll('#sym img, #sym script, #ast img').length, 0);
  assert.match(d.getElementById('sym').textContent, /<img src=x/);   // aparece como texto, no como elemento
  d.getElementById('sym').value = '../../secreto.json';
  d.getElementById('sym').dispatchEvent(new w.Event('change'));
  await new Promise(r => setTimeout(r, 30));
  assert.ok(!pedidos.some(p => p.includes('..')));
  assert.deepEqual(errores, []);
});

test('datos corruptos o desactualizados se avisan y no rompen la página', async () => {
  const m = { updated: 'x', symbols: [{ symbol: 'SPY', name: 'a', market: 'us', file: 'SPY.json', rows: 1, last: '2025-01-01' }] };
  const mal = datos('SPY'); mal.c[5] = -1;
  const a = await abrir(m, { 'SPY.json': mal });
  await new Promise(r => setTimeout(r, 50));
  assert.match(a.w.document.getElementById('ast').textContent, /No pude leer/);
  assert.deepEqual(a.errores, []);
  const b = await abrir(m, { 'SPY.json': datos('SPY') });
  assert.match(b.w.document.getElementById('ast').textContent, /desactualizado/);
});

test('sin datos automáticos queda disponible el CSV propio', async () => {
  const { w } = await abrir(null, {});
  await new Promise(r => setTimeout(r, 50));
  assert.match(w.document.getElementById('ast').textContent, /CSV/);
  assert.equal(w.document.getElementById('autob').hidden, true);
});

test('v2: busca cualquier ticker, muestra encabezado, veredicto, costos y noticias', async () => {
  const API = 'https://panel.carlos.workers.dev';
  const { JSDOM: J, VirtualConsole: VC } = require('jsdom');
  const errores = [], vc = new VC(); vc.on('jsdomError', e => errores.push(e.message));
  const dom = new J(fs.readFileSync(path.join(SITE, 'index.html'), 'utf8'), { url: 'http://localhost/', runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true });
  const w = dom.window, pedidos = [];
  const ok = o => ({ ok: true, status: 200, json: async () => o });
  w.fetch = async u => {
    pedidos.push(u);
    if (u === 'config.json') return ok({ api: API });
    if (u === 'data/crypto.json') return ok([{ s: 'NVXUSDT', b: 'NVX' }]);
    if (u.startsWith(API + '/search')) return ok([{ s: 'NVDA', n: 'NVIDIA', x: 'NASDAQ' }, { s: 'WALMEX.MX', n: 'Walmart de Mexico', x: 'Mexico' }]);
    if (u.startsWith(API + '/prices')) return ok({ ...datos('NVDA'), name: 'NVIDIA <b>Corp</b>', currency: 'USD', exchange: 'NMS' });
    if (u.startsWith(API + '/news')) return ok([{ title: 'Sube NVDA', link: 'https://ok.example/a', src: 'Fuente', date: 'hoy' }, { title: 'Malo', link: 'javascript:alert(1)' }]);
    return { ok: false, status: 404, json: async () => ({}) };
  };
  for (const f of ['core.js', 'app.js']) { const el = w.document.createElement('script'); el.textContent = fs.readFileSync(path.join(SITE, f), 'utf8'); w.document.body.appendChild(el); }
  await new Promise(r => setTimeout(r, 50));
  const d = w.document, tk = d.getElementById('tk');
  tk.value = 'nv'; tk.dispatchEvent(new w.Event('input'));
  await new Promise(r => setTimeout(r, 450));
  const li = [...d.querySelectorAll('#sr li')];
  assert.deepEqual(li.map(x => x.textContent.split(' · ')[0]), ['NVXUSDT', 'NVDA', 'WALMEX.MX']);
  li[1].click();
  for (let i = 0; i < 50 && !d.querySelector('#t .row'); i++) await new Promise(r => setTimeout(r, 20));
  assert.match(d.getElementById('qh').textContent, /NVIDIA <b>Corp<\/b>/);          // texto, no HTML
  assert.equal(d.querySelectorAll('#qh b').length, 1);
  assert.match(d.getElementById('qh').textContent, /Rango de 52 semanas/);
  assert.match(d.getElementById('b').textContent, /Veredicto en 4 preguntas/);
  assert.match(d.getElementById('b').textContent, /Si hubieras invertido 10,000/);
  assert.equal(d.querySelectorAll('#b table tr').length > 4, true);
  d.querySelector('#tabs [data-i="2"]').click();
  for (let i = 0; i < 50 && !d.querySelector('#nw a'); i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(d.querySelectorAll('#nw a').length, 1);                                // el enlace javascript: se descarta
  assert.equal(d.querySelector('#nw a').rel, 'noopener noreferrer');
  assert.ok(pedidos.every(u => !/\.\./.test(u)));
  assert.deepEqual(errores, []);
});

test('v3: catálogo de mercados, resumen de decisión, moneda, opciones, bonos y paneles de Fundamental', async () => {
  const API = 'https://panel.carlos.workers.dev';
  const { JSDOM: J, VirtualConsole: VC } = require('jsdom');
  const errores = [], vc = new VC(); vc.on('jsdomError', e => errores.push(e.message));
  const dom = new J(fs.readFileSync(path.join(SITE, 'index.html'), 'utf8'), { url: 'http://localhost/', runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true });
  const w = dom.window, d = w.document, pedidos = [];
  const ok = o => ({ ok: true, status: 200, json: async () => o });
  const tem = [{ id: 'chips', titulo: 'Semiconductores', dir: 'up', activos: [{ s: 'NVDA', n: 'NVIDIA', e: 'beneficio' }] }];
  w.fetch = async u => {
    pedidos.push(u);
    if (u === 'config.json') return ok({ api: API });
    if (u === 'data/crypto.json') return ok([]);
    if (u === 'data/weekly.json') return ok({ url: 'https://am.jpmorgan.com/x.pdf', fecha: 'October 02, 2026', actualizado: '2026-10-05T00:00:00Z', temas: tem, empresas: [], aviso: 'aviso' });
    if (u.startsWith(API + '/prices')) { const s = decodeURIComponent(u.split('symbol=')[1]); return ok({ ...datos(s), name: s === '^GSPC' ? 'S&P 500' : 'Nombre ' + s, currency: s === '^TNX' ? 'USD' : 'USD', exchange: 'X' }); }
    if (u.startsWith(API + '/morning')) return ok({ source: 'RTTNews', title: 'Titulo', date: 'October 05, 2026 08:57 ET', url: 'https://www.rttnews.com/content/marketanalysis.aspx', temas: tem, empresas: [], aviso: 'aviso' });
    if (u.startsWith(API + '/news')) return ok([{ title: 'Noticia', link: 'https://ok.example/a', src: 'F', date: 'hoy' }]);
    if (u.startsWith(API + '/feed')) return ok([{ title: 'Titular ' + u.split('src=')[1], link: 'https://ok.example/f' }]);
    if (u.startsWith(API + '/insiders')) return ok([{ title: '4 - Statement', link: 'https://www.sec.gov/Archives/x', date: '2026-10-01T10:00:00' }]);
    if (u.startsWith(API + '/options')) return ok({ symbol: 'SPX', spot: 100, expirations: ['2026-11-20'], pcVol: 1.2, pcOI: 0.8, rows: [{ exp: '2026-11-20', t: 'C', k: 100, bid: 1, ask: 1.2, iv: 0.2, d: 0.5, v: 10, oi: 20 }] });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  for (const f of ['core.js', 'app.js']) { const el = d.createElement('script'); el.textContent = fs.readFileSync(path.join(SITE, f), 'utf8'); d.body.appendChild(el); }
  const esperar = async (fn, n = 60) => { for (let i = 0; i < n && !fn(); i++) await new Promise(r => setTimeout(r, 20)); };
  await esperar(() => false, 5);
  assert.ok(d.querySelectorAll('#cat button').length >= 40);
  const chip = t => [...d.querySelectorAll('#cat button')].find(b => b.textContent === t);
  chip('^GSPC').click(); await esperar(() => d.querySelector('#b table'));
  assert.match(d.getElementById('qh').textContent, /Índice/);
  assert.match(d.getElementById('t').textContent, /Resumen para decidir/);
  assert.match(d.getElementById('t').textContent, /Precio, medias móviles y cruces/);
  assert.match(d.getElementById('b').textContent, /Si hubieras invertido 10,000 USD hace/);
  assert.match(d.getElementById('b').textContent, /no se compra directamente/);
  assert.match(d.getElementById('b').textContent, /rango de resultados/);
  assert.ok(d.querySelector('#b svg rect title') || d.querySelector('#b svg'));
  const op = d.getElementById('opt'); op.open = true; op.dispatchEvent(new w.Event('toggle'));
  await esperar(() => d.querySelector('#ob table'));
  assert.match(d.getElementById('ob').textContent, /Vencimiento 2026-11-20/);
  assert.ok(pedidos.some(u => u.includes('/options?symbol=%5ESPX')));
  d.querySelector('#tabs [data-i="2"]').click(); await esperar(() => d.querySelector('#mm a') && d.querySelector('#lv a') && d.querySelector('#po a'));
  assert.equal(d.getElementById('fx').hidden, true);
  assert.match(d.getElementById('wk').textContent, /J\.P\. Morgan/);
  assert.equal(d.querySelectorAll('#lv a').length >= 6, true);                      // 2 titulares + 6 cuentas de X
  assert.ok([...d.querySelectorAll('#po a')].some(a => a.href.startsWith('https://www.quiverquant.com/')));
  chip('^TNX').click(); await esperar(() => /tasa de interés/.test(d.getElementById('b').textContent));
  assert.match(d.getElementById('b').textContent, /tasa de interés, no un precio/); assert.doesNotMatch(d.getElementById('b').textContent, /Veredicto/);
  assert.match(d.getElementById('qh').textContent, /Bono/);
  assert.deepEqual(errores, []);
});
