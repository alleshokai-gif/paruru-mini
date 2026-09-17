'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

async function listFiles(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === 'node_modules') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(fullPath));
    else result.push(fullPath);
  }
  return result;
}

test('component contains no production credential name or credential-shaped literal', async () => {
  const files = await listFiles(ROOT);
  const productionName = ['KAZ', 'OS', 'PROGRESS', 'READ', 'TOKEN'].join('_');
  const credentialShapes = [
    /AIza[0-9A-Za-z_-]{20,}/,
    /ya29\.[0-9A-Za-z_-]{10,}/,
    new RegExp(['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ')),
    /eyJ[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]{20,}/,
  ];
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    assert.equal(content.includes(productionName), false);
    assert.equal(credentialShapes.some((pattern) => pattern.test(content)), false);
  }
});

test('isolated Apps Script manifest is trigger-only and uses the minimum scope candidate', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'apps-script', 'appsscript.json'), 'utf8'));
  assert.equal(Object.hasOwn(manifest, 'webapp'), false);
  assert.deepEqual(manifest.oauthScopes, [
    'openid',
    'https://www.googleapis.com/auth/script.external_request',
    'https://www.googleapis.com/auth/script.storage',
  ]);
  assert.equal(manifest.oauthScopes.some((scope) => scope.includes('userinfo.email')), false);
});

test('trigger source exposes no web handler and emits no execution log', async () => {
  const code = await fs.readFile(path.join(ROOT, 'apps-script', 'Code.js'), 'utf8');
  assert.equal(/function\s+do(?:Get|Post)\s*\(/.test(code), false);
  assert.equal(/\b(?:Logger|console)\s*\./.test(code), false);
});

test('repository component contains no generated capture, fixture, state, or environment file', async () => {
  const files = (await listFiles(ROOT)).map((file) => path.relative(ROOT, file).replaceAll('\\', '/'));
  const forbidden = files.filter((file) =>
    /(^|\/)(?:fixtures?|snapshots?|captures?|artifacts?|logs?)(\/|$)/i.test(file)
    || /(?:^|\/)\.env(?:\.|$)/i.test(file)
    || /(?:state|response|token)\.(?:json|log|txt)$/i.test(file));
  assert.deepEqual(forbidden, []);
});
