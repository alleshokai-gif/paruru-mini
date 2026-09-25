'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = source.indexOf('function openHomeMemoFromQuick_()');
const to = source.indexOf('homeMemoQuickOpen?.addEventListener', from);
assert(from >= 0 && to > from, 'quick memo transfer is missing');
const transfer = source.slice(from, to);

function run(allowed, capability, existing, quick) {
  const memoInput = { value: existing, focus() { this.focused = true; } };
  const homeMemoQuickInput = { value: quick };
  const homeMemoDetails = { open: false, scrollIntoView() { this.scrolled = true; } };
  const context = {
    memoInput, homeMemoQuickInput, homeMemoDetails,
    isViewAllowed_: () => allowed,
    hasMembershipCapability_: () => capability,
  };
  vm.runInNewContext(`${transfer}\nopenHomeMemoFromQuick_();`, context);
  return { memoInput, homeMemoQuickInput, homeMemoDetails };
}

const first = run(true, true, '', '買い物メモ');
assert.equal(first.memoInput.value, '買い物メモ');
assert.equal(first.homeMemoQuickInput.value, '');
assert(first.homeMemoDetails.open && first.homeMemoDetails.scrolled && first.memoInput.focused, 'quick input did not open the preserved save form');

const appended = run(true, true, '消さない下書き', '追加メモ');
assert.equal(appended.memoInput.value, '消さない下書き\n追加メモ', 'existing user draft was overwritten');

for (const result of [run(false, true, '既存', '未許可'), run(true, false, '既存', '未許可')]) {
  assert.equal(result.memoInput.value, '既存');
  assert.equal(result.homeMemoQuickInput.value, '未許可');
  assert.equal(result.homeMemoDetails.open, false, 'unavailable memo form was opened');
}

console.log('PASS quick memo preserves drafts and opens only the existing authorized save flow');
