function homeAgent_(body) {
  return json_(runHomeAgentRequest_(body || {}));
}

function runHomeAgentRequest_(body) {
  const startedAt = new Date();
  const request = normalizeHomeAgentRequest_(body, startedAt);
  const warnings = [];
  const errors = [];
  const skillResults = {};
  const usedSkills = [];

  const intent = request.intent || detectHomeAgentIntent_(request.message);
  request.intent = intent;

  if (intent !== HOME_AGENT_INTENT_DAILY_DEPARTURE_CHECK) {
    warnings.push('home_agent_intent_not_matched');
    return buildHomeAgentResponse_(request, {
      success: false,
      assignedAgents: ['paruru'],
      usedSkills: [],
      result: {
        message: 'Home Agentで扱う質問として判定できませんでした。通常メモ保存はcreateWithAIを使ってください。',
      },
      requiresConfirmation: false,
      warnings: warnings,
      errors: [],
      startedAt: startedAt,
    });
  }

  const assignedAgents = getHomeAgentsForIntent_(intent);
  const skillSequence = getHomeSkillSequenceForIntent_(intent);

  skillSequence.forEach(function(skillId) {
    const result = invokeHomeSkill_(skillId, request, skillResults);
    skillResults[skillId] = result;
    usedSkills.push(skillId);
    (result.warnings || []).forEach(function(warning) {
      if (shouldPropagateHomeAgentSkillWarning_(skillId, warning, result)) {
        warnings.push(skillId + ':' + warning);
      }
    });
    if (!result.success) {
      errors.push({
        skill: skillId,
        code: result.error && result.error.code,
        message: result.error && result.error.message,
      });
    }
  });

  const departure = skillResults.buildDepartureCheck && skillResults.buildDepartureCheck.data
    ? skillResults.buildDepartureCheck.data
    : {};
  if (departure && departure.summary) {
    departure.summary = localizeHomeAgentSummaryDate_(departure.summary, request.parameters.date, startedAt);
  }
  const alertCandidate = createSignageAlertSkill_(request, {
    buildDepartureCheck: skillResults.buildDepartureCheck,
  });
  const actionCandidates = alertCandidate && alertCandidate.success && alertCandidate.data && alertCandidate.data.action
      && alertCandidate.data.action.parameters && alertCandidate.data.action.parameters.message
    ? [alertCandidate.data.action]
    : [];

  const finishedAt = new Date();
  const audit = buildHomeAgentAudit_(request, {
    assignedAgents: assignedAgents,
    usedSkills: usedSkills,
    success: Boolean(skillResults.buildDepartureCheck && skillResults.buildDepartureCheck.success),
    executedAt: formatHomeAgentDateTime_(finishedAt),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    warnings: warnings,
  });

  return buildHomeAgentResponse_(request, {
    success: audit.success,
    assignedAgents: assignedAgents,
    usedSkills: usedSkills,
    result: departure,
    skillResults: skillResults,
    actionCandidates: actionCandidates,
    requiresConfirmation: false,
    warnings: warnings,
    errors: errors,
    audit: audit,
    startedAt: startedAt,
  });
}

function normalizeHomeAgentRequest_(body, now) {
  const parameters = Object.assign({}, body.parameters || {});
  const message = String(body.message || body.memo || '').trim();
  const explicitDate = parameters.date || body.date;
  const date = explicitDate
    ? normalizeHomeAgentDate_(explicitDate, now)
    : resolveHomeAgentMessageDate_(message, now);
  parameters.date = date;

  return {
    requestId: String(body.requestId || Utilities.getUuid()),
    conversationId: String(body.conversationId || ''),
    userId: String(body.userId || ''),
    deviceId: String(body.deviceId || ''),
    message: message,
    intent: String(body.intent || '').trim(),
    parameters: parameters,
    context: Object.assign({}, body.context || {}),
    timezone: String(body.timezone || HOME_AGENT_TIMEZONE),
    useMocks: body.useMocks === true,
    allowActiveSpreadsheetFallback: body.allowActiveSpreadsheetFallback === true,
  };
}

function detectHomeAgentIntent_(message) {
  const text = String(message || '').trim();
  if (!text) return '';

  const questionSignals = [
    '？', '?', '教えて', 'なに', '何', 'ある', 'いる', '要る', 'チェック',
    '予定', '持ち物', '出かけ', '出発', '傘', '給食', '学校',
  ];
  const dailySignals = [
    '今日', '本日', '朝', '出発前', '出かける前', '登校', '予定', '持ち物',
    '傘', '給食', '学校',
  ];
  const memoLikeShopping = /買う$|買って$|買っとく$|購入$/.test(text);

  if (memoLikeShopping && text.indexOf('？') === -1 && text.indexOf('?') === -1 && text.indexOf('教えて') === -1) {
    return '';
  }

  const hasQuestion = questionSignals.some(function(signal) {
    return text.indexOf(signal) !== -1;
  });
  const hasDaily = dailySignals.some(function(signal) {
    return text.indexOf(signal) !== -1;
  });

  return hasQuestion && hasDaily ? HOME_AGENT_INTENT_DAILY_DEPARTURE_CHECK : '';
}

function buildHomeAgentResponse_(request, options) {
  const finishedAt = new Date();
  const response = {
    success: options.success === true,
    requestId: request.requestId,
    conversationId: request.conversationId,
    intent: request.intent,
    assignedAgents: options.assignedAgents || [],
    usedSkills: options.usedSkills || [],
    result: options.result || {},
    requiresConfirmation: options.requiresConfirmation === true,
    warnings: options.warnings || [],
    errors: options.errors || [],
    executedAt: formatHomeAgentDateTime_(finishedAt),
    durationMs: options.startedAt ? finishedAt.getTime() - options.startedAt.getTime() : 0,
  };

  if (options.skillResults) {
    response.skillResults = options.skillResults;
  }

  response.actionCandidates = options.actionCandidates || [];

  if (options.audit) {
    response.audit = options.audit;
  }

  return response;
}

function buildHomeAgentAudit_(request, options) {
  return {
    requestId: request.requestId,
    userId: request.userId,
    intent: request.intent,
    assignedAgents: options.assignedAgents || [],
    usedSkills: options.usedSkills || [],
    success: options.success === true,
    executedAt: options.executedAt,
    durationMs: options.durationMs,
    warnings: options.warnings || [],
  };
}

function shouldPropagateHomeAgentSkillWarning_(skillId, warning, result) {
  if (skillId === 'getSchoolLunch') {
    return false;
  }
  return true;
}

function homeAgentSkillResult_(skill, agent, data, meta) {
  const now = new Date();
  const options = meta || {};
  return {
    success: true,
    skill: skill,
    agent: agent,
    data: data || {},
    source: options.source || '',
    retrievedAt: options.retrievedAt || formatHomeAgentDateTime_(now),
    sourceUpdatedAt: options.sourceUpdatedAt || '',
    freshness: options.freshness || 'unknown',
    warnings: options.warnings || [],
    requiresConfirmation: options.requiresConfirmation === true,
  };
}

function homeAgentSkillError_(skill, agent, code, message) {
  return {
    success: false,
    skill: skill,
    agent: agent,
    data: {},
    source: '',
    retrievedAt: formatHomeAgentDateTime_(new Date()),
    sourceUpdatedAt: '',
    freshness: 'unknown',
    warnings: [],
    requiresConfirmation: false,
    error: {
      code: code,
      message: message,
    },
  };
}

function normalizeHomeAgentDate_(value, now) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const monthDay = raw.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (monthDay) {
    const base = now || new Date();
    const year = Number(Utilities.formatDate(base, HOME_AGENT_TIMEZONE, 'yyyy'));
    return formatHomeAgentDate_(new Date(year, Number(monthDay[1]) - 1, Number(monthDay[2])));
  }

  return Utilities.formatDate(now || new Date(), HOME_AGENT_TIMEZONE, 'yyyy-MM-dd');
}

function resolveHomeAgentMessageDate_(message, now) {
  const text = String(message || '').trim();
  const base = now || new Date();
  const explicitIso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (explicitIso) {
    return explicitIso[1] + '-' + explicitIso[2] + '-' + explicitIso[3];
  }

  const monthDay = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (monthDay) {
    const year = Number(Utilities.formatDate(base, HOME_AGENT_TIMEZONE, 'yyyy'));
    return formatHomeAgentDate_(new Date(year, Number(monthDay[1]) - 1, Number(monthDay[2])));
  }

  if (/あさって|明後日/.test(text)) {
    return addHomeAgentDays_(base, 2);
  }
  if (/明日|あした|あす/.test(text)) {
    return addHomeAgentDays_(base, 1);
  }
  if (/今日|本日/.test(text)) {
    return addHomeAgentDays_(base, 0);
  }
  return addHomeAgentDays_(base, 0);
}

function addHomeAgentDays_(baseDate, days) {
  const baseText = Utilities.formatDate(baseDate || new Date(), HOME_AGENT_TIMEZONE, 'yyyy-MM-dd');
  const parts = baseText.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  date.setDate(date.getDate() + Number(days || 0));
  return formatHomeAgentDate_(date);
}

function localizeHomeAgentSummaryDate_(summary, targetDate, now) {
  const text = String(summary || '');
  const label = getHomeAgentDateLabel_(targetDate, now);
  if (label === '今日') {
    return text;
  }
  return text.replace(/^今日は/, label + 'は');
}

function getHomeAgentDateLabel_(targetDate, now) {
  const today = addHomeAgentDays_(now || new Date(), 0);
  const tomorrow = addHomeAgentDays_(now || new Date(), 1);
  const dayAfterTomorrow = addHomeAgentDays_(now || new Date(), 2);
  if (targetDate === today) return '今日';
  if (targetDate === tomorrow) return '明日';
  if (targetDate === dayAfterTomorrow) return 'あさって';

  const parts = String(targetDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return '対象日';
  return Number(parts[2]) + '月' + Number(parts[3]) + '日';
}

function parseHomeAgentDate_(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error('date must be yyyy-MM-dd');
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatHomeAgentDate_(date) {
  return Utilities.formatDate(date, HOME_AGENT_TIMEZONE, 'yyyy-MM-dd');
}

function formatHomeAgentDateTime_(date) {
  return Utilities.formatDate(date, HOME_AGENT_TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function formatHomeAgentTime_(date) {
  return Utilities.formatDate(date, HOME_AGENT_TIMEZONE, 'HH:mm');
}

function sameHomeAgentDate_(left, right) {
  if (!(left instanceof Date) || !(right instanceof Date)) return false;
  return formatHomeAgentDate_(left) === formatHomeAgentDate_(right);
}

function testHomeAgentRelativeDateParsing_() {
  const base = new Date(2026, 6, 12, 9, 0, 0);
  const cases = [
    ['今日の予定と持ち物教えて', '2026-07-12'],
    ['本日の予定教えて', '2026-07-12'],
    ['明日の予定と持ち物教えて', '2026-07-13'],
    ['あしたの予定教えて', '2026-07-13'],
    ['あすの給食なに？', '2026-07-13'],
    ['あさっての給食なに？', '2026-07-14'],
    ['明後日の予定教えて', '2026-07-14'],
    ['2026-07-20の予定教えて', '2026-07-20'],
    ['7月20日の予定教えて', '2026-07-20'],
  ];

  cases.forEach(function(testCase) {
    const actual = resolveHomeAgentMessageDate_(testCase[0], base);
    if (actual !== testCase[1]) {
      throw new Error(testCase[0] + ' expected ' + testCase[1] + ' but got ' + actual);
    }
  });

  const explicit = normalizeHomeAgentRequest_({
    message: '明日の予定教えて',
    parameters: { date: '2026-07-20' },
  }, base);
  if (explicit.parameters.date !== '2026-07-20') {
    throw new Error('parameters.date should override message date');
  }

  console.log('testHomeAgentRelativeDateParsing_ passed');
}

function testHomeAgentDailyDepartureCheck(date) {
  const result = runHomeAgentRequest_({
    action: 'homeAgent',
    message: '今日の予定と持ち物教えて',
    userId: 'father',
    deviceId: 'test-device',
    conversationId: 'test-conversation',
    parameters: {
      date: date || '2026-07-12',
    },
    timezone: HOME_AGENT_TIMEZONE,
    useMocks: true,
  });

  const requiredSkills = [
    'getFamilySchedule',
    'getSchoolSummary',
    'getSchoolLunch',
    'getWeatherSummary',
    'buildDepartureCheck',
  ];

  if (result.intent !== HOME_AGENT_INTENT_DAILY_DEPARTURE_CHECK) {
    throw new Error('Intent判定がdaily_departure_checkになってへんで');
  }

  ['paruru', 'peno', 'shimao'].forEach(function(agentId) {
    if (result.assignedAgents.indexOf(agentId) === -1) {
      throw new Error('Agent assignment is missing: ' + agentId);
    }
  });

  requiredSkills.forEach(function(skillId) {
    if (result.usedSkills.indexOf(skillId) === -1) {
      throw new Error('Skillが実行されてへんで: ' + skillId);
    }
    if (!result.skillResults || !result.skillResults[skillId]) {
      throw new Error('Skill結果がないで: ' + skillId);
    }
    if (!result.skillResults[skillId].retrievedAt) {
      throw new Error('retrievedAtがないで: ' + skillId);
    }
  });

  if (!result.result || !result.result.date || !result.result.summary) {
    throw new Error('統合結果が不足してるで');
  }

  if (result.requiresConfirmation !== false) {
    throw new Error('Home Agent response should not require confirmation for read-only answer generation');
  }

  if (!result.actionCandidates || !result.actionCandidates.length || !result.actionCandidates[0].requiresConfirmation) {
    throw new Error('Signage Alert candidate should be returned as confirmation-required actionCandidate');
  }

  console.log(JSON.stringify({
    success: result.success,
    intent: result.intent,
    assignedAgents: result.assignedAgents,
    usedSkills: result.usedSkills,
    result: result.result,
    warnings: result.warnings,
    actionCandidates: result.actionCandidates,
    audit: result.audit,
  }, null, 2));

  return result;
}

function testHomeAgentDailyDepartureCheckReal(date) {
  const result = runHomeAgentRequest_({
    action: 'homeAgent',
    message: '今日の予定と持ち物教えて',
    userId: 'father',
    deviceId: 'test-device',
    conversationId: 'test-conversation',
    parameters: {
      date: date || Utilities.formatDate(new Date(), HOME_AGENT_TIMEZONE, 'yyyy-MM-dd'),
    },
    timezone: HOME_AGENT_TIMEZONE,
    useMocks: false,
  });

  console.log(JSON.stringify({
    success: result.success,
    intent: result.intent,
    assignedAgents: result.assignedAgents,
    usedSkills: result.usedSkills,
    result: result.result,
    warnings: result.warnings,
    errors: result.errors,
    actionCandidates: result.actionCandidates,
    audit: result.audit,
  }, null, 2));

  return result;
}

function testHomeAgentFamilyScheduleConnection(date) {
  const request = buildHomeAgentConnectionTestRequest_(date, false);
  const result = invokeHomeSkill_('getFamilySchedule', request, {});
  return logHomeAgentConnectionTestResult_(result);
}

function testHomeAgentSchoolSummaryConnection(date, allowActiveSpreadsheetFallback) {
  const request = buildHomeAgentConnectionTestRequest_(date, allowActiveSpreadsheetFallback === true);
  const result = invokeHomeSkill_('getSchoolSummary', request, {});
  return logHomeAgentConnectionTestResult_(result);
}

function testHomeAgentSchoolLunchConnection(date, allowActiveSpreadsheetFallback) {
  const request = buildHomeAgentConnectionTestRequest_(date, allowActiveSpreadsheetFallback === true);
  const result = invokeHomeSkill_('getSchoolLunch', request, {});
  return logHomeAgentConnectionTestResult_(result);
}

function testHomeAgentWeatherConnection(date, allowActiveSpreadsheetFallback) {
  const request = buildHomeAgentConnectionTestRequest_(date, allowActiveSpreadsheetFallback === true);
  const result = invokeHomeSkill_('getWeatherSummary', request, {});
  return logHomeAgentConnectionTestResult_(result);
}

function testHomeAgentWeatherConnection20260712() {
  return testHomeAgentWeatherConnection('2026-07-12', false);
}

function testHomeAgentDailyDepartureCheck20260712() {
  return testHomeAgentDailyDepartureCheckReal('2026-07-12');
}

function testHomeAgentDailyDepartureCheckMock20260712() {
  return testHomeAgentDailyDepartureCheck('2026-07-12');
}

function testHomeAgentCalendarDateFiltering() {
  const cases = [
    {
      name: 'single_day_all_day_end_is_exclusive',
      targetDate: '2026-07-12',
      event: makeHomeAgentCalendarTestEvent_('2026-07-11', '2026-07-12', true),
      expected: false,
    },
    {
      name: 'multi_day_all_day_includes_before_end',
      targetDate: '2026-07-12',
      event: makeHomeAgentCalendarTestEvent_('2026-07-11', '2026-07-14', true),
      expected: true,
    },
    {
      name: 'multi_day_all_day_end_day_is_exclusive',
      targetDate: '2026-07-14',
      event: makeHomeAgentCalendarTestEvent_('2026-07-11', '2026-07-14', true),
      expected: false,
    },
    {
      name: 'timed_overnight_overlaps_target',
      targetDate: '2026-07-12',
      event: makeHomeAgentCalendarTestEvent_('2026-07-11 23:00:00', '2026-07-12 01:00:00', false),
      expected: true,
    },
    {
      name: 'timed_event_ending_at_day_start_is_excluded',
      targetDate: '2026-07-12',
      event: makeHomeAgentCalendarTestEvent_('2026-07-11 23:00:00', '2026-07-12 00:00:00', false),
      expected: false,
    },
  ];

  const results = cases.map(function(testCase) {
    const targetStart = parseHomeAgentDate_(testCase.targetDate);
    targetStart.setHours(0, 0, 0, 0);
    const targetEnd = new Date(targetStart.getTime());
    targetEnd.setDate(targetEnd.getDate() + 1);
    const actual = isHomeAgentCalendarEventOnTargetDate_(testCase.event, targetStart, targetEnd);
    if (actual !== testCase.expected) {
      throw new Error(testCase.name + ' failed: expected=' + testCase.expected + ', actual=' + actual);
    }
    return {
      name: testCase.name,
      success: true,
    };
  });

  console.log(JSON.stringify(results, null, 2));
  return results;
}

function testHomeAgentLunchWarningRules() {
  const nonSchoolResult = buildDepartureCheckSkill_({
    parameters: { date: '2026-07-12' },
  }, {
    getSchoolSummary: homeAgentSkillResult_('getSchoolSummary', 'peno', {
      date: '2026-07-12',
      isSchoolDay: false,
      events: [],
    }, { source: 'test', freshness: 'current' }),
    getSchoolLunch: homeAgentSkillResult_('getSchoolLunch', 'peno', {
      date: '2026-07-12',
      status: 'no_data',
      menu: '',
    }, { source: 'test', freshness: 'unknown', warnings: ['lunch_row_not_found'] }),
  });

  const schoolResult = buildDepartureCheckSkill_({
    parameters: { date: '2026-07-13' },
  }, {
    getSchoolSummary: homeAgentSkillResult_('getSchoolSummary', 'peno', {
      date: '2026-07-13',
      isSchoolDay: true,
      events: [],
    }, { source: 'test', freshness: 'current' }),
    getSchoolLunch: homeAgentSkillResult_('getSchoolLunch', 'peno', {
      date: '2026-07-13',
      status: 'no_data',
      menu: '',
    }, { source: 'test', freshness: 'unknown', warnings: ['lunch_row_not_found'] }),
  });

  if (nonSchoolResult.warnings.indexOf('lunch_data_not_available') !== -1) {
    throw new Error('Non-school day should not warn about missing lunch data');
  }
  if (schoolResult.warnings.indexOf('lunch_data_not_available') === -1) {
    throw new Error('School day should warn about missing lunch data');
  }

  const result = {
    nonSchoolDayWarnings: nonSchoolResult.warnings,
    schoolDayWarnings: schoolResult.warnings,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function makeHomeAgentCalendarTestEvent_(start, end, allDay) {
  return {
    getStartTime: function() { return parseHomeAgentTestDateTime_(start); },
    getEndTime: function() { return parseHomeAgentTestDateTime_(end); },
    isAllDayEvent: function() { return allDay === true; },
  };
}

function parseHomeAgentTestDateTime_(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) {
    throw new Error('Invalid test datetime: ' + text);
  }
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] || 0),
    Number(match[5] || 0),
    Number(match[6] || 0)
  );
}

function testHomeAgentRequiredProperties() {
  const keys = [
    'PALURU_SCHOOL_SPREADSHEET_ID',
    'PALURU_WEATHER_SPREADSHEET_ID',
    'PALURU_FAMILY_CALENDAR_ID',
  ];
  const result = keys.reduce(function(out, key) {
    out[key] = Boolean(getHomeAgentProperty_(key, ''));
    return out;
  }, {});
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function testHomeAgentWeatherSpreadsheetInventory() {
  const ss = openHomeAgentOptionalSpreadsheet_('PALURU_WEATHER_SPREADSHEET_ID', {
    allowActiveSpreadsheetFallback: false,
  });
  if (!ss) {
    const result = {
      success: false,
      errorCode: 'WEATHER_SOURCE_NOT_CONFIGURED',
      sheets: [],
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  const sheets = ss.getSheets().map(function(sheet) {
    const lastColumn = sheet.getLastColumn();
    const lastRow = sheet.getLastRow();
    const headers = lastColumn > 0
      ? sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(function(value) {
          return String(value || '').trim();
        }).filter(function(value) {
          return value !== '';
        })
      : [];
    return {
      name: sheet.getName(),
      lastRow: lastRow,
      lastColumn: lastColumn,
      headers: headers,
      weatherRelevance: classifyHomeAgentWeatherSheet_(sheet.getName(), headers),
    };
  });

  const result = {
    success: true,
    spreadsheetConfigured: true,
    sheets: sheets,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function classifyHomeAgentWeatherSheet_(sheetName, headers) {
  const text = [sheetName].concat(headers || []).join(' ').toLowerCase();
  if (/signage_status|weather_miyamae|weather_hibiya|weather_machida|weather_tachikawa/.test(text)) {
    return 'four_point_weather_candidate';
  }
  if (/message|shimao/.test(text)) {
    return 'shimao_text_candidate';
  }
  if (/weather|forecast|precip|rain|天気|降水/.test(text)) {
    return 'weather_candidate';
  }
  if (/temperature|humidity|温度|湿度|温湿度/.test(text)) {
    return 'climate_not_forecast';
  }
  if (/aiseg|power|watt|電力|エアコン|aircon/.test(text)) {
    return 'energy_or_aircon_not_forecast';
  }
  return 'unknown';
}

function buildHomeAgentConnectionTestRequest_(date, allowActiveSpreadsheetFallback) {
  return normalizeHomeAgentRequest_({
    action: 'homeAgent',
    message: '今日の予定と持ち物教えて',
    userId: 'connection-test',
    deviceId: 'connection-test',
    parameters: {
      date: date || Utilities.formatDate(new Date(), HOME_AGENT_TIMEZONE, 'yyyy-MM-dd'),
    },
    timezone: HOME_AGENT_TIMEZONE,
    useMocks: false,
    allowActiveSpreadsheetFallback: allowActiveSpreadsheetFallback === true,
  }, new Date());
}

function logHomeAgentConnectionTestResult_(result) {
  const summary = summarizeHomeAgentConnectionTestResult_(result);
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

function summarizeHomeAgentConnectionTestResult_(result) {
  const data = result && result.data ? result.data : {};
  return {
    success: Boolean(result && result.success),
    skill: result ? result.skill : '',
    source: result ? result.source : '',
    count: countHomeAgentConnectionRows_(result ? result.skill : '', data),
    retrievedAt: result ? result.retrievedAt : '',
    sourceUpdatedAt: result ? result.sourceUpdatedAt : '',
    freshness: result ? result.freshness : 'unknown',
    warnings: result ? result.warnings || [] : [],
    errorCode: result && result.error ? result.error.code : '',
    status: data.status || '',
    location: data.location || '',
    forecastDate: data.forecastDate || '',
    precipitationProbability: data.precipitationProbability !== undefined ? data.precipitationProbability : '',
    umbrellaRecommended: data.umbrellaRecommended === true,
  };
}

function countHomeAgentConnectionRows_(skill, data) {
  if (skill === 'getFamilySchedule') {
    return data.events ? data.events.length : 0;
  }
  if (skill === 'getSchoolSummary') {
    return (data.events ? data.events.length : 0) + (data.sourceSheets ? data.sourceSheets.length : 0);
  }
  if (skill === 'getSchoolLunch') {
    return data.menu ? 1 : 0;
  }
  if (skill === 'getWeatherSummary') {
    return [
      data.weatherText,
      data.currentTemperature,
      data.maxTemperature,
      data.minTemperature,
      data.precipitationProbability,
    ].filter(function(value) {
      return value !== '' && value != null;
    }).length;
  }
  return 0;
}
