const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../site/core.js');

const close = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const dia = i => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
const serie = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const mk = c => ({ s50: C.sma(c, 50), s100: C.sma(c, 100), s200: C.sma(c, 200) });

test('sma: promedio móvil y NaN al inicio', () => {
  const s = C.sma([1, 2, 3, 4, 5], 3);
  assert.ok(isNaN(s[0]) && isNaN(s[1]));
  assert.deepEqual(s.slice(2), [2, 3, 4]);
});

test('ema: recursión exponencial', () => {
  const e = C.ema([10, 20, 30], 3);
  assert.equal(e[0], 10); close(e[1], 15); close(e[2], 22.5);
});

test('parse: formato Yahoo usa Close y no Adj Close', () => {
  const csv = 'Date,Open,High,Low,Close,Adj Close,Volume\n' + serie(40, i => `${dia(i)},10,11,9,${10 + i},5,1000`).join('\n');
  const d = C.parse(csv);
  assert.equal(d.c.length, 40); assert.equal(d.c[0], 10); assert.equal(d.h[0], 11);
});

test('parse: encabezados en español y punto y coma', () => {
  const csv = 'Fecha;Apertura;Máx.;Mín.;Cierre;Volumen\n' + serie(40, i => `${dia(i)};10;11;9;${10 + i};1000`).join('\n');
  assert.equal(C.parse(csv).c[39], 49);
});

test('parse: orden descendente se invierte a ascendente', () => {
  const csv = 'Date,Close\n' + serie(40, i => `${dia(39 - i)},${50 - i}`).join('\n');
  const d = C.parse(csv);
  assert.equal(d.c[0], 11); assert.equal(d.c[39], 50); assert.deepEqual(d.h, d.c);
});

test('parse: rechaza pocas filas y falta de columna de cierre', () => {
  assert.throws(() => C.parse('Date,Close\n2024-01-01,10'));
  assert.throws(() => C.parse('Date,Precio\n' + serie(40, i => `${dia(i)},10`).join('\n')));
});

test('bt: sin datos suficientes para la SMA 200 no opera', () => {
  const c = serie(150, i => 100 + i);
  const o = C.bt(c, mk(c), 0);
  assert.equal(o.tr, 0); assert.ok(o.rs.every(x => x === 0));
});

test('bt: tendencia alcista sostenida entra y gana', () => {
  const c = serie(500, i => 100 * Math.pow(1.002, i));
  const o = C.bt(c, mk(c), 0);
  assert.ok(o.tr >= 1 && o.inv > 0.5);
  assert.ok(o.rs.reduce((a, r) => a * (1 + r), 1) > 1);
});

test('bt: no usa información futura (truncar el futuro no cambia el pasado)', () => {
  const c = serie(600, i => 100 + 30 * Math.sin(i / 40) + i * 0.05);
  const completo = C.bt(c, mk(c), 0.001);
  const cortado = c.slice(0, 400);
  const parcial = C.bt(cortado, mk(cortado), 0.001);
  assert.deepEqual(parcial.rs, completo.rs.slice(0, 399));
});

// Implementación de referencia, escrita aparte: la posición del día i se decide con el cierre del día i-1.
function referencia(c) {
  const s50 = C.sma(c, 50), s100 = C.sma(c, 100), s200 = C.sma(c, 200);
  let pos = 0; const out = [];
  for (let i = 1; i < c.length; i++) {
    out.push(pos * (c[i] / c[i - 1] - 1));
    if (!isNaN(s200[i])) {
      if (!pos) { if (c[i] > s200[i] && s50[i] > s200[i] && c[i] > s50[i]) pos = 1; }
      else if (c[i] < s100[i]) pos = 0;
    }
  }
  return out;
}

test('bt: coincide con la referencia independiente (la posición se fija antes del retorno del día)', () => {
  let semilla = 12345;
  const azar = () => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla / 4294967296 - 0.5; };
  for (let k = 0; k < 5; k++) {
    let p = 100; const c = serie(700, () => (p *= 1 + 0.0006 + 0.02 * azar()));
    const real = C.bt(c, mk(c), 0).rs, esperado = referencia(c);
    assert.equal(real.length, esperado.length);
    real.forEach((x, i) => close(x, esperado[i], 1e-12));
  }
});

test('bt: los costos reducen el retorno', () => {
  const c = serie(600, i => 100 + 30 * Math.sin(i / 25) + i * 0.05);
  const sin = C.bt(c, mk(c), 0), con = C.bt(c, mk(c), 0.01);
  assert.ok(sin.tr > 1);
  const tot = o => o.rs.reduce((a, r) => a * (1 + r), 1);
  assert.ok(tot(con) < tot(sin));
});

test('st: retorno compuesto, caída máxima y desviación cero', () => {
  const r = C.st(Array(252).fill(0.001), 252);
  close(r.cagr, Math.pow(1.001, 252) - 1, 1e-9); assert.equal(r.sr, 0);
  close(C.st([0.1, -0.5, 0.2], 252).dd, -0.5, 1e-9);
});

const base = { rev0: 1000, rev1: 900, cogs0: 600, cogs1: 600, ni0: 100, ni1: 50, ta0: 1100, ta1: 1000, ta2: 1000,
  cfo: 150, ltd0: 100, ltd1: 200, ca0: 200, ca1: 150, cl0: 100, cl1: 100, issued: false };

test('fscore: caso perfecto da 9 y cada señal se puede apagar', () => {
  assert.equal(C.fscore(base).filter(s => s[1]).length, 9);
  assert.equal(C.fscore({ ...base, issued: true }).filter(s => s[1]).length, 8);
  const s = C.fscore({ ...base, ni0: -10 });
  assert.equal(s[0][1], false); assert.equal(s[2][1], false);
});

test('fscore: devuelve null si faltan datos', () => {
  const { cfo, ...incompleto } = base;
  assert.equal(C.fscore(incompleto), null);
});

test('altman Z\'\' y zonas', () => {
  const z = C.altman({ ca: 200, cl: 100, ta: 1000, re: 300, ebit: 100, eq: 400, tl: 600 });
  close(z, 3.25 + 6.56 * 0.1 + 3.26 * 0.3 + 6.72 * 0.1 + 1.05 * (400 / 600), 1e-9);
  assert.equal(C.zone(z), 'segura'); assert.equal(C.zone(2), 'gris'); assert.equal(C.zone(1), 'riesgo'); assert.equal(C.zone(NaN), '');
});

test('sizing: arriesga el porcentaje elegido y no usa apalancamiento', () => {
  const a = C.sizing(1000, 1, 2.5, 2, 100);
  close(a.units, 2); close(a.loss, 10); close(a.stop, 95); assert.equal(a.capped, false);
  const b = C.sizing(1000, 1, 2, 0.1, 100);
  close(b.value, 1000); assert.equal(b.capped, true); assert.ok(b.loss < 10);
});

test('validate: acepta datos sanos y rechaza malos', () => {
  const ok = { symbol: 'X', t: serie(40, dia), c: serie(40, () => 10), h: serie(40, () => 11), l: serie(40, () => 9) };
  assert.equal(C.validate(ok), true);
  assert.equal(C.validate({ ...ok, c: ok.c.slice(1) }), false);
  assert.equal(C.validate({ ...ok, c: ok.c.map((x, i) => (i ? x : -1)) }), false);
  assert.equal(C.validate({ ...ok, h: ok.h.map((x, i) => (i ? x : '10')) }), false);
  assert.equal(C.validate({ ...ok, t: null }), false);
  assert.equal(C.validate(null), false);
});

test('esc: neutraliza HTML', () => {
  assert.equal(C.esc('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
});
