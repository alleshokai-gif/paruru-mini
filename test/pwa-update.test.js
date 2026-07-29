'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const gasSource = fs.readFileSync(path.join(root, 'gas', 'Code.js'), 'utf8');
const nurseSource = fs.readFileSync(path.join(root, 'features', 'nurse-okan', 'nurse-okan.js'), 'utf8');

assert(appSource.includes('...buildMemoCredentialPayload("update"), id, ...updates'), 'update payload lost credentials');
assert(appSource.includes('await updateInboxItem(id, { status: "Done" });'), 'Done status changed');
assert(appSource.includes('debugLog("[Paruru] edit update failed"') && appSource.includes('debugLog("[Paruru] complete update failed"'), 'update handlers lack failure handling');
assert(appSource.includes('activeMembershipContext?.role !== "self_record"'), 'health task role gate missing');
assert(appSource.includes('console.error("[Paruru] Inbox update failed"'), 'Inbox update diagnostic log missing');
['action: "update"', 'httpStatus:', 'responseSuccess:', 'responseErrorCode:', 'responseMessage:', 'inboxId:', 'role:', 'hasDeviceId:', 'hasPairingToken:'].forEach((field) => assert(appSource.includes(field), `Inbox update diagnostic field missing: ${field}`));
assert(appSource.includes('error.responseErrorCode = String(result?.error?.code || "").trim();'), 'API error code is not retained');
assert(appSource.includes('error.httpStatus = response.status;'), 'HTTP status is not retained');
assert(appSource.includes('完了できませんでした${code ? `（${code}）` : ""}'), 'completion error code is not shown safely');
assert(!appSource.includes('console.error("[Paruru] Inbox update failed", {\n    action: "update",\n    deviceId:'), 'diagnostic log leaked deviceId');
assert(!appSource.includes('console.error("[Paruru] Inbox update failed", {\n    action: "update",\n    pairingToken:'), 'diagnostic log leaked pairingToken');
assert(appSource.includes('showMessage("保存はできたけど、一覧の更新に失敗したで。", "error")'), 'edit refresh failure is not distinguished');
assert(appSource.includes('showMessage("完了できたけど、一覧の更新に失敗したで。", "error")'), 'complete refresh failure is not distinguished');
assert(appSource.includes('throwOnError: true'), 'refresh failure is swallowed for update flows');
assert(gasSource.includes("if (action === 'update')"), 'update route missing');
assert(gasSource.includes("const prohibited = ['userId', 'userDisplayName', 'ownerUserId', 'createdByUserId', 'role', 'homeId'];"), 'identity allowlist regression');
assert(!gasSource.includes("'deviceId', 'ownerUserId'"), 'deviceId remains forbidden for authenticated update');
assert(!gasSource.includes("'pairingToken'"), 'pairingToken was added to the forbidden identity fields');
assert(gasSource.includes("if (target.item.ownerUserId !== actor.memberUserId) throw homeMembershipError_('FORBIDDEN');"), 'cross-owner rejection missing');
assert(appSource.includes('health.daily.get') && appSource.includes('prependVirtualHealthTask_'), 'health task composition missing');
assert(appSource.includes('action: "daily"') && appSource.includes('healthSlot'), 'health task navigation metadata missing');
assert(nurseSource.includes("new CustomEvent('nurse-okan:daily-saved'"), 'daily save invalidation event missing');
assert(nurseSource.includes('focusPendingOpen_') && nurseSource.includes('scrollIntoView'), 'nurse daily deep focus missing');
console.log('PASS authenticated update payload, Done handler error handling, ownership guard, and fail-closed identity policy');
