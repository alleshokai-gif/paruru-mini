'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const gasSource = fs.readFileSync(path.join(root, 'gas', 'Code.js'), 'utf8');

assert(appSource.includes('...buildMemoCredentialPayload("update"), id, ...updates'), 'update payload lost credentials');
assert(appSource.includes('await updateInboxItem(id, { status: "Done" });'), 'Done status changed');
assert(appSource.includes('debugLog("[Paruru] edit update failed"') && appSource.includes('debugLog("[Paruru] complete update failed"'), 'update handlers lack failure handling');
assert(appSource.includes('showMessage("保存はできたけど、一覧の更新に失敗したで。", "error")'), 'edit refresh failure is not distinguished');
assert(appSource.includes('showMessage("完了できたけど、一覧の更新に失敗したで。", "error")'), 'complete refresh failure is not distinguished');
assert(appSource.includes('throwOnError: true'), 'refresh failure is swallowed for update flows');
assert(gasSource.includes("if (action === 'update')"), 'update route missing');
assert(gasSource.includes("const prohibited = ['userId', 'userDisplayName', 'ownerUserId', 'createdByUserId', 'role', 'homeId'];"), 'identity allowlist regression');
assert(!gasSource.includes("'deviceId', 'ownerUserId'"), 'deviceId remains forbidden for authenticated update');
assert(!gasSource.includes("'pairingToken'"), 'pairingToken was added to the forbidden identity fields');
assert(gasSource.includes("if (target.item.ownerUserId !== actor.memberUserId) throw homeMembershipError_('FORBIDDEN');"), 'cross-owner rejection missing');
console.log('PASS authenticated update payload, Done handler error handling, ownership guard, and fail-closed identity policy');
