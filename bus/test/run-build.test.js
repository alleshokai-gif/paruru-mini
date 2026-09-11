import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Node runtime graph contains no GTFS ZIP/CSV/build/Worker/secret-file dependency', async () => {
  const result = await build({ entryPoints: [new URL('../runtime/start.js', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')],
    bundle: true, platform: 'node', format: 'esm', write: false, metafile: true, logLevel: 'silent' });
  const paths = Object.keys(result.metafile.inputs).join('\n');
  for (const forbidden of ['fflate', '/worker/', '/scripts/', '.dev.vars', '/kawasaki/static']) assert.ok(!paths.includes(forbidden));
  assert.ok(paths.includes('core/service.js')); assert.ok(paths.includes('http/handler.js'));
  const runtime = ['runtime/start.js', 'runtime/server.js', 'core/service.js', 'http/handler.js'].map(read).join('\n');
  assert.ok(!runtime.includes('caches.default')); assert.ok(!runtime.includes('.dev.vars'));
});

test('remote image context is allowlisted; build never deploys or requests real secrets', () => {
  const docker = read('Dockerfile'), cloud = read('cloudbuild.yaml');
  assert.match(docker, /USER node/); assert.match(docker, /npm ci --omit=dev/);
  assert.ok(!docker.includes('ODPT_ACCESS_TOKEN')); assert.ok(!docker.includes('COPY . .'));
  for (const name of ['.dockerignore', '.gcloudignore']) {
    const value = read(name);
    assert.match(value, /^\*\*\r?\n/); assert.ok(value.includes('!generated/p0-static.json'));
    for (const file of ['config.js', 'attribution.js', 'context.js', 'position-reference.js']) {
      assert.ok(value.includes(`!providers/kawasaki/${file}`));
      assert.ok(docker.includes(`providers/kawasaki/${file}`));
    }
    for (const forbidden of ['!.dev.vars', '!node_modules', '!scripts', '!test', '!worker', '!generated/**', '!.git']) assert.ok(!value.includes(forbidden));
  }
  assert.ok(!/gcloud\s+run|availableSecrets|secretEnv|set-secrets/.test(cloud));
  assert.match(cloud, /synthetic-build-health-only/); assert.match(cloud, /\/health/);
});
