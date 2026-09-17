'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');

test('write-only form has two new-value fields and no current-value representation', () => {
  assert.match(html, /id="newCredential"[^>]+type="password"/);
  assert.match(html, /id="confirmCredential"[^>]+type="password"/);
  assert.doesNotMatch(html, /current credential/i);
  assert.doesNotMatch(html, /\*{4,}/);
  assert.doesNotMatch(html, /show credential|reveal/i);
});

test('submitted input fields are cleared before the stage network request', () => {
  const captureIndex = script.indexOf('const newValue = elements.newCredential.value;');
  const clearIndex = script.indexOf("elements.newCredential.value = '';", captureIndex);
  const requestIndex = script.indexOf("/stage`, {", captureIndex);
  assert(captureIndex >= 0);
  assert(clearIndex > captureIndex);
  assert(requestIndex > clearIndex);
  assert.match(script, /elements\.confirmCredential\.value = '';/);
});

test('browser code has no persistent storage or console logging', () => {
  const forbidden = [['local', 'Storage'].join(''), ['session', 'Storage'].join(''), ['console', '.'].join('')];
  forbidden.forEach((value) => assert.equal(script.includes(value), false, value));
});

test('UI is local-only and mobile controls meet minimum sizing', () => {
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(styles, /min-height:\s*48px/);
  assert.match(styles, /font-size:\s*16px/);
  assert.match(styles, /@media \(max-width: 390px\)/);
  assert.match(styles, /overflow-x:\s*hidden/);
});

test('rotation UI exposes approval, rollback, and redacted audit actions', () => {
  assert.match(script, /Human approval/);
  assert.match(script, /rollback/);
  assert.match(html, /Redacted audit/);
  assert.match(html, /Redacted diagnostics/);
});
