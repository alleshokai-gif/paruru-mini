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

function readHomeAgentSignageStatusWeather_(sheet, request) {
  const rows = readHomeAgentTable_(sheet);
  if (!rows.length) return null;

  const location = normalizeHomeAgentWeatherLocation_(request.parameters.location || request.location || 'home');
  const row = getLatestHomeAgentRowObject_(rows);
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
  if (!parsed.precipitationProbability && !/雨|傘|降水|☔|🌧|⛈/.test(weatherText)) {
    warnings.push('weather_precipitation_probability_missing');
  }

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
  const popMatch = raw.match(/(?:☔|雨|降水)\s*(\d{1,3})\s*%/);
  const precipitationProbability = popMatch ? Math.min(100, Number(popMatch[1])) : '';
  const weather = inferHomeAgentWeatherLabel_(raw);

  return {
    weather: weather,
    currentTemperature: currentMatch ? Number(currentMatch[1]) : '',
    minTemperature: rangeMatch ? Number(rangeMatch[1]) : '',
    maxTemperature: rangeMatch ? Number(rangeMatch[2]) : '',
    precipitationProbability: precipitationProbability,
    umbrellaRecommended: precipitationProbability !== ''
      ? precipitationProbability >= 30
      : /傘いる|帰りだけ傘|雨|降水|☔|🌧|⛈/.test(raw),
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
