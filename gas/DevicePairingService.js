const HOME_CONTROL_DEVICE_REGISTRY_PROPERTY = 'PALURU_HOME_CONTROL_DEVICE_REGISTRY_V1';
const HOME_CONTROL_LEGACY_HASHES_PROPERTY = 'PALURU_HOME_AGENT_DEVICE_TOKEN_HASHES';
const HOME_CONTROL_MAX_DEVICES = 20;
const HOME_CONTROL_CODE_TTL_MILLISECONDS = 10 * 60 * 1000;
const HOME_CONTROL_REQUEST_TTL_MILLISECONDS = 15 * 60 * 1000;
const HOME_CONTROL_APPROVE_MAX_FAILURES = 5;
const HOME_CONTROL_APPROVE_RATE_WINDOW_MILLISECONDS = 10 * 60 * 1000;

function devicePairingBegin_(body) {
  try {
    const input = validateDevicePairingBeginInput_(body || {});
    const result = withHomeControlRegistryLock_(function(registry, deps) {
      const now = deps.now();
      pruneHomeControlRegistry_(registry, now.getTime());
      const existing = registry.devices[input.deviceId];
      if (existing && existing.status === 'active') throw homeControlPairingError_('DEVICE_ALREADY_REGISTERED');
      if (countHomeControlManagedDevices_(registry) >= HOME_CONTROL_MAX_DEVICES) throw homeControlPairingError_('DEVICE_LIMIT_REACHED');

      const requestId = deps.uuid();
      const requestSecret = deps.randomToken(24);
      let code = '';
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = deps.randomCode();
        if (!findHomeControlRequestByCode_(registry, candidate, deps)) {
          code = candidate;
          break;
        }
      }
      if (!code) throw homeControlPairingError_('PAIRING_CODE_UNAVAILABLE');
      const createdAt = homeControlIso_(now);
      registry.requests[requestId] = {
        requestId: requestId,
        requestSecretHash: deps.hash(requestSecret),
        deviceId: input.deviceId,
        displayName: input.displayName,
        tokenHash: input.tokenHash,
        codeHash: deps.hash(code),
        kind: 'pairing',
        status: 'pending',
        createdAt: createdAt,
        expiresAt: homeControlIso_(new Date(now.getTime() + HOME_CONTROL_REQUEST_TTL_MILLISECONDS)),
        codeExpiresAt: homeControlIso_(new Date(now.getTime() + HOME_CONTROL_CODE_TTL_MILLISECONDS)),
        approvedAt: null,
        approvedByDeviceId: null,
      };
      registry.devices[input.deviceId] = {
        deviceId: input.deviceId,
        displayName: input.displayName,
        tokenHash: input.tokenHash,
        status: 'pending',
        registeredAt: null,
        lastUsedAt: null,
        revokedAt: null,
        tokenGeneration: existing && Number.isInteger(existing.tokenGeneration) ? existing.tokenGeneration + 1 : 1,
      };
      return {
        requestId: requestId,
        requestSecret: requestSecret,
        code: code,
        expiresAt: registry.requests[requestId].codeExpiresAt,
      };
    });
    return json_({ success: true, data: result, warnings: [] });
  } catch (error) {
    return json_(homeControlPairingFailure_(error && error.code));
  }
}

function devicePairingApprove_(body) {
  const diagnostics = createDevicePairingApprovalDiagnostics_();
  try {
    const input = validateDevicePairingApproveInput_(body || {});
    const result = withHomeControlRegistryLock_(function(registry, deps) {
      const now = deps.now();
      pruneHomeControlRegistry_(registry, now.getTime());
      const adminActor = resolveMembershipApprovalAdminWithinRegistryLock_(input.deviceId, input.pairingToken, registry, deps, now);
      const rate = registry.approveAttempts[input.deviceId] || { count: 0, startedAt: now.getTime() };
      if (!Number.isFinite(rate.startedAt) || now.getTime() - rate.startedAt >= HOME_CONTROL_APPROVE_RATE_WINDOW_MILLISECONDS) {
        rate.count = 0;
        rate.startedAt = now.getTime();
      }
      const approval = resolvePendingApprovalRequestByCode_(registry, input.code, deps, now);
      if (!approval) {
        rate.count += 1;
        registry.approveAttempts[input.deviceId] = rate;
        if (rate.count >= HOME_CONTROL_APPROVE_MAX_FAILURES) throw homeControlPairingError_('PAIRING_CODE_RATE_LIMITED');
        throw homeControlPairingError_('INVALID_PAIRING_CODE');
      }
      setDevicePairingApprovalStage_(diagnostics, 'pendingRequest', 'resolved', { kind: approval.kind });
      if (rate.count) delete registry.approveAttempts[input.deviceId];
      const request = approval.request;
      const targetDevice = registry.devices[request.deviceId];
      if (approval.kind === 'pairing') {
        if (!targetDevice || targetDevice.status !== 'pending') throw homeControlPairingError_('PAIRING_REQUEST_INVALID');
      } else if (approval.kind === 'membership') {
        if (!targetDevice || targetDevice.status !== 'active' ||
          !constantTimeEqualHomeControl_(String(request.tokenHash || ''), String(targetDevice.tokenHash || ''))) {
          throw homeControlPairingError_('PAIRING_REQUEST_INVALID');
        }
      } else {
        // resolvePendingApprovalRequestByCode_ normalizes complete legacy requests.
        throw homeControlPairingError_('PAIRING_REQUEST_INVALID');
      }
      setDevicePairingApprovalStage_(diagnostics, 'registryDevice', 'verified', { requestKind: approval.kind });
      provisionMembershipFromApprovalTemplateWithinRegistryLock_(adminActor, targetDevice.deviceId, input.membershipTemplate, request.requestId, homeControlIso_(now), diagnostics);
      if (approval.kind === 'pairing') {
        targetDevice.status = 'active';
        targetDevice.registeredAt = homeControlIso_(now);
        targetDevice.lastUsedAt = homeControlIso_(now);
        targetDevice.revokedAt = null;
      }
      setDevicePairingApprovalStage_(diagnostics, 'registryActivation', approval.kind === 'pairing' ? 'active' : 'not_required');
      request.status = 'approved';
      request.approvedAt = homeControlIso_(now);
      request.approvedByDeviceId = input.deviceId;
      request.codeHash = '';
      request.codeExpiresAt = null;
      return { requestId: request.requestId, deviceName: targetDevice.displayName, status: 'approved' };
    });
    return json_({ success: true, data: result, warnings: [], diagnostics: diagnostics });
  } catch (error) {
    setDevicePairingApprovalFailure_(diagnostics, error && error.code);
    return json_(devicePairingApprovalFailure_(error && error.code, diagnostics));
  }
}

function createDevicePairingApprovalDiagnostics_() {
  return {
    operation: 'devicePairingApprove',
    stages: {
      pendingRequest: 'not_started', registryDevice: 'not_started', registryActivation: 'not_started',
      secondSonPolicy: 'not_started', homeMembers: 'not_started', deviceMemberships: 'not_started', conflict: 'not_checked',
    },
  };
}

function setDevicePairingApprovalStage_(diagnostics, name, status, details) {
  if (!diagnostics || !diagnostics.stages || !Object.prototype.hasOwnProperty.call(diagnostics.stages, name)) return;
  diagnostics.stages[name] = status;
  if (details) diagnostics[name] = details;
}

function setDevicePairingApprovalFailure_(diagnostics, code) {
  if (!diagnostics) return;
  diagnostics.errorCode = String(code || 'PAIRING_FAILED');
}

function devicePairingApprovalFailure_(code, diagnostics) {
  const failure = homeControlPairingFailure_(code);
  failure.diagnostics = diagnostics;
  return failure;
}

function membershipRegistrationBegin_(body) {
  try {
    const input = validateHomeControlAuthenticatedInput_(body || {});
    const result = withHomeControlRegistryLock_(function(registry, deps) {
      const now = deps.now();
      pruneHomeControlRegistry_(registry, now.getTime());
      verifyHomeControlRegistryDevice_(input.deviceId, input.pairingToken, registry, deps, now);
      // getDeviceMembership_ is deliberately unique-row based: any active, disabled,
      // or duplicate Device_Memberships row must fail closed rather than be reassigned.
      if (getDeviceMembership_(input.deviceId)) throw homeControlPairingError_('MEMBERSHIP_ALREADY_ASSIGNED');
      if (findActiveMembershipRegistrationRequestForDevice_(registry, input.deviceId, now)) {
        throw homeControlPairingError_('MEMBERSHIP_REGISTRATION_PENDING');
      }

      const requestId = deps.uuid();
      const requestSecret = deps.randomToken(24);
      let code = '';
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = deps.randomCode();
        if (!findHomeControlRequestByCode_(registry, candidate, deps)) {
          code = candidate;
          break;
        }
      }
      if (!code) throw homeControlPairingError_('PAIRING_CODE_UNAVAILABLE');
      const device = registry.devices[input.deviceId];
      const createdAt = homeControlIso_(now);
      registry.requests[requestId] = {
        requestId: requestId,
        requestSecretHash: deps.hash(requestSecret),
        deviceId: input.deviceId,
        displayName: String(device.displayName || ''),
        tokenHash: String(device.tokenHash || ''),
        codeHash: deps.hash(code),
        kind: 'membership',
        status: 'pending',
        createdAt: createdAt,
        expiresAt: homeControlIso_(new Date(now.getTime() + HOME_CONTROL_REQUEST_TTL_MILLISECONDS)),
        codeExpiresAt: homeControlIso_(new Date(now.getTime() + HOME_CONTROL_CODE_TTL_MILLISECONDS)),
        approvedAt: null,
        approvedByDeviceId: null,
      };
      return {
        requestId: requestId,
        requestSecret: requestSecret,
        code: code,
        expiresAt: registry.requests[requestId].codeExpiresAt,
      };
    });
    return json_({ success: true, data: result, warnings: [] });
  } catch (error) {
    return json_(homeControlPairingFailure_(error && error.code));
  }
}

function membershipRegistrationStatus_(body) {
  try {
    const input = validateMembershipRegistrationStatusInput_(body || {});
    const result = withHomeControlRegistryLock_(function(registry, deps) {
      const now = deps.now();
      verifyHomeControlRegistryDevice_(input.deviceId, input.pairingToken, registry, deps, now);
      const request = registry.requests[input.requestId];
      if (!isOwnedMembershipRegistrationRequest_(request, input, deps)) {
        throw homeControlPairingError_('MEMBERSHIP_REGISTRATION_REQUEST_INVALID');
      }
      const requestExpired = !homeControlFutureIso_(request.expiresAt, now);
      const codeExpired = !homeControlFutureIso_(request.codeExpiresAt, now);
      pruneHomeControlRegistry_(registry, now.getTime());
      if (request.status === 'approved' && !requestExpired) return { status: 'approved' };
      if (request.status === 'pending' && !requestExpired && !codeExpired) {
        return { status: 'pending', expiresAt: request.codeExpiresAt };
      }
      if (request.status === 'pending' || request.status === 'approved') return { status: 'expired' };
      throw homeControlPairingError_('MEMBERSHIP_REGISTRATION_REQUEST_INVALID');
    });
    return json_({ success: true, data: result, warnings: [] });
  } catch (error) {
    return json_(homeControlPairingFailure_(error && error.code));
  }
}

function devicePairingStatus_(body) {
  try {
    const input = validateDevicePairingStatusInput_(body || {});
    const result = withHomeControlRegistryLock_(function(registry, deps) {
      const now = deps.now();
      pruneHomeControlRegistry_(registry, now.getTime());
      const request = registry.requests[input.requestId];
      if (!isPairingStatusRequest_(request) || !constantTimeEqualHomeControl_(deps.hash(input.requestSecret), String(request.requestSecretHash || ''))) {
        throw homeControlPairingError_('PAIRING_REQUEST_INVALID');
      }
      const device = registry.devices[request.deviceId];
      const active = request.status === 'approved' && device && device.status === 'active';
      return {
        status: active ? 'active' : 'pending',
        deviceName: String(request.displayName || ''),
        expiresAt: active ? null : request.codeExpiresAt,
      };
    });
    return json_({ success: true, data: result, warnings: [] });
  } catch (error) {
    return json_(homeControlPairingFailure_(error && error.code));
  }
}

function devicePairingList_(body) {
  try {
    const input = validateHomeControlAuthenticatedInput_(body || {});
    const result = withHomeControlRegistryLock_(function(registry, deps) {
      const now = deps.now();
      pruneHomeControlRegistry_(registry, now.getTime());
      resolveMembershipApprovalAdminWithinRegistryLock_(input.deviceId, input.pairingToken, registry, deps, now);
      return Object.keys(registry.devices).map(function(deviceId) {
        const item = registry.devices[deviceId];
        return {
          deviceId: item.deviceId,
          displayName: item.displayName,
          status: item.status,
          registeredAt: item.registeredAt,
          lastUsedAt: item.lastUsedAt,
          revokedAt: item.revokedAt,
          isCurrentDevice: item.deviceId === input.deviceId,
        };
      }).sort(function(left, right) {
        return String(right.registeredAt || '').localeCompare(String(left.registeredAt || ''));
      });
    });
    return json_({ success: true, data: { devices: result }, warnings: [] });
  } catch (error) {
    return json_(homeControlPairingFailure_(error && error.code));
  }
}

function devicePairingRevoke_(body) {
  try {
    const input = validateDevicePairingRevokeInput_(body || {});
    const result = withHomeControlRegistryLock_(function(registry, deps) {
    const now = deps.now();
    pruneHomeControlRegistry_(registry, now.getTime());
    const adminActor = resolveMembershipApprovalAdminWithinRegistryLock_(input.deviceId, input.pairingToken, registry, deps, now);
    if (String(adminActor.deviceId) === input.targetDeviceId) throw homeControlPairingError_('CANNOT_REVOKE_CURRENT_DEVICE');
    const target = registry.devices[input.targetDeviceId];
      if (!target || target.status !== 'active') throw homeControlPairingError_('PAIRING_DEVICE_NOT_FOUND');
      target.status = 'revoked';
      target.revokedAt = homeControlIso_(now);
      target.lastUsedAt = null;
      return { deviceId: target.deviceId, status: 'revoked' };
    });
    return json_({ success: true, data: result, warnings: [] });
  } catch (error) {
    return json_(homeControlPairingFailure_(error && error.code));
  }
}

function verifyHomeControlDevicePairing_(deviceId, pairingToken, dependencies) {
  const deps = getHomeControlPairingDependencies_(dependencies);
  const verify = function(registry) {
    const now = deps.now();
    pruneHomeControlRegistry_(registry, now.getTime());
    const registered = registry.devices[String(deviceId || '')];
    if (registered) {
      verifyHomeControlRegistryDevice_(deviceId, pairingToken, registry, deps, now);
      return { handled: true, authorized: true };
    }
    return { handled: false, authorized: false };
  };
  if (dependencies && dependencies.alreadyLocked === true) {
    const registry = loadHomeControlRegistry_(deps);
    const result = verify(registry);
    saveHomeControlRegistry_(registry, deps);
    return result;
  }
  return withHomeControlRegistryLock_(verify, deps);
}

function withHomeControlRegistryLock_(callback, dependencies) {
  const deps = getHomeControlPairingDependencies_(dependencies);
  deps.lock.waitLock(5000);
  try {
    const registry = loadHomeControlRegistry_(deps);
    try {
      const result = callback(registry, deps);
      saveHomeControlRegistry_(registry, deps);
      return result;
    } catch (error) {
      // Failed code attempts are part of the security state and must survive the rejected request.
      saveHomeControlRegistry_(registry, deps);
      throw error;
    }
  } finally {
    deps.lock.releaseLock();
  }
}

function loadHomeControlRegistry_(deps) {
  let source;
  try { source = JSON.parse(String(deps.getProperty(HOME_CONTROL_DEVICE_REGISTRY_PROPERTY) || '')); } catch (error) { source = null; }
  const registry = source && source.version === 1 && source.devices && source.requests && source.approveAttempts ? source : {
    version: 1, devices: {}, requests: {}, approveAttempts: {}
  };
  migrateLegacyHomeControlDevices_(registry, deps);
  return registry;
}

function migrateLegacyHomeControlDevices_(registry, deps) {
  let legacy;
  try { legacy = JSON.parse(String(deps.getProperty(HOME_CONTROL_LEGACY_HASHES_PROPERTY) || '')); } catch (error) { legacy = null; }
  if (!legacy || Array.isArray(legacy) || typeof legacy !== 'object') return;
  Object.keys(legacy).forEach(function(deviceId) {
    const tokenHash = String(legacy[deviceId] || '').toLowerCase();
    if (!isHomeControlTokenHash_(tokenHash) || registry.devices[deviceId]) return;
    registry.devices[deviceId] = {
      deviceId: String(deviceId).slice(0, 200), displayName: '登録済み端末', tokenHash: tokenHash,
      status: 'active', registeredAt: null, lastUsedAt: null, revokedAt: null, tokenGeneration: 1,
    };
  });
}

function saveHomeControlRegistry_(registry, deps) {
  const text = JSON.stringify(registry);
  if (text.length > 8500) throw homeControlPairingError_('DEVICE_LIMIT_REACHED');
  deps.setProperty(HOME_CONTROL_DEVICE_REGISTRY_PROPERTY, text);
}

function pruneHomeControlRegistry_(registry, nowMs) {
  Object.keys(registry.requests).forEach(function(requestId) {
    const request = registry.requests[requestId];
    if (!request || !homeControlFutureIso_(request.expiresAt, new Date(nowMs))) {
      if (request && request.status === 'pending' && registry.devices[request.deviceId] && registry.devices[request.deviceId].status === 'pending') {
        delete registry.devices[request.deviceId];
      }
      delete registry.requests[requestId];
    }
  });
  Object.keys(registry.approveAttempts).forEach(function(deviceId) {
    const item = registry.approveAttempts[deviceId];
    if (!item || !Number.isFinite(item.startedAt) || nowMs - item.startedAt >= HOME_CONTROL_APPROVE_RATE_WINDOW_MILLISECONDS) delete registry.approveAttempts[deviceId];
  });
}

function verifyHomeControlRegistryDevice_(deviceId, pairingToken, registry, deps, now) {
  const item = registry.devices[String(deviceId || '')];
  const token = String(pairingToken || '');
  if (!item || item.status !== 'active' || token.length < 32 || token.length > 512) throw homeControlPairingError_('UNAUTHORIZED_DEVICE');
  if (!constantTimeEqualHomeControl_(deps.hash(token), String(item.tokenHash || ''))) throw homeControlPairingError_('UNAUTHORIZED_DEVICE');
  item.lastUsedAt = homeControlIso_(now);
}

function findHomeControlRequestByCode_(registry, code, deps) {
  return findHomeControlRequestsByCode_(registry, code, deps)[0] || null;
}

function findHomeControlRequestsByCode_(registry, code, deps) {
  const hash = deps.hash(code);
  return Object.keys(registry.requests).map(function(id) { return registry.requests[id]; }).filter(function(item) {
    return item && item.codeHash && constantTimeEqualHomeControl_(hash, String(item.codeHash));
  });
}

function resolvePendingApprovalRequestByCode_(registry, code, deps, now) {
  const matches = findHomeControlRequestsByCode_(registry, code, deps).map(function(request) {
    if (isPendingPairingRequest_(request, now)) {
      // Complete legacy requests are pairing requests only; preserve their old behavior
      // without allowing kind-less membership requests.
      return { request: request, kind: 'pairing' };
    }
    if (isPendingMembershipRegistrationRequest_(request, now)) return { request: request, kind: 'membership' };
    return null;
  }).filter(function(item) { return item; });
  if (matches.length !== 1) return null;
  return matches[0];
}

function isPendingPairingRequest_(request, now) {
  if (!request || request.status !== 'pending' || !homeControlFutureIso_(request.codeExpiresAt, now)) return false;
  if (request.kind === 'pairing') return true;
  // Pairing requests created before kind was introduced remain valid only when their
  // required pairing fields are complete. No ambiguous legacy request is accepted.
  return !request.kind &&
    isHomeControlUuid_(request.requestId) &&
    isHomeControlDeviceId_(request.deviceId) &&
    typeof request.displayName === 'string' &&
    isHomeControlTokenHash_(request.requestSecretHash) &&
    isHomeControlTokenHash_(request.tokenHash) &&
    isHomeControlTokenHash_(request.codeHash) &&
    homeControlFutureIso_(request.expiresAt, now);
}

function isPairingStatusRequest_(request) {
  if (!request) return false;
  if (request.kind === 'pairing') return true;
  if (request.kind) return false;
  const hasRequiredFields = isHomeControlUuid_(request.requestId) &&
    isHomeControlDeviceId_(request.deviceId) &&
    typeof request.displayName === 'string' &&
    isHomeControlTokenHash_(request.requestSecretHash) &&
    isHomeControlTokenHash_(request.tokenHash);
  return hasRequiredFields && (isHomeControlTokenHash_(request.codeHash) || request.status === 'approved');
}

function findActiveMembershipRegistrationRequestForDevice_(registry, deviceId, now) {
  return Object.keys(registry.requests).map(function(id) { return registry.requests[id]; }).filter(function(request) {
    return request && request.kind === 'membership' && request.deviceId === deviceId && request.status === 'pending' &&
      homeControlFutureIso_(request.expiresAt, now) && homeControlFutureIso_(request.codeExpiresAt, now);
  })[0] || null;
}

function isPendingMembershipRegistrationRequest_(request, now) {
  return Boolean(request && request.kind === 'membership' && request.status === 'pending' &&
    isHomeControlUuid_(request.requestId) && isHomeControlDeviceId_(request.deviceId) && typeof request.displayName === 'string' &&
    isHomeControlTokenHash_(request.requestSecretHash) && isHomeControlTokenHash_(request.tokenHash) &&
    isHomeControlTokenHash_(request.codeHash) &&
    homeControlFutureIso_(request.expiresAt, now) && homeControlFutureIso_(request.codeExpiresAt, now));
}

function isOwnedMembershipRegistrationRequest_(request, input, deps) {
  return Boolean(request && request.kind === 'membership' && request.deviceId === input.deviceId &&
    constantTimeEqualHomeControl_(deps.hash(input.requestSecret), String(request.requestSecretHash || '')));
}

function countHomeControlManagedDevices_(registry) {
  return Object.keys(registry.devices).filter(function(id) {
    const status = registry.devices[id] && registry.devices[id].status;
    return status === 'active' || status === 'pending';
  }).length;
}

function validateDevicePairingBeginInput_(body) {
  const deviceId = String(body.deviceId || '').trim().slice(0, 200);
  const displayName = String(body.displayName || '').trim().replace(/[\x00-\x1f\x7f]/g, '').slice(0, 80);
  const tokenHash = String(body.tokenHash || '').trim().toLowerCase();
  if (!isHomeControlDeviceId_(deviceId) || !displayName || !isHomeControlTokenHash_(tokenHash)) throw homeControlPairingError_('INVALID_PAIRING_INPUT');
  return { deviceId: deviceId, displayName: displayName, tokenHash: tokenHash };
}

function validateDevicePairingApproveInput_(body) {
  const auth = validateHomeControlAuthenticatedInput_(body);
  const code = String(body.code || '').trim();
  const membershipTemplate = String(body.membershipTemplate || '').trim();
  if (!/^\d{6}$/.test(code)) throw homeControlPairingError_('INVALID_PAIRING_CODE');
  if (!isHomeMemberApprovalTemplate_(membershipTemplate)) throw homeControlPairingError_('INVALID_MEMBERSHIP_TEMPLATE');
  return { deviceId: auth.deviceId, pairingToken: auth.pairingToken, code: code, membershipTemplate: membershipTemplate };
}

function validateDevicePairingStatusInput_(body) {
  const requestId = String(body.requestId || '').trim();
  const requestSecret = String(body.requestSecret || '').trim();
  if (!isHomeControlUuid_(requestId) || requestSecret.length < 32 || requestSecret.length > 512) throw homeControlPairingError_('PAIRING_REQUEST_INVALID');
  return { requestId: requestId, requestSecret: requestSecret };
}

function validateMembershipRegistrationStatusInput_(body) {
  const auth = validateHomeControlAuthenticatedInput_(body);
  const requestId = String(body.requestId || '').trim();
  const requestSecret = String(body.requestSecret || '').trim();
  if (!isHomeControlUuid_(requestId) || requestSecret.length < 32 || requestSecret.length > 512) {
    throw homeControlPairingError_('MEMBERSHIP_REGISTRATION_REQUEST_INVALID');
  }
  return { deviceId: auth.deviceId, pairingToken: auth.pairingToken, requestId: requestId, requestSecret: requestSecret };
}

function validateDevicePairingRevokeInput_(body) {
  const auth = validateHomeControlAuthenticatedInput_(body);
  const targetDeviceId = String(body.targetDeviceId || '').trim().slice(0, 200);
  if (!isHomeControlDeviceId_(targetDeviceId)) throw homeControlPairingError_('INVALID_PAIRING_INPUT');
  return { deviceId: auth.deviceId, pairingToken: auth.pairingToken, targetDeviceId: targetDeviceId };
}

function validateHomeControlAuthenticatedInput_(body) {
  const deviceId = String(body.deviceId || '').trim().slice(0, 200);
  const pairingToken = String(body.pairingToken || '');
  if (!isHomeControlDeviceId_(deviceId) || pairingToken.length < 32 || pairingToken.length > 512) throw homeControlPairingError_('UNAUTHORIZED_DEVICE');
  return { deviceId: deviceId, pairingToken: pairingToken };
}

function getHomeControlPairingDependencies_(overrides) {
  const input = overrides || {};
  return {
    getProperty: input.getProperty || function(name) { return PropertiesService.getScriptProperties().getProperty(name); },
    setProperty: input.setProperty || function(name, value) { PropertiesService.getScriptProperties().setProperty(name, value); },
    lock: input.lock || LockService.getScriptLock(), now: input.now || function() { return new Date(); },
    uuid: input.uuid || function() { return Utilities.getUuid(); }, hash: input.hash || hashHomeControlValue_,
    randomToken: input.randomToken || randomHomeControlToken_, randomCode: input.randomCode || randomHomeControlCode_,
  };
}

function hashHomeControlValue_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''), Utilities.Charset.UTF_8);
  return bytes.map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function randomHomeControlToken_(byteLength) {
  const bytes = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  return bytes.slice(0, Math.max(32, Number(byteLength || 24) * 2));
}

function randomHomeControlCode_() {
  return String(parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 1000000).padStart(6, '0');
}

function isHomeControlDeviceId_(value) { return /^[A-Za-z0-9_.:-]{1,200}$/.test(value); }
function isHomeControlTokenHash_(value) { return /^[a-f0-9]{64}$/.test(value); }
function isHomeControlUuid_(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function homeControlIso_(value) { return Utilities.formatDate(value, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function homeControlFutureIso_(value, now) { const ms = Date.parse(String(value || '')); return Number.isFinite(ms) && ms > now.getTime(); }
function constantTimeEqualHomeControl_(left, right) { const a = String(left || ''); const b = String(right || ''); let diff = a.length ^ b.length; const length = Math.max(a.length, b.length); for (let i = 0; i < length; i += 1) diff |= (a.charCodeAt(i % Math.max(1, a.length)) || 0) ^ (b.charCodeAt(i % Math.max(1, b.length)) || 0); return diff === 0; }
function homeControlPairingError_(code) { const error = new Error(String(code || 'PAIRING_FAILED')); error.code = String(code || 'PAIRING_FAILED'); return error; }
function homeControlPairingFailure_(code) { const safe = String(code || 'PAIRING_FAILED'); return { success: false, data: {}, warnings: [], error: { code: safe }, message: getHomeControlPairingMessage_(safe) }; }
function getHomeControlPairingMessage_(code) { if (code === 'DEVICE_LIMIT_REACHED') return '登録できる端末数の上限です。'; if (code === 'PAIRING_CODE_RATE_LIMITED') return '承認コードの確認回数が多すぎます。しばらく待ってください。'; if (code === 'UNAUTHORIZED_DEVICE') return '登録済み端末の確認に失敗しました。'; if (code === 'DEVICE_ALREADY_REGISTERED') return 'この端末はすでに登録済みです。'; return '端末登録を完了できませんでした。'; }
