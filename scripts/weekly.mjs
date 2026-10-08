// Convierte el texto del informe semanal en temas y activos con las mismas reglas del análisis de apertura (no copia el texto).
import fs from 'node:fs';
import { analyze } from '../worker/worker.mjs';

export function buildWeekly(text, meta) {
  const limpio = String(text).replace(/\s+/g, ' ');
  const a = analyze(limpio);
  const f = /([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(limpio);
  return { source: 'J.P. Morgan Asset Management', url: meta.url, fecha: f ? f[1] : '', actualizado: meta.now, temas: a.temas, empresas: a.empresas,
    aviso: 'Lectura automática por reglas simples del informe semanal; no es un resumen redactado ni una recomendación. El informe original es de J.P. Morgan Asset Management.' };
}

if (process.argv[1] && process.argv[1].endsWith('weekly.mjs')) {
  const [, , txt, url] = process.argv;
  fs.mkdirSync('site/data', { recursive: true });
  fs.writeFileSync('site/data/weekly.json', JSON.stringify(buildWeekly(fs.readFileSync(txt, 'utf8'), { url, now: new Date().toISOString() })));
}
