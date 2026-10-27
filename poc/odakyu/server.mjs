import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { normalize } from './core.mjs';
import { listSnapshots, readSnapshot, latest } from './storage.mjs';
import { reconstructTrips } from './reconstruct.mjs';
import { verifyRecordedChecks } from './verification.mjs';
import { demoModel } from './demo.mjs';
import { datasetModel } from './dataset.mjs';

const root = new URL('./', import.meta.url);
const port = Number(process.env.ODAKYU_POC_PORT || 8767);
const assets = new Map([
  ['/', ['index.html', 'text/html']], ['/style.css', ['style.css', 'text/css']],
  ['/app.mjs', ['app.mjs', 'text/javascript']], ['/core.mjs', ['core.mjs', 'text/javascript']],
  ['/navigation.mjs', ['navigation.mjs', 'text/javascript']]
]);
async function loadModel(snapshot, mode = 'real') {
  if (mode === 'demo') return demoModel();
  if (mode === 'additional') {
    const supplied = JSON.parse(await readFile(new URL('./data/additional-dataset.json', root), 'utf8'));
    if (supplied.kind !== 'additional') throw Error('ADDITIONAL_KIND_INVALID');
    return datasetModel(supplied);
  }
  const [source, rail, stations] = await Promise.all([readSnapshot(snapshot), latest('Railway'), latest('Station')]);
  const model = normalize(source.rows, rail.rows, stations.rows, source.fetchedAt);
  const provider = JSON.parse(await readFile(new URL('../../bus/release-static/kazu-commute-static.json', root), 'utf8'));
  const reconstructed = reconstructTrips(provider, model);
  model.trips = reconstructed.trips.map(t => ({ ...t, datasetId: 'saved-static', dataKind: 'real' }));
  model.dataset = { id: 'saved-static', kind: 'real', title: '保存実データ（部分収録）', dailyReady: false,
    rights: { status: 'ODPT限定条件・既存Static追加利用未確認' }, serviceDates: Object.values(reconstructed.report.sourceDates || {}), coverage: reconstructed.report.coverage };
  model.reconstruction = reconstructed.report;
  let audit = null;
  try { audit = JSON.parse(await readFile(new URL('./data/arrival-audit.json', import.meta.url), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  model.arrivalVerification = verifyRecordedChecks(model.trips, audit);
  model.trips = model.trips.filter(t => !model.arrivalVerification.quarantinedIds.includes(t.id));
  try {
    const reference = JSON.parse(await readFile(new URL('./data/navigation-reference.json', root), 'utf8'));
    model.example = model.trips.some(t => t.id === reference.selectedId) && Number.isInteger(reference.compareAt)
      ? { selectedId: reference.selectedId, compareAt: reference.compareAt } : null;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    model.example = null; // Only the optional replay button is unavailable; train selection remains explicit.
  }
  return model;
}
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'");
  try {
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host)) { response.writeHead(403).end(); return; }
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const asset = assets.get(url.pathname);
    if (asset) {
      response.setHeader('Content-Type', `${asset[1]}; charset=utf-8`);
      response.end(await readFile(new URL(asset[0], root))); return;
    }
    if (url.pathname === '/api/datasets') {
      let additional = false, real = false;
      try { real = (await listSnapshots()).length > 0; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { await access(new URL('./data/additional-dataset.json', root)); additional = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify([
        { id: 'real', title: real ? '保存実データ（部分収録）' : '保存実データ（未配置）', available: real },
        { id: 'demo', title: 'デモ：架空ダイヤ・実運行案内不可', available: true },
        { id: 'additional', title: additional ? '追加データ（読込時に利用条件を検証）' : '追加データ（未配置）', available: additional }
      ])); return;
    }
    if (url.pathname === '/api/snapshots') {
      const result = await Promise.all((await listSnapshots()).map(async id => ({ id, fetchedAt: (await readSnapshot(id)).fetchedAt })));
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result)); return;
    }
    if (url.pathname === '/api/model') {
      const mode = url.searchParams.get('dataset') || 'real';
      if (!['real', 'demo', 'additional'].includes(mode)) { response.writeHead(400).end('DATASET_INVALID'); return; }
      if (mode !== 'real') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(await loadModel(null, mode))); return; }
      const names = await listSnapshots(), id = url.searchParams.get('snapshot') || names[0];
      if (!names.includes(id)) { response.writeHead(400).end('SNAPSHOT_INVALID'); return; }
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(await loadModel(id))); return;
    }
    response.writeHead(404).end('NOT_FOUND');
  } catch {
    response.writeHead(503).end('LOCAL_DATA_UNAVAILABLE');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`ODAKYU_POC_READY http://127.0.0.1:${port}`));
