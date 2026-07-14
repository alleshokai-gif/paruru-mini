function homeAgent_(body) {
  return json_(runHomeAgentRequest_(body || {}));
}

function homeAgentAction_(body) {
  return json_(runHomeAgentAction_(body || {}));
}

function runHomeAgentAction_(body) {
  const candidate = body.candidate || {};
  const skill = String(body.skill || candidate.skill || candidate.action || '').trim();
  const parameters = Object.assign({}, candidate.parameters || {}, body.parameters || {});
  const request = normalizeHomeAgentRequest_({
    message: String(body.message || ''),
    userId: body.userId || '',
    userDisplayName: body.userDisplayName || '',
    deviceId: body.deviceId || '',
    parameters: parameters,
  }, new Date());

  if (body.confirmed !== true) {
    return {
      success: false,
      message: 'confirmation required',
      error: { code: 'CONFIRMATION_REQUIRED' },
    };
  }

  let result;
  if (skill === 'pauseRoomAutomation') {
    result = pauseRoomAutomationSkill_(request);
  } else if (skill === 'resumeRoomAutomation') {
    result = resumeRoomAutomationSkill_(request);
  } else if (skill === 'setAirconOverride') {
    return {
      success: false,
      message: 'aircon operation is not connected',
      error: { code: 'AIRCON_OPERATION_NOT_CONNECTED' },
    };
  } else {
    return {
      success: false,
      message: 'unsupported action',
      error: { code: 'UNSUPPORTED_HOME_AGENT_ACTION' },
    };
  }

  return {
    success: result && result.success === true,
    message: result && result.success === true ? 'home agent action executed' : 'home agent action failed',
    skill: skill,
    result: result && result.data ? result.data : {},
    skillResult: result,
    warnings: result && result.warnings ? result.warnings : [],
    error: result && result.error ? result.error : null,
  };
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

  if (!isSupportedHomeAgentIntent_(intent)) {
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

  const responseResult = buildHomeAgentResultForIntent_(request, skillResults, startedAt);
  if (responseResult && responseResult.summary) {
    responseResult.summary = localizeHomeAgentSummaryDate_(responseResult.summary, request.parameters.date, startedAt);
  }
  const alertCandidate = shouldCreateHomeAgentSignageCandidate_(request)
    ? createSignageAlertCandidateForIntent_(request, responseResult, skillResults)
    : null;
  const resultActionCandidates = Array.isArray(responseResult.actionCandidates) ? responseResult.actionCandidates : [];
  const signageCandidates = alertCandidate && alertCandidate.success && alertCandidate.data && alertCandidate.data.action
      && alertCandidate.data.action.parameters && alertCandidate.data.action.parameters.message
    ? [alertCandidate.data.action]
    : [];
  const actionCandidates = resultActionCandidates.concat(signageCandidates);

  const finishedAt = new Date();
  const audit = buildHomeAgentAudit_(request, {
    assignedAgents: assignedAgents,
    usedSkills: usedSkills,
    success: hasSuccessfulHomeAgentResult_(skillResults),
    executedAt: formatHomeAgentDateTime_(finishedAt),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    warnings: warnings,
  });
  const userWarnings = buildHomeAgentUserWarnings_(warnings, errors);

  return buildHomeAgentResponse_(request, {
    success: audit.success,
    assignedAgents: assignedAgents,
    usedSkills: usedSkills,
    result: responseResult,
    skillResults: skillResults,
    actionCandidates: actionCandidates,
    requiresConfirmation: false,
    warnings: userWarnings,
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
  parameters.roomId = String(parameters.roomId || body.roomId || detectHomeAgentRoomId_(message) || '').trim();
  if (!parameters.roomId && body.context && body.context.lastRoomId && isHomeAgentImplicitRoomRequest_(message)) {
    parameters.roomId = String(body.context.lastRoomId || '').trim();
  }

  return {
    requestId: String(body.requestId || Utilities.getUuid()),
    conversationId: String(body.conversationId || ''),
    userId: String(body.userId || ''),
    userDisplayName: String(body.userDisplayName || ''),
    calendarSuffix: String(body.calendarSuffix || ''),
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

  const memoLikeShopping = /買う$|買って$|買っとく$|購入$/.test(text);
  if (memoLikeShopping && text.indexOf('？') === -1 && text.indexOf('?') === -1 && text.indexOf('教えて') === -1) {
    return '';
  }

  if (/出発前|出かける前|登校前|持ち物まとめ|まとめて|全部|一通り|チェック/.test(text)) {
    return HOME_AGENT_INTENT_DEPARTURE_CHECK;
  }
  if (/自動制御.*(止め|停止|一時停止)|通常運転.*戻|一時停止.*やめ/.test(text)) {
    return /戻|やめ|解除|再開/.test(text)
      ? HOME_AGENT_INTENT_RESUME_ROOM_AUTOMATION
      : HOME_AGENT_INTENT_PAUSE_ROOM_AUTOMATION;
  }
  if (/家の温度どう|家の中暑くない|部屋大丈夫|家の中どんな感じ|家の中.*大丈夫/.test(text)) {
    return HOME_AGENT_INTENT_ROOM_CLIMATE_OVERVIEW;
  }
  if (/冷房効いとる|設定温度まで下がりそう|ちゃんと冷え|ぬるい/.test(text)) {
    return HOME_AGENT_INTENT_ADAPTIVE_CLIMATE_CHECK;
  }
  if (/ちょっと暑い|少し暑い|ちょっと寒い|少し寒い|少し強めて|ちょっと強めて|少し弱めて|ちょっと弱めて|1度下げて|1度上げて|一度下げて|一度上げて/.test(text)) {
    return HOME_AGENT_INTENT_AIRCON_COMFORT_ADJUSTMENT;
  }  if (/強めて|弱めて|除湿して|暖かくして|涼しくして|冷やして|温めて/.test(text)) {
    return HOME_AGENT_INTENT_AIRCON_OVERRIDE_REQUEST;
  }
  if (/暑い部屋|寒い部屋|蒸してる部屋|家の中大丈夫|部屋.*大丈夫/.test(text)) {
    return HOME_AGENT_INTENT_ROOM_CLIMATE_ALERT_CHECK;
  }
  if (/暑い|寒い|蒸し|蒸す|温度|湿度|部屋/.test(text)) {
    return HOME_AGENT_INTENT_ROOM_CLIMATE_CHECK;
  }
  if (/給食|献立/.test(text)) {
    return HOME_AGENT_INTENT_SCHOOL_LUNCH;
  }
  if (/傘|天気|雨|気温|暑い|寒い|降水/.test(text)) {
    return HOME_AGENT_INTENT_WEATHER_CHECK;
  }
  if (/学校|登校|休校|子ども|こども|子供|学校行事/.test(text)) {
    return HOME_AGENT_INTENT_SCHOOL_STATUS;
  }
  if (/予定|なんかある|何かある|ある[？?]?/.test(text)) {
    return HOME_AGENT_INTENT_PERSONAL_SCHEDULE;
  }

  return '';
}

function isSupportedHomeAgentIntent_(intent) {
  return [
    HOME_AGENT_INTENT_PERSONAL_SCHEDULE,
    HOME_AGENT_INTENT_SCHOOL_STATUS,
    HOME_AGENT_INTENT_SCHOOL_LUNCH,
    HOME_AGENT_INTENT_WEATHER_CHECK,
    HOME_AGENT_INTENT_DEPARTURE_CHECK,
    HOME_AGENT_INTENT_DAILY_DEPARTURE_CHECK,
    HOME_AGENT_INTENT_ROOM_CLIMATE_CHECK,
    HOME_AGENT_INTENT_ROOM_CLIMATE_ALERT_CHECK,
    HOME_AGENT_INTENT_ROOM_CLIMATE_OVERVIEW,
    HOME_AGENT_INTENT_ADAPTIVE_CLIMATE_CHECK,
    HOME_AGENT_INTENT_AIRCON_COMFORT_ADJUSTMENT,
    HOME_AGENT_INTENT_AIRCON_OVERRIDE_REQUEST,
    HOME_AGENT_INTENT_PAUSE_ROOM_AUTOMATION,
    HOME_AGENT_INTENT_RESUME_ROOM_AUTOMATION,
  ].indexOf(intent) !== -1;
}

function buildHomeAgentResultForIntent_(request, skillResults, now) {
  if (request.intent === HOME_AGENT_INTENT_PERSONAL_SCHEDULE) {
    return buildHomeAgentPersonalScheduleResult_(request, skillResults.getFamilySchedule, now);
  }
  if (request.intent === HOME_AGENT_INTENT_SCHOOL_STATUS) {
    return buildHomeAgentSchoolStatusResult_(request, skillResults.getSchoolSummary, now);
  }
  if (request.intent === HOME_AGENT_INTENT_SCHOOL_LUNCH) {
    return buildHomeAgentSchoolLunchResult_(request, skillResults.getSchoolLunch, now);
  }
  if (request.intent === HOME_AGENT_INTENT_WEATHER_CHECK) {
    return buildHomeAgentWeatherCheckResult_(request, skillResults.getWeatherSummary, now);
  }
  if (request.intent === HOME_AGENT_INTENT_ROOM_CLIMATE_CHECK) {
    return buildHomeAgentRoomClimateResult_(request, skillResults.getRoomClimate);
  }
  if (request.intent === HOME_AGENT_INTENT_ROOM_CLIMATE_ALERT_CHECK) {
    return buildHomeAgentRoomClimateAlertResult_(request, skillResults.getAllRoomClimateAlerts);
  }
  if (request.intent === HOME_AGENT_INTENT_ROOM_CLIMATE_OVERVIEW) {
    return buildHomeAgentRoomClimateOverviewResult_(request, skillResults.roomClimateOverview);
  }
  if (request.intent === HOME_AGENT_INTENT_ADAPTIVE_CLIMATE_CHECK) {
    return buildHomeAgentAdaptiveClimateResult_(request, skillResults);
  }
  if (request.intent === HOME_AGENT_INTENT_AIRCON_COMFORT_ADJUSTMENT) {
    return buildHomeAgentManualComfortResult_(request, skillResults);
  }
  if (request.intent === HOME_AGENT_INTENT_AIRCON_OVERRIDE_REQUEST) {
    return buildHomeAgentAirconProposalResult_(request, skillResults);
  }
  if (request.intent === HOME_AGENT_INTENT_PAUSE_ROOM_AUTOMATION) {
    return buildHomeAgentPauseProposalResult_(request, skillResults);
  }
  if (request.intent === HOME_AGENT_INTENT_RESUME_ROOM_AUTOMATION) {
    return buildHomeAgentResumeRoomAutomationResult_(request, skillResults);
  }

  const departure = skillResults.buildDepartureCheck && skillResults.buildDepartureCheck.data
    ? Object.assign({}, skillResults.buildDepartureCheck.data)
    : {};
  return departure;
}

function buildHomeAgentPersonalScheduleResult_(request, scheduleResult, now) {
  const data = scheduleResult && scheduleResult.data ? scheduleResult.data : {};
  const allEvents = Array.isArray(data.events) ? data.events : [];
  const events = filterHomeAgentPersonalEvents_(request, allEvents);
  const label = getHomeAgentDateLabel_(request.parameters.date, now);
  return {
    date: request.parameters.date,
    summary: events.length
      ? label + 'は予定が' + events.length + '件あるよ。'
      : label + 'は予定なし。',
    schedule: events,
    signageMessage: buildHomeAgentScheduleMessage_(label, events),
  };
}

function buildHomeAgentSchoolStatusResult_(request, schoolResult, now) {
  const school = schoolResult && schoolResult.data ? schoolResult.data : {};
  const label = getHomeAgentDateLabel_(request.parameters.date, now);
  const events = Array.isArray(school.events) ? school.events.filter(Boolean) : [];
  const schoolText = school.isSchoolDay === true
    ? '学校あり'
    : school.isSchoolDay === false
      ? '学校なし'
      : '学校予定は未確認';
  return {
    date: request.parameters.date,
    summary: label + 'は' + schoolText + (events.length ? '。行事が' + events.length + '件。' : '。'),
    school: {
      isSchoolDay: school.isSchoolDay,
      events: events,
    },
    signageMessage: [label + 'は' + schoolText].concat(events).join('。'),
  };
}

function buildHomeAgentSchoolLunchResult_(request, lunchResult, now) {
  const lunch = lunchResult && lunchResult.data ? lunchResult.data : {};
  const label = getHomeAgentDateLabel_(request.parameters.date, now);
  const lunchText = lunch.status === 'available' && lunch.menu
    ? String(lunch.menu)
    : lunch.status === 'no_lunch'
      ? '給食なし'
      : '給食データなし';
  return {
    date: request.parameters.date,
    summary: buildHomeAgentLunchSummary_(label, lunch),
    lunch: {
      status: lunch.status || '',
      menu: lunch.menu || '',
    },
    signageMessage: label + 'の給食は' + lunchText + '。',
  };
}

function buildHomeAgentLunchSummary_(label, lunch) {
  if (lunch.status === 'available' && lunch.menu) {
    const menu = String(lunch.menu).trim();
    const hints = [];
    if (/鶏|チキン|からあげ|唐揚げ/.test(menu)) {
      hints.push('鶏');
    }
    if (/クリーム|牛乳|乳|チーズ|グラタン|シチュー/.test(menu)) {
      hints.push('クリーム');
    }
    if (/カレー/.test(menu)) {
      hints.push('カレー味');
    }
    if (hints.length) {
      return label + 'は' + menu + 'や。夜は' + uniqueHomeAgentValues_(hints).join('・') + 'あたりを避けると被りにくいで。';
    }
    return label + 'は' + menu + 'や。夕飯とかぶらんよう、軽く見とくとええよ。';
  }
  if (lunch.status === 'no_lunch') {
    return label + 'は給食なし。昼の段取り、忘れんといてな。';
  }
  return label + 'の給食は確認できんかった。';
}

function buildHomeAgentWeatherCheckResult_(request, weatherResult, now) {
  const weather = weatherResult && weatherResult.data ? weatherResult.data : {};
  const label = getHomeAgentDateLabel_(request.parameters.date, now);
  const weatherText = String(weather.weather || weather.condition || extractHomeAgentWeatherLabel_(weather.weatherText) || '').trim();
  const umbrellaRecommended = shouldRecommendHomeAgentUmbrella_(weather);
  const umbrellaText = umbrellaRecommended ? '傘、持っとき。' : '傘は今のところ大丈夫そう。';
  return {
    date: request.parameters.date,
    summary: label + 'の天気を見たよ。' + umbrellaText,
    weather: {
      weather: weatherText,
      currentTemperature: weather.currentTemperature != null ? weather.currentTemperature : '',
      maxTemperature: weather.maxTemperature != null ? weather.maxTemperature : '',
      minTemperature: weather.minTemperature != null ? weather.minTemperature : '',
      precipitationProbability: weather.precipitationProbability != null ? weather.precipitationProbability : '',
      umbrellaRecommended: umbrellaRecommended,
    },
    suggestedItems: umbrellaRecommended ? ['傘'] : [],
    signageMessage: label + 'の天気。' + umbrellaText,
  };
}

function buildHomeAgentRoomClimateResult_(request, climateResult) {
  const climate = climateResult && climateResult.data ? climateResult.data : {};
  if (!request.parameters.roomId) {
    return {
      summary: 'どの部屋か教えて。僕も家全部を勝手には見んよ。',
      warnings: ['部屋が特定できんかった。'],
    };
  }
  const comfort = climate.comfortLabel || '状態は控えめに見とる';
  return {
    summary: climate.displayName
      ? climate.displayName + 'は' + formatHomeAgentClimateNumbers_(climate) + 'や。' + comfort + '。'
      : '部屋の温湿度は確認できんかった。',
    roomClimate: climate,
    conversationContext: {
      lastIntent: request.intent,
      lastRoomId: climate.displayName || climate.roomId || request.parameters.roomId,
      lastClimateSnapshot: climate,
      capturedAt: formatHomeAgentDateTime_(new Date()),
    },
  };
}

function buildHomeAgentRoomClimateAlertResult_(request, alertsResult) {
  const data = alertsResult && alertsResult.data ? alertsResult.data : {};
  const alerts = Array.isArray(data.alerts) ? data.alerts.slice(0, 3) : [];
  return {
    summary: alerts.length
      ? 'いま気になるんは' + alerts.length + '部屋や。'
      : 'いま大きく気になる部屋はなさそう。',
    roomClimateAlerts: alerts,
    notificationCandidates: Array.isArray(data.notificationCandidates) ? data.notificationCandidates : [],
  };
}

function buildHomeAgentRoomClimateOverviewResult_(request, overviewResult) {
  const overview = overviewResult && overviewResult.data ? overviewResult.data : {};
  const rooms = Array.isArray(overview.rooms) ? overview.rooms.slice(0, 3) : [];
  return {
    summary: overview.summary || (rooms.length ? '家の中を見たよ。' : '家の温度データを確認できんかった。'),
    roomClimateOverview: {
      checkedAt: overview.checkedAt || '',
      rooms: rooms,
      totalRoomsChecked: overview.totalRoomsChecked || 0,
    },
    conversationContext: {
      lastIntent: request.intent,
      lastRoomId: rooms.length === 1 ? (rooms[0].displayName || rooms[0].roomId) : (request.parameters.roomId || ''),
      capturedAt: formatHomeAgentDateTime_(new Date()),
    },
  };
}

function buildHomeAgentAdaptiveClimateResult_(request, skillResults) {
  const climate = readHomeAgentSkillData_(skillResults.getRoomClimate, {});
  const trend = readHomeAgentSkillData_(skillResults.getRoomClimateTrend, {});
  const proposal = readHomeAgentSkillData_(skillResults.buildAdaptiveClimateProposal, {});
  return {
    summary: proposal.summary || '冷え方を確認したけど、提案までは作れんかった。',
    roomClimate: climate,
    climateTrend: trend,
    proposal: proposal.proposal || null,
    actionCandidates: proposal.actionCandidate ? [proposal.actionCandidate] : [],
    conversationContext: {
      lastIntent: request.intent,
      lastRoomId: climate.displayName || climate.roomId || request.parameters.roomId,
      lastClimateSnapshot: climate,
      lastClimateTrend: trend,
      lastProposal: proposal.proposal || null,
      capturedAt: formatHomeAgentDateTime_(new Date()),
    },
  };
}

function buildHomeAgentManualComfortResult_(request, skillResults) {
  const climate = readHomeAgentSkillData_(skillResults.getRoomClimate, {});
  const trend = readHomeAgentSkillData_(skillResults.getRoomClimateTrend, {});
  const proposal = readHomeAgentSkillData_(skillResults.buildManualComfortAdjustmentProposal, {});
  return {
    summary: proposal.summary || '体感入力は受け取ったけど、温度変更の提案は作れんかった。',
    roomClimate: climate,
    climateTrend: trend,
    proposal: proposal.proposal || null,
    actionCandidates: proposal.actionCandidate ? [proposal.actionCandidate] : [],
    conversationContext: {
      lastIntent: request.intent,
      lastRoomId: climate.displayName || climate.roomId || request.parameters.roomId || request.context.lastRoomId || '',
      lastClimateSnapshot: climate,
      lastClimateTrend: trend,
      lastProposal: proposal.proposal || null,
      capturedAt: formatHomeAgentDateTime_(new Date()),
    },
  };
}

function buildHomeAgentAirconProposalResult_(request, skillResults) {
  const climate = readHomeAgentSkillData_(skillResults.getRoomClimate, {});
  const proposal = readHomeAgentSkillData_(skillResults.buildAirconAdjustmentProposal, {});
  return {
    summary: proposal.summary || '操作候補は作れんかった。部屋と今の状態をもう一回見る？',
    roomClimate: climate,
    proposal: proposal.proposal || null,
    actionCandidates: proposal.actionCandidate ? [proposal.actionCandidate] : [],
    conversationContext: {
      lastIntent: request.intent,
      lastRoomId: climate.roomId || request.parameters.roomId,
      lastClimateSnapshot: climate,
      lastProposal: proposal.proposal || null,
      capturedAt: formatHomeAgentDateTime_(new Date()),
    },
  };
}

function buildHomeAgentPauseProposalResult_(request, skillResults) {
  const climate = readHomeAgentSkillData_(skillResults.getRoomClimate, {});
  const proposal = readHomeAgentSkillData_(skillResults.buildPauseRoomAutomationProposal, {});
  return {
    summary: proposal.summary || '一時停止の候補は作れんかった。',
    roomClimate: climate,
    proposal: proposal.proposal || null,
    actionCandidates: proposal.actionCandidate ? [proposal.actionCandidate] : [],
  };
}

function buildHomeAgentResumeRoomAutomationResult_(request, skillResults) {
  const climate = readHomeAgentSkillData_(skillResults.getRoomClimate, {});
  const pause = readHomeAgentSkillData_(skillResults.getRoomAutomationPause, {});
  const roomName = climate.displayName || request.parameters.roomId || 'その部屋';
  return {
    summary: pause.activePause
      ? roomName + 'は一時停止中や。通常運転に戻す候補だけ出しとく。'
      : roomName + 'は一時停止してないみたいやで。',
    roomClimate: climate,
    proposal: pause.activePause ? {
      action: 'resume_room_automation',
      roomId: climate.roomId || request.parameters.roomId,
      requiresConfirmation: true,
    } : null,
    actionCandidates: pause.activePause ? [{
      skill: 'resumeRoomAutomation',
      agent: 'shimao',
      requiresConfirmation: true,
      parameters: {
        roomId: climate.roomId || request.parameters.roomId,
      },
    }] : [],
  };
}

function formatHomeAgentClimateNumbers_(climate) {
  const parts = [];
  if (climate.temperature !== '' && climate.temperature != null) parts.push(climate.temperature + '℃');
  if (climate.humidity !== '' && climate.humidity != null) parts.push('湿度' + climate.humidity + '％');
  return parts.length ? parts.join('、') : '温湿度は不明';
}

function shouldRecommendHomeAgentUmbrella_(weather) {
  const weatherText = String(weather.weather || weather.condition || weather.weatherText || '');
  const precipitation = Number(weather.precipitationProbability);
  if (/雨|雪|雷雨|⛈|🌧|❄/.test(weatherText)) {
    return true;
  }
  if (!isNaN(precipitation) && precipitation >= 40) {
    return true;
  }
  return false;
}

function buildHomeAgentUserWarnings_(warningCodes, errors) {
  const out = [];
  const codes = warningCodes || [];
  const hasWeatherError = (errors || []).some(function(error) {
    return error.skill === 'getWeatherSummary';
  });
  if (hasWeatherError || codes.some(function(code) {
    return /weather_source_not_available|WEATHER_SOURCE_NOT_CONFIGURED/.test(code);
  })) {
    out.push('天気は確認できんかった。');
  } else if (codes.some(function(code) {
    return /weather_precipitation_probability_missing|weather_precipitation_unavailable/.test(code);
  })) {
    out.push('降水確率は確認できんかった。');
  }
  if (codes.some(function(code) {
    return /weather_inconsistent_rain_probability/.test(code);
  })) {
    out.push('雨予報やけど降水確率データに食い違いがあるよ。');
  }
  if (codes.some(function(code) {
    return /weather_forecast_date_mismatch/.test(code);
  })) {
    out.push('天気の対象日が少し怪しいかも。');
  }
  if (codes.some(function(code) {
    return /room_climate_stale/.test(code);
  })) {
    out.push('センサー情報が古いけん、操作候補は控えたよ。');
  }
  if (codes.some(function(code) {
    return /aircon_state_unknown/.test(code);
  })) {
    out.push('エアコン状態がはっきり読めんかった。');
  }
  if (codes.some(function(code) {
    return /room_not_specified|ROOM_NOT_SPECIFIED/.test(code);
  })) {
    out.push('部屋が特定できんかった。');
  }
  if ((errors || []).some(function(error) {
    return /getRoomClimate|getAllRoomClimateAlerts/.test(error.skill || '');
  })) {
    out.push('部屋の温湿度は確認できんかった。');
  }
  return uniqueHomeAgentValues_(out);
}

function extractHomeAgentWeatherLabel_(weatherText) {
  const text = String(weatherText || '');
  const match = text.match(/(晴れ|曇り|くもり|雨|雪|雷)/);
  return match ? match[1] : '';
}

function buildHomeAgentScheduleMessage_(label, events) {
  if (!events.length) {
    return label + 'は予定なし。';
  }
  return label + 'の予定は' + events.map(function(event) {
    return String(event.title || '').trim();
  }).filter(Boolean).join('、') + '。';
}

function filterHomeAgentPersonalEvents_(request, events) {
  if (isHomeAgentBroadScheduleRequest_(request.message)) {
    return events;
  }

  const suffix = getHomeAgentCalendarSuffix_(request);
  if (!suffix) {
    return [];
  }

  return events.filter(function(event) {
    const title = String(event.title || '').trim();
    if (!title) return false;
    if (!title.endsWith(suffix)) return false;
    if (/ゴミ|ごみ/.test(title)) return false;
    return true;
  });
}

function isHomeAgentBroadScheduleRequest_(message) {
  return /家族|みんな|全員|子ども|こども|子供|学校/.test(String(message || ''));
}

function getHomeAgentCalendarSuffix_(request) {
  if (request.calendarSuffix) {
    return request.calendarSuffix;
  }
  if (request.userId === 'father') {
    return '（父）';
  }
  return '';
}

function detectHomeAgentRoomId_(message) {
  const text = String(message || '');
  const aliases = [
    ['living', /リビング|ldk|LDK/],
    ['bedroom', /寝室/],
    ['kids_room', /子供部屋|子ども部屋|こども部屋|子供|子ども|こども/],
    ['study', /書斎/],
    ['entrance', /玄関/],
    ['attic', /天井裏/],
    ['outside', /外気|外/],
  ];
  for (var i = 0; i < aliases.length; i++) {
    if (aliases[i][1].test(text)) {
      return aliases[i][0];
    }
  }
  return '';
}

function isHomeAgentImplicitRoomRequest_(message) {
  return /強めて|弱めて|除湿して|暖かくして|涼しくして|冷やして|温めて|通常運転|一時停止|止めて|ちょっと暑い|少し暑い|暑い|ぬるい|ちょっと寒い|少し寒い|寒い|1度下げて|1度上げて|一度下げて|一度上げて/.test(String(message || ''));
}

function shouldCreateHomeAgentSignageCandidate_(request) {
  return /サイネージで知らせ|家族に知らせ|朝流し|読み上げ/.test(String(request.message || ''));
}

function createSignageAlertCandidateForIntent_(request, result, skillResults) {
  if (request.intent === HOME_AGENT_INTENT_DEPARTURE_CHECK || request.intent === HOME_AGENT_INTENT_DAILY_DEPARTURE_CHECK) {
    return createSignageAlertSkill_(request, {
      buildDepartureCheck: skillResults.buildDepartureCheck,
    });
  }

  const message = String(result.signageMessage || result.summary || '').trim();
  if (!message) {
    return null;
  }
  return {
    success: true,
    data: {
      action: {
        skill: 'createSignageAlert',
        agent: 'paruru',
        requiresConfirmation: true,
        parameters: {
          message: message,
          deviceId: request.deviceId || '',
        },
      },
    },
  };
}

function hasSuccessfulHomeAgentResult_(skillResults) {
  return Object.keys(skillResults || {}).some(function(skillId) {
    return skillResults[skillId] && skillResults[skillId].success === true;
  });
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

function testHomeAgentIntentRouting_() {
  const cases = [
    ['明日の予定は？', HOME_AGENT_INTENT_PERSONAL_SCHEDULE],
    ['今日なんかある？', HOME_AGENT_INTENT_PERSONAL_SCHEDULE],
    ['子どもの学校どうなっとる？', HOME_AGENT_INTENT_SCHOOL_STATUS],
    ['明日の給食なに？', HOME_AGENT_INTENT_SCHOOL_LUNCH],
    ['明日傘いる？', HOME_AGENT_INTENT_WEATHER_CHECK],
    ['天気どう？', HOME_AGENT_INTENT_WEATHER_CHECK],
    ['明日の予定と持ち物まとめて', HOME_AGENT_INTENT_DEPARTURE_CHECK],
    ['寝室暑い？', HOME_AGENT_INTENT_ROOM_CLIMATE_CHECK],
    ['暑い部屋ある？', HOME_AGENT_INTENT_ROOM_CLIMATE_ALERT_CHECK],
    ['寝室ちょっと強めて', HOME_AGENT_INTENT_AIRCON_OVERRIDE_REQUEST],
    ['寝室の自動制御を朝6時まで止めて', HOME_AGENT_INTENT_PAUSE_ROOM_AUTOMATION],
    ['寝室を通常運転に戻して', HOME_AGENT_INTENT_RESUME_ROOM_AUTOMATION],
  ];

  cases.forEach(function(testCase) {
    const actual = detectHomeAgentIntent_(testCase[0]);
    if (actual !== testCase[1]) {
      throw new Error(testCase[0] + ' expected ' + testCase[1] + ' but got ' + actual);
    }
  });

  console.log('testHomeAgentIntentRouting_ passed');
}

function testHomeAgentDailyDepartureCheck(date) {
  const result = runHomeAgentRequest_({
    action: 'homeAgent',
    message: '今日の予定と持ち物まとめて サイネージで知らせて',
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

  if (result.intent !== HOME_AGENT_INTENT_DEPARTURE_CHECK) {
    throw new Error('Intent判定がdeparture_checkになってへんで');
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
