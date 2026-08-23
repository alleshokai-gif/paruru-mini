const NURSE_OKAN_COMMENT_AGENT_ACTION = 'agent.nurseOkanComment';
const NURSE_OKAN_COMMENT_CONTEXT_VERSION = 'nurse-okan-comment-1';
const NURSE_OKAN_COMMENT_TIME_ZONE = 'Asia/Tokyo';
const NURSE_OKAN_COMMENT_SLOTS = Object.freeze(['morning', 'lunch', 'post_training', 'dinner', 'condition']);
const NURSE_OKAN_COMMENT_RULE_CODES = Object.freeze({
  morning_not_recorded: true, post_training_not_recorded: true, dinner_not_recorded: true,
  morning_fuel_missing: true, post_training_fuel_missing: true, protein_source_missing: true,
  symptom_attention: true, weight_gain_stalled: true, on_track: true,
});
const NURSE_OKAN_COMMENT_DUE_HOURS = Object.freeze({ morning: 9, lunch: 15, dinner: 22, condition: 23 });

function nurseOkanComment_(body) {
  const trace = createMiniAgentTrace_(body, 'nurseOkanComment');
  let guard = null;
  let settled = false;
  let outcome = null;
  logMiniAgentTrace_('REQUEST_RECEIVED', trace, { stage: 'REQUEST_RECEIVED' });
  try {
    const request = validateNurseOkanCommentRequest_(body);
    const healthContext = resolveHealthGatewayContext_({
      deviceId: request.deviceId,
      pairingToken: request.pairingToken,
      targetMemberUserId: request.targetMemberUserId,
    });
    if (!healthContext.targetUserId) throw healthGatewayError_('INVALID_INPUT');
    const facts = loadNurseOkanCommentFacts_(healthContext, nurseOkanCommentLocalDate_());
    const commentContext = buildNurseOkanCommentContext_(facts, new Date());
    const agentInput = buildNurseOkanCommentAgentInput_(request, healthContext.actor, commentContext);
    const costGuard = AgentCostGuardService.preflight({
      guardRequestId: request.clientRequestId,
      actor: agentInput.actor,
      responsePolicyId: agentInput.responsePolicyId,
      interactionClass: 'health_comment',
    });
    if (!costGuard || costGuard.allowed !== true) {
      throw createAgentGatewayError_(String(costGuard && costGuard.errorCode || 'AGENT_RATE_LIMITED'), 'COST_GUARD', String(costGuard && costGuard.guardReason || 'health_comment'));
    }
    guard = costGuard;
    const response = callNurseOkanCommentAgent_(getPaluruAgentConfig_(), agentInput, trace);
    outcome = buildNurseOkanCommentCostGuardOutcome_(response, 'completed');
    AgentCostGuardService.settle(guard, outcome);
    settled = true;
    logMiniAgentTrace_('RESPONSE_SENT', trace, { stage: 'RESPONSE_SENT', httpStatus: 200, agentPerformance: response.diagnostics });
    persistAgentTrace_(trace);
    return json_({ success: true, data: { comment: response.comment }, message: 'ok' });
  } catch (error) {
    if (guard && !settled) {
      try { AgentCostGuardService.settle(guard, outcome || buildNurseOkanCommentCostGuardOutcome_(null, 'agent_error')); } catch (_) {}
    }
    const code = nurseOkanCommentErrorCode_(error);
    logMiniAgentTrace_('RESPONSE_SENT', trace, { stage: String(error && error.agentTraceStage || 'UNHANDLED_ERROR'), httpStatus: 200, errorCode: code, reason: 'NURSE_OKAN_COMMENT' });
    persistAgentTrace_(trace);
    return json_({ success: false, data: {}, error: { code: code }, message: 'nurse comment unavailable' });
  }
}

function validateNurseOkanCommentRequest_(body) {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const clientRequestId = String(input.clientRequestId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientRequestId)) throw healthGatewayError_('INVALID_INPUT');
  return {
    clientRequestId: clientRequestId,
    deviceId: input.deviceId,
    pairingToken: input.pairingToken,
    targetMemberUserId: String(input.targetMemberUserId || '').trim(),
  };
}

function nurseOkanCommentLocalDate_() {
  return Utilities.formatDate(new Date(), NURSE_OKAN_COMMENT_TIME_ZONE, 'yyyy-MM-dd');
}

function shiftNurseOkanCommentDate_(localDate, days) {
  const parts = String(localDate || '').split('-').map(Number);
  const value = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + Number(days || 0)));
  return [value.getUTCFullYear(), String(value.getUTCMonth() + 1).padStart(2, '0'), String(value.getUTCDate()).padStart(2, '0')].join('-');
}

function loadNurseOkanCommentFacts_(healthContext, localDate) {
  const actor = healthContext.actor;
  const targetUserId = healthContext.targetUserId;
  const read = function(operation, payload) {
    authorizeTargetOperation_(actor, targetUserId, operation);
    return fetchHealthGatewayData_(Object.assign({ action: operation }, payload || {}), actor, targetUserId);
  };
  return {
    localDate: localDate,
    daily: read('health.daily.get', { localDate: localDate }),
    recent: read('health.daily.list', { fromLocalDate: shiftNurseOkanCommentDate_(localDate, -6), toLocalDate: localDate }),
    weights: read('health.weight.list', { fromLocalDate: shiftNurseOkanCommentDate_(localDate, -29), toLocalDate: localDate }),
  };
}

function buildNurseOkanCommentAgentInput_(request, actor, commentContext) {
  return {
    clientRequestId: request.clientRequestId,
    responsePolicyId: (actor.role === 'guardian' || actor.role === 'self_record') ? 'concise' : 'normal',
    actor: {
      memberUserId: String(actor.memberUserId || '').trim().slice(0, 100),
      displayName: String(actor.displayName || '').trim().slice(0, 100),
      role: String(actor.role || '').trim().slice(0, 100),
      capabilities: Array.isArray(actor.capabilities) ? actor.capabilities.slice() : [],
      homeId: String(actor.homeId || '').trim().slice(0, 200),
      deviceId: String(actor.deviceId || '').trim().slice(0, 200),
    },
    commentContext: commentContext,
  };
}

function callNurseOkanCommentAgent_(config, input, trace) {
  const payload = {
    action: NURSE_OKAN_COMMENT_AGENT_ACTION,
    clientRequestId: input.clientRequestId,
    responsePolicyId: input.responsePolicyId,
    actor: input.actor,
    commentContext: input.commentContext,
    authToken: config.token,
  };
  logMiniAgentTrace_('AGENT_REQUEST_START', trace, { stage: 'AGENT_REQUEST' });
  let response;
  try {
    response = UrlFetchApp.fetch(config.url, { method: 'post', contentType: 'text/plain;charset=utf-8', payload: JSON.stringify(payload), muteHttpExceptions: true });
  } catch (_) {
    throw createAgentGatewayError_('AGENT_UNAVAILABLE', 'AGENT_REQUEST', 'URLFETCH_FAILED');
  }
  if (!response || response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw createAgentGatewayError_('AGENT_UNAVAILABLE', 'AGENT_REQUEST', 'UPSTREAM_HTTP_' + String(response && response.getResponseCode() || ''));
  let parsed;
  try { parsed = JSON.parse(String(response.getContentText() || '')); } catch (_) { throw createAgentGatewayError_('AGENT_UNAVAILABLE', 'AGENT_RESPONSE', 'UPSTREAM_JSON_PARSE_FAILED'); }
  appendAgentTraceEntries_(trace, parsed && parsed.traceEvents);
  if (!parsed || parsed.success !== true || !parsed.data || typeof parsed.data !== 'object') {
    throw createAgentGatewayError_(safeUpstreamAgentErrorCode_(parsed), 'UPSTREAM_AGENT_FAILED', 'NURSE_OKAN_COMMENT');
  }
  const comment = validateNurseOkanCommentOutput_(parsed.data.comment);
  const usage = parsed.data.usage && typeof parsed.data.usage === 'object' ? parsed.data.usage : {};
  if (Number(usage.modelCallCount) !== 1) throw createAgentGatewayError_('AGENT_ERROR', 'AGENT_RESPONSE', 'MODEL_CALL_LIMIT');
  return { comment: comment, usage: usage, diagnostics: parsed.data.diagnostics && typeof parsed.data.diagnostics === 'object' ? parsed.data.diagnostics : {} };
}

function validateNurseOkanCommentOutput_(value) {
  const text = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const sentenceCount = text.split(/[。！？]/).filter(function(part) { return String(part || '').trim() !== ''; }).length;
  if (!text || Array.from(text).length > 100 || sentenceCount < 1 || sentenceCount > 3) throw createAgentGatewayError_('AGENT_ERROR', 'AGENT_RESPONSE', 'COMMENT_INVALID');
  return text;
}

function buildNurseOkanCommentCostGuardOutcome_(response, eventType) {
  const usage = response && response.usage && typeof response.usage === 'object' ? response.usage : {};
  return {
    eventType: eventType === 'completed' ? 'completed' : 'agent_error',
    model: 'unknown',
    interactionClass: 'health_comment',
    resultStatus: eventType === 'completed' ? 'SUCCESS' : 'UNAVAILABLE',
    usage: {
      inputTokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : null,
      outputTokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : null,
      totalTokens: typeof usage.totalTokens === 'number' ? usage.totalTokens : null,
      modelCallCount: Number(usage.modelCallCount) === 1 ? 1 : null,
      usageStatus: String(usage.usageStatus || '') === 'available' ? 'available' : 'unavailable',
    },
  };
}

function nurseOkanCommentErrorCode_(error) {
  const code = String(error && error.code || '');
  return {
    UNAUTHORIZED_DEVICE: true, MEMBERSHIP_NOT_FOUND: true, FORBIDDEN: true, INVALID_INPUT: true,
    CONFIGURATION_ERROR: true, HEALTH_UNAVAILABLE: true, AGENT_UNAVAILABLE: true,
    AGENT_ERROR: true, AGENT_BUSY: true, AGENT_RATE_LIMITED: true,
  }[code] ? code : 'AGENT_UNAVAILABLE';
}

function buildNurseOkanCommentContext_(facts, now) {
  const source = facts && typeof facts === 'object' ? facts : {};
  const localDate = String(source.localDate || '');
  const daily = source.daily && typeof source.daily === 'object' ? source.daily : {};
  const slots = daily.slots && typeof daily.slots === 'object' ? daily.slots : {};
  const time = now instanceof Date ? now : new Date();
  const today = {};
  NURSE_OKAN_COMMENT_SLOTS.forEach(function(slot) {
    const value = slots[slot] && typeof slots[slot] === 'object' ? slots[slot] : null;
    const name = slot === 'post_training' ? 'postTraining' : slot;
    today[name] = buildNurseOkanCommentSlot_(slot, value, localDate, time);
  });
  return {
    version: NURSE_OKAN_COMMENT_CONTEXT_VERSION,
    localDate: localDate,
    today: today,
    ruleCodes: (Array.isArray(daily.ruleCodes) ? daily.ruleCodes : []).filter(function(code) { return NURSE_OKAN_COMMENT_RULE_CODES[String(code || '')] === true; }),
    weight: buildNurseOkanCommentWeight_(source.weights),
    recent: buildNurseOkanCommentRecent_(source.recent, localDate, time),
  };
}

function buildNurseOkanCommentSlot_(slot, value, localDate, now) {
  const recorded = Boolean(value && String(value.recordedAt || '').trim());
  if (recorded) {
    return {
      state: 'recorded',
      summary: formatNurseOkanCommentSummary_(slot, value),
      restDay: slot === 'post_training' && String(value.postTrainingStatus || '') === 'rest_day',
    };
  }
  return { state: nurseOkanCommentSlotState_(slot, localDate, now) };
}

function nurseOkanCommentSlotState_(slot, localDate, now) {
  if (slot === 'post_training') return 'unknown';
  const today = Utilities.formatDate(now, NURSE_OKAN_COMMENT_TIME_ZONE, 'yyyy-MM-dd');
  if (String(localDate) !== today) return 'missing';
  const hour = Number(Utilities.formatDate(now, NURSE_OKAN_COMMENT_TIME_ZONE, 'H'));
  return hour >= Number(NURSE_OKAN_COMMENT_DUE_HOURS[slot] || Infinity) ? 'due_missing' : 'not_due';
}

function safeNurseOkanCommentText_(value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 40);
}

function pushNurseOkanCommentPart_(parts, value) {
  const text = safeNurseOkanCommentText_(value);
  if (text && parts.indexOf(text) < 0) parts.push(text);
}

function formatNurseOkanCommentSummary_(slot, value) {
  const parts = [];
  if (slot === 'morning') {
    pushNurseOkanCommentPart_(parts, { banana_1: 'バナナ1本', rice_1: 'ご飯1杯', rice_2: 'ご飯2杯', bread_1: 'パン1個', bread_2: 'パン2個', cereal_1: 'シリアル1杯', yogurt_1: 'ヨーグルト1個', other: value.morningMealOther }[String(value.morningMealType || '')]);
    pushNurseOkanCommentPart_(parts, { milk_glass_1: '牛乳1杯', water_glass_1: '水1杯', water_bottle_1: '水1本', tea_glass_1: 'お茶1杯', tea_bottle_1: 'お茶1本', sports_drink_bottle_1: 'スポドリ1本', juice_glass_1: 'ジュース1杯', other: value.morningWaterOther }[String(value.morningWaterType || '')]);
    pushNurseOkanCommentPart_(parts, value.morningCondition ? '体調' + nurseOkanCommentConditionLabel_(value.morningConditionType, value.morningConditionOther) : '');
  } else if (slot === 'lunch') {
    const meal = { bento: '弁当', cafeteria: '学食', convenience_bento: 'コンビニ弁当', onigiri: 'おにぎり', bread: 'パン', noodles: '麺類', other: value.lunchMealOther }[String(value.lunchMealType || '')];
    const amount = { half: '半分', most: 'ほぼ完食', all: '完食' }[String(value.lunchAmount || '')];
    pushNurseOkanCommentPart_(parts, meal ? meal + (amount ? '・' + amount : '') : amount ? '昼食' + amount : '');
    pushNurseOkanCommentPart_(parts, { sports_drink_bottle_1: 'スポドリ1本', sports_drink_bottle_2: 'スポドリ2本', water_bottle_1: '水1本', tea_bottle_1: 'お茶1本', juice_bottle_1: 'ジュース1本', other: value.lunchWaterOther }[String(value.lunchWaterType || '')]);
  } else if (slot === 'post_training') {
    if (String(value.postTrainingStatus || '') === 'rest_day') return '部活なし';
    pushNurseOkanCommentPart_(parts, { onigiri_1: 'おにぎり1個', onigiri_2: 'おにぎり2個', onigiri_3: 'おにぎり3個', bread_1: 'パン1個', bread_2: 'パン2個', banana_1: 'バナナ1本', jelly_1: 'ゼリー1個', other: value.postTrainingSnackOther }[String(value.postTrainingSnackType || '')]);
    const protein = { protein: 'プロテイン', milk: '牛乳', yogurt: 'ヨーグルト', soy: '豆乳', other: value.postTrainingProteinOther }[String(value.postTrainingProteinSource || '')];
    pushNurseOkanCommentPart_(parts, value.postTrainingProteinAmount ? (protein === 'プロテイン' ? 'プロテイン' + value.postTrainingProteinAmount + 'g' : protein) : protein);
  } else if (slot === 'dinner') {
    const rice = /^rice_(\d+)/.exec(String(value.dinnerMealType || ''));
    pushNurseOkanCommentPart_(parts, rice ? 'ご飯' + rice[1] + '杯' : Number(value.dinnerRiceBowls) > 0 ? 'ご飯' + Number(value.dinnerRiceBowls) + '杯' : '');
    if (/_natto(?:_|$)/.test(String(value.dinnerMealType || '')) || Number(value.dinnerNattoPacks) > 0) pushNurseOkanCommentPart_(parts, '納豆' + (Number(value.dinnerNattoPacks) > 0 ? Number(value.dinnerNattoPacks) + 'P' : ''));
    pushNurseOkanCommentPart_(parts, { egg: '卵', dairy: '乳製品', tofu: '豆腐', fish: '魚', protein: 'プロテイン', other: 'その他' }[String(value.dinnerExtraProteinSource || '')] || (String(value.dinnerMealType || '') === 'other' ? value.dinnerMealOther : ''));
  } else if (slot === 'condition') {
    pushNurseOkanCommentPart_(parts, { good: '食欲良好', normal: '食欲ふつう', low: '食欲低下' }[String(value.conditionAppetite || '')]);
    const symptoms = Array.isArray(value.symptoms) ? value.symptoms : [];
    pushNurseOkanCommentPart_(parts, { dizziness: 'めまい', headache: '頭痛', nausea: '吐き気', cramps: '腹痛', marked_fatigue: '強いだるさ' }[String(symptoms[0] || '')] || '症状なし');
  }
  return parts.slice(0, 3).join(' / ') || '詳細なし';
}

function nurseOkanCommentConditionLabel_(type, other) {
  const label = { good: 'よい', slight_fever: '少し熱っぽい', fever: '発熱', fatigue: 'だるさ', cough: 'せき', throat: 'のど', nose: '鼻', headache: '頭痛', stomachache: '腹痛', nausea: '吐き気', muscle_pain: '筋肉痛', other: other }[String(type || '')];
  return safeNurseOkanCommentText_(label);
}

function nurseOkanCommentWeightRecords_(weights) {
  const source = weights && typeof weights === 'object' ? weights : {};
  const seen = {};
  return (Array.isArray(source.items) ? source.items : []).concat([source.latest, source.previous]).filter(function(item, index) {
    const weight = Number(item && item.weightKg);
    const key = String(item && item.recordId || '') || [String(item && item.measuredDate || ''), String(item && item.recordedAt || ''), String(weight), String(index)].join('|');
    if (seen[key] || !item || String(item.status || 'active') !== 'active' || !/^\d{4}-\d{2}-\d{2}$/.test(String(item.measuredDate || '')) || !Number.isFinite(weight) || weight <= 0) return false;
    seen[key] = true;
    return true;
  }).sort(function(a, b) { return String(a.measuredDate).localeCompare(String(b.measuredDate)) || String(a.recordedAt || '').localeCompare(String(b.recordedAt || '')); });
}

function buildNurseOkanCommentWeight_(weights) {
  const records = nurseOkanCommentWeightRecords_(weights);
  const latest = records.length ? records[records.length - 1] : null;
  const previous = records.length > 1 ? records[records.length - 2] : null;
  const periodDifference = function(days) {
    const lastDate = latest && String(latest.measuredDate || '');
    if (!lastDate) return null;
    const start = shiftNurseOkanCommentDate_(lastDate, 1 - days);
    const points = records.filter(function(record) { return String(record.measuredDate) >= start && String(record.measuredDate) <= lastDate; });
    return points.length > 1 ? Number(points[points.length - 1].weightKg) - Number(points[0].weightKg) : null;
  };
  return {
    latestKg: latest ? Number(latest.weightKg) : null,
    previousDifferenceKg: latest && previous ? Number(latest.weightKg) - Number(previous.weightKg) : null,
    sevenDayDifferenceKg: periodDifference(7),
    thirtyDayDifferenceKg: periodDifference(30),
    measurementCount: records.length,
  };
}

function buildNurseOkanCommentRecent_(recent, today, now) {
  const items = recent && Array.isArray(recent.items) ? recent.items : [];
  return { days: items.slice(0, 7).map(function(item) {
    const slots = item && item.slots && typeof item.slots === 'object' ? item.slots : {};
    const states = {};
    NURSE_OKAN_COMMENT_SLOTS.forEach(function(slot) {
      const value = slots[slot] && typeof slots[slot] === 'object' ? slots[slot] : null;
      states[slot === 'post_training' ? 'postTraining' : slot] = value && String(value.recordedAt || '').trim() ? 'recorded' : String(item && item.localDate || '') === String(today || '') ? nurseOkanCommentSlotState_(slot, today, now) : 'missing';
    });
    return { localDate: String(item && item.localDate || ''), states: states };
  }) };
}
