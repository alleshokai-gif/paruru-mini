function getFamilyScheduleSkill_(request) {
  const date = parseHomeAgentDate_(request.parameters.date);

  if (request.useMocks) {
    return homeAgentSkillResult_('getFamilySchedule', 'paruru', {
      date: request.parameters.date,
      events: [
        {
          title: '歯医者（父）',
          start: request.parameters.date + ' 17:30',
          end: request.parameters.date + ' 18:00',
          allDay: false,
        },
      ],
    }, {
      source: 'mock: Google Calendar',
      freshness: 'mock',
    });
  }

  const config = getCalendarConfig_('family');
  const calendar = getCalendarByConfig_(config);
  const start = new Date(date.getTime());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);

  const events = calendar.getEvents(start, end).filter(function(event) {
    return isHomeAgentCalendarEventOnTargetDate_(event, start, end);
  }).map(function(event) {
    return {
      title: event.getTitle(),
      start: event.isAllDayEvent() ? formatHomeAgentDate_(event.getStartTime()) : formatHomeAgentDateTime_(event.getStartTime()),
      end: event.isAllDayEvent() ? formatHomeAgentDate_(event.getEndTime()) : formatHomeAgentDateTime_(event.getEndTime()),
      allDay: event.isAllDayEvent(),
    };
  });

  return homeAgentSkillResult_('getFamilySchedule', 'paruru', {
    date: request.parameters.date,
    events: events,
  }, {
    source: 'Google Calendar',
    freshness: 'current',
  });
}

function isHomeAgentCalendarEventOnTargetDate_(event, targetDayStart, targetDayEnd) {
  const eventStart = event.getStartTime();
  const eventEnd = event.getEndTime();

  if (event.isAllDayEvent()) {
    const startDate = stripHomeAgentTime_(eventStart).getTime();
    const endDate = stripHomeAgentTime_(eventEnd).getTime();
    const targetDate = stripHomeAgentTime_(targetDayStart).getTime();
    return startDate <= targetDate && targetDate < endDate;
  }

  return eventStart.getTime() < targetDayEnd.getTime()
    && eventEnd.getTime() > targetDayStart.getTime();
}

function stripHomeAgentTime_(date) {
  const value = new Date(date.getTime());
  value.setHours(0, 0, 0, 0);
  return value;
}

function getSchoolSummarySkill_(request) {
  const date = parseHomeAgentDate_(request.parameters.date);
  const warnings = [];

  if (request.useMocks) {
    return homeAgentSkillResult_('getSchoolSummary', 'peno', {
      date: request.parameters.date,
      isSchoolDay: true,
      season: '通常',
      events: ['5時間授業'],
      label: '',
      sourceSheets: ['mock: Calendar_Dim', 'mock: Daily_Context'],
    }, {
      source: 'mock: School Spreadsheet',
      freshness: 'mock',
    });
  }

  const ss = openHomeAgentOptionalSpreadsheet_('PALURU_SCHOOL_SPREADSHEET_ID', request);
  if (!ss) {
    return homeAgentSkillError_(
      'getSchoolSummary',
      'peno',
      'SCHOOL_SOURCE_NOT_CONFIGURED',
      '学校データの参照先が設定されていません'
    );
  }
  const calendarSheet = ss.getSheetByName(getHomeAgentProperty_('PALURU_SCHOOL_CALENDAR_DIM_SHEET', 'Calendar_Dim'));
  const contextSheet = ss.getSheetByName(getHomeAgentProperty_('PALURU_SCHOOL_DAILY_CONTEXT_SHEET', 'Daily_Context'));
  const data = {
    date: request.parameters.date,
    isSchoolDay: null,
    season: '',
    label: '',
    events: [],
    sourceSheets: [],
  };

  if (calendarSheet) {
    data.sourceSheets.push(calendarSheet.getName());
    const row = findHomeAgentRowByDate_(calendarSheet, date, ['date', 'Date']);
    if (row) {
      data.isSchoolDay = normalizeHomeAgentBool_(pickHomeAgentValue_(row, ['is_school_day', 'school_day', 'isSchoolDay']));
      data.season = String(pickHomeAgentValue_(row, ['season', 'Season']) || '');
      data.label = String(pickHomeAgentValue_(row, ['label', 'Label']) || '');
    } else {
      warnings.push('calendar_dim_row_not_found');
    }
  } else {
    warnings.push('calendar_dim_sheet_not_found');
  }

  if (contextSheet) {
    data.sourceSheets.push(contextSheet.getName());
    const contextRow = findHomeAgentRowByDate_(contextSheet, date, ['date', 'Date']);
    if (contextRow) {
      [
        pickHomeAgentValue_(contextRow, ['tomorrow_event', 'event', 'school_event']),
        pickHomeAgentValue_(contextRow, ['tomorrow_items', 'items', 'bring_items']),
      ].forEach(function(value) {
        const text = String(value || '').trim();
        if (text) data.events.push(text);
      });
    } else {
      warnings.push('daily_context_row_not_found');
    }
  } else {
    warnings.push('daily_context_sheet_not_found');
  }

  if (data.isSchoolDay === null && data.season) {
    warnings.push('school_day_unknown_season_present');
  }

  return homeAgentSkillResult_('getSchoolSummary', 'peno', data, {
    source: 'School Spreadsheet',
    freshness: warnings.length ? 'unknown' : 'current',
    warnings: warnings,
  });
}

function getSchoolLunchSkill_(request) {
  const date = parseHomeAgentDate_(request.parameters.date);
  const warnings = [];

  if (request.useMocks) {
    return homeAgentSkillResult_('getSchoolLunch', 'peno', {
      date: request.parameters.date,
      status: 'available',
      menu: 'カレーライス / サラダ',
      nutrition: {},
      district: 'mock',
    }, {
      source: 'mock: Lunch_Fact',
      freshness: 'mock',
    });
  }

  const ss = openHomeAgentOptionalSpreadsheet_('PALURU_SCHOOL_SPREADSHEET_ID', request);
  if (!ss) {
    return homeAgentSkillError_(
      'getSchoolLunch',
      'peno',
      'SCHOOL_SOURCE_NOT_CONFIGURED',
      '学校データの参照先が設定されていません'
    );
  }
  const lunchSheet = ss.getSheetByName(getHomeAgentProperty_('PALURU_SCHOOL_LUNCH_SHEET', 'Lunch_Fact'));
  if (!lunchSheet) {
    return homeAgentSkillResult_('getSchoolLunch', 'peno', {
      date: request.parameters.date,
      status: 'data_missing',
      menu: '',
      nutrition: {},
      district: '',
    }, {
      source: 'School Spreadsheet / Lunch_Fact',
      freshness: 'unknown',
      warnings: ['lunch_sheet_not_found'],
    });
  }

  const row = findHomeAgentRowByDate_(lunchSheet, date, ['date', 'Date']);
  if (!row) {
    return homeAgentSkillResult_('getSchoolLunch', 'peno', {
      date: request.parameters.date,
      status: 'no_data',
      menu: '',
      nutrition: {},
      district: '',
    }, {
      source: 'School Spreadsheet / Lunch_Fact',
      freshness: 'unknown',
      warnings: ['lunch_row_not_found'],
    });
  }

  const menu = String(pickHomeAgentValue_(row, ['menu', 'Menu', '献立']) || '').trim();
  const district = String(pickHomeAgentValue_(row, ['district', 'District', 'school', 'child']) || '').trim();
  const nutrition = {};
  ['calorie', 'Calories', 'protein', 'fat', 'salt'].forEach(function(key) {
    if (typeof row[key] !== 'undefined' && row[key] !== '') {
      nutrition[key] = row[key];
    }
  });

  if (!menu) warnings.push('lunch_menu_blank');

  return homeAgentSkillResult_('getSchoolLunch', 'peno', {
    date: request.parameters.date,
    status: menu ? 'available' : 'no_lunch',
    menu: menu,
    nutrition: nutrition,
    district: district,
  }, {
    source: 'School Spreadsheet / Lunch_Fact',
    freshness: 'current',
    warnings: warnings,
  });
}

function getWeatherSummarySkill_(request) {
  const warnings = [];

  if (request.useMocks) {
    return homeAgentSkillResult_('getWeatherSummary', 'shimao', {
      date: request.parameters.date,
      location: '宮前',
      weather: '雨',
      weatherText: '宮前 🌧️ 08:00 28℃ / 24–31℃ ☔80%',
      currentTemperature: 28,
      maxTemperature: 31,
      minTemperature: 24,
      precipitationProbability: 80,
      umbrellaRecommended: true,
      forecastDate: request.parameters.date,
      updatedAt: request.parameters.date + ' 08:00:00',
      adoptedSource: 'mock: Signage_Status',
    }, {
      source: 'mock: Signage_Status',
      sourceUpdatedAt: request.parameters.date + ' 08:00:00',
      freshness: 'mock',
    });
  }

  const ss = openHomeAgentOptionalSpreadsheet_('PALURU_WEATHER_SPREADSHEET_ID', request);
  if (!ss) {
    return homeAgentSkillError_(
      'getWeatherSummary',
      'shimao',
      'WEATHER_SOURCE_NOT_CONFIGURED',
      '天気データの参照先が設定されていません'
    );
  }
  const statusSheetName = getHomeAgentProperty_('PALURU_WEATHER_STATUS_SHEET', 'Signage_Status');
  const statusSheet = ss.getSheetByName(statusSheetName);
  if (statusSheet) {
    const status = readHomeAgentSignageStatusWeather_(statusSheet, request);
    if (status && status.data) {
      return homeAgentSkillResult_('getWeatherSummary', 'shimao', status.data, {
        source: statusSheetName,
        sourceUpdatedAt: status.sourceUpdatedAt,
        freshness: status.freshness,
        warnings: status.warnings,
      });
    }
    warnings.push('signage_status_weather_not_found');
  } else {
    warnings.push('structured_four_point_weather_sheet_not_found');
  }

  const shimaoSheet = ss.getSheetByName(getHomeAgentProperty_('PALURU_SHIMAO_SHEET', 'Message'));
  if (shimaoSheet) {
    const cell = getHomeAgentProperty_('PALURU_SHIMAO_CELL', 'A2');
    const text = String(shimaoSheet.getRange(cell).getDisplayValue() || '').trim();
    return homeAgentSkillResult_('getWeatherSummary', 'shimao', {
      date: request.parameters.date,
      weatherText: text,
      currentTemperature: '',
      maxTemperature: '',
      minTemperature: '',
      precipitationProbability: '',
      umbrellaRecommended: /雨|傘|降水/.test(text),
      forecastDate: request.parameters.date,
      updatedAt: '',
      adoptedSource: 'Signage weather text',
    }, {
      source: 'Signage weather text',
      freshness: 'unknown',
      warnings: warnings.concat([
        'signage_weather_text_is_not_structured',
        'weather_structured_source_requires_inventory',
      ]),
    });
  }

  return homeAgentSkillResult_('getWeatherSummary', 'shimao', {
    date: request.parameters.date,
    weatherText: '',
    currentTemperature: '',
    maxTemperature: '',
    minTemperature: '',
    precipitationProbability: '',
    umbrellaRecommended: false,
    forecastDate: request.parameters.date,
    updatedAt: '',
    adoptedSource: '',
  }, {
    source: 'Weather source not configured',
    freshness: 'unknown',
    warnings: warnings.concat(['weather_source_not_available']),
  });
}

function buildDepartureCheckSkill_(request, previousResults) {
  {
    const date = request.parameters.date;
    const scheduleResult = previousResults.getFamilySchedule;
    const schoolResult = previousResults.getSchoolSummary;
    const lunchResult = previousResults.getSchoolLunch;
    const weatherResult = previousResults.getWeatherSummary;
    const schedule = readHomeAgentSkillData_(scheduleResult, { events: [] });
    const school = readHomeAgentSkillData_(schoolResult, {});
    const lunch = readHomeAgentSkillData_(lunchResult, {});
    const weather = readHomeAgentSkillData_(weatherResult, {});
    const alerts = [];
    const suggestedItems = [];
    const summaryParts = [];
    const warnings = [];
    const successfulReads = [scheduleResult, schoolResult, lunchResult, weatherResult].filter(function(result) {
      return result && result.success === true;
    });

    [scheduleResult, schoolResult, lunchResult, weatherResult].forEach(function(result) {
      if (result && result.success === false && result.error && result.error.code) {
        warnings.push(result.skill + '_failed:' + result.error.code);
      }
    });

    if (!successfulReads.length) {
      return homeAgentSkillError_(
        'buildDepartureCheck',
        'paruru',
        'NO_DEPARTURE_DATA',
        '出発前チェックに使えるデータを取得できませんでした'
      );
    }

    if (schoolResult && schoolResult.success) {
      if (school.isSchoolDay === true) {
        summaryParts.push('今日は学校あり');
      } else if (school.isSchoolDay === false) {
        summaryParts.push('今日は学校なし');
      } else if (school.season || school.label || (school.events && school.events.length)) {
        summaryParts.push('学校予定は一部だけ取得');
        warnings.push('school_day_unknown');
      }
    }

    if (scheduleResult && scheduleResult.success) {
      const eventCount = schedule.events ? schedule.events.length : 0;
      summaryParts.push(eventCount ? '予定が' + eventCount + '件' : '予定なし');
    }

    if (lunchResult && lunchResult.success) {
      if (lunch.status === 'available' && lunch.menu) {
        summaryParts.push('給食は' + lunch.menu);
      } else if (lunch.status === 'no_lunch') {
        summaryParts.push('給食なし');
      } else if ((lunch.status === 'no_data' || lunch.status === 'data_missing') && school.isSchoolDay === true) {
        warnings.push('lunch_data_not_available');
      }
    }

    const weatherFreshEnough = weatherResult && weatherResult.success && ['current', 'mock'].indexOf(weatherResult.freshness) !== -1;
    if (weatherResult && weatherResult.success && weather.umbrellaRecommended) {
      if (weatherFreshEnough) {
        alerts.push({
          type: 'umbrella',
          level: 'normal',
          message: '雨の可能性あり。傘持っとき。',
        });
        suggestedItems.push('傘');
      } else {
        warnings.push('weather_umbrella_not_used_due_to_uncertain_freshness');
      }
    }

    if (schoolResult && schoolResult.success && school.events && school.events.length) {
      school.events.forEach(function(eventText) {
        if (String(eventText || '').trim()) {
          alerts.push({
            type: 'school',
            level: 'info',
            message: String(eventText).trim(),
          });
        }
      });
    }

    if (!summaryParts.length) {
      summaryParts.push('取得できた範囲では出発前の追加情報はありません');
    }

    const signageMessageParts = summaryParts.slice();
    if (weatherFreshEnough && weather.umbrellaRecommended) {
      signageMessageParts.push('雨かもしれんけん、傘持っとき。');
    }

    return homeAgentSkillResult_('buildDepartureCheck', 'paruru', {
      date: date,
      summary: summaryParts.join('。') + '。',
      schedule: schedule.events || [],
      school: school,
      lunch: lunch,
      weather: weather,
      alerts: alerts,
      suggestedItems: uniqueHomeAgentValues_(suggestedItems),
      signageMessage: signageMessageParts.join('。'),
    }, {
      source: 'Home Agent rule-based aggregator',
      freshness: 'current',
      warnings: warnings,
    });
  }

  const date = request.parameters.date;
  const schedule = readHomeAgentSkillData_(previousResults.getFamilySchedule, { events: [] });
  const school = readHomeAgentSkillData_(previousResults.getSchoolSummary, {});
  const lunch = readHomeAgentSkillData_(previousResults.getSchoolLunch, {});
  const weather = readHomeAgentSkillData_(previousResults.getWeatherSummary, {});
  const alerts = [];
  const suggestedItems = [];
  const summaryParts = [];

  if (school.isSchoolDay === true) {
    summaryParts.push('今日は学校あり');
  } else if (school.isSchoolDay === false) {
    summaryParts.push('今日は学校なし');
  } else {
    summaryParts.push('学校予定は未確認');
  }

  if (schedule.events && schedule.events.length) {
    summaryParts.push('予定が' + schedule.events.length + '件');
  }

  if (weather.umbrellaRecommended) {
    alerts.push({
      type: 'umbrella',
      level: 'normal',
      message: '雨の可能性あり。傘持っとき。',
    });
    suggestedItems.push('傘');
  }

  if (school.events && school.events.length) {
    school.events.forEach(function(eventText) {
      if (String(eventText || '').trim()) {
        alerts.push({
          type: 'school',
          level: 'info',
          message: String(eventText).trim(),
        });
      }
    });
  }

  const lunchText = lunch.status === 'available' && lunch.menu
    ? '給食は' + lunch.menu
    : lunch.status === 'no_lunch'
      ? '給食なし'
      : '';
  if (lunchText) summaryParts.push(lunchText);

  const signageMessageParts = summaryParts.slice();
  if (weather.umbrellaRecommended) {
    signageMessageParts.push('雨かもしれんけん、傘持っとき。');
  }

  return homeAgentSkillResult_('buildDepartureCheck', 'paruru', {
    date: date,
    summary: summaryParts.join('。') + '。',
    schedule: schedule.events || [],
    school: school,
    lunch: lunch,
    weather: weather,
    alerts: alerts,
    suggestedItems: uniqueHomeAgentValues_(suggestedItems),
    signageMessage: signageMessageParts.join('。'),
  }, {
    source: 'Home Agent rule-based aggregator',
    freshness: 'current',
  });
}

function createSignageAlertSkill_(request, previousResults) {
  const departure = readHomeAgentSkillData_(previousResults.buildDepartureCheck, {});
  const message = String(departure.signageMessage || departure.summary || '').trim();
  const warnings = [];

  if (!message) {
    warnings.push('signage_message_blank');
  }

  return homeAgentSkillResult_('createSignageAlert', 'paruru', {
    requiresConfirmation: true,
    action: {
      skill: 'createSignageAlert',
      agent: 'paruru',
      requiresConfirmation: true,
      parameters: {
        message: message,
        deviceId: request.deviceId || '',
      },
    },
    note: 'v0.1では候補作成のみ。Signage Alert APIは自動実行しない。',
  }, {
    source: 'Signage Alert candidate only',
    freshness: 'current',
    warnings: warnings,
    requiresConfirmation: true,
  });
}

function getRoomClimateSkill_(request) {
  const roomId = String(request.parameters.roomId || '').trim();
  if (!roomId) {
    return homeAgentSkillError_('getRoomClimate', 'shimao', 'ROOM_NOT_SPECIFIED', 'Room is required');
  }

  const response = callSwitchbotTempLogHomeAgentApi_('getRoomClimate', {
    roomId: roomId,
    userId: request.userId || '',
  }, { write: false });

  if (!response.success) {
    return homeAgentSkillError_('getRoomClimate', 'shimao', response.errorCode || 'SWITCHBOT_TEMP_LOG_ERROR', response.message || 'Room climate request failed');
  }

  const data = response.data || {};
  return homeAgentSkillResult_('getRoomClimate', 'shimao', data, {
    source: 'switchbot-temp-log',
    freshness: data.freshness || 'unknown',
    warnings: data.freshness === 'stale' ? ['room_climate_stale'] : [],
  });
}

function getAllRoomClimateAlertsSkill_(request) {
  const response = callSwitchbotTempLogHomeAgentApi_('getRoomClimateAlerts', {
    userId: request.userId || '',
  }, { write: false });

  if (!response.success) {
    return homeAgentSkillError_('getAllRoomClimateAlerts', 'shimao', response.errorCode || 'SWITCHBOT_TEMP_LOG_ERROR', response.message || 'Room climate alerts request failed');
  }

  return homeAgentSkillResult_('getAllRoomClimateAlerts', 'shimao', response.data || { alerts: [] }, {
    source: 'switchbot-temp-log',
    freshness: 'current',
  });
}

function getAirconStatusSkill_(request) {
  const roomId = String(request.parameters.roomId || '').trim();
  const response = callSwitchbotTempLogHomeAgentApi_('getRoomClimate', {
    roomId: roomId,
    userId: request.userId || '',
  }, { write: false });

  if (!response.success) {
    return homeAgentSkillError_('getAirconStatus', 'shimao', response.errorCode || 'SWITCHBOT_TEMP_LOG_ERROR', response.message || 'Aircon state request failed');
  }

  const state = response.data && response.data.currentAirconState ? response.data.currentAirconState : {};
  return homeAgentSkillResult_('getAirconStatus', 'shimao', {
    roomId: roomId,
    currentAirconState: state,
  }, {
    source: 'switchbot-temp-log',
    freshness: state.power ? 'current' : 'unknown',
    warnings: state.power ? [] : ['aircon_state_unknown'],
  });
}

function getRoomAutomationPauseSkill_(request) {
  const roomId = String(request.parameters.roomId || '').trim();
  const response = callSwitchbotTempLogHomeAgentApi_('getRoomAutomationPause', {
    roomId: roomId,
    userId: request.userId || '',
  }, { write: false });

  if (!response.success) {
    return homeAgentSkillError_('getRoomAutomationPause', 'shimao', response.errorCode || 'SWITCHBOT_TEMP_LOG_ERROR', response.message || 'Pause state request failed');
  }

  return homeAgentSkillResult_('getRoomAutomationPause', 'shimao', {
    roomId: roomId,
    activePause: response.data && response.data.activePause ? response.data.activePause : null,
  }, {
    source: 'switchbot-temp-log',
    freshness: 'current',
  });
}

function getRoomClimateTrendSkill_(request) {
  const roomId = String(request.parameters.roomId || '').trim();
  if (!roomId) {
    return homeAgentSkillError_('getRoomClimateTrend', 'shimao', 'ROOM_NOT_SPECIFIED', 'Room is required');
  }

  const response = callSwitchbotTempLogHomeAgentApi_('getRoomClimateTrend', {
    roomId: roomId,
    windowMinutes: request.parameters.windowMinutes || 30,
    userId: request.userId || '',
  }, { write: false });

  if (!response.success) {
    return homeAgentSkillError_('getRoomClimateTrend', 'shimao', response.errorCode || 'SWITCHBOT_TEMP_LOG_ERROR', response.message || 'Room climate trend request failed');
  }

  const data = response.data || {};
  return homeAgentSkillResult_('getRoomClimateTrend', 'shimao', data, {
    source: 'switchbot-temp-log',
    freshness: data.freshness || 'unknown',
    warnings: data.warnings || [],
  });
}

function roomClimateOverviewSkill_(request) {
  const response = callSwitchbotTempLogHomeAgentApi_('roomClimateOverview', {
    windowMinutes: request.parameters.windowMinutes || 30,
    userId: request.userId || '',
  }, { write: false });

  if (!response.success) {
    return homeAgentSkillError_('roomClimateOverview', 'shimao', response.errorCode || 'SWITCHBOT_TEMP_LOG_ERROR', response.message || 'Room climate overview request failed');
  }

  const data = response.data || {};
  return homeAgentSkillResult_('roomClimateOverview', 'shimao', data, {
    source: 'switchbot-temp-log',
    freshness: 'current',
    warnings: data.warnings || [],
  });
}

function buildAdaptiveClimateProposalSkill_(request, previousResults) {
  const climate = readHomeAgentSkillData_(previousResults.getRoomClimate, {});
  const trend = readHomeAgentSkillData_(previousResults.getRoomClimateTrend, null);
  const pause = readHomeAgentSkillData_(previousResults.getRoomAutomationPause, {});
  const roomId = climate.roomId || String(request.parameters.roomId || '').trim();
  if (!roomId) {
    return homeAgentSkillResult_('buildAdaptiveClimateProposal', 'shimao', {
      summary: 'どの部屋を見るか分からんかった。部屋名を入れてな。',
    }, { source: 'proposal', freshness: 'current', warnings: ['room_not_specified'] });
  }

  const response = callSwitchbotTempLogHomeAgentApi_('buildAdaptiveClimateProposal', {
    roomId: roomId,
    durationMinutes: inferHomeAgentProposalDurationMinutes_(request.message) || 60,
    windowMinutes: request.parameters.windowMinutes || 30,
    currentClimate: climate,
    trend: trend,
    airconState: climate.currentAirconState || {},
    activePause: pause.activePause || null,
    userId: request.userId || '',
  }, { write: false });

  if (!response.success) {
    return homeAgentSkillError_('buildAdaptiveClimateProposal', 'shimao', response.errorCode || 'SWITCHBOT_TEMP_LOG_ERROR', response.message || 'Adaptive climate proposal request failed');
  }

  const raw = response.data || {};
  const proposal = buildHomeAgentAirconProposalFromAdaptive_(raw, climate, 'adaptive');
  return homeAgentSkillResult_('buildAdaptiveClimateProposal', 'shimao', {
    summary: buildHomeAgentAdaptiveSummary_(raw, climate, 'adaptive'),
    proposal: proposal,
    actionCandidate: proposal && proposal.requiresConfirmation ? {
      skill: 'setAirconOverride',
      agent: 'shimao',
      requiresConfirmation: true,
      parameters: proposal,
    } : null,
  }, {
    source: 'switchbot-temp-log',
    freshness: raw.dataFreshness || 'unknown',
    warnings: filterHomeAgentUserClimateWarnings_(raw.warnings || []),
  });
}

function buildManualComfortAdjustmentProposalSkill_(request, previousResults) {
  const climate = readHomeAgentSkillData_(previousResults.getRoomClimate, {});
  const trend = readHomeAgentSkillData_(previousResults.getRoomClimateTrend, null);
  const roomId = climate.roomId || String(request.parameters.roomId || request.context.lastRoomId || '').trim();
  if (!roomId) {
    return homeAgentSkillResult_('buildManualComfortAdjustmentProposal', 'shimao', {
      summary: 'どの部屋を調整するか分からんかった。先に「寝室の温度は？」みたいに聞いてな。',
    }, { source: 'proposal', freshness: 'current', warnings: ['room_not_specified'] });
  }

  const response = callSwitchbotTempLogHomeAgentApi_('buildManualComfortAdjustmentProposal', {
    roomId: roomId,
    contextRoomId: request.context.lastRoomId || '',
    message: request.message,
    durationMinutes: inferHomeAgentProposalDurationMinutes_(request.message) || 120,
    currentClimate: climate,
    trend: trend,
    airconState: climate.currentAirconState || {},
    userId: request.userId || '',
  }, { write: false });

  if (!response.success) {
    return homeAgentSkillError_('buildManualComfortAdjustmentProposal', 'shimao', response.errorCode || 'SWITCHBOT_TEMP_LOG_ERROR', response.message || 'Manual comfort proposal request failed');
  }

  const raw = response.data || {};
  const proposal = buildHomeAgentAirconProposalFromAdaptive_(raw, climate, 'manual_comfort');
  return homeAgentSkillResult_('buildManualComfortAdjustmentProposal', 'shimao', {
    summary: buildHomeAgentAdaptiveSummary_(raw, climate, 'manual_comfort'),
    proposal: proposal,
    actionCandidate: proposal && proposal.requiresConfirmation ? {
      skill: 'setAirconOverride',
      agent: 'shimao',
      requiresConfirmation: true,
      parameters: proposal,
    } : null,
  }, {
    source: 'switchbot-temp-log',
    freshness: raw.dataFreshness || 'unknown',
    warnings: filterHomeAgentUserClimateWarnings_(raw.warnings || []),
  });
}

function buildHomeAgentAirconProposalFromAdaptive_(raw, climate, adjustmentType) {
  if (!raw || raw.success === false) return null;
  const proposedSetTemp = normalizeHomeAgentNumber_(raw.proposedSetTemp !== undefined ? raw.proposedSetTemp : raw.effectiveSetTemp);
  const currentSetTemp = normalizeHomeAgentNumber_(raw.currentSetTemp);
  const baseRuleSetTemp = normalizeHomeAgentNumber_(raw.baseRuleSetTemp !== undefined ? raw.baseRuleSetTemp : raw.baseSetTemp);
  return {
    action: 'set_aircon',
    adjustmentType: adjustmentType,
    roomId: raw.roomId || climate.roomId || '',
    displayName: raw.displayName || climate.displayName || raw.roomId || '',
    mode: raw.mode || '',
    targetRoomTemp: normalizeHomeAgentNumber_(raw.targetRoomTemp),
    baseRuleSetTemp: baseRuleSetTemp,
    currentSetTemp: currentSetTemp,
    proposedSetTemp: proposedSetTemp,
    temperature: proposedSetTemp,
    currentRoomTemp: normalizeHomeAgentNumber_(raw.currentRoomTemp),
    humidity: climate.humidity !== undefined ? climate.humidity : '',
    trend: raw.trend || '',
    trendRate: raw.trendRate !== undefined ? raw.trendRate : '',
    adaptiveOffset: raw.adaptiveOffset || 0,
    manualComfortOffset: raw.manualComfortOffset || 0,
    durationMinutes: raw.actionCandidate && raw.actionCandidate.parameters ? raw.actionCandidate.parameters.durationMinutes : 120,
    restorePolicy: 'resume_automation',
    reason: raw.reason || '',
    message: raw.message || '',
    requiresConfirmation: raw.requiresConfirmation === true,
    connected: false,
  };
}

function buildHomeAgentAdaptiveSummary_(raw, climate, adjustmentType) {
  const roomName = raw.displayName || climate.displayName || 'その部屋';
  if (!raw || raw.success === false) return roomName + 'の提案を作れんかった。';
  if (raw.reason === 'current_set_temp_unknown' || raw.reason === 'base_state_unknown') {
    return roomName + 'の現在の設定温度を確認できんかったけん、温度変更の提案は出さんよ。';
  }
  if (raw.reason === 'stale_sensor') {
    return roomName + 'のセンサー情報が古いけん、温度変更の提案は出さんよ。';
  }
  if (raw.reason === 'automation_paused') {
    return roomName + 'は自動制御を一時停止中やけん、今は補正を重ねんよ。';
  }
  if (raw.requiresConfirmation !== true) {
    return raw.message || roomName + 'はいま様子見でよさそうやで。';
  }
  const modeText = raw.mode === 'heat' ? '暖房' : raw.mode === 'dry' ? '除湿' : '冷房';
  const currentTempText = raw.currentRoomTemp !== '' && raw.currentRoomTemp != null ? roomName + 'は' + raw.currentRoomTemp + '℃。' : '';
  const trendText = raw.trendRate !== '' && raw.trendRate != null ? '温度傾向は' + raw.trend + '（' + raw.trendRate + '℃/10分）。' : '';
  const baseText = raw.currentSetTemp !== '' && raw.currentSetTemp != null ? 'いま' + modeText + raw.currentSetTemp + '℃やけん、' : modeText + '設定を確認して、';
  const duration = raw.actionCandidate && raw.actionCandidate.parameters ? raw.actionCandidate.parameters.durationMinutes : (adjustmentType === 'adaptive' ? 60 : 120);
  return currentTempText + trendText + baseText + duration + '分だけ' + raw.proposedSetTemp + '℃にする案はありやな。';
}

function filterHomeAgentUserClimateWarnings_(warnings) {
  const allowed = {
    stale_sensor: true,
    current_set_temp_unknown: true,
    insufficient_samples: true,
    automation_paused: true,
  };
  return (warnings || []).filter(function(warning) {
    return allowed[String(warning || '')] === true;
  });
}

function buildAirconAdjustmentProposalSkill_(request, previousResults) {
  const climate = readHomeAgentSkillData_(previousResults.getRoomClimate, {});
  if (!climate.roomId) {
    return homeAgentSkillResult_('buildAirconAdjustmentProposal', 'shimao', {
      summary: 'どの部屋を触るか分からんかった。部屋名を入れてな。',
    }, { source: 'proposal', freshness: 'current', warnings: ['room_not_specified'] });
  }
  if (climate.freshness === 'stale') {
    return homeAgentSkillResult_('buildAirconAdjustmentProposal', 'shimao', {
      summary: climate.displayName + 'のセンサー情報が古いけん、操作候補は出さんよ。',
    }, { source: 'proposal', freshness: 'stale', warnings: ['room_climate_stale'] });
  }
  if (climate.hasAircon !== true) {
    return homeAgentSkillResult_('buildAirconAdjustmentProposal', 'shimao', {
      summary: climate.displayName + 'はエアコン操作対象じゃないみたい。温湿度だけ見とく。',
    }, { source: 'proposal', freshness: 'current', warnings: ['room_has_no_aircon'] });
  }

  const current = climate.currentAirconState || {};
  const mode = inferHomeAgentAirconProposalMode_(request.message, climate, current);
  const currentTemp = normalizeHomeAgentNumber_(current.temperature);
  const targetTemp = chooseHomeAgentAirconTargetTemperature_(request.message, mode, currentTemp);
  const durationMinutes = inferHomeAgentProposalDurationMinutes_(request.message);
  const proposal = {
    action: 'set_aircon',
    roomId: climate.roomId,
    displayName: climate.displayName,
    mode: mode,
    temperature: targetTemp,
    durationMinutes: durationMinutes,
    restorePolicy: 'resume_automation',
    reason: inferHomeAgentAirconProposalReason_(request.message, climate),
    requiresConfirmation: true,
    connected: false,
  };

  return homeAgentSkillResult_('buildAirconAdjustmentProposal', 'shimao', {
    summary: climate.displayName + 'を' + durationMinutes + '分だけ' + formatHomeAgentAirconProposalText_(proposal) + '候補は作ったよ。まだ実操作にはつないでない。',
    proposal: proposal,
    actionCandidate: {
      skill: 'setAirconOverride',
      agent: 'shimao',
      requiresConfirmation: true,
      parameters: proposal,
    },
  }, {
    source: 'proposal-only',
    freshness: 'current',
    warnings: current.stateConfidence === 'unknown' ? ['aircon_state_unknown'] : [],
  });
}

function buildPauseRoomAutomationProposalSkill_(request, previousResults) {
  const climate = readHomeAgentSkillData_(previousResults.getRoomClimate, {});
  const roomId = climate.roomId || String(request.parameters.roomId || '').trim();
  if (!roomId) {
    return homeAgentSkillResult_('buildPauseRoomAutomationProposal', 'shimao', {
      summary: 'どの部屋を止めるか分からんかった。',
    }, { source: 'proposal', freshness: 'current', warnings: ['room_not_specified'] });
  }
  const expiresAt = inferHomeAgentPauseExpiresAt_(request.message);
  const durationMinutes = inferHomeAgentPauseDurationMinutes_(request.message);
  const response = callSwitchbotTempLogHomeAgentApi_('buildPauseRoomAutomationProposal', {
    roomId: roomId,
    userId: request.userId || '',
    expiresAt: expiresAt,
    durationMinutes: durationMinutes,
    reason: 'user_requested_pause',
  }, { write: false });

  if (!response.success) {
    return homeAgentSkillError_('buildPauseRoomAutomationProposal', 'shimao', response.errorCode || 'SWITCHBOT_TEMP_LOG_ERROR', response.message || 'Pause proposal request failed');
  }

  const switchbotProposal = response.data || {};
  const params = switchbotProposal.parameters || {};
  const proposal = {
    action: 'pause_room_automation',
    roomId: params.roomId || roomId,
    displayName: climate.displayName || params.roomName || roomId,
    expiresAt: params.expiresAt || expiresAt,
    reason: 'home_agent_pause_request',
    requiresConfirmation: true,
  };
  return homeAgentSkillResult_('buildPauseRoomAutomationProposal', 'shimao', {
    summary: proposal.displayName + 'の自動制御を' + proposal.expiresAt + 'まで止める候補を作ったよ。確認したら保存する。',
    proposal: proposal,
    actionCandidate: {
      skill: 'pauseRoomAutomation',
      agent: 'shimao',
      requiresConfirmation: true,
      parameters: proposal,
    },
  }, { source: 'switchbot-temp-log', freshness: 'current' });
}

function pauseRoomAutomationSkill_(request) {
  const roomId = String(request.parameters.roomId || '').trim();
  const response = callSwitchbotTempLogHomeAgentApi_('pauseRoomAutomation', {
    roomId: roomId,
    userId: request.userId || '',
    confirmed: true,
    expiresAt: request.parameters.expiresAt || '',
    durationMinutes: request.parameters.durationMinutes || '',
    reason: request.parameters.reason || 'home_agent_pause_request',
  }, { write: true });

  if (!response.success) {
    return homeAgentSkillError_('pauseRoomAutomation', 'shimao', response.errorCode || 'SWITCHBOT_TEMP_LOG_ERROR', response.message || 'Pause execution failed');
  }

  return homeAgentSkillResult_('pauseRoomAutomation', 'shimao', response.data || {}, {
    source: 'switchbot-temp-log',
    freshness: 'current',
  });
}

function resumeRoomAutomationSkill_(request) {
  const roomId = String(request.parameters.roomId || '').trim();
  const response = callSwitchbotTempLogHomeAgentApi_('resumeRoomAutomation', {
    roomId: roomId,
    userId: request.userId || '',
  }, { write: true });

  if (!response.success) {
    return homeAgentSkillError_('resumeRoomAutomation', 'shimao', response.errorCode || 'SWITCHBOT_TEMP_LOG_ERROR', response.message || 'Resume execution failed');
  }

  return homeAgentSkillResult_('resumeRoomAutomation', 'shimao', response.data || {}, {
    source: 'switchbot-temp-log',
    freshness: 'current',
  });
}

function callSwitchbotTempLogHomeAgentApi_(action, payload, options) {
  const url = getHomeAgentProperty_('SWITCHBOT_TEMP_LOG_WEB_APP_URL', '');
  if (!url) {
    return {
      success: false,
      errorCode: 'SWITCHBOT_TEMP_LOG_URL_NOT_CONFIGURED',
      message: 'switchbot-temp-log Web App URL is not configured',
    };
  }

  const secret = getHomeAgentProperty_('PALURU_HOME_AGENT_SECRET', '');
  if (!secret) {
    return {
      success: false,
      errorCode: 'HOME_AGENT_SECRET_NOT_CONFIGURED',
      message: 'Home Agent shared secret is not configured',
    };
  }
  const body = Object.assign({}, payload || {}, {
    action: action,
    secret: secret,
  });

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'text/plain;charset=utf-8',
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    const status = response.getResponseCode();
    const parsed = JSON.parse(response.getContentText() || '{}');
    if (status < 200 || status >= 300) {
      logHomeAgentSwitchbotApiFailure_(action, 'SWITCHBOT_TEMP_LOG_HTTP_' + status, 'switchbot-temp-log HTTP request failed');
      return {
        success: false,
        errorCode: 'SWITCHBOT_TEMP_LOG_HTTP_' + status,
        message: 'switchbot-temp-log HTTP request failed',
      };
    }
    if (!parsed.success) {
      logHomeAgentSwitchbotApiFailure_(action, parsed.errorCode || 'SWITCHBOT_TEMP_LOG_ERROR', parsed.message || 'switchbot-temp-log action failed');
    }
    return parsed;
  } catch (error) {
    logHomeAgentSwitchbotApiFailure_(action, 'SWITCHBOT_TEMP_LOG_REQUEST_FAILED', error && error.message ? error.message : 'switchbot-temp-log request failed');
    return {
      success: false,
      errorCode: 'SWITCHBOT_TEMP_LOG_REQUEST_FAILED',
      message: error && error.message ? error.message : 'switchbot-temp-log request failed',
    };
  }
}

function logHomeAgentSwitchbotApiFailure_(action, errorCode, message) {
  if (typeof Logger !== 'undefined') {
    Logger.log('[HomeAgent switchbot-temp-log] action=%s errorCode=%s message=%s', String(action || ''), String(errorCode || ''), String(message || ''));
  }
}
function readHomeAgentSignageStatusWeather_(sheet, request) {
  const rows = readHomeAgentTable_(sheet);
  if (!rows.length) return null;

  const location = normalizeHomeAgentWeatherLocation_(request.parameters.location || request.location || 'home');
  const row = selectHomeAgentWeatherRow_(rows, request.parameters.date);
  const weatherText = String(pickHomeAgentValue_(row, location.headers) || '').trim();
  if (!weatherText) return null;

  const updatedAtRaw = pickHomeAgentValue_(row, ['updated_at', 'updatedAt', 'timestamp', 'receivedAt']);
  const updatedAtDate = parseHomeAgentSheetDate_(updatedAtRaw);
  const sourceUpdatedAt = updatedAtDate ? formatHomeAgentDateTime_(updatedAtDate) : String(updatedAtRaw || '');
  const forecastDate = normalizeHomeAgentStatusForecastDate_(row, updatedAtDate, request.parameters.date);
  const parsed = parseHomeAgentSignageWeatherText_(weatherText);
  const warnings = [];

  if (!updatedAtDate) {
    warnings.push('weather_status_updated_at_missing');
  }
  if (parsed.precipitationProbability === '' && !/雨|雪|傘|降水|☔|🌧|⛈|❄/.test(weatherText)) {
    warnings.push('weather_precipitation_probability_missing');
  }
  if (forecastDate !== request.parameters.date) {
    warnings.push('weather_forecast_date_mismatch');
  }
  (parsed.warnings || []).forEach(function(warning) {
    warnings.push(warning);
  });

  const freshness = getHomeAgentWeatherFreshness_(updatedAtDate, request.parameters.date);
  if (freshness === 'stale') {
    warnings.push('weather_status_stale');
  }

  return {
    data: {
      date: request.parameters.date,
      location: location.name,
      weather: parsed.weather,
      weatherText: weatherText,
      currentTemperature: parsed.currentTemperature,
      maxTemperature: parsed.maxTemperature,
      minTemperature: parsed.minTemperature,
      precipitationProbability: parsed.precipitationProbability,
      umbrellaRecommended: parsed.umbrellaRecommended,
      forecastDate: forecastDate,
      updatedAt: sourceUpdatedAt,
      adoptedSource: sheet.getName(),
    },
    sourceUpdatedAt: sourceUpdatedAt,
    freshness: freshness,
    warnings: warnings,
  };
}

function selectHomeAgentWeatherRow_(rows, targetDate) {
  for (var i = rows.length - 1; i >= 0; i--) {
    const rowDate = normalizeHomeAgentWeatherRowDate_(rows[i]);
    if (rowDate && rowDate === targetDate) {
      return rows[i];
    }
  }
  return getLatestHomeAgentRowObject_(rows);
}

function normalizeHomeAgentWeatherRowDate_(row) {
  const value = pickHomeAgentValue_(row, ['date', 'date_str', 'forecastDate', 'forecast_date']);
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  const parsed = parseHomeAgentSheetDate_(value);
  return parsed ? formatHomeAgentDate_(parsed) : '';
}

function normalizeHomeAgentWeatherLocation_(value) {
  const key = String(value || '').trim().toLowerCase();
  const locations = {
    home: {
      name: '宮前',
      headers: ['weather_miyamae', 'miyamae', '宮前'],
    },
    miyamae: {
      name: '宮前',
      headers: ['weather_miyamae', 'miyamae', '宮前'],
    },
    work: {
      name: '日比谷',
      headers: ['weather_hibiya', 'hibiya', '日比谷'],
    },
    hibiya: {
      name: '日比谷',
      headers: ['weather_hibiya', 'hibiya', '日比谷'],
    },
    hanoi: {
      name: '町田',
      headers: ['weather_machida', 'machida', '町田'],
    },
    machida: {
      name: '町田',
      headers: ['weather_machida', 'machida', '町田'],
    },
    fuuga: {
      name: '立川',
      headers: ['weather_tachikawa', 'tachikawa', '立川'],
    },
    tachikawa: {
      name: '立川',
      headers: ['weather_tachikawa', 'tachikawa', '立川'],
    },
  };

  return locations[key] || locations.home;
}

function parseHomeAgentSignageWeatherText_(text) {
  const raw = String(text || '');
  const currentMatch = raw.match(/(\-?\d+(?:\.\d+)?)\s*℃/);
  const rangeMatch = raw.match(/(\-?\d+)\s*[–〜~-]\s*(\-?\d+)\s*℃/);
  const popMatches = Array.from(raw.matchAll(/(?:☔|雨|降水|降水確率)?\s*(\d{1,3})\s*%/g));
  const precipitationProbability = popMatches.length
    ? Math.min(100, Math.max.apply(null, popMatches.map(function(match) { return Number(match[1]); })))
    : '';
  const weather = inferHomeAgentWeatherLabel_(raw);
  const warnings = [];
  const rainy = /雨|雪|雷雨|🌧|⛈|❄/.test(weather || raw);
  if (rainy && precipitationProbability !== '' && precipitationProbability < 40) {
    warnings.push('weather_inconsistent_rain_probability');
  }

  return {
    weather: weather,
    currentTemperature: currentMatch ? Number(currentMatch[1]) : '',
    minTemperature: rangeMatch ? Number(rangeMatch[1]) : '',
    maxTemperature: rangeMatch ? Number(rangeMatch[2]) : '',
    precipitationProbability: precipitationProbability,
    umbrellaRecommended: rainy || (precipitationProbability !== '' && precipitationProbability >= 40),
    warnings: warnings,
  };
}

function inferHomeAgentWeatherLabel_(text) {
  const raw = String(text || '');
  if (/⛈|雷/.test(raw)) return '雷雨';
  if (/🌧|雨/.test(raw)) return '雨';
  if (/❄|雪/.test(raw)) return '雪';
  if (/☀|晴/.test(raw)) return '晴れ';
  if (/☁|くもり|曇/.test(raw)) return 'くもり';
  return '';
}

function normalizeHomeAgentStatusForecastDate_(row, updatedAtDate, fallbackDate) {
  const dateStr = String(pickHomeAgentValue_(row, ['date', 'date_str']) || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if (updatedAtDate) return formatHomeAgentDate_(updatedAtDate);
  return fallbackDate;
}

function getHomeAgentWeatherFreshness_(updatedAtDate, targetDate) {
  if (!updatedAtDate) return 'unknown';
  const now = new Date();
  const ageMs = now.getTime() - updatedAtDate.getTime();
  if (formatHomeAgentDate_(updatedAtDate) !== targetDate) return 'stale';
  if (ageMs > 6 * 60 * 60 * 1000) return 'stale';
  if (ageMs < -10 * 60 * 1000) return 'unknown';
  return 'current';
}

function getLatestHomeAgentRowObject_(rows) {
  for (var i = rows.length - 1; i >= 0; i--) {
    if (rows[i]) return rows[i];
  }
  return {};
}

function normalizeHomeAgentNumber_(value) {
  if (value === '' || value == null) return '';
  const num = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isNaN(num) ? '' : num;
}

function getHomeAgentClimateSeverityRank_(severity) {
  if (severity === 'critical') return 3;
  if (severity === 'warning') return 2;
  if (severity === 'info') return 1;
  return 0;
}

function formatHomeAgentClimateNumbersForSkill_(climate) {
  const parts = [];
  if (climate.temperature !== '' && climate.temperature != null) parts.push(climate.temperature + '℃');
  if (climate.humidity !== '' && climate.humidity != null) parts.push('湿度' + climate.humidity + '％');
  return parts.join('、');
}

function inferHomeAgentAirconProposalMode_(message, climate, current) {
  const text = String(message || '');
  if (/除湿/.test(text)) return 'dry';
  if (/寒|暖|温/.test(text)) return 'heat';
  if (current.mode) return current.mode;
  return climate.temperature >= 26 ? 'cool' : 'heat';
}

function chooseHomeAgentAirconTargetTemperature_(message, mode, currentTemp) {
  const base = currentTemp !== '' ? currentTemp : (mode === 'heat' ? 22 : 27);
  if (/弱めて/.test(String(message || ''))) {
    return mode === 'heat' ? Math.max(18, base - 1) : Math.min(30, base + 1);
  }
  return mode === 'heat' ? Math.min(26, base + 1) : Math.max(18, base - 1);
}

function inferHomeAgentProposalDurationMinutes_(message) {
  const text = String(message || '');
  const hour = text.match(new RegExp('(\\d{1,2})\\s*(?:\\u6642\\u9593|hours?|h)', 'i'));
  if (hour) return Math.min(480, Math.max(1, Number(hour[1]) * 60));
  const minute = text.match(new RegExp('(\\d{1,3})\\s*(?:\\u5206|minutes?|min|m)', 'i'));
  if (minute) return Math.min(480, Math.max(1, Number(minute[1])));
  return 120;
}

function inferHomeAgentPauseExpiresAt_(message) {
  const text = String(message || '');
  const now = new Date();
  const duration = inferHomeAgentPauseDurationMinutes_(text);
  if (duration) {
    return formatHomeAgentDateTime_(new Date(now.getTime() + duration * 60 * 1000));
  }

  const untilHour = text.match(new RegExp('(?:\\u671d|\\u5348\\u524d|am)?\\s*(\\d{1,2})\\s*(?:\\u6642|:00)\\s*(?:\\u307e\\u3067|until)', 'i'));
  if (untilHour) {
    const date = new Date(now.getTime());
    date.setHours(Number(untilHour[1]), 0, 0, 0);
    if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 1);
    return formatHomeAgentDateTime_(date);
  }
  return '';
}

function inferHomeAgentPauseDurationMinutes_(message) {
  const text = String(message || '');
  const hour = text.match(new RegExp('(\\d{1,2})\\s*(?:\\u6642\\u9593|hours?|h)', 'i'));
  if (hour) return Number(hour[1]) * 60;
  const minute = text.match(new RegExp('(\\d{1,3})\\s*(?:\\u5206|minutes?|min|m)', 'i'));
  if (minute) return Number(minute[1]);
  return 0;
}
function inferHomeAgentAirconProposalReason_(message, climate) {
  const text = String(message || '');
  if (/寒|暖|温/.test(text)) return 'user_feels_cold';
  if (/暑|涼|冷|強め/.test(text)) return 'user_feels_hot';
  return climate.comfortState || 'user_requested_adjustment';
}

function formatHomeAgentAirconProposalText_(proposal) {
  const modeText = proposal.mode === 'heat' ? '暖房' : proposal.mode === 'dry' ? '除湿' : '冷房';
  return modeText + (proposal.temperature !== '' ? proposal.temperature + '℃にする' : 'を調整する');
}

function openHomeAgentOptionalSpreadsheet_(propertyKey, request) {
  const spreadsheetId = getHomeAgentProperty_(propertyKey, '');
  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }

  if (request && request.allowActiveSpreadsheetFallback === true) {
    return SpreadsheetApp.getActiveSpreadsheet();
  }

  return null;
}

function getHomeAgentProperty_(key, defaultValue) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  return value == null || value === '' ? defaultValue : value;
}

function findHomeAgentRowByDate_(sheet, targetDate, dateHeaders) {
  const rows = readHomeAgentTable_(sheet);
  for (var i = 0; i < rows.length; i++) {
    const rawDate = pickHomeAgentValue_(rows[i], dateHeaders);
    const parsed = parseHomeAgentSheetDate_(rawDate);
    if (parsed && sameHomeAgentDate_(parsed, targetDate)) {
      return rows[i];
    }
  }
  return null;
}

function getLatestHomeAgentRow_(sheet) {
  const rows = readHomeAgentTable_(sheet);
  if (!rows.length) return null;
  return rows[rows.length - 1];
}

function readHomeAgentTable_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(function(header) {
    return String(header || '').trim();
  });
  return values.slice(1).filter(function(row) {
    return row.some(function(value) { return value !== ''; });
  }).map(function(row) {
    return headers.reduce(function(obj, header, index) {
      if (header) {
        obj[header] = row[index];
      }
      return obj;
    }, {});
  });
}

function pickHomeAgentValue_(row, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    if (Object.prototype.hasOwnProperty.call(row, candidates[i])) {
      return row[candidates[i]];
    }
  }
  return '';
}

function parseHomeAgentSheetDate_(value) {
  if (value instanceof Date) return value;
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return parseHomeAgentDate_(text);
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function normalizeHomeAgentBool_(value) {
  if (value === true) return true;
  if (value === false) return false;
  const text = String(value || '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'school', 'school_day'].indexOf(text) !== -1) return true;
  if (['false', '0', 'no', 'n', 'holiday', 'vacation'].indexOf(text) !== -1) return false;
  return null;
}

function readHomeAgentSkillData_(result, fallback) {
  return result && result.success && result.data ? result.data : fallback;
}

function uniqueHomeAgentValues_(values) {
  const seen = {};
  return values.filter(function(value) {
    const key = String(value || '').trim();
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function buildHomeAgentWeatherText_(row) {
  const temp = pickHomeAgentValue_(row, ['temperature', 'temp']);
  const precipitation = pickHomeAgentValue_(row, ['precipitation', 'rain']);
  const parts = [];
  if (temp !== '') parts.push('現在気温 ' + temp + '度');
  if (precipitation !== '') parts.push('降水量 ' + precipitation);
  return parts.join('、');
}


