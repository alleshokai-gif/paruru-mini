const PET_HEALTH_GATEWAY_OPERATION_CAPABILITIES = Object.freeze({
  'pet.health.getDailySummary': 'pet.health.read',
  'pet.health.listRecentEvents': 'pet.health.read',
  'pet.health.getDashboard': 'pet.health.read',
  'pet.health.record': 'pet.health.record',
  'pet.health.correct': 'pet.health.record',
  'pet.health.void': 'pet.health.record',
});
const PET_HEALTH_GATEWAY_ALLOWED_INPUTS = Object.freeze({
  'pet.health.getDailySummary': Object.freeze({ action: true, deviceId: true, pairingToken: true, petId: true, localDate: true }),
  'pet.health.listRecentEvents': Object.freeze({ action: true, deviceId: true, pairingToken: true, petId: true, days: true }),
  'pet.health.getDashboard': Object.freeze({ action: true, deviceId: true, pairingToken: true, petId: true, localDate: true, requestId: true }),
  'pet.health.record': Object.freeze({ action: true, deviceId: true, pairingToken: true, petId: true, clientRequestId: true, event: true }),
  'pet.health.correct': Object.freeze({ action: true, deviceId: true, pairingToken: true, petId: true, clientRequestId: true, correctionOfEventId: true, event: true }),
  'pet.health.void': Object.freeze({ action: true, deviceId: true, pairingToken: true, petId: true, clientRequestId: true, correctionOfEventId: true }),
});
const PET_HEALTH_GATEWAY_RECENT_EVENT_FIELDS = Object.freeze({
  meal: Object.freeze(['mealSlot', 'amountG', 'completion', 'note']),
  stool: Object.freeze(['stoolForm', 'stoolAmount', 'coprophagy', 'note']),
  water_bottle: Object.freeze(['remainingMl', 'newFillMl', 'bottleDecreaseMl', 'elapsedHours', 'normalized24hMl', 'note']),
  water: Object.freeze(['amountMl', 'note']),
  urine: Object.freeze(['urineStatus', 'note']),
  weight: Object.freeze(['weightKg', 'note']),
  observation: Object.freeze(['energy', 'appetite', 'flags', 'note']),
});
const PET_HEALTH_GATEWAY_SAFE_ERRORS = Object.freeze({
  UNAUTHORIZED_DEVICE: true, MEMBERSHIP_NOT_FOUND: true, FORBIDDEN: true,
  INVALID_INPUT: true, IDEMPOTENCY_CONFLICT: true, DATA_INTEGRITY_ERROR: true,
  CONFIGURATION_ERROR: true, PET_HEALTH_UNAVAILABLE: true,
});

function petHealthGateway_(body) {
  const input = body || {};
  const dashboardTiming = petHealthGatewayDashboardTiming_(input);
  petHealthGatewayLogDashboardTiming_(dashboardTiming, 'REQUEST_RECEIVED');
  try {
    if (!PET_HEALTH_GATEWAY_OPERATION_CAPABILITIES[String(input.action || '').trim()]) throw petHealthGatewayError_('FORBIDDEN');
    const actor = resolveAuthenticatedActor_(input.deviceId, input.pairingToken);
    petHealthGatewayLogDashboardTiming_(dashboardTiming, 'ACTOR_RESOLVED');
    const result = petHealthGatewayForTrustedActor_(input, actor, 'manual', dashboardTiming);
    petHealthGatewayLogDashboardTiming_(dashboardTiming, 'RESPONSE_SENT');
    return result;
  } catch (error) {
    const code = error && PET_HEALTH_GATEWAY_SAFE_ERRORS[error.code] ? error.code : 'PET_HEALTH_UNAVAILABLE';
    petHealthGatewayLogDashboardTiming_(dashboardTiming, 'RESPONSE_SENT', code);
    return json_({ success: false, data: {}, error: { code: code }, message: 'pet health request failed' });
  }
}

// This lower boundary is for server-resolved actors only.  The public route
// always passes manual; a future confirmed Agent route may pass agent without
// accepting source, actor, home, role, or capabilities from its request body.
function petHealthGatewayForTrustedActor_(input, actor, trustedSource, dashboardTiming) {
  const operation = String(input && input.action || '').trim();
  const capability = PET_HEALTH_GATEWAY_OPERATION_CAPABILITIES[operation];
  if (!capability) throw petHealthGatewayError_('FORBIDDEN');
  authorizeCapability_(actor, capability);
  petHealthGatewayValidateInput_(input, operation);
  if (trustedSource !== 'manual' && trustedSource !== 'agent') throw petHealthGatewayError_('CONFIGURATION_ERROR');

  const properties = PropertiesService.getScriptProperties();
  const url = String(properties.getProperty('HEALTH_WEBAPP_URL') || '');
  const serviceToken = String(properties.getProperty('HEALTH_SERVICE_TOKEN') || '');
  if (!isAllowedHealthWebAppUrl_(url) || !serviceToken) throw petHealthGatewayError_('CONFIGURATION_ERROR');

  const forwarded = {
    operation: operation,
    serviceToken: serviceToken,
    homeId: String(actor.homeId),
    actorUserId: String(actor.memberUserId),
    petId: input.petId,
  };
  if (operation === 'pet.health.record') {
    forwarded.source = trustedSource;
    forwarded.clientRequestId = input.clientRequestId;
    forwarded.event = input.event;
  } else if (operation === 'pet.health.correct') {
    forwarded.source = trustedSource;
    forwarded.clientRequestId = input.clientRequestId;
    forwarded.correctionOfEventId = input.correctionOfEventId;
    forwarded.event = input.event;
  } else if (operation === 'pet.health.void') {
    forwarded.source = trustedSource;
    forwarded.clientRequestId = input.clientRequestId;
    forwarded.correctionOfEventId = input.correctionOfEventId;
  } else if (operation === 'pet.health.listRecentEvents') {
    forwarded.days = input.days;
  } else if (Object.prototype.hasOwnProperty.call(input, 'localDate')) {
    forwarded.localDate = input.localDate;
  }

  let response;
  try {
    petHealthGatewayLogDashboardTiming_(dashboardTiming, 'HEALTH_REQUEST_START');
    response = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(forwarded), muteHttpExceptions: true,
    });
    petHealthGatewayLogDashboardTiming_(dashboardTiming, 'HEALTH_RESPONSE_RECEIVED');
  } catch (_) {
    throw petHealthGatewayError_('PET_HEALTH_UNAVAILABLE');
  }
  if (!response || response.getResponseCode() < 200 || response.getResponseCode() > 299) throw petHealthGatewayError_('PET_HEALTH_UNAVAILABLE');

  let result;
  try { result = JSON.parse(String(response.getContentText() || '')); } catch (_) { throw petHealthGatewayError_('PET_HEALTH_UNAVAILABLE'); }
  if (result && result.success === false) throw petHealthGatewayError_(petHealthGatewayBackendErrorCode_(result));
  if (!petHealthGatewayValidSuccess_(result, operation)) throw petHealthGatewayError_('PET_HEALTH_UNAVAILABLE');
  return json_({ success: true, status: result.status, operation: result.operation, data: result.data, warnings: result.warnings, error: null, schemaVersion: result.schemaVersion, message: 'ok' });
}

function petHealthGatewayDashboardTiming_(input) {
  if (String(input && input.action || '').trim() !== 'pet.health.getDashboard') return null;
  const supplied = String(input && input.requestId || '').trim();
  let requestId = petHealthGatewayUuid_(supplied) ? supplied : '';
  if (!requestId) {
    try { requestId = Utilities.getUuid(); } catch (_) { return null; }
  }
  return {
    requestId: requestId,
    startedAtMs: Date.now(),
  };
}

function petHealthGatewayLogDashboardTiming_(timing, stage, errorCode) {
  if (!timing || typeof Logger === 'undefined' || typeof Logger.log !== 'function') return;
  const code = String(errorCode || '');
  const safeErrorCode = code && PET_HEALTH_GATEWAY_SAFE_ERRORS[code] ? code : (code ? 'UNKNOWN' : null);
  try {
    Logger.log('[PALURU_PET_DASHBOARD] ' + JSON.stringify({
      requestIdSuffix: String(timing.requestId || '').slice(-8),
      stage: String(stage || 'UNKNOWN').replace(/[^A-Z0-9_]/g, '').slice(0, 80) || 'UNKNOWN',
      elapsedMs: Math.max(0, Date.now() - Number(timing.startedAtMs || Date.now())),
      errorCode: safeErrorCode,
      buildId: typeof PALURU_MINI_BUILD_ID === 'string' ? PALURU_MINI_BUILD_ID : '',
    }));
  } catch (_) {
    // Timing diagnostics must never change the Gateway result.
  }
}

function petHealthGatewayUuid_(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function petHealthGatewayValidateInput_(input, operation) {
  if (!petHealthGatewayObject_(input)) throw petHealthGatewayError_('INVALID_INPUT');
  const allowed = PET_HEALTH_GATEWAY_ALLOWED_INPUTS[operation];
  if (!allowed || Object.keys(input).some(function(key) { return !allowed[key]; })) throw petHealthGatewayError_('INVALID_INPUT');
  if (input.petId !== 'popio') throw petHealthGatewayError_('INVALID_INPUT');
  if (operation === 'pet.health.listRecentEvents' && input.days !== 7) throw petHealthGatewayError_('INVALID_INPUT');
  if (operation === 'pet.health.getDashboard' && Object.prototype.hasOwnProperty.call(input, 'requestId') && !petHealthGatewayUuid_(input.requestId)) throw petHealthGatewayError_('INVALID_INPUT');
}

function petHealthGatewayBackendErrorCode_(result) {
  const code = String(result && result.error && result.error.code || '');
  if (code === 'UNAUTHORIZED') return 'CONFIGURATION_ERROR';
  return PET_HEALTH_GATEWAY_SAFE_ERRORS[code] ? code : 'PET_HEALTH_UNAVAILABLE';
}

function petHealthGatewayValidSuccess_(result, operation) {
  if (!result || result.success !== true || result.status !== 'SUCCESS' || result.operation !== operation || !petHealthGatewayObject_(result.data) || !petHealthGatewayValidWarnings_(result.warnings) || result.error !== null || result.schemaVersion !== 'pet-health-1.0') return false;
  if (operation === 'pet.health.record' || operation === 'pet.health.correct' || operation === 'pet.health.void') {
    const event = result.data.event, idempotency = result.data.idempotency;
    return Boolean(petHealthGatewayObject_(event) && String(event.eventId || '') && event.petId === 'popio' && String(event.eventType || '') && petHealthGatewayObject_(idempotency) && typeof idempotency.replayed === 'boolean');
  }
  const data = result.data;
  if (operation === 'pet.health.getDailySummary') return petHealthGatewayValidSummary_(data);
  if (operation === 'pet.health.listRecentEvents') return data.petId === 'popio' && data.days === 7 && /^\d{4}-\d{2}-\d{2}$/.test(String(data.fromLocalDate || '')) && /^\d{4}-\d{2}-\d{2}$/.test(String(data.toLocalDate || '')) && data.timezone === 'Asia/Tokyo' && Array.isArray(data.events) && data.events.every(petHealthGatewayValidRecentEvent_);
  return operation === 'pet.health.getDashboard' && data.petId === 'popio' && /^\d{4}-\d{2}-\d{2}$/.test(String(data.localDate || '')) && data.timezone === 'Asia/Tokyo' && petHealthGatewayValidSummary_(data.summary) && data.summary.localDate === data.localDate && Array.isArray(data.recentEvents) && data.recentEvents.every(petHealthGatewayValidRecentEvent_);
}

function petHealthGatewayValidSummary_(data) {
  return petHealthGatewayObject_(data) && data.petId === 'popio' && /^\d{4}-\d{2}-\d{2}$/.test(String(data.localDate || '')) && data.timezone === 'Asia/Tokyo' && petHealthGatewayObject_(data.meal) && petHealthGatewayObject_(data.water) && petHealthGatewayObject_(data.stool) && petHealthGatewayObject_(data.urine) && (data.latestWeight === null || petHealthGatewayObject_(data.latestWeight)) && Array.isArray(data.notableObservations) && data.notableObservations.every(petHealthGatewayObject_);
}

function petHealthGatewayValidRecentEvent_(event) {
  if (!petHealthGatewayObject_(event) || !String(event.eventId || '') || !PET_HEALTH_GATEWAY_RECENT_EVENT_FIELDS[event.eventType] || !Number.isFinite(new Date(String(event.occurredAt || '')).getTime()) || !Number.isFinite(new Date(String(event.recordedAt || '')).getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(String(event.localDate || ''))) return false;
  const allowed = { eventId: true, eventType: true, occurredAt: true, localDate: true, recordedAt: true };
  PET_HEALTH_GATEWAY_RECENT_EVENT_FIELDS[event.eventType].forEach(function(key) { allowed[key] = true; });
  return Object.keys(event).every(function(key) { return allowed[key]; });
}

function petHealthGatewayObject_(value) {
  return Boolean(value) && Object.prototype.toString.call(value) === '[object Object]';
}

function petHealthGatewayValidWarnings_(warnings) {
  return Array.isArray(warnings) && warnings.length <= 10 && warnings.every(function(warning) {
    return typeof warning === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(warning);
  });
}

function petHealthGatewayError_(code) { const error = new Error(String(code || 'PET_HEALTH_UNAVAILABLE')); error.code = String(code || 'PET_HEALTH_UNAVAILABLE'); return error; }
