const HEALTH_OPS = Object.freeze({
  'health.context.get': true, 'health.daily.get': true, 'health.daily.list': true, 'health.daily.recordSlot': true,
  'health.weight.list': true, 'health.weight.record': true, 'health.weight.correct': true,
  'health.profile.get': true, 'health.profile.update': true,
});

function healthGateway_(body) {
  try {
    const input = body || {};
    if (!HEALTH_OPS[input.action]) throw healthGatewayError_('FORBIDDEN');
    const context = resolveHealthGatewayContext_(input);
    if (input.action === 'health.context.get' && !String(input.targetMemberUserId || '').trim() && context.canSuperviseHealth && context.canControlHome) {
      return json_({ success: true, data: { homeId: context.actor.homeId, actor: { userId: context.actor.memberUserId, role: context.actor.role }, targets: context.targets }, message: 'ok' });
    }
    if (!context.targetUserId) throw healthGatewayError_('INVALID_INPUT');
    authorizeTargetOperation_(context.actor, context.targetUserId, input.action);
    const data = fetchHealthGatewayData_(input, context.actor, context.targetUserId);
    if (input.action === 'health.context.get') {
      const actorMember = getHomeMember_(context.actor.homeId, context.actor.memberUserId);
      const selfTarget = actorMember ? { userId: actorMember.memberUserId, displayName: actorMember.displayName } : null;
      data.targets = context.canSuperviseHealth
        ? context.canControlHome
          ? context.targets
          : selfTarget ? [selfTarget].concat(context.targets) : context.targets
        : selfTarget ? [selfTarget] : [];
    }
    return json_({ success: true, data: data, message: 'ok' });
  } catch (error) {
    const code = error && error.code;
    return json_({ success: false, data: {}, error: { code: ['UNAUTHORIZED_DEVICE', 'MEMBERSHIP_NOT_FOUND', 'FORBIDDEN', 'CONFIGURATION_ERROR', 'INVALID_INPUT', 'IDEMPOTENCY_CONFLICT', 'DATA_INTEGRITY_ERROR', 'HEALTH_UNAVAILABLE'].indexOf(code) >= 0 ? code : 'HEALTH_UNAVAILABLE' }, message: 'health request failed' });
  }
}

function resolveHealthGatewayContext_(input) {
  const actor = resolveAuthenticatedActor_(input.deviceId, input.pairingToken);
  const targets = getActiveSelfRecordMembers_(actor.homeId);
  const canSuperviseHealth = hasRoleCapability_(actor, 'health.supervision.read');
  const canControlHome = hasRoleCapability_(actor, 'home.control');
  const targetUserId = String(input.targetMemberUserId || (!canSuperviseHealth || !canControlHome ? actor.memberUserId : (targets.length === 1 ? targets[0].userId : ''))).trim();
  return {
    actor: actor,
    targets: targets,
    canSuperviseHealth: canSuperviseHealth,
    canControlHome: canControlHome,
    targetUserId: targetUserId,
  };
}

function fetchHealthGatewayData_(input, actor, targetUserId) {
  const properties = PropertiesService.getScriptProperties();
  const url = String(properties.getProperty('HEALTH_WEBAPP_URL') || '');
  const serviceToken = String(properties.getProperty('HEALTH_SERVICE_TOKEN') || '');
  if (!isAllowedHealthWebAppUrl_(url) || !serviceToken) throw healthGatewayError_('CONFIGURATION_ERROR');

  // Only server-resolved identity is forwarded.  In particular, never forward pairingToken.
  const forwarded = {
    operation: input.action, serviceToken: serviceToken,
    homeId: actor.homeId, actorUserId: actor.memberUserId, actorRole: actor.role,
    targetUserId: targetUserId, localDate: input.localDate, slot: input.slot,
    fromLocalDate: input.fromLocalDate, toLocalDate: input.toLocalDate,
    payload: input.payload, clientRequestId: input.clientRequestId, isCorrection: input.isCorrection,
    measuredDate: input.measuredDate, weightKg: input.weightKg, recordId: input.recordId,
    targetWeightKg: input.targetWeightKg, correctionReason: input.correctionReason, limit: input.limit,
  };
  const response = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(forwarded), muteHttpExceptions: true,
  });
  if (!response || response.getResponseCode() < 200 || response.getResponseCode() > 299) throw healthGatewayError_('HEALTH_UNAVAILABLE');
  let result;
  try { result = JSON.parse(String(response.getContentText() || '')); } catch (_) { throw healthGatewayError_('HEALTH_UNAVAILABLE'); }
  if (!result || result.success !== true || !result.data || typeof result.data !== 'object') {
    const upstreamCode = result && result.error && result.error.code;
    throw healthGatewayError_(['INVALID_INPUT', 'IDEMPOTENCY_CONFLICT', 'DATA_INTEGRITY_ERROR'].indexOf(upstreamCode) >= 0 ? upstreamCode : 'HEALTH_UNAVAILABLE');
  }
  return result.data;
}

function isAllowedHealthWebAppUrl_(url) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(String(url || ''));
}
function healthGatewayError_(code) { const error = new Error(code); error.code = code; return error; }
