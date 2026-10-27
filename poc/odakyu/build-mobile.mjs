import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSnapshots } from './storage.mjs';
import { loadModel } from './model.mjs';

const root = new URL('./', import.meta.url);
export function renderMobile({ html, css, core, navigation, app, real, demo, snapshot, createdAt }) {
  if (real?.dataset?.kind !== 'real' || demo?.dataset?.kind !== 'demo' || !Array.isArray(real.trips)
      || !Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(real.fetchedAt))) throw Error('MOBILE_MODEL_INVALID');
  const strip = source => source.replace(/^import[^\n]*\n/gm, '').replace(/^export /gm, '');
  const module = `const { BUILD, TYPES, minutes, clock } = (() => {\n${strip(core)}\nreturn { BUILD, TYPES, minutes, clock };\n})();\n`
    + `const { planNavigation, scheduledPosition, CONNECTION_LABELS } = (() => {\n${strip(navigation)}\nreturn { planNavigation, scheduledPosition, CONNECTION_LABELS };\n})();\n${strip(app)}`;
  if (/^\s*(import|export)\s/m.test(module) || /<\/script/i.test(module) || /<\/style/i.test(css)) throw Error('MOBILE_BUNDLE_UNSUPPORTED');
  const record = { format: 'odakyu-private-offline-v1', createdAt, realUseEndsAt: '2027-03-13T00:00:00+09:00',
    datasets: [{ id: 'real', title: '本人用・保存実データ（部分収録）', available: true },
      { id: 'demo', title: 'デモ：架空ダイヤ・実運行案内不可', available: true },
      { id: 'additional', title: 'この保存版に追加データなし', available: false }],
    snapshots: [{ id: snapshot, fetchedAt: real.fetchedAt }], models: { real, demo } };
  const json = JSON.stringify(record).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'";
  if (!html.includes('<script type="module" src="/app.mjs"></script>') || !html.includes('<link rel="stylesheet" href="/style.css">')) throw Error('MOBILE_TEMPLATE_INVALID');
  return html.replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">`)
    .replace('<body>', '<body data-offline="true">').replace('id="mobile-export"', 'id="mobile-export" hidden')
    .replace('<link rel="stylesheet" href="/style.css">', () => `<style>${css}</style>`)
    .replace('<script type="module" src="/app.mjs"></script>', () => `<script id="offline-data" type="application/json">${json}</script><script type="module">${module}</script>`);
}
async function main() {
  if (Date.now() >= Date.parse('2027-03-13T00:00:00+09:00')) throw Error('ODPT_LICENSE_EXPIRED');
  const snapshot = (await listSnapshots())[0];
  if (!snapshot) throw Error('MOBILE_SNAPSHOT_MISSING');
  const [html, css, core, navigation, app] = await Promise.all(['index.html', 'style.css', 'core.mjs', 'navigation.mjs', 'app.mjs'].map(name => readFile(new URL(name, root), 'utf8')));
  const real = await loadModel(snapshot), demo = await loadModel(null, 'demo');
  const result = renderMobile({ html, css, core, navigation, app, real, demo, snapshot, createdAt: new Date().toISOString() });
  const target = new URL('./data/mobile.html', root), temp = new URL('./data/mobile.html.tmp', root);
  await writeFile(temp, result, 'utf8'); await rename(temp, target);
  if (await readFile(target, 'utf8') !== result) throw Error('MOBILE_READBACK_FAILED');
  console.log(JSON.stringify({ status: 'PASS', realTrips: real.trips.length, demoSegments: demo.trips.length,
    bytes: Buffer.byteLength(result), readback: true, networkRequired: false, published: false }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch { console.error('MOBILE_EXPORT_FAILED'); process.exitCode = 1; }
}
