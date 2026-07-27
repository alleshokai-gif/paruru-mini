const HOME_AGENT_ACTIONS_ENABLED_PROPERTY = 'PALURU_HOME_AGENT_ACTIONS_ENABLED';
const HOME_AGENT_DEVICE_TOKEN_HASHES_PROPERTY = 'PALURU_HOME_AGENT_DEVICE_TOKEN_HASHES';
const HOME_AGENT_ALLOWED_ROOM_IDS_PROPERTY = 'PALURU_HOME_AGENT_ALLOWED_ROOM_IDS';
const HOME_AGENT_ACTION_CONFIRMATION_TTL_SECONDS = 300;
const HOME_AGENT_ACTION_RESULT_TTL_SECONDS = 21600;
const HOME_AGENT_ACTION_IDEMPOTENCY_TTL_SECONDS = 21600;
const HOME_AGENT_ACTION_MAX_PAUSE_MILLISECONDS = 8 * 60 * 60 * 1000;
const HOME_AGENT_ACTION_STATE_PREFIX = 'PALURU_HA_ACTION_STATE_';
const HOME_AGENT_ACTION_MAX_STATE_ENTRIES = 200;
const HOME_AGENT_ACTION_ALLOWED_SKILLS = Object.freeze({
  pauseRoomAutomation: true,
  resumeRoomAutomation: true,
});

function secureHomeAgentActionCandidates_(candidates, request, pairingToken, dependencies) {
  return (Array.isArray(candidates) ? candidates : []).map(function(candidate) {
    const skill = String(candidate && (candidate.skill || candidate.action) || '').trim();
    if (!HOME_AGENT_ACTION_ALLOWED_SKILLS[skill]) return candidate;
    try {
      return createHomeAgentActionConfirmation_(candidate, request || {}, pairingToken, dependencies);
    } catch (error) {
      return {
        type: 'homeAgentActionUnavailable',
        requiresConfirmation: true,
        actionLabel: skill === 'pauseRoomAutomation' ? '自動制御だけ止める' : '通常運転に戻す',
        confirmationMessage: getHomeAgentActionPublicErrorMessage_(error && error.code),
      };
    }
  });
}

function createHomeAgentActionConfirmation_(candidate, request, pairingToken, dependencies) {
  const deps = getHomeAgentActionDependencies_(dependencies);
  assertHomeAgentActionsEnabled_(deps);
  const skill = String(candidate && (candidate.skill || candidate.action) || '').trim();
  if (!HOME_AGENT_ACTION_ALLOWED_SKILLS[skill]) throw homeAgentActionSecurityError_('UNSUPPORTED_HOME_AGENT_ACTION');

  const parameters = Object.assign({}, candidate && candidate.parameters || {});
  const roomId = String(parameters.roomId || '').trim();
  assertAllowedHomeAgentRoom_(roomId, deps);
  const actor = sanitizeTrustedHomeAgentActionActor_(request && request._authenticatedActor);
  const clientRequestId = String(request && request.clientRequestId || '').trim();
  if (!isHomeAgentActionUuid_(clientRequestId)) throw homeAgentActionSecurityError_('INVALID_CLIENT_REQUEST_ID');

  const nowMs = deps.now().getTime();
  const operation = buildHomeAgentActionOperation_(skill, parameters, nowMs);
  const fingerprint = deps.hash(JSON.stringify({ skill: skill, roomId: roomId, actor: actor, operation: operation }));
  deps.lock.waitLock(30000);
  try {
    cleanupHomeAgentActionState_(deps, nowMs);
    const requestKey = homeAgentActionRequestKey_(actor.deviceId, clientRequestId, deps);
    const existingText = readHomeAgentActionState_(requestKey, deps, nowMs, false);
    if (existingText) {
      const existing = parseHomeAgentActionJson_(existingText, 'INVALID_CONFIRMATION');
      if (existing.fingerprint !== fingerprint || !isHomeAgentActionUuid_(existing.confirmationId)) {
        throw homeAgentActionSecurityError_('IDEMPOTENCY_CONFLICT');
      }
      return buildHomeAgentActionPublicConfirmation_(existing.confirmationId, clientRequestId, skill);
    }

    const confirmationId = deps.uuid();
    if (!isHomeAgentActionUuid_(confirmationId)) throw homeAgentActionSecurityError_('INTERNAL_ERROR');
    const record = {
      version: 1,
      confirmationId: confirmationId,
      clientRequestId: clientRequestId,
      skill: skill,
      roomId: roomId,
      actor: actor,
      operation: operation,
      confirmationExpiresAtMs: nowMs + HOME_AGENT_ACTION_CONFIRMATION_TTL_SECONDS * 1000,
    };
    writeHomeAgentActionState_(homeAgentActionPendingKey_(confirmationId, deps), JSON.stringify(record), nowMs + HOME_AGENT_ACTION_CONFIRMATION_TTL_SECONDS * 1000, deps);
    writeHomeAgentActionState_(requestKey, JSON.stringify({ confirmationId: confirmationId, fingerprint: fingerprint }), nowMs + HOME_AGENT_ACTION_IDEMPOTENCY_TTL_SECONDS * 1000, deps);
    return buildHomeAgentActionPublicConfirmation_(confirmationId, clientRequestId, skill);
  } finally {
    deps.lock.releaseLock();
  }
}

function buildHomeAgentActionPublicConfirmation_(confirmationId, clientRequestId, skill) {
  return {
    type: 'homeAgentActionConfirmation',
    confirmationId: confirmationId,
    clientRequestId: clientRequestId,
    requiresConfirmation: true,
    actionLabel: skill === 'pauseRoomAutomation' ? '自動制御だけ止める' : '通常運転に戻す',
    confirmationMessage: skill === 'pauseRoomAutomation'
      ? '確認したら指定した期限まで自動制御を一時停止するで。安全停止は維持される。'
      : '確認したらこの部屋の一時停止を解除して通常運転へ戻すで。',
  };
}

function executeHomeAgentActionConfirmation_(body, dependencies) {
  const deps = getHomeAgentActionDependencies_(dependencies);
  try {
    assertHomeAgentActionsEnabled_(deps);
    const confirmationId = String(body && body.confirmationId || '').trim();
    const clientRequestId = String(body && body.clientRequestId || '').trim();
    const actor = sanitizeTrustedHomeAgentActionActor_(body && body._authenticatedActor);
    if (!isHomeAgentActionUuid_(confirmationId)) throw homeAgentActionSecurityError_('INVALID_CONFIRMATION');
    if (!isHomeAgentActionUuid_(clientRequestId)) throw homeAgentActionSecurityError_('INVALID_CLIENT_REQUEST_ID');

    const lock = deps.lock;
    lock.waitLock(30000);
    try {
      const resultKey = homeAgentActionResultKey_(confirmationId, deps);
      const actionNowMs = deps.now().getTime();
      const cachedResultText = readHomeAgentActionState_(resultKey, deps, actionNowMs, false);
      if (cachedResultText) {
        const cached = parseHomeAgentActionJson_(cachedResultText, 'INVALID_CONFIRMATION');
        if (cached.clientRequestId !== clientRequestId) throw homeAgentActionSecurityError_('INVALID_CONFIRMATION');
        assertHomeAgentActionActorMatches_(cached.actor, actor);
        return cached.response;
      }

      const pendingKey = homeAgentActionPendingKey_(confirmationId, deps);
      const pendingText = readHomeAgentActionState_(pendingKey, deps, actionNowMs, true);
      if (!pendingText) throw homeAgentActionSecurityError_('INVALID_CONFIRMATION');
      const record = parseHomeAgentActionJson_(pendingText, 'INVALID_CONFIRMATION');
      if (record.confirmationId !== confirmationId || record.clientRequestId !== clientRequestId) {
        throw homeAgentActionSecurityError_('INVALID_CONFIRMATION');
      }
      assertHomeAgentActionActorMatches_(record.actor, actor);
      const nowMs = deps.now().getTime();
      if (!Number.isFinite(record.confirmationExpiresAtMs) || record.confirmationExpiresAtMs <= nowMs) {
        removeHomeAgentActionState_(pendingKey, deps);
        throw homeAgentActionSecurityError_('CONFIRMATION_EXPIRED');
      }
      revalidateHomeAgentActionRecord_(record, nowMs, deps);

      // Delete before calling the upstream. Holding the script lock prevents a second execution.
      removeHomeAgentActionState_(pendingKey, deps);
      let response;
      try {
        response = deps.execute(record, actor);
      } catch (error) {
        response = homeAgentActionSecurityFailure_('HOME_AGENT_ACTION_FAILED');
      }
      response = sanitizeHomeAgentActionExecutionResponse_(response, record.skill);
      writeHomeAgentActionState_(resultKey, JSON.stringify({
        clientRequestId: clientRequestId,
        actor: record.actor,
        response: response,
      }), nowMs + HOME_AGENT_ACTION_RESULT_TTL_SECONDS * 1000, deps);
      return response;
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return homeAgentActionSecurityFailure_(error && error.code || 'HOME_AGENT_ACTION_FAILED');
  }
}

function executeSecuredHomeAgentActionRecord_(record, trustedActor) {
  const actor = sanitizeTrustedHomeAgentActionActor_(trustedActor);
  assertHomeAgentActionActorMatches_(record && record.actor, actor);
  const request = normalizeHomeAgentRequest_({
    userId: actor.memberUserId,
    userDisplayName: actor.displayName,
    deviceId: actor.deviceId,
    parameters: record.skill === 'pauseRoomAutomation' ? {
      roomId: record.roomId,
      expiresAt: record.operation.pauseExpiresAt,
      reason: 'home_agent_pause_request',
    } : { roomId: record.roomId },
  }, new Date());
  let result;
  if (record.skill === 'pauseRoomAutomation') {
    const climate = getRoomClimateSkill_(request);
    if (!climate || climate.success !== true) throw homeAgentActionSecurityError_('HOME_AGENT_ACTION_STATE_CHANGED');
    result = pauseRoomAutomationSkill_(request);
  } else {
    const pauseState = getRoomAutomationPauseSkill_(request);
    const activePause = pauseState && pauseState.data && pauseState.data.activePause;
    if (!pauseState || pauseState.success !== true || !activePause
        || String(activePause.pauseId || '') !== String(record.operation.resumeTarget || '')) {
      throw homeAgentActionSecurityError_('HOME_AGENT_ACTION_STATE_CHANGED');
    }
    result = resumeRoomAutomationSkill_(request);
  }
  return {
    success: result && result.success === true,
    message: result && result.success === true ? 'home agent action executed' : 'home agent action failed',
    operation: record.skill === 'pauseRoomAutomation' ? 'pause' : 'resume',
    result: result && result.data ? result.data : {},
    warnings: result && result.warnings ? result.warnings : [],
    error: result && result.error ? { code: String(result.error.code || 'HOME_AGENT_ACTION_FAILED') } : null,
  };
}

function buildHomeAgentActionOperation_(skill, parameters, nowMs) {
  if (skill === 'resumeRoomAutomation') {
    const resumeTarget = String(parameters.resumeTarget || parameters.pauseId || '').trim();
    if (!resumeTarget) throw homeAgentActionSecurityError_('INVALID_HOME_AGENT_ACTION');
    return { resumeTarget: resumeTarget.slice(0, 200) };
  }
  const pauseDate = parseHomeAgentActionDate_(parameters.expiresAt);
  const pauseMs = pauseDate && pauseDate.getTime();
  if (!Number.isFinite(pauseMs) || pauseMs <= nowMs || pauseMs - nowMs > HOME_AGENT_ACTION_MAX_PAUSE_MILLISECONDS) {
    throw homeAgentActionSecurityError_('INVALID_HOME_AGENT_ACTION');
  }
  return { pauseExpiresAt: String(parameters.expiresAt), pauseExpiresAtMs: pauseMs };
}

function revalidateHomeAgentActionRecord_(record, nowMs, deps) {
  if (!record || !HOME_AGENT_ACTION_ALLOWED_SKILLS[record.skill]) throw homeAgentActionSecurityError_('UNSUPPORTED_HOME_AGENT_ACTION');
  assertAllowedHomeAgentRoom_(String(record.roomId || ''), deps);
  if (record.skill === 'pauseRoomAutomation') {
    const pauseMs = Number(record.operation && record.operation.pauseExpiresAtMs);
    if (!Number.isFinite(pauseMs) || pauseMs <= nowMs || pauseMs - nowMs > HOME_AGENT_ACTION_MAX_PAUSE_MILLISECONDS) {
      throw homeAgentActionSecurityError_('INVALID_HOME_AGENT_ACTION');
    }
  } else if (!String(record.operation && record.operation.resumeTarget || '').trim()) {
    throw homeAgentActionSecurityError_('INVALID_HOME_AGENT_ACTION');
  }
}

function assertHomeAgentActionsEnabled_(deps) {
  if (String(deps.getProperty(HOME_AGENT_ACTIONS_ENABLED_PROPERTY) || '').trim().toLowerCase() !== 'true') {
    throw homeAgentActionSecurityError_('HOME_AGENT_ACTIONS_DISABLED');
  }
}

function assertAllowedHomeAgentRoom_(roomId, deps) {
  let allowed;
  try {
    allowed = JSON.parse(String(deps.getProperty(HOME_AGENT_ALLOWED_ROOM_IDS_PROPERTY) || ''));
  } catch (error) {
    allowed = null;
  }
  if (!Array.isArray(allowed) || !roomId || allowed.indexOf(roomId) < 0) {
    throw homeAgentActionSecurityError_('ROOM_NOT_ALLOWED');
  }
}

function verifyHomeAgentDevicePairing_(deviceId, pairingToken, deps) {
  if (typeof verifyHomeControlDevicePairing_ === 'function') {
    const registryResult = verifyHomeControlDevicePairing_(deviceId, pairingToken, {
      getProperty: deps.getProperty,
      setProperty: function(name, value) { PropertiesService.getScriptProperties().setProperty(name, value); },
      hash: deps.hash,
      now: deps.now,
      lock: deps.lock,
      alreadyLocked: true,
    });
    if (registryResult && registryResult.handled) return;
  }
  let hashes;
  try {
    hashes = JSON.parse(String(deps.getProperty(HOME_AGENT_DEVICE_TOKEN_HASHES_PROPERTY) || ''));
  } catch (error) {
    hashes = null;
  }
  const expected = hashes && !Array.isArray(hashes) ? String(hashes[String(deviceId || '')] || '') : '';
  const token = String(pairingToken || '');
  if (!expected || token.length < 32 || token.length > 512) throw homeAgentActionSecurityError_('UNAUTHORIZED_DEVICE');
  const actual = deps.hash(token);
  if (!constantTimeEqualHomeAgentAction_(actual, expected.toLowerCase())) throw homeAgentActionSecurityError_('UNAUTHORIZED_DEVICE');
}

function sanitizeHomeAgentActionActor_(request) {
  const deviceId = String(request.deviceId || '').trim().slice(0, 200);
  if (!deviceId) throw homeAgentActionSecurityError_('UNAUTHORIZED_DEVICE');
  return {
    userId: String(request.userId || '').trim().slice(0, 100),
    userDisplayName: String(request.userDisplayName || '').trim().slice(0, 100),
    deviceId: deviceId,
  };
}

function sanitizeTrustedHomeAgentActionActor_(actor) {
  const homeId = String(actor && actor.homeId || '').trim().slice(0, 200);
  const memberUserId = String(actor && actor.memberUserId || '').trim().slice(0, 100);
  const deviceId = String(actor && actor.deviceId || '').trim().slice(0, 200);
  const capabilities = Array.isArray(actor && actor.capabilities) ? actor.capabilities : [];
  if (!homeId || !memberUserId || !deviceId || capabilities.indexOf('home.control') < 0) {
    throw homeAgentActionSecurityError_('UNAUTHORIZED_DEVICE');
  }
  return {
    homeId: homeId,
    memberUserId: memberUserId,
    displayName: String(actor && actor.displayName || '').trim().slice(0, 100),
    deviceId: deviceId,
  };
}

function assertHomeAgentActionActorMatches_(recordActor, trustedActor) {
  if (!recordActor || !trustedActor
      || String(recordActor.homeId || '') !== String(trustedActor.homeId || '')
      || String(recordActor.memberUserId || '') !== String(trustedActor.memberUserId || '')
      || String(recordActor.deviceId || '') !== String(trustedActor.deviceId || '')) {
    throw homeAgentActionSecurityError_('UNAUTHORIZED_DEVICE');
  }
}

function sanitizeHomeAgentActionExecutionResponse_(response, skill) {
  const success = response && response.success === true;
  return {
    success: success,
    message: success ? 'home agent action executed' : 'home agent action failed',
    operation: skill === 'pauseRoomAutomation' ? 'pause' : 'resume',
    result: sanitizeHomeAgentActionResult_(response && response.result, skill),
    warnings: Array.isArray(response && response.warnings) ? response.warnings.map(String).slice(0, 10) : [],
    error: success ? null : { code: String(response && response.error && response.error.code || 'HOME_AGENT_ACTION_FAILED') },
  };
}

function sanitizeHomeAgentActionResult_(result, skill) {
  const source = result && typeof result === 'object' ? result : {};
  if (skill === 'pauseRoomAutomation') {
    const pause = source.activePause || source.pause || {};
    return {
      activePause: pause && typeof pause === 'object' ? {
        expiresAt: String(pause.expiresAt || ''),
        status: String(pause.status || ''),
      } : null,
    };
  }
  return {
    resumed: Number.isFinite(Number(source.resumed)) ? Number(source.resumed) : 0,
    status: String(source.status || ''),
    activePause: null,
  };
}

function homeAgentActionSecurityFailure_(code) {
  return {
    success: false,
    message: getHomeAgentActionPublicErrorMessage_(code),
    result: {},
    warnings: [],
    error: { code: String(code || 'HOME_AGENT_ACTION_FAILED') },
  };
}

function getHomeAgentActionPublicErrorMessage_(code) {
  if (code === 'HOME_AGENT_ACTIONS_DISABLED') return 'home agent operations are disabled';
  if (code === 'UNAUTHORIZED_DEVICE') return 'device authentication failed';
  if (code === 'CONFIRMATION_EXPIRED') return 'confirmation expired';
  if (code === 'AIRCON_OPERATION_NOT_CONNECTED') return 'aircon operation is not connected';
  if (code === 'UNSUPPORTED_HOME_AGENT_ACTION') return 'unsupported action';
  return 'confirmation is invalid';
}

function getHomeAgentActionDependencies_(overrides) {
  const input = overrides || {};
  return {
    getProperty: input.getProperty || function(name) {
      return PropertiesService.getScriptProperties().getProperty(name);
    },
    state: input.state || getDefaultHomeAgentActionState_(),
    lock: input.lock || LockService.getScriptLock(),
    uuid: input.uuid || function() { return Utilities.getUuid(); },
    now: input.now || function() { return new Date(); },
    hash: input.hash || hashHomeAgentActionToken_,
    execute: input.execute || executeSecuredHomeAgentActionRecord_,
  };
}

function hashHomeAgentActionToken_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''), Utilities.Charset.UTF_8);
  return bytes.map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function homeAgentActionPendingKey_(confirmationId, deps) {
  return 'ha:pending:' + deps.hash(confirmationId).slice(0, 40);
}

function homeAgentActionResultKey_(confirmationId, deps) {
  return 'ha:result:' + deps.hash(confirmationId).slice(0, 40);
}

function homeAgentActionRequestKey_(deviceId, clientRequestId, deps) {
  return 'ha:request:' + deps.hash(String(deviceId || '') + ':' + String(clientRequestId || '')).slice(0, 40);
}

function getDefaultHomeAgentActionState_() {
  const properties = PropertiesService.getScriptProperties();
  return {
    get: function(key) { return properties.getProperty(HOME_AGENT_ACTION_STATE_PREFIX + key); },
    put: function(key, value) { properties.setProperty(HOME_AGENT_ACTION_STATE_PREFIX + key, value); },
    remove: function(key) { properties.deleteProperty(HOME_AGENT_ACTION_STATE_PREFIX + key); },
    all: function() { return properties.getProperties(); },
  };
}

function readHomeAgentActionState_(key, deps, nowMs, allowExpired) {
  const text = deps.state.get(key);
  if (!text) return null;
  const envelope = parseHomeAgentActionJson_(text, 'INVALID_CONFIRMATION');
  if (!Number.isFinite(envelope.expiresAtMs) || typeof envelope.value !== 'string') {
    removeHomeAgentActionState_(key, deps);
    return null;
  }
  if (!allowExpired && envelope.expiresAtMs <= nowMs) {
    removeHomeAgentActionState_(key, deps);
    return null;
  }
  return envelope.value;
}

function writeHomeAgentActionState_(key, value, expiresAtMs, deps) {
  deps.state.put(key, JSON.stringify({ expiresAtMs: expiresAtMs, value: String(value || '') }));
}

function removeHomeAgentActionState_(key, deps) {
  deps.state.remove(key);
}

function cleanupHomeAgentActionState_(deps, nowMs) {
  const all = deps.state.all();
  const keys = Object.keys(all || {}).filter(function(key) { return key.indexOf(HOME_AGENT_ACTION_STATE_PREFIX) === 0; });
  keys.forEach(function(fullKey) {
    const key = fullKey.slice(HOME_AGENT_ACTION_STATE_PREFIX.length);
    try {
      const envelope = JSON.parse(String(all[fullKey] || ''));
      if (!Number.isFinite(envelope.expiresAtMs) || envelope.expiresAtMs <= nowMs) deps.state.remove(key);
    } catch (error) {
      deps.state.remove(key);
    }
  });
  const remaining = Object.keys(deps.state.all() || {}).filter(function(key) { return key.indexOf(HOME_AGENT_ACTION_STATE_PREFIX) === 0; });
  if (remaining.length + 2 > HOME_AGENT_ACTION_MAX_STATE_ENTRIES) throw homeAgentActionSecurityError_('HOME_AGENT_ACTION_STATE_FULL');
}

function parseHomeAgentActionJson_(text, code) {
  try {
    const value = JSON.parse(String(text || ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    return value;
  } catch (error) {
    throw homeAgentActionSecurityError_(code || 'INVALID_CONFIRMATION');
  }
}

function parseHomeAgentActionDate_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? text.replace(' ', 'T') + '+09:00' : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isHomeAgentActionUuid_(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function constantTimeEqualHomeAgentAction_(leftValue, rightValue) {
  const left = String(leftValue || '');
  const right = String(rightValue || '');
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index % Math.max(left.length, 1)) || 0) ^ (right.charCodeAt(index % Math.max(right.length, 1)) || 0);
  }
  return diff === 0;
}

function homeAgentActionSecurityError_(code) {
  const error = new Error(String(code || 'HOME_AGENT_ACTION_FAILED'));
  error.code = String(code || 'HOME_AGENT_ACTION_FAILED');
  return error;
}
