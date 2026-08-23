const HEALTH_OPS = Object.freeze({
  'health.context.get': true, 'health.daily.get': true, 'health.daily.list': true, 'health.daily.recordSlot': true,
  'health.weight.list': true, 'health.weight.record': true,
});

function healthGateway_(body) {
  try {
    const input = body || {};
    if (!HEALTH_OPS[input.action]) throw healthGatewayError_('FORBIDDEN');
    const actor = resolveAuthenticatedActor_(input.deviceId, input.pairingToken);
    const targets = getActiveSelfRecordMembers_(actor.homeId);
    const canSuperviseHealth = hasRoleCapability_(actor, 'health.supervision.read');
    const canControlHome = hasRoleCapability_(actor, 'home.control');
    if (input.action === 'health.context.get' && !String(input.targetMemberUserId || '').trim() && canSuperviseHealth && canControlHome) {
      return json_({ success: true, data: { homeId: actor.homeId, actor: { userId: actor.memberUserId, role: actor.role }, targets: targets }, message: 'ok' });
    }
    const targetUserId = String(input.targetMemberUserId || (!canSuperviseHealth || !canControlHome ? actor.memberUserId : (targets.length === 1 ? targets[0].userId : ''))).trim();
    if (!targetUserId) throw healthGatewayError_('INVALID_INPUT');
    authorizeTargetOperation_(actor, targetUserId, input.action);

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
      payload: input.payload, clientRequestId: input.clientRequestId,
      measuredDate: input.measuredDate, weightKg: input.weightKg, limit: input.limit,
    };
    const response = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(forwarded), muteHttpExceptions: true,
    });
    if (!response || response.getResponseCode() < 200 || response.getResponseCode() > 299) throw healthGatewayError_('HEALTH_UNAVAILABLE');
    let result;
    try { result = JSON.parse(String(response.getContentText() || '')); } catch (_) { throw healthGatewayError_('HEALTH_UNAVAILABLE'); }
    if (!result || result.success !== true || !result.data || typeof result.data !== 'object') {
      throw healthGatewayError_(result && result.error && result.error.code === 'INVALID_INPUT' ? 'INVALID_INPUT' : 'HEALTH_UNAVAILABLE');
    }
    if (input.action === 'health.context.get') {
      const actorMember = getHomeMember_(actor.homeId, actor.memberUserId);
      const selfTarget = actorMember ? { userId: actorMember.memberUserId, displayName: actorMember.displayName } : null;
      result.data.targets = canSuperviseHealth
        ? canControlHome
          ? targets
          : selfTarget ? [selfTarget].concat(targets) : targets
        : selfTarget ? [selfTarget] : [];
    }
    return json_({ success: true, data: result.data, message: 'ok' });
  } catch (error) {
    const code = error && error.code;
    return json_({ success: false, data: {}, error: { code: ['UNAUTHORIZED_DEVICE', 'MEMBERSHIP_NOT_FOUND', 'FORBIDDEN', 'CONFIGURATION_ERROR', 'INVALID_INPUT', 'HEALTH_UNAVAILABLE'].indexOf(code) >= 0 ? code : 'HEALTH_UNAVAILABLE' }, message: 'health request failed' });
  }
}

function isAllowedHealthWebAppUrl_(url) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(String(url || ''));
}
function healthGatewayError_(code) { const error = new Error(code); error.code = code; return error; }
