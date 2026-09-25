'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
assert(index.includes('<textarea id="memo" name="memo" rows="3"'), 'compact memo textarea missing');
assert(index.includes('id="askPaluruButton"') && index.includes('💭 相談する'), 'consult action missing');
assert(index.includes('id="saveToPaluruButton"') && index.includes('📝 登録する'), 'register action missing');
assert(index.includes('id="category" name="category" type="hidden" value=""'), 'category should default to AI');
assert(index.includes('type="hidden" name="priority" value=""'), 'priority should default to AI');
assert(!index.includes('homeMemoQuickOpen') && !index.includes('homeMemoDetails'), 'obsolete expandable memo UI remains');
assert(!app.includes('openHomeMemoFromQuick_'), 'obsolete memo expansion handler remains');
console.log('PASS compact direct memo composer uses existing consult/register flow with AI defaults');
