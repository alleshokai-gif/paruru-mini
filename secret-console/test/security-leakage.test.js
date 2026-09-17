'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

test('component contains no fixture or snapshot artifacts', () => {
  const relative = walk(ROOT).map((file) => path.relative(ROOT, file).replaceAll('\\', '/'));
  assert.equal(relative.some((file) => file.startsWith('fixtures/')), false);
  assert.equal(relative.some((file) => /\.(snap|snapshot)$/i.test(file)), false);
});

test('component source contains no production physical credential names', () => {
  const source = walk(ROOT).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const names = [
    ['KAZ', 'OS', 'PROGRESS', 'READ', 'TOKEN'].join('_'),
    ['OPENAI', 'API', 'KEY'].join('_'),
    ['FAMILY', 'INBOX', 'SERVICE', 'TOKEN'].join('_'),
    ['HEALTH', 'SERVICE', 'TOKEN'].join('_')
  ];
  names.forEach((name) => assert.equal(source.includes(name), false, name));
});

test('credential-shaped leakage scan is zero', () => {
  const source = walk(ROOT).map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const patterns = [
    /\bsk-[A-Za-z0-9_-]{20,}/g,
    /\bAIza[A-Za-z0-9_-]{20,}/g,
    /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
    /\bya29\.[A-Za-z0-9._-]{20,}/g,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/g
  ];
  const matches = patterns.flatMap((pattern) => source.match(pattern) || []);
  assert.equal(matches.length, 0);
});

test('package has no production backend dependency', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(Object.hasOwn(manifest, 'dependencies'), false);
  assert.equal(Object.hasOwn(manifest, 'devDependencies'), false);
});
