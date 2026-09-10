import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { buildP0Static, publishStatic, validateArtifact, validateP0Static } from '../scripts/p0-static.js';
import { NOW, staticZip } from './fixtures.js';

const artifact = () => buildP0Static(staticZip(), { now: NOW, sourceDate: '20260828' });
test('generator retains four exact directions, stop/route/service/direction/sequence/time evidence', () => {
  const index = artifact();
  assert.equal(Object.keys(index.directions).length, 4); assert.equal(index.sourceVersion, 'synthetic');
  assert.equal(index.stops['184_2'].name, '合成停留所');
  const row = index.directions.home_to_noborito[0]; assert.equal(row.scheduledSeconds, 28440);
  assert.equal(row.directionId, null);
  assert.equal(row.stopSequence, 1); assert.equal(row.alightSequence, 9);
  validateArtifact(index, '20260828');
});
test('generator rejects missing direction/stop/route/trip/service, broken sequence/time, calendar ambiguity and changed config', () => {
  for (const change of [
    (i) => { delete i.directions.home_to_noborito; }, (i) => { delete i.stops['184_2']; }, (i) => { delete i.routes['10044']; },
    (i) => { i.directions.home_to_noborito = []; }, (i) => { i.directions.home_to_noborito[0].serviceId = 'unknown'; },
    (i) => { i.directions.home_to_noborito[0].alightSequence = 1; }, (i) => { i.directions.home_to_noborito[0].scheduledSeconds = null; },
    (i) => { i.calendar.push(i.calendar[0]); }, (i) => { i.directions.home_to_noborito[0].directionId = 'unsupported'; }
  ]) { const index = artifact(); change(index); assert.throws(() => validateP0Static(index)); }
  const index = artifact(); index.configHash = 'changed'; assert.throws(() => validateArtifact(index, '20260828'));
});
test('failed validation or replacement preserves previous JSON bytes; success saves rollback copy', () => {
  const folder = mkdtempSync(join(tmpdir(), 'paluru-bus-static-test-'));
  assert(resolve(folder).startsWith(resolve(tmpdir()) + sep));
  try {
    const output = join(folder, 'p0-static.json'), index = artifact(); const first = publishStatic(index, output);
    const before = readFileSync(output);
    index.directions.home_to_noborito = [];
    assert.throws(() => publishStatic(index, output)); assert.deepEqual(readFileSync(output), before);
    assert.throws(() => publishStatic(artifact(), output, { beforeReplace() { throw Error('synthetic-write-failure'); } }));
    assert.deepEqual(readFileSync(output), before);
    const next = artifact(); next.generatedAt = '2026-09-10T08:00:00+09:00'; publishStatic(next, output);
    assert(existsSync(join(folder, `previous-${first.sha256.slice(0, 16)}.json`)));
    assert.deepEqual(readFileSync(join(folder, `previous-${first.sha256.slice(0, 16)}.json`)), before);
  } finally { rmSync(folder, { recursive: true }); }
});
test('runtime graph excludes ZIP/parser; Static is injected only at composition root', async () => {
  const result = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['worker/entry.js'], bundle: true,
    write: false, metafile: true, format: 'esm', platform: 'browser', logLevel: 'silent', plugins: [{ name: 'synthetic-static', setup(build) {
      build.onResolve({ filter: /generated\/p0-static\.json$/ }, () => ({ path: 'synthetic-static', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: JSON.stringify(artifact()), loader: 'json' }));
    } }] });
  assert(!Object.keys(result.metafile.inputs).some((p) => /fflate|kawasaki\/static|scripts\//.test(p)));
  assert(!/AllLines\.zip|stop_times\.txt/.test(result.outputFiles[0].text));
});
test('production and development CORS separate; no assets/storage bindings/secrets', () => {
  const prod = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const local = JSON.parse(readFileSync(new URL('../wrangler.local.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(prod.name, 'paluru-bus-api'); assert.equal(prod.vars.ALLOWED_ORIGINS, 'https://alleshokai-gif.github.io');
  assert(!JSON.stringify(prod).includes('localhost')); assert(!JSON.stringify(prod).includes('ODPT_ACCESS_TOKEN'));
  assert(!prod.assets && !prod.kv_namespaces && !prod.r2_buckets); assert.equal(prod.preview_urls, false);
  assert(local.vars.ALLOWED_ORIGINS.includes('http://127.0.0.1:')); assert.equal(local.workers_dev, false);
});
