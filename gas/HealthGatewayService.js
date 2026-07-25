const HEALTH_OPS = Object.freeze({
  'health.context.get': true, 'health.daily.get': true, 'health.daily.recordSlot': true,
  'health.weight.list': true, 'health.weight.record': true,
});

function healthGateway_(body) {
  try {
    const input = body || {};
    if (!HEALTH_OPS[input.action]) throw healthGatewayError_('FORBIDDEN');
    const actor = resolveAuthenticatedActor_(input.deviceId, input.pairingToken);
    const targets = getActiveSelfRecordMembers_(actor.homeId);
    const targetUserId = String(input.targetMemberUserId || (actor.role === 'self_record' ? actor.memberUserId : (targets.length === 1 ? targets[0].userId : ''))).trim();
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
    if (input.action === 'health.context.get') result.data.targets = actor.role === 'admin' ? targets : targets.filter(function(item) { return item.userId === actor.memberUserId; });
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
