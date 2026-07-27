const HOME_MEMBERS_SHEET_NAME = 'Home_Members';
const DEVICE_MEMBERSHIPS_SHEET_NAME = 'Device_Memberships';
const HOME_MEMBERS_HEADERS = ['homeId', 'memberUserId', 'displayName', 'role', 'status', 'createdAt', 'updatedAt'];
const DEVICE_MEMBERSHIPS_HEADERS = ['deviceId', 'homeId', 'memberUserId', 'status', 'assignedBy', 'assignedAt', 'updatedAt'];
const HOME_MEMBER_ROLES = Object.freeze({ admin: true, guardian: true, self_record: true });
const HOME_MEMBER_STATUS = Object.freeze({ active: true, disabled: true });
const ROLE_CAPABILITIES = Object.freeze({
  admin: Object.freeze(['home.read', 'home.control', 'calendar.family.read', 'calendar.family.create', 'calendar.family.edit_own', 'calendar.family.delete_own', 'memo.self.read', 'memo.self.create', 'memo.self.update', 'memo.self.delete', 'health.self.read', 'health.self.record', 'health.supervision.read', 'health.supervision.record']),
  guardian: Object.freeze(['home.read', 'calendar.family.read', 'calendar.family.create', 'calendar.family.edit_own', 'calendar.family.delete_own', 'memo.self.read', 'memo.self.create', 'memo.self.update', 'memo.self.delete', 'health.self.read', 'health.self.record', 'health.supervision.read', 'health.supervision.record']),
  self_record: Object.freeze(['home.read', 'calendar.family.read', 'calendar.family.create', 'calendar.family.edit_own', 'calendar.family.delete_own', 'memo.self.read', 'memo.self.create', 'memo.self.update', 'memo.self.delete', 'health.self.read', 'health.self.record']),
});
const ROLE_ALLOWED_VIEWS = Object.freeze({
  admin: Object.freeze(['home', 'inbox', 'nurse-okan', 'settings']),
  guardian: Object.freeze(['home', 'inbox', 'nurse-okan']),
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
    if (!member || member.status !== 'active' || !isHomeMemberPolicyMatch_(member) || !HOME_MEMBER_ROLES[member.role]) throw homeMembershipError_('MEMBERSHIP_NOT_FOUND');
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
  return row ? { deviceId: row.deviceId, homeId: row.homeId, memberUserId: row.memberUserId, status: row.status, assignedBy: row.assignedBy } : null;
}

function authorizeTargetOperation_(actor, targetUserId, operation) {
  const target = String(targetUserId || '').trim();
  const policy = HEALTH_OPERATION_CAPABILITIES[operation];
  if (!actor || !actor.homeId || !actor.memberUserId || !HOME_MEMBER_ROLES[actor.role] || !policy) throw homeMembershipError_('FORBIDDEN');
  const targetMember = getHomeMember_(actor.homeId, target);
  if (!targetMember || targetMember.status !== 'active' || !isHomeMemberPolicyMatch_(targetMember)) throw homeMembershipError_('FORBIDDEN');
  if (target === actor.memberUserId) return authorizeCapability_(actor, policy.self);
  if (targetMember.role !== 'self_record') throw homeMembershipError_('FORBIDDEN');
  return authorizeCapability_(actor, policy.supervision);
}

function authorizeCapability_(actor, capability) {
  if (!hasRoleCapability_(actor, capability)) throw homeMembershipError_('FORBIDDEN');
  return true;
}

function hasRoleCapability_(actor, capability) {
  return Boolean(actor && actor.homeId && actor.memberUserId && HOME_MEMBER_ROLES[actor.role] && ROLE_CAPABILITIES[actor.role].indexOf(String(capability || '')) >= 0);
}

function resolveHomeAgentReadActor_(body) {
  const input = body || {};
  const actor = resolveAuthenticatedActor_(input.deviceId, input.pairingToken);
  authorizeCapability_(actor, 'home.read');
  const member = getHomeMember_(actor.homeId, actor.memberUserId);
  if (!member || member.status !== 'active' || !isHomeMemberPolicyMatch_(member)) throw homeMembershipError_('MEMBERSHIP_NOT_FOUND');
  return {
    homeId: actor.homeId,
    memberUserId: actor.memberUserId,
    displayName: member.displayName,
    role: actor.role,
    capabilities: ROLE_CAPABILITIES[actor.role].slice(),
    deviceId: actor.deviceId,
  };
}

function resolveHomeAgentControlActor_(body) {
  const input = body || {};
  const actor = resolveAuthenticatedActor_(input.deviceId, input.pairingToken);
  authorizeCapability_(actor, 'home.control');
  const member = getHomeMember_(actor.homeId, actor.memberUserId);
  if (!member || member.status !== 'active' || !isHomeMemberPolicyMatch_(member)) throw homeMembershipError_('MEMBERSHIP_NOT_FOUND');
  return {
    homeId: actor.homeId,
    memberUserId: actor.memberUserId,
    displayName: member.displayName,
    role: actor.role,
    capabilities: ROLE_CAPABILITIES[actor.role].slice(),
    deviceId: actor.deviceId,
  };
}

function getMembershipContext_(body) {
  const input = body || {};
  const actor = resolveAuthenticatedActor_(input.deviceId, input.pairingToken);
  const member = getHomeMember_(actor.homeId, actor.memberUserId);
  if (!member || member.status !== 'active' || !isHomeMemberPolicyMatch_(member) || !HOME_MEMBER_ROLES[member.role]) throw homeMembershipError_('MEMBERSHIP_NOT_FOUND');
  const policy = getHomeMemberPolicy_(member.memberUserId);
  return { memberUserId: member.memberUserId, displayName: member.displayName, role: member.role, calendarSuffix: policy.calendarSuffix, capabilities: ROLE_CAPABILITIES[member.role].slice(), allowedViews: ROLE_ALLOWED_VIEWS[member.role].slice() };
}

function getActiveSelfRecordMembers_(homeId) {
  const sheet = getRequiredHomeMembershipSheet_(HOME_MEMBERS_SHEET_NAME, HOME_MEMBERS_HEADERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const map = headers.reduce(function(out, header, index) { out[header] = index; return out; }, {});
  return values.slice(1).filter(function(row) {
    return String(row[map.homeId] || '') === String(homeId) && String(row[map.status] || '') === 'active' && isHomeMemberPolicyMatch_({ memberUserId: row[map.memberUserId], displayName: row[map.displayName], role: row[map.role] }) && String(row[map.role] || '') === 'self_record';
  }).map(function(row) {
    const policy = getHomeMemberPolicy_(row[map.memberUserId]);
    return { userId: policy.memberUserId, displayName: policy.displayName };
  });
}

// This helper is called while DevicePairingService already owns the Script Lock.
// It must use the supplied Registry object and must not call resolveAuthenticatedActor_,
// because that function acquires the Registry Lock again.
function resolveMembershipApprovalAdminWithinRegistryLock_(deviceId, pairingToken, registry, deps, now) {
  verifyHomeControlRegistryDevice_(deviceId, pairingToken, registry, deps, now);
  const device = getDeviceMembership_(deviceId);
  if (!device || device.status !== 'active') throw homeMembershipError_('MEMBERSHIP_NOT_FOUND');
  const member = getHomeMember_(device.homeId, device.memberUserId);
  if (!member || member.status !== 'active' || !isHomeMemberPolicyMatch_(member) || member.role !== 'admin') throw homeMembershipError_('FORBIDDEN');
  return { homeId: member.homeId, memberUserId: member.memberUserId, role: member.role, deviceId: String(deviceId) };
}

function getMembershipApprovalTemplate_(templateName) {
  const policy = getHomeMemberPolicyByApprovalTemplate_(templateName);
  if (!policy) throw homeMembershipError_('INVALID_MEMBERSHIP_TEMPLATE');
  return {
    memberUserId: policy.memberUserId,
    displayName: policy.displayName,
    role: policy.role,
    requiresExistingMember: policy.registrationMode === HOME_MEMBER_REGISTRATION_MODES.EXISTING_MEMBER_ONLY,
  };
}

function getMembershipApprovalAssignment_(serverOperationId) {
  const operationId = String(serverOperationId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(operationId)) throw homeMembershipError_('INVALID_MEMBERSHIP_OPERATION');
  return 'pairing_approval:' + operationId;
}

function getMembershipApprovalDeviceState_(device, homeId, template, assignment) {
  if (!device) return 'missing';
  if (device.homeId !== homeId || device.memberUserId !== template.memberUserId || device.assignedBy !== assignment) {
    throw homeMembershipError_('MEMBERSHIP_CONFLICT');
  }
  if (device.status === 'disabled' || device.status === 'active') return device.status;
  throw homeMembershipError_('MEMBERSHIP_CONFLICT');
}

function assertExistingMembershipApprovalMember_(member, template) {
  if (!member || !isHomeMemberPolicyMatch_(member) || member.role !== template.role || (member.status !== 'active' && member.status !== 'disabled')) {
    throw homeMembershipError_('MEMBERSHIP_CONFLICT');
  }
}

// This helper intentionally accepts only a server-resolved admin actor, a target device,
// a fixed template, and a server-resolved Registry request id. Client userId, role, homeId,
// capability values, and operation ids are not inputs.
function provisionMembershipFromApprovalTemplateWithinRegistryLock_(adminActor, targetDeviceId, templateName, serverOperationId, now) {
  if (!adminActor || adminActor.role !== 'admin' || !adminActor.homeId || !adminActor.memberUserId) throw homeMembershipError_('FORBIDDEN');
  const deviceId = String(targetDeviceId || '').trim();
  if (!deviceId) throw homeMembershipError_('INVALID_MEMBERSHIP_TARGET');
  const template = getMembershipApprovalTemplate_(templateName);
  const assignment = getMembershipApprovalAssignment_(serverOperationId);
  const homeId = String(adminActor.homeId);
  let createdHomeMember = false;
  let provisioningStarted = false;

  try {
    const existingDevice = getDeviceMembership_(deviceId);
    const deviceState = getMembershipApprovalDeviceState_(existingDevice, homeId, template, assignment);
    const existingMember = getHomeMember_(homeId, template.memberUserId);
    if (template.requiresExistingMember) {
      if (!existingMember || existingMember.status !== 'active' || !isHomeMemberPolicyMatch_(existingMember) || existingMember.role !== template.role) {
        throw homeMembershipError_('MEMBERSHIP_NOT_FOUND');
      }
    } else {
      if (deviceState === 'missing') {
        if (existingMember) throw homeMembershipError_('MEMBERSHIP_CONFLICT');
      } else if (existingMember) {
        assertExistingMembershipApprovalMember_(existingMember, template);
      }
    }

    if (deviceState === 'active') {
      if (!template.requiresExistingMember && (!existingMember || existingMember.status !== 'active')) {
        if (existingMember) assertExistingMembershipApprovalMember_(existingMember, template);
        provisioningStarted = true;
        upsertHomeMember_(homeId, template.memberUserId, existingMember ? existingMember.displayName : template.displayName, template.role, 'active', now);
      }
      return { memberUserId: template.memberUserId, role: template.role, deviceId: deviceId, status: 'active' };
    }

    if (deviceState === 'missing') {
      provisioningStarted = true;
      upsertDeviceMembership_(deviceId, homeId, template.memberUserId, 'disabled', assignment, now);
    }

    const pendingDevice = getDeviceMembership_(deviceId);
    if (getMembershipApprovalDeviceState_(pendingDevice, homeId, template, assignment) !== 'disabled') {
      throw homeMembershipError_('MEMBERSHIP_CONFLICT');
    }

    let confirmedMember = getHomeMember_(homeId, template.memberUserId);
    if (!template.requiresExistingMember && !confirmedMember) {
      provisioningStarted = true;
      upsertHomeMember_(homeId, template.memberUserId, template.displayName, template.role, 'active', now);
      createdHomeMember = true;
      confirmedMember = getHomeMember_(homeId, template.memberUserId);
    } else if (!template.requiresExistingMember && confirmedMember && confirmedMember.status === 'disabled') {
      assertExistingMembershipApprovalMember_(confirmedMember, template);
      provisioningStarted = true;
      upsertHomeMember_(homeId, template.memberUserId, confirmedMember.displayName, template.role, 'active', now);
      confirmedMember = getHomeMember_(homeId, template.memberUserId);
    }
    if (!confirmedMember || confirmedMember.status !== 'active' || !isHomeMemberPolicyMatch_(confirmedMember) || confirmedMember.role !== template.role) throw homeMembershipError_('MEMBERSHIP_CONFLICT');

    provisioningStarted = true;
    upsertDeviceMembership_(deviceId, homeId, template.memberUserId, 'active', assignment, now);
    return { memberUserId: template.memberUserId, role: template.role, deviceId: deviceId, status: 'active' };
  } catch (error) {
    if (!provisioningStarted) throw error;
    try {
      rollbackMembershipApprovalProvision_(homeId, template, deviceId, assignment, createdHomeMember, now);
    } catch (rollbackError) {
      throw homeMembershipError_('MEMBERSHIP_ROLLBACK_PENDING');
    }
    throw error;
  }
}

function rollbackMembershipApprovalProvision_(homeId, template, deviceId, assignment, createdHomeMember, now) {
  const device = getDeviceMembership_(deviceId);
  if (device && device.homeId === homeId && device.memberUserId === template.memberUserId && device.assignedBy === assignment && device.status === 'active') {
    upsertDeviceMembership_(deviceId, homeId, template.memberUserId, 'disabled', assignment, now);
  }
  if (createdHomeMember) {
    const member = getHomeMember_(homeId, template.memberUserId);
    if (member && member.status === 'active' && member.role === template.role) {
      upsertHomeMember_(homeId, template.memberUserId, member.displayName, template.role, 'disabled', now);
    }
  }
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
