// Trusted, one-time recovery for a replaced second-son device.  This file is
// intentionally not routed from Code.js and must be run only in the Apps Script editor.
const SECOND_SON_DEVICE_TRANSFER_REPAIR_PROPERTIES = Object.freeze({
  oldDeviceId: 'PALURU_SECOND_SON_TRANSFER_OLD_DEVICE_ID',
  newDeviceId: 'PALURU_SECOND_SON_TRANSFER_NEW_DEVICE_ID',
  pendingRequestId: 'PALURU_SECOND_SON_TRANSFER_PENDING_REQUEST_ID',
});
const SECOND_SON_DEVICE_TRANSFER_HOME_ID = 'paluru-home';
const SECOND_SON_DEVICE_TRANSFER_MEMBER_USER_ID = 'second_son';

function repairSecondSonDeviceTransferDryRun_(input) {
  const config = resolveSecondSonDeviceTransferRepairInput_(input);
  const deps = getHomeControlPairingDependencies_();
  deps.lock.waitLock(5000);
  try {
    // Deliberately do not use withHomeControlRegistryLock_: it persists the Registry
    // even for a read-only callback. A dry-run must perform no writes at all.
    const registry = loadHomeControlRegistry_(deps);
    return inspectSecondSonDeviceTransferRepair_(config, registry, deps.now());
  } finally {
    deps.lock.releaseLock();
  }
}

function repairSecondSonDeviceTransfer_(input) {
  const config = resolveSecondSonDeviceTransferRepairInput_(input);
  let membershipSnapshot = null;
  let registrySnapshot = null;
  let repaired = false;
  const result = withHomeControlRegistryLock_(function(registry, deps) {
    const now = deps.now();
    const before = inspectSecondSonDeviceTransferRepair_(config, registry, now);
    if (before.alreadyRepaired) return createHomeControlRegistryCommitResult_({
      success: true,
      alreadyRepaired: true,
      summary: before,
    });
    if (!before.canRepair) throw homeMembershipError_('DEVICE_TRANSFER_PRECONDITION_FAILED');

    registrySnapshot = cloneSecondSonDeviceTransferValue_(registry);
    membershipSnapshot = snapshotSecondSonDeviceTransferMemberships_(config);
    try {
      const timestamp = homeControlIso_(now);
      disableSecondSonTransferOldMembership_(membershipSnapshot, timestamp);
      createSecondSonTransferNewMembership_(config, timestamp);

      const newRegistryDevice = registry.devices[config.newDeviceId];
      const pendingRequest = registry.requests[config.pendingRequestId];
      newRegistryDevice.status = 'active';
      newRegistryDevice.registeredAt = timestamp;
      newRegistryDevice.lastUsedAt = timestamp;
      newRegistryDevice.revokedAt = null;
      pendingRequest.status = 'approved';
      pendingRequest.approvedAt = timestamp;
      pendingRequest.approvedByDeviceId = 'trusted_repair:second_son_transfer';
      pendingRequest.codeHash = '';
      pendingRequest.codeExpiresAt = null;

      const after = inspectSecondSonDeviceTransferRepair_(config, registry, now);
      if (!after.alreadyRepaired) throw homeMembershipError_('DEVICE_TRANSFER_VERIFICATION_FAILED');
      assertSecondSonDeviceTransferPostconditions_(config);
      repaired = true;
      return createHomeControlRegistryCommitResult_({
        success: true,
        alreadyRepaired: false,
        summary: after,
      }, function() {
        rollbackSecondSonDeviceTransferRepair_(registry, registrySnapshot, membershipSnapshot);
      });
    } catch (error) {
      try {
        rollbackSecondSonDeviceTransferRepair_(registry, registrySnapshot, membershipSnapshot);
      } catch (rollbackError) {
        throw homeMembershipError_('DEVICE_TRANSFER_ROLLBACK_PENDING');
      }
      throw error;
    }
  });
  if (repaired) {
    console.log('[PALURU device-transfer-repair] ' + JSON.stringify({
      event: 'second_son_device_transfer',
      oldDeviceId: config.oldDeviceId,
      newDeviceId: config.newDeviceId,
      pendingRequestId: config.pendingRequestId,
      result: result.summary,
    }));
  }
  return result;
}

function assertSecondSonDeviceTransferPostconditions_(config) {
  const targets = getActiveSelfRecordMembers_(config.homeId).filter(function(target) {
    return target.userId === config.memberUserId;
  });
  const newMembership = getDeviceMembership_(config.newDeviceId);
  const member = getHomeMember_(config.homeId, config.memberUserId);
  if (targets.length !== 1 || !newMembership || newMembership.status !== 'active' ||
      newMembership.homeId !== config.homeId || newMembership.memberUserId !== config.memberUserId ||
      !member || member.status !== 'active' || !isHomeMemberPolicyMatch_(member)) {
    throw homeMembershipError_('DEVICE_TRANSFER_VERIFICATION_FAILED');
  }
}

function resolveSecondSonDeviceTransferRepairInput_(input) {
  const properties = PropertiesService.getScriptProperties();
  const source = input || {};
  const config = {
    homeId: String(source.homeId || SECOND_SON_DEVICE_TRANSFER_HOME_ID).trim(),
    memberUserId: String(source.memberUserId || SECOND_SON_DEVICE_TRANSFER_MEMBER_USER_ID).trim(),
    oldDeviceId: String(source.oldDeviceId || properties.getProperty(SECOND_SON_DEVICE_TRANSFER_REPAIR_PROPERTIES.oldDeviceId) || '').trim(),
    newDeviceId: String(source.newDeviceId || properties.getProperty(SECOND_SON_DEVICE_TRANSFER_REPAIR_PROPERTIES.newDeviceId) || '').trim(),
    pendingRequestId: String(source.pendingRequestId || properties.getProperty(SECOND_SON_DEVICE_TRANSFER_REPAIR_PROPERTIES.pendingRequestId) || '').trim(),
  };
  if (config.homeId !== SECOND_SON_DEVICE_TRANSFER_HOME_ID || config.memberUserId !== SECOND_SON_DEVICE_TRANSFER_MEMBER_USER_ID ||
      !config.oldDeviceId || !config.newDeviceId || config.oldDeviceId === config.newDeviceId || !isSecondSonDeviceTransferRequestId_(config.pendingRequestId)) {
    throw homeMembershipError_('DEVICE_TRANSFER_INVALID_INPUT');
  }
  return config;
}

function inspectSecondSonDeviceTransferRepair_(config, registry, now) {
  const membershipState = readSecondSonDeviceTransferMembershipState_(config);
  const oldRegistry = registry.devices[config.oldDeviceId] || null;
  const newRegistry = registry.devices[config.newDeviceId] || null;
  const pendingRequest = registry.requests[config.pendingRequestId] || null;
  const blockingReasons = [];
  const policyMember = membershipState.homeMembers[0] || null;
  const activeMemberships = membershipState.deviceMemberships.filter(function(row) { return row.status === 'active'; });
  const disabledMemberships = membershipState.deviceMemberships.filter(function(row) { return row.status === 'disabled'; });
  const alreadyRepaired = membershipState.homeMemberCount === 1 && policyMember && policyMember.status === 'active' &&
    membershipState.homeMemberPolicyMatch && activeMemberships.length === 1 && activeMemberships[0].deviceId === config.newDeviceId &&
    membershipState.oldDeviceRows.length === 1 && membershipState.oldDeviceRows[0].status === 'disabled' &&
    membershipState.newDeviceRows.length === 1 && membershipState.newDeviceRows[0].status === 'active' &&
    oldRegistry && oldRegistry.status === 'revoked' && newRegistry && newRegistry.status === 'active' &&
    pendingRequest && pendingRequest.status === 'approved' && pendingRequest.deviceId === config.newDeviceId;

  if (!alreadyRepaired) {
    if (membershipState.homeMemberCount !== 1 || !policyMember || policyMember.status !== 'active' || !membershipState.homeMemberPolicyMatch) blockingReasons.push('HOME_MEMBER_INVALID');
    if (!oldRegistry || oldRegistry.status !== 'revoked') blockingReasons.push('OLD_REGISTRY_NOT_REVOKED');
    if (!newRegistry || newRegistry.status !== 'pending') blockingReasons.push('NEW_REGISTRY_NOT_PENDING');
    if (!pendingRequest || pendingRequest.status !== 'pending' || pendingRequest.kind !== 'pairing' || pendingRequest.deviceId !== config.newDeviceId || !isPendingPairingRequest_(pendingRequest, now)) blockingReasons.push('PENDING_REQUEST_INVALID');
    if (membershipState.oldDeviceRows.length !== 1 || membershipState.oldDeviceRows[0].status !== 'active') blockingReasons.push('OLD_DEVICE_MEMBERSHIP_INVALID');
    if (membershipState.newDeviceRows.length !== 0) blockingReasons.push('NEW_DEVICE_MEMBERSHIP_EXISTS');
    if (activeMemberships.length !== 1 || activeMemberships[0].deviceId !== config.oldDeviceId) blockingReasons.push('ACTIVE_DEVICE_MEMBERSHIPS_INVALID');
  }
  return {
    oldRegistryStatus: oldRegistry ? String(oldRegistry.status || '') : 'missing',
    newRegistryStatus: newRegistry ? String(newRegistry.status || '') : 'missing',
    pendingRequestStatus: pendingRequest ? String(pendingRequest.status || '') : 'missing',
    pendingRequestDeviceId: pendingRequest ? String(pendingRequest.deviceId || '') : '',
    homeMemberCount: membershipState.homeMemberCount,
    homeMemberStatus: policyMember ? String(policyMember.status || '') : 'missing',
    activeDeviceMemberships: activeMemberships.map(secondSonDeviceTransferMembershipSummary_),
    disabledDeviceMemberships: disabledMemberships.map(secondSonDeviceTransferMembershipSummary_),
    canRepair: alreadyRepaired || blockingReasons.length === 0,
    alreadyRepaired: alreadyRepaired,
    blockingReasons: blockingReasons,
  };
}

function readSecondSonDeviceTransferMembershipState_(config) {
  const homeSheet = getRequiredHomeMembershipSheet_(HOME_MEMBERS_SHEET_NAME, HOME_MEMBERS_HEADERS);
  const deviceSheet = getRequiredHomeMembershipSheet_(DEVICE_MEMBERSHIPS_SHEET_NAME, DEVICE_MEMBERSHIPS_HEADERS);
  const homeMembers = secondSonDeviceTransferRows_(homeSheet).filter(function(row) {
    return row.homeId === config.homeId && row.memberUserId === config.memberUserId;
  });
  const deviceMemberships = secondSonDeviceTransferRows_(deviceSheet).filter(function(row) {
    return row.homeId === config.homeId && row.memberUserId === config.memberUserId;
  });
  const policyMember = homeMembers[0] || null;
  return {
    homeMembers: homeMembers,
    homeMemberCount: homeMembers.length,
    homeMemberPolicyMatch: Boolean(policyMember && isHomeMemberPolicyMatch_(policyMember)),
    deviceMemberships: deviceMemberships,
    oldDeviceRows: secondSonDeviceTransferRows_(deviceSheet).filter(function(row) { return row.deviceId === config.oldDeviceId; }),
    newDeviceRows: secondSonDeviceTransferRows_(deviceSheet).filter(function(row) { return row.deviceId === config.newDeviceId; }),
  };
}

function secondSonDeviceTransferRows_(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  return values.slice(1).map(function(row, offset) {
    const item = { rowNumber: offset + 2, values: row.slice() };
    headers.forEach(function(header, index) { item[header] = String(row[index] || ''); });
    return item;
  });
}

function secondSonDeviceTransferMembershipSummary_(row) {
  return { deviceId: String(row.deviceId || ''), status: String(row.status || ''), assignedBy: String(row.assignedBy || '') };
}

function snapshotSecondSonDeviceTransferMemberships_(config) {
  const sheet = getRequiredHomeMembershipSheet_(DEVICE_MEMBERSHIPS_SHEET_NAME, DEVICE_MEMBERSHIPS_HEADERS);
  const rows = secondSonDeviceTransferRows_(sheet);
  return {
    sheet: sheet,
    headers: sheet.getDataRange().getValues()[0].map(String),
    oldRow: rows.filter(function(row) { return row.deviceId === config.oldDeviceId; })[0] || null,
    newRow: rows.filter(function(row) { return row.deviceId === config.newDeviceId; })[0] || null,
    initialLastRow: sheet.getLastRow(),
  };
}

function disableSecondSonTransferOldMembership_(snapshot, timestamp) {
  const statusIndex = snapshot.headers.indexOf('status');
  const updatedAtIndex = snapshot.headers.indexOf('updatedAt');
  if (!snapshot.oldRow || statusIndex < 0 || updatedAtIndex < 0) throw homeMembershipError_('DEVICE_TRANSFER_PRECONDITION_FAILED');
  const row = snapshot.oldRow.values.slice();
  row[statusIndex] = 'disabled';
  row[updatedAtIndex] = timestamp;
  snapshot.sheet.getRange(snapshot.oldRow.rowNumber, 1, 1, snapshot.headers.length).setValues([row]);
}

function createSecondSonTransferNewMembership_(config, timestamp) {
  const sheet = getRequiredHomeMembershipSheet_(DEVICE_MEMBERSHIPS_SHEET_NAME, DEVICE_MEMBERSHIPS_HEADERS);
  const headers = sheet.getDataRange().getValues()[0].map(String);
  const row = new Array(headers.length).fill('');
  const values = {
    deviceId: config.newDeviceId,
    homeId: config.homeId,
    memberUserId: config.memberUserId,
    status: 'active',
    assignedBy: 'trusted_repair:second_son_transfer:' + config.pendingRequestId,
    assignedAt: timestamp,
    updatedAt: timestamp,
  };
  headers.forEach(function(header, index) { if (Object.prototype.hasOwnProperty.call(values, header)) row[index] = values[header]; });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
}

function rollbackSecondSonDeviceTransferRepair_(registry, registrySnapshot, membershipSnapshot) {
  if (!registrySnapshot || !membershipSnapshot || !membershipSnapshot.oldRow || membershipSnapshot.newRow) throw homeMembershipError_('DEVICE_TRANSFER_ROLLBACK_PENDING');
  replaceSecondSonDeviceTransferRegistry_(registry, registrySnapshot);
  membershipSnapshot.sheet.getRange(membershipSnapshot.oldRow.rowNumber, 1, 1, membershipSnapshot.headers.length).setValues([membershipSnapshot.oldRow.values]);
  if (membershipSnapshot.sheet.getLastRow() > membershipSnapshot.initialLastRow) membershipSnapshot.sheet.deleteRow(membershipSnapshot.sheet.getLastRow());
}

function replaceSecondSonDeviceTransferRegistry_(target, snapshot) {
  Object.keys(target).forEach(function(key) { delete target[key]; });
  Object.keys(snapshot).forEach(function(key) { target[key] = cloneSecondSonDeviceTransferValue_(snapshot[key]); });
}

function cloneSecondSonDeviceTransferValue_(value) {
  return JSON.parse(JSON.stringify(value));
}

function isSecondSonDeviceTransferRequestId_(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}
