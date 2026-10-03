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
  assert.match(csp, /default-src 'none'/); assert.match(csp, /script-src 'self'/); assert.match(csp, /connect-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline/);
  assert.doesNotMatch(html, /\son\w+=/i);
  assert.doesNotMatch(html + fs.readFileSync(path.join(SITE, 'app.js'), 'utf8'), /https?:\/\/(?!www\.w3\.org)/);
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
  assert.deepEqual(pedidos.slice(0, 2), ['data/manifest.json', 'data/SPY.json']);
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
