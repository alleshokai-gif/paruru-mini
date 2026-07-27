'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const policySource = fs.readFileSync(path.join(root, 'gas', 'HomeMemberPolicy.js'), 'utf8');
const codeSource = fs.readFileSync(path.join(root, 'gas', 'Code.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert(from >= 0 && to > from, `source boundary missing: ${start}`);
  return source.slice(from, to);
}

const gasContext = { Object, String };
vm.createContext(gasContext);
vm.runInContext(policySource, gasContext);
vm.runInContext(between(codeSource, 'function buildNotificationMessage_', 'function shouldShowInToday_'), gasContext);

assert.strictEqual(gasContext.getHomeMemberAddress_('paruru', 'father'), '兄弟');
assert.strictEqual(gasContext.getHomeMemberAddress_('nurseOkan', 'father'), 'お父さん');
assert.strictEqual(gasContext.getHomeMemberAddress_('paruru', 'second_son'), 'ふうが');
assert.strictEqual(gasContext.getHomeMemberAddress_('nurseOkan', 'second_son'), 'ふうちゃん');
assert.strictEqual(gasContext.getHomeMemberAddress_('paruru', 'mother'), '');
assert.strictEqual(gasContext.getHomeMemberAddress_('unknownCharacter', 'father'), '');
assert.deepStrictEqual(JSON.parse(JSON.stringify(gasContext.getHomeMemberAddressTerms_('unknown_member'))), { paruru: '', nurseOkan: '' });

assert.strictEqual(gasContext.buildNotificationMessage_('提出物', ['due_today'], { memberUserId: 'father' }), '兄弟、提出物は今日まで。僕は覚えとったよ。');
assert.strictEqual(gasContext.buildNotificationMessage_('提出物', ['due_today'], { memberUserId: 'second_son' }), 'ふうが、提出物は今日まで。僕は覚えとったよ。');
assert.strictEqual(gasContext.buildNotificationMessage_('提出物', ['due_today'], { memberUserId: 'unknown_member' }), '提出物は今日まで。僕は覚えとったよ。');
assert.strictEqual(gasContext.buildNotificationMessage_('提出物', ['due_today']), '提出物は今日まで。僕は覚えとったよ。');

const appContext = {
  activeMembershipContext: { addressTerms: { paruru: '兄弟' } },
  String,
};
vm.createContext(appContext);
const formatSource = between(appSource, 'function formatParuruLine_', 'function resetParuruSpeechSoon');
vm.runInContext(formatSource, appContext);
assert.strictEqual(appContext.formatParuruLine_('{{address}}、今日は気にしとくことあるよ。'), '兄弟、今日は気にしとくことあるよ。');
assert.strictEqual(appContext.formatParuruLine_('今日は急ぎなし。珍しいね、{{address}}。'), '今日は急ぎなし。珍しいね、兄弟。');
appContext.activeMembershipContext = { addressTerms: { paruru: 'ふうが' } };
assert.strictEqual(appContext.formatParuruLine_('{{address}}、ひとつ気にしといて。'), 'ふうが、ひとつ気にしといて。');
appContext.activeMembershipContext = { addressTerms: { paruru: '' } };
assert.strictEqual(appContext.formatParuruLine_('{{address}}、ひとつ気にしといて。'), 'ひとつ気にしといて。');
assert.strictEqual(appContext.formatParuruLine_('今日は急ぎなし。珍しいね、{{address}}。'), '今日は急ぎなし。珍しいね。');
assert(!formatSource.includes('userProfile') && !formatSource.includes('displayName') && !formatSource.includes('userId'), 'PWA address formatter trusts client profile fields');
assert(appSource.includes('addressTerms: Object.assign({}, membershipContext.addressTerms || {})'), 'server-resolved address terms were not retained');

console.log('PASS member address policy, safe fallback, server notification, and PWA context-only formatting');
