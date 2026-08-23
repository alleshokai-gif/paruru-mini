// Legacy migration / emergency recovery only for a replaced second-son device.
// This file is intentionally not routed from Code.js and must not be used by the
// normal multi-device registration path. Run it only from the Apps Script editor.
const SECOND_SON_DEVICE_TRANSFER_REPAIR_PROPERTIES = Object.freeze({
  oldDeviceId: 'PALURU_SECOND_SON_TRANSFER_OLD_DEVICE_ID',
  pairingCode: 'PALURU_SECOND_SON_TRANSFER_PAIRING_CODE',
});
const SECOND_SON_DEVICE_TRANSFER_HOME_ID = 'paluru-home';
const SECOND_SON_DEVICE_TRANSFER_MEMBER_USER_ID = 'second_son';

function repairSecondSonDeviceTransferPreflight(input) {
  const config = resolveSecondSonDeviceTransferPreflightInput_(input);
  const deps = getHomeControlPairingDependencies_();
  deps.lock.waitLock(5000);
  try {
    // Do not use withHomeControlRegistryLock_: preflight must never persist Registry.
    const report = inspectSecondSonDeviceTransferPreflight_(config, loadHomeControlRegistry_(deps));
    logSecondSonDeviceTransferPreflight_(report);
    return report;
  } finally {
    deps.lock.releaseLock();
  }
}

function logSecondSonDeviceTransferPreflight_(report) {
  const reasons = Array.isArray(report && report.blockingReasons) ? report.blockingReasons : [];
  const activeMemberships = Array.isArray(report && report.activeDeviceMemberships) ? report.activeDeviceMemberships : [];
  console.log('[SecondSonTransfer Preflight] JSON\n' + JSON.stringify(report));
  if (report && report.canStartTransfer) {
    console.log([
      '[SecondSonTransfer Preflight]',
      'RESULT: READY',
      'canStartTransfer: true',
      'blockingReasons: none',
      'oldRegistryStatus: ' + String(report.oldRegistryStatus || 'missing'),
      'homeMemberCount: ' + String(report.homeMemberCount || 0),
      'activeDeviceMemberships: ' + String(activeMemberships.length),
      '',
      'NEXT:',
      String(report.instructions || '次男Chromeで新しい6桁コードを発行してください'),
    ].join('\n'));
    return;
  }
  console.log([
    '[SecondSonTransfer Preflight]',
    'RESULT: BLOCKED',
    'canStartTransfer: false',
    '',
    'REASONS:',
    reasons.length ? reasons.map(function(reason) { return '- ' + reason; }).join('\n') : '- UNKNOWN',
    '',
    '次男にはまだコード発行を依頼しないでください。',
  ].join('\n'));
}

function repairSecondSonDeviceTransferDryRun_(input) {
  const config = resolveSecondSonDeviceTransferRepairInput_(input);
  const deps = getHomeControlPairingDependencies_();
  deps.lock.waitLock(5000);
  try {
    // Deliberately do not use withHomeControlRegistryLock_: it persists the Registry
    // even for a read-only callback. A dry-run must perform no writes at all.
    const registry = loadHomeControlRegistry_(deps);
    return inspectSecondSonDeviceTransferRepairFromInput_(config, registry, deps, deps.now());
  } finally {
    deps.lock.releaseLock();
  }
}

// Public Apps Script editor entry point. Keep the mutable implementation private so
// tests can supply controlled input without exposing it in the manual function picker.
function repairSecondSonDeviceTransfer() {
  try {
    const result = repairSecondSonDeviceTransfer_();
    logSecondSonDeviceTransferExecution_(result);
    return result;
  } catch (error) {
    const code = String(error && error.code || 'DEVICE_TRANSFER_FAILED');
    logSecondSonDeviceTransferExecution_({ success: false, error: { code: code } });
    throw error;
  }
}

function logSecondSonDeviceTransferExecution_(result) {
  const success = Boolean(result && result.success);
  const alreadyRepaired = Boolean(result && result.alreadyRepaired);
  const code = String(result && result.error && result.error.code || '');
  console.log('[SecondSonTransfer Execute] JSON\n' + JSON.stringify(result || { success: false }));
  console.log([
    '[SecondSonTransfer Execute]',
    'RESULT: ' + (success ? (alreadyRepaired ? 'ALREADY_REPAIRED' : 'COMPLETED') : 'BLOCKED'),
    'success: ' + String(success),
    success ? 'pairingCodeProperty: cleared' : 'errorCode: ' + (code || 'DEVICE_TRANSFER_FAILED'),
    success
      ? 'NEXT: 次男Chromeを再表示して、active_memberとして起動することを確認してください。'
      : '次男には追加操作を依頼せず、実行ログのerrorCodeを確認してください。',
  ].join('\n'));
}

function repairSecondSonDeviceTransfer_(input) {
  const config = resolveSecondSonDeviceTransferRepairInput_(input);
  let membershipSnapshot = null;
  let registrySnapshot = null;
  let repaired = false;
  const result = withHomeControlRegistryLock_(function(registry, deps) {
    const now = deps.now();
    if (config.inputMode === 'direct_internal') {
      const directBefore = inspectSecondSonDeviceTransferRepair_(config, registry, now);
      if (directBefore.alreadyRepaired) return createHomeControlRegistryCommitResult_({
        success: true,
        alreadyRepaired: true,
        summary: directBefore,
      });
    }
    const preflight = inspectSecondSonDeviceTransferPreflight_(config, registry);
    if (!preflight.canStartTransfer) throw homeMembershipError_('DEVICE_TRANSFER_PRECONDITION_FAILED');
    const resolved = resolveSecondSonDeviceTransferRepairRequest_(config, registry, deps, now);
    if (!resolved.success) throw homeMembershipError_('DEVICE_TRANSFER_PRECONDITION_FAILED');
    const resolvedConfig = resolved.config;
    const before = inspectSecondSonDeviceTransferRepair_(resolvedConfig, registry, now);
    if (before.alreadyRepaired) return createHomeControlRegistryCommitResult_({
      success: true,
      alreadyRepaired: true,
      summary: before,
    });
    if (!before.canRepair) throw homeMembershipError_('DEVICE_TRANSFER_PRECONDITION_FAILED');

    registrySnapshot = cloneSecondSonDeviceTransferValue_(registry);
    membershipSnapshot = snapshotSecondSonDeviceTransferMemberships_(resolvedConfig);
    try {
      const timestamp = homeControlIso_(now);
      disableSecondSonTransferOldMembership_(membershipSnapshot, timestamp);
      createSecondSonTransferNewMembership_(resolvedConfig, timestamp);

      const newRegistryDevice = registry.devices[resolvedConfig.newDeviceId];
      const pendingRequest = registry.requests[resolvedConfig.pendingRequestId];
      newRegistryDevice.status = 'active';
      newRegistryDevice.registeredAt = timestamp;
      newRegistryDevice.lastUsedAt = timestamp;
      newRegistryDevice.revokedAt = null;
      pendingRequest.status = 'approved';
      pendingRequest.approvedAt = timestamp;
      pendingRequest.approvedByDeviceId = 'trusted_repair:second_son_transfer';
      pendingRequest.codeHash = '';
      pendingRequest.codeExpiresAt = null;

      const after = inspectSecondSonDeviceTransferRepair_(resolvedConfig, registry, now);
      if (!after.alreadyRepaired) throw homeMembershipError_('DEVICE_TRANSFER_VERIFICATION_FAILED');
      assertSecondSonDeviceTransferPostconditions_(resolvedConfig);
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
    PropertiesService.getScriptProperties().deleteProperty(SECOND_SON_DEVICE_TRANSFER_REPAIR_PROPERTIES.pairingCode);
    console.log('[PALURU device-transfer-repair] ' + JSON.stringify({
      event: 'second_son_device_transfer',
      oldDeviceId: config.oldDeviceId,
      newDeviceId: result.summary.pendingRequestDeviceId,
      pendingRequestId: result.summary.pendingRequestId,
      result: result.summary,
    }));
  }
  return result;
}

function resolveSecondSonDeviceTransferPreflightInput_(input) {
  const properties = PropertiesService.getScriptProperties();
  const source = input || {};
  const config = {
    homeId: String(source.homeId || SECOND_SON_DEVICE_TRANSFER_HOME_ID).trim(),
    memberUserId: String(source.memberUserId || SECOND_SON_DEVICE_TRANSFER_MEMBER_USER_ID).trim(),
    oldDeviceId: String(source.oldDeviceId || properties.getProperty(SECOND_SON_DEVICE_TRANSFER_REPAIR_PROPERTIES.oldDeviceId) || '').trim(),
  };
  if (config.homeId !== SECOND_SON_DEVICE_TRANSFER_HOME_ID || config.memberUserId !== SECOND_SON_DEVICE_TRANSFER_MEMBER_USER_ID || !config.oldDeviceId) {
    throw homeMembershipError_('DEVICE_TRANSFER_INVALID_INPUT');
  }
  return config;
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
    newDeviceId: String(source.newDeviceId || '').trim(),
    pendingRequestId: String(source.pendingRequestId || '').trim(),
    pairingCode: String(source.pairingCode || properties.getProperty(SECOND_SON_DEVICE_TRANSFER_REPAIR_PROPERTIES.pairingCode) || '').trim(),
  };
  const hasDirectInternalInput = Boolean(config.newDeviceId && config.pendingRequestId);
  if (config.homeId !== SECOND_SON_DEVICE_TRANSFER_HOME_ID || config.memberUserId !== SECOND_SON_DEVICE_TRANSFER_MEMBER_USER_ID || !config.oldDeviceId ||
      (hasDirectInternalInput && (config.oldDeviceId === config.newDeviceId || !isSecondSonDeviceTransferRequestId_(config.pendingRequestId))) ||
      (!hasDirectInternalInput && !/^\d{6}$/.test(config.pairingCode))) {
    throw homeMembershipError_('DEVICE_TRANSFER_INVALID_INPUT');
  }
  config.inputMode = hasDirectInternalInput ? 'direct_internal' : 'pairing_code';
  return config;
}

function inspectSecondSonDeviceTransferPreflight_(config, registry) {
  const membershipState = readSecondSonDeviceTransferMembershipState_(Object.assign({}, config, { newDeviceId: '' }));
  const oldRegistry = registry.devices[config.oldDeviceId] || null;
  const policyMember = membershipState.homeMembers[0] || null;
  const activeMemberships = membershipState.deviceMemberships.filter(function(row) { return row.status === 'active'; });
  const oldDeviceRows = membershipState.oldDeviceRows;
  const blockingReasons = [];
  const hasAlreadyRepairedState = oldDeviceRows.length === 1 && oldDeviceRows[0].status === 'disabled' &&
    activeMemberships.length === 1 && activeMemberships[0].deviceId !== config.oldDeviceId;

  if (membershipState.homeMemberCount !== 1 || !policyMember || policyMember.status !== 'active' || !membershipState.homeMemberPolicyMatch) blockingReasons.push('HOME_MEMBER_INVALID');
  if (!oldRegistry || oldRegistry.status !== 'revoked') blockingReasons.push('OLD_REGISTRY_NOT_REVOKED');
  if (hasAlreadyRepairedState) blockingReasons.push('TRANSFER_ALREADY_REPAIRED');
  if (oldDeviceRows.length !== 1 || oldDeviceRows[0].status !== 'active') blockingReasons.push('OLD_DEVICE_MEMBERSHIP_INVALID');
  if (activeMemberships.length !== 1 || activeMemberships[0].deviceId !== config.oldDeviceId) blockingReasons.push('ACTIVE_DEVICE_MEMBERSHIPS_INVALID');
  if (membershipState.deviceMemberships.some(function(row) { return row.deviceId !== config.oldDeviceId; })) blockingReasons.push('DEVICE_MEMBERSHIP_CONFLICT');
  if (oldDeviceRows.length === 1 && oldDeviceRows[0].status === 'disabled' && !hasAlreadyRepairedState) blockingReasons.push('TRANSFER_ROLLBACK_PENDING');

  return {
    canStartTransfer: blockingReasons.length === 0,
    blockingReasons: blockingReasons,
    oldRegistryStatus: oldRegistry ? String(oldRegistry.status || '') : 'missing',
    homeMemberCount: membershipState.homeMemberCount,
    activeDeviceMemberships: activeMemberships.map(secondSonDeviceTransferMembershipSummary_),
    instructions: blockingReasons.length === 0
      ? '次男Chromeで新しい6桁コードを発行してください'
      : 'blockingReasonsを解消してから、もう一度Preflightを実行してください',
  };
}

function inspectSecondSonDeviceTransferRepairFromInput_(config, registry, deps, now) {
  const resolved = resolveSecondSonDeviceTransferRepairRequest_(config, registry, deps, now);
  if (!resolved.success) return createSecondSonDeviceTransferResolutionFailureReport_(config, registry, resolved);
  const report = inspectSecondSonDeviceTransferRepair_(resolved.config, registry, now);
  report.pendingRequestId = resolved.config.pendingRequestId;
  report.pairingCode = maskSecondSonTransferPairingCode_(config.pairingCode);
  return report;
}

function resolveSecondSonDeviceTransferRepairRequest_(config, registry, deps, now) {
  if (config.inputMode === 'direct_internal') return { success: true, config: config };
  const matches = findHomeControlRequestsByCode_(registry, config.pairingCode, deps);
  if (matches.length !== 1) return { success: false, reason: matches.length > 1 ? 'PAIRING_CODE_MULTIPLE_MATCHES' : 'PAIRING_CODE_NOT_FOUND' };
  const request = matches[0];
  if (request.kind !== 'pairing') return { success: false, reason: 'PAIRING_REQUEST_KIND_INVALID', request: request };
  if (request.status !== 'pending' || !homeControlFutureIso_(request.expiresAt, now) || !homeControlFutureIso_(request.codeExpiresAt, now)) {
    return { success: false, reason: 'PAIRING_REQUEST_EXPIRED_OR_NOT_PENDING', request: request };
  }
  if (!isHomeControlUuid_(request.requestId) || !isHomeControlDeviceId_(request.deviceId) || request.deviceId === config.oldDeviceId) {
    return { success: false, reason: 'PAIRING_REQUEST_DEVICE_INVALID', request: request };
  }
  const newRegistry = registry.devices[request.deviceId];
  if (!newRegistry || newRegistry.status !== 'pending') return { success: false, reason: 'NEW_REGISTRY_NOT_PENDING', request: request };
  return { success: true, config: Object.assign({}, config, { newDeviceId: request.deviceId, pendingRequestId: request.requestId }) };
}

function createSecondSonDeviceTransferResolutionFailureReport_(config, registry, resolved) {
  const membershipState = readSecondSonDeviceTransferMembershipState_(Object.assign({}, config, { newDeviceId: '' }));
  const request = resolved.request || null;
  const policyMember = membershipState.homeMembers[0] || null;
  return {
    oldRegistryStatus: registry.devices[config.oldDeviceId] ? String(registry.devices[config.oldDeviceId].status || '') : 'missing',
    newRegistryStatus: request && registry.devices[request.deviceId] ? String(registry.devices[request.deviceId].status || '') : 'missing',
    pendingRequestStatus: request ? String(request.status || '') : 'missing',
    pendingRequestDeviceId: request ? String(request.deviceId || '') : '',
    pendingRequestId: request ? String(request.requestId || '') : '',
    pairingCode: maskSecondSonTransferPairingCode_(config.pairingCode),
    homeMemberCount: membershipState.homeMemberCount,
    homeMemberStatus: policyMember ? String(policyMember.status || '') : 'missing',
    activeDeviceMemberships: membershipState.deviceMemberships.filter(function(row) { return row.status === 'active'; }).map(secondSonDeviceTransferMembershipSummary_),
    disabledDeviceMemberships: membershipState.deviceMemberships.filter(function(row) { return row.status === 'disabled'; }).map(secondSonDeviceTransferMembershipSummary_),
    canRepair: false,
    alreadyRepaired: false,
    blockingReasons: [resolved.reason],
  };
}

function maskSecondSonTransferPairingCode_(code) {
  const value = String(code || '');
  return value ? '***' + value.slice(-2) : '';
}

function clearSecondSonDeviceTransferPairingCode_() {
  PropertiesService.getScriptProperties().deleteProperty(SECOND_SON_DEVICE_TRANSFER_REPAIR_PROPERTIES.pairingCode);
  return { success: true, pairingCodeCleared: true };
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
    pendingRequestId: pendingRequest ? String(pendingRequest.requestId || '') : '',
    pairingCode: maskSecondSonTransferPairingCode_(config.pairingCode),
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
