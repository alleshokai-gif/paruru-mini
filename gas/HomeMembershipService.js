const HOME_MEMBERS_SHEET_NAME = 'Home_Members';
const DEVICE_MEMBERSHIPS_SHEET_NAME = 'Device_Memberships';
const HOME_MEMBERS_HEADERS = ['homeId', 'memberUserId', 'displayName', 'role', 'status', 'createdAt', 'updatedAt'];
const DEVICE_MEMBERSHIPS_HEADERS = ['deviceId', 'homeId', 'memberUserId', 'status', 'assignedBy', 'assignedAt', 'updatedAt'];
const HOME_MEMBER_ROLES = Object.freeze({ admin: true, self_record: true });
const HOME_MEMBER_STATUS = Object.freeze({ active: true, disabled: true });
const ROLE_CAPABILITIES = Object.freeze({
  admin: Object.freeze(['home.read', 'home.control', 'calendar.family.read', 'calendar.family.create', 'calendar.family.edit_own', 'calendar.family.delete_own', 'memo.self.read', 'memo.self.create', 'memo.self.update', 'memo.self.delete', 'health.self.read', 'health.self.record', 'health.supervision.read', 'health.supervision.record']),
  self_record: Object.freeze(['home.read', 'calendar.family.read', 'calendar.family.create', 'calendar.family.edit_own', 'calendar.family.delete_own', 'memo.self.read', 'memo.self.create', 'memo.self.update', 'memo.self.delete', 'health.self.read', 'health.self.record']),
});
const ROLE_ALLOWED_VIEWS = Object.freeze({
  admin: Object.freeze(['home', 'inbox', 'nurse-okan', 'settings']),
  self_record: Object.freeze(['home', 'inbox', 'nurse-okan']),
});
const HEALTH_OPERATION_CAPABILITIES = Object.freeze({
  'health.context.get': Object.freeze({ self: 'health.self.read', supervision: 'health.supervision.read' }),
  'health.daily.get': Object.freeze({ self: 'health.self.read', supervision: 'health.supervision.read' }),
  'health.weight.list': Object.freeze({ self: 'health.self.read', supervision: 'health.supervision.read' }),
  'health.daily.recordSlot': Object.freeze({ self: 'health.self.record', supervision: 'health.supervision.record' }),
  'health.weight.record': Object.freeze({ self: 'health.self.record', supervision: 'health.supervision.record' }),
});

function ensureMembershipSheets_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  ensureMembershipSheet_(spreadsheet, HOME_MEMBERS_SHEET_NAME, HOME_MEMBERS_HEADERS);
  ensureMembershipSheet_(spreadsheet, DEVICE_MEMBERSHIPS_SHEET_NAME, DEVICE_MEMBERSHIPS_HEADERS);
}

function resolveAuthenticatedActor_(deviceId, pairingToken) {
  try {
    const pairing = verifyHomeControlDevicePairing_(deviceId, pairingToken);
    if (!pairing || pairing.handled !== true || pairing.authorized !== true) throw homeMembershipError_('UNAUTHORIZED_DEVICE');
    const sheet = getRequiredHomeMembershipSheet_(DEVICE_MEMBERSHIPS_SHEET_NAME, DEVICE_MEMBERSHIPS_HEADERS);
    const row = findUniqueHomeMembershipRow_(sheet, 'deviceId', deviceId);
    if (!row || row.status !== 'active') throw homeMembershipError_('MEMBERSHIP_NOT_FOUND');
    const member = getHomeMember_(row.homeId, row.memberUserId);
    if (!member || member.status !== 'active' || !HOME_MEMBER_ROLES[member.role]) throw homeMembershipError_('MEMBERSHIP_NOT_FOUND');
    return { homeId: row.homeId, memberUserId: row.memberUserId, role: member.role, deviceId: String(deviceId) };
  } catch (error) {
    throw homeMembershipError_(error && error.code || 'UNAUTHORIZED_DEVICE');
  }
}

function getHomeMember_(homeId, memberUserId) {
  const sheet = getRequiredHomeMembershipSheet_(HOME_MEMBERS_SHEET_NAME, HOME_MEMBERS_HEADERS);
  const row = findUniqueHomeMembershipRow_(sheet, 'homeId', homeId, 'memberUserId', memberUserId);
  return row ? { homeId: row.homeId, memberUserId: row.memberUserId, displayName: row.displayName, role: row.role, status: row.status } : null;
}

function getDeviceMembership_(deviceId) {
  const sheet = getRequiredHomeMembershipSheet_(DEVICE_MEMBERSHIPS_SHEET_NAME, DEVICE_MEMBERSHIPS_HEADERS);
  const row = findUniqueHomeMembershipRow_(sheet, 'deviceId', deviceId);
  return row ? { deviceId: row.deviceId, homeId: row.homeId, memberUserId: row.memberUserId, status: row.status } : null;
}

function authorizeTargetOperation_(actor, targetUserId, operation) {
  const target = String(targetUserId || '').trim();
  const policy = HEALTH_OPERATION_CAPABILITIES[operation];
  if (!actor || !actor.homeId || !actor.memberUserId || !HOME_MEMBER_ROLES[actor.role] || !policy) throw homeMembershipError_('FORBIDDEN');
  const targetMember = getHomeMember_(actor.homeId, target);
  if (!targetMember || targetMember.status !== 'active' || targetMember.role !== 'self_record') throw homeMembershipError_('FORBIDDEN');
  if (target === actor.memberUserId) return authorizeCapability_(actor, policy.self);
  if (actor.role === 'admin') return authorizeCapability_(actor, policy.supervision);
  throw homeMembershipError_('FORBIDDEN');
}

function authorizeCapability_(actor, capability) {
  if (!actor || !actor.homeId || !actor.memberUserId || !HOME_MEMBER_ROLES[actor.role] || ROLE_CAPABILITIES[actor.role].indexOf(String(capability || '')) < 0) throw homeMembershipError_('FORBIDDEN');
  return true;
}

function getMembershipContext_(body) {
  const input = body || {};
  const actor = resolveAuthenticatedActor_(input.deviceId, input.pairingToken);
  const member = getHomeMember_(actor.homeId, actor.memberUserId);
  if (!member || member.status !== 'active' || !HOME_MEMBER_ROLES[member.role]) throw homeMembershipError_('MEMBERSHIP_NOT_FOUND');
  return { memberUserId: member.memberUserId, displayName: member.displayName, role: member.role, capabilities: ROLE_CAPABILITIES[member.role].slice(), allowedViews: ROLE_ALLOWED_VIEWS[member.role].slice() };
}

function getActiveSelfRecordMembers_(homeId) {
  const sheet = getRequiredHomeMembershipSheet_(HOME_MEMBERS_SHEET_NAME, HOME_MEMBERS_HEADERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const map = headers.reduce(function(out, header, index) { out[header] = index; return out; }, {});
  return values.slice(1).filter(function(row) {
    return String(row[map.homeId] || '') === String(homeId) && String(row[map.status] || '') === 'active' && String(row[map.role] || '') === 'self_record';
  }).map(function(row) { return { userId: String(row[map.memberUserId]), displayName: String(row[map.displayName] || '') }; });
}

function bootstrapPilotHomeMembership_() {
  const properties = PropertiesService.getScriptProperties();
  const homeId = String(properties.getProperty('PALURU_HOME_ID') || '').trim();
  const fatherDeviceId = String(properties.getProperty('PILOT_FATHER_DEVICE_ID') || '').trim();
  const secondSonDeviceId = String(properties.getProperty('PILOT_SECOND_SON_DEVICE_ID') || '').trim();
  if (!homeId || !fatherDeviceId || !secondSonDeviceId) throw homeMembershipError_('CONFIGURATION_ERROR');
  assertBootstrapPairingDevice_(properties, fatherDeviceId);
  assertBootstrapPairingDevice_(properties, secondSonDeviceId);
  ensureMembershipSheets_();
  const now = homeMembershipNow_();
  upsertHomeMember_(homeId, 'father', '父', 'admin', 'active', now);
  upsertHomeMember_(homeId, 'second_son', '次男', 'self_record', 'active', now);
  upsertDeviceMembership_(fatherDeviceId, homeId, 'father', 'active', 'bootstrap', now);
  upsertDeviceMembership_(secondSonDeviceId, homeId, 'second_son', 'active', 'bootstrap', now);
}

function assertBootstrapPairingDevice_(properties, deviceId) {
  const raw = properties.getProperty('PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1');
  if (!raw) throw homeMembershipError_('CONFIGURATION_ERROR');
  let registry;
  try { registry = JSON.parse(raw); } catch (error) { throw homeMembershipError_('CONFIGURATION_ERROR'); }
  const device = registry && registry.devices && registry.devices[String(deviceId)];
  if (!device || String(device.status || '') !== 'active') throw homeMembershipError_('CONFIGURATION_ERROR');
}

function ensureMembershipSheet_(spreadsheet, sheetName, requiredHeaders) {
  const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  const current = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String) : [];
  const missing = requiredHeaders.filter(function(header) { return current.indexOf(header) < 0; });
  if (missing.length) sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
  sheet.setFrozenRows(1);
  return sheet;
}

function getRequiredHomeMembershipSheet_(sheetName, requiredHeaders) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) throw homeMembershipError_('CONFIGURATION_ERROR');
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(String);
  if (requiredHeaders.some(function(header) { return headers.indexOf(header) < 0; })) throw homeMembershipError_('CONFIGURATION_ERROR');
  return sheet;
}

function findHomeMembershipRow_(sheet, firstKey, firstValue, secondKey, secondValue) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const firstIndex = headers.indexOf(firstKey);
  const secondIndex = secondKey ? headers.indexOf(secondKey) : -1;
  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][firstIndex] || '') !== String(firstValue || '')) continue;
    if (secondIndex >= 0 && String(values[index][secondIndex] || '') !== String(secondValue || '')) continue;
    return headers.reduce(function(result, header, column) { result[header] = String(values[index][column] || ''); return result; }, {});
  }
  return null;
}

function findUniqueHomeMembershipRow_(sheet, firstKey, firstValue, secondKey, secondValue) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const firstIndex = headers.indexOf(firstKey);
  const secondIndex = secondKey ? headers.indexOf(secondKey) : -1;
  let match = null;
  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][firstIndex] || '') !== String(firstValue || '')) continue;
    if (secondIndex >= 0 && String(values[index][secondIndex] || '') !== String(secondValue || '')) continue;
    if (match) throw homeMembershipError_('MEMBERSHIP_NOT_FOUND');
    match = headers.reduce(function(result, header, column) { result[header] = String(values[index][column] || ''); return result; }, {});
  }
  return match;
}

function upsertHomeMember_(homeId, memberUserId, displayName, role, status, now) {
  upsertHomeMembershipRow_(HOME_MEMBERS_SHEET_NAME, HOME_MEMBERS_HEADERS, 'homeId', homeId, 'memberUserId', memberUserId, { homeId: homeId, memberUserId: memberUserId, displayName: displayName, role: role, status: status, updatedAt: now, createdAt: now });
}

function upsertDeviceMembership_(deviceId, homeId, memberUserId, status, assignedBy, now) {
  upsertHomeMembershipRow_(DEVICE_MEMBERSHIPS_SHEET_NAME, DEVICE_MEMBERSHIPS_HEADERS, 'deviceId', deviceId, null, null, { deviceId: deviceId, homeId: homeId, memberUserId: memberUserId, status: status, assignedBy: assignedBy, assignedAt: now, updatedAt: now });
}

function upsertHomeMembershipRow_(sheetName, headers, firstKey, firstValue, secondKey, secondValue, values) {
  const sheet = getRequiredHomeMembershipSheet_(sheetName, headers);
  const existing = findHomeMembershipRow_(sheet, firstKey, firstValue, secondKey, secondValue);
  const all = sheet.getDataRange().getValues();
  const headerMap = all[0].map(String).reduce(function(map, header, index) { map[header] = index; return map; }, {});
  const rowNumber = existing ? all.findIndex(function(row, index) { return index > 0 && String(row[headerMap[firstKey]] || '') === String(firstValue || '') && (!secondKey || String(row[headerMap[secondKey]] || '') === String(secondValue || '')); }) + 1 : sheet.getLastRow() + 1;
  const row = existing ? all[rowNumber - 1].slice() : new Array(headers.length).fill('');
  Object.keys(values).forEach(function(key) { if (headerMap[key] !== undefined && (key !== 'createdAt' || !existing)) row[headerMap[key]] = values[key]; });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
}

function homeMembershipNow_() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function homeMembershipError_(code) { const error = new Error(String(code || 'MEMBERSHIP_ERROR')); error.code = String(code || 'MEMBERSHIP_ERROR'); return error; }
