// Single read-only aggregation for the Home card ("今日のぱるる") and Agent.
// Calendar and Inbox are read here once per requested day; callers must not
// merge either source themselves.
const PALURU_TODAY_PARURU_CONTEXT_SCHEMA_VERSION = 'today-paruru-context-1.0';
const PALURU_TODAY_PARURU_DEFAULT_SWITCH_TIME = '18:00';

function todayParuruContext_(params, actor) {
  return json_(buildTodayParuruContextData_(params, actor));
}

function buildTodayParuruContextData_(params, actor, dependencies) {
  const source = params || {};
  const deps = dependencies || {};
  const now = deps.now instanceof Date ? deps.now : new Date();
  const settings = resolveTodayParuruSettings_(source, actor);
  const plan = buildTodayParuruRequestPlan_(now, settings.tomorrowScheduleStartTime, source.period);
  const aggregationParams = {
    selectedMemberKeys: settings.selectedMemberKeys.join(','),
    includeUnknown: settings.includeUnknown ? 'true' : 'false',
    tomorrowScheduleStartTime: settings.tomorrowScheduleStartTime,
    scope: settings.scope
  };
  // Inbox is intentionally read once even after the evening Calendar rollover.
  const inboxItems = Array.isArray(deps.inboxItems) ? deps.inboxItems : readOwnedInboxItems_(actor);
  const calendarRangeEnd = addTodayParuruDays_(plan.today, plan.includeTomorrow ? 2 : 1);
  let calendarCandidates = [];
  let calendarWarnings = [];
  try {
    calendarCandidates = deps.calendarCandidates || CalendarReadService.readNormalizedDateRange(plan.today, calendarRangeEnd);
  } catch (error) {
    calendarWarnings = ['calendar_events_unavailable'];
  }
  const sharedOptions = { items: inboxItems, calendarCandidates: calendarCandidates, calendarWarnings: calendarWarnings };
  const today = buildNotificationCandidatesResponse_(Object.assign({}, aggregationParams, {
    date: plan.today,
    limit: '50'
  }), actor, sharedOptions);
  const tomorrow = plan.includeTomorrow
    ? buildNotificationCandidatesResponse_(Object.assign({}, aggregationParams, {
      date: plan.tomorrow,
      limit: '50'
    }), actor, sharedOptions)
    : null;
  const merged = mergeTodayParuruCandidates_(today, tomorrow, plan, now.getTime());
  return {
    success: true,
    schemaVersion: PALURU_TODAY_PARURU_CONTEXT_SCHEMA_VERSION,
    targetDate: plan.includeTomorrow ? plan.tomorrow : plan.today,
    includeTomorrow: plan.includeTomorrow,
    count: merged.items.length,
    items: merged.items,
    warnings: merged.warnings,
    sourceSummary: summarizeTodayParuruSources_(merged.items)
  };
}

function resolveTodayParuruSettings_(params, actor) {
  const source = params && typeof params === 'object' ? params : {};
  const actorMember = String(actor && actor.memberUserId || '').trim();
  const aliases = {
    father: 'father', mother: 'mother', son1: 'eldest_son', eldest_son: 'eldest_son',
    daughter1: 'eldest_daughter', eldest_daughter: 'eldest_daughter', son2: 'second_son', second_son: 'second_son',
    daughter2: 'youngest_daughter', youngest_daughter: 'youngest_daughter', family: 'family'
  };
  const raw = Array.isArray(source.selectedMemberKeys) ? source.selectedMemberKeys
    : String(source.selectedMemberKeys || '').split(',');
  const seen = {};
  const selectedMemberKeys = raw.map(function(value) { return aliases[String(value || '').trim()] || ''; })
    .filter(function(value) { if (!value || seen[value]) return false; seen[value] = true; return true; });
  if (!selectedMemberKeys.length) {
    if (aliases[actorMember]) selectedMemberKeys.push(aliases[actorMember]);
    selectedMemberKeys.push('family');
  }
  const includeUnknown = source.includeUnknown === true || String(source.includeUnknown || '').toLowerCase() === 'true';
  const tomorrowScheduleStartTime = normalizeTodayParuruClock_(source.tomorrowScheduleStartTime)
    || PALURU_TODAY_PARURU_DEFAULT_SWITCH_TIME;
  const scope = selectedMemberKeys.length === 1 && selectedMemberKeys[0] === aliases[actorMember] ? 'mine' : 'family';
  return {
    selectedMemberKeys: selectedMemberKeys,
    includeUnknown: includeUnknown,
    tomorrowScheduleStartTime: tomorrowScheduleStartTime,
    scope: scope
  };
}

function buildTodayParuruRequestPlan_(now, startTime, requestedPeriod) {
  const current = now instanceof Date ? now : new Date(now);
  const today = Utilities.formatDate(current, 'Asia/Tokyo', 'yyyy-MM-dd');
  const tomorrow = addTodayParuruDays_(today, 1);
  const threshold = normalizeTodayParuruClock_(startTime) || PALURU_TODAY_PARURU_DEFAULT_SWITCH_TIME;
  if (requestedPeriod === 'today') return { today: today, tomorrow: tomorrow, includeTomorrow: false, threshold: threshold };
  if (requestedPeriod === 'tomorrow') return {
    today: tomorrow, tomorrow: addTodayParuruDays_(tomorrow, 1), includeTomorrow: false, threshold: threshold
  };
  const time = Utilities.formatDate(current, 'Asia/Tokyo', 'HH:mm');
  return { today: today, tomorrow: tomorrow, includeTomorrow: time >= threshold, threshold: threshold };
}

function mergeTodayParuruCandidates_(todayResult, tomorrowResult, plan, nowMs) {
  const todayItems = Array.isArray(todayResult && todayResult.items) ? todayResult.items : [];
  const nonCalendarItems = todayItems.filter(function(item) { return !isTodayParuruCalendarCandidate_(item); });
  const todayCalendarItems = sortTodayParuruCalendarItems_(todayItems
    .filter(isTodayParuruCalendarCandidate_)
    .map(function(item) { return Object.assign({}, item, { rollingDisplayDate: plan.today, rollingDay: 'today' }); })
    .filter(function(item) { return isTodayParuruCalendarVisible_(item, plan.today, nowMs); }));
  const tomorrowRaw = plan.includeTomorrow && Array.isArray(tomorrowResult && tomorrowResult.items)
    ? sortTodayParuruCalendarItems_(tomorrowResult.items
      .filter(isTodayParuruCalendarCandidate_)
      .map(function(item) { return Object.assign({}, item, { rollingDisplayDate: plan.tomorrow, rollingDay: 'tomorrow' }); })
      .filter(function(item) { return isTodayParuruCalendarVisible_(item, plan.tomorrow, nowMs); }))
    : [];
  const todayKeys = {};
  todayCalendarItems.forEach(function(item) {
    const key = buildTodayParuruCalendarOccurrenceKey_(item);
    if (key) todayKeys[key] = true;
  });
  const tomorrowCalendarItems = tomorrowRaw.filter(function(item) {
    const key = buildTodayParuruCalendarOccurrenceKey_(item);
    return !key || !todayKeys[key];
  });
  const warnings = [].concat(todayResult && todayResult.warnings || [], tomorrowResult && tomorrowResult.warnings || []);
  if (todayCalendarItems.concat(tomorrowCalendarItems).some(function(item) {
    return item.rollingWarning === 'calendar_end_missing';
  })) warnings.push('calendar_end_missing');
  return {
    items: nonCalendarItems.concat(todayCalendarItems, tomorrowCalendarItems),
    warnings: uniqueTodayParuruWarnings_(warnings)
  };
}

function summarizeTodayParuruSources_(items) {
  return (Array.isArray(items) ? items : []).reduce(function(summary, item) {
    if (isTodayParuruCalendarCandidate_(item)) summary.calendarCount += 1;
    else summary.inboxCount += 1;
    return summary;
  }, { calendarCount: 0, inboxCount: 0 });
}

function isTodayParuruCalendarCandidate_(item) {
  return String(item && item.sourceType || '') === 'google_calendar';
}

function buildTodayParuruCalendarOccurrenceKey_(item) {
  if (!isTodayParuruCalendarCandidate_(item)) return '';
  const stableId = String(item.sourceId || item.id || '').trim();
  const start = String(item.startAt || buildTodayParuruDateTime_(item.eventStart, item.eventStartTime) || '').trim();
  const end = String(item.endAt || buildTodayParuruDateTime_(item.eventEnd, item.eventEndTime) || item.eventEnd || '').trim();
  if (stableId && start) return 'id:' + stableId + '|start:' + start + '|end:' + end;
  const title = String(item.rawTitle || item.cleanTitle || item.title || '').trim();
  const member = String(item.memberKey || '').trim();
  if (!start || !end || !title) return '';
  return 'fallback:' + start + '|' + end + '|' + title + '|' + member + '|' + Boolean(item.allDay);
}

function isTodayParuruCalendarVisible_(item, displayDate, nowMs) {
  if (!isTodayParuruCalendarCandidate_(item)) return true;
  if (item.allDay === true) {
    const exclusiveEndDate = normalizeTodayParuruDate_(item.eventEnd || item.endAt);
    if (!exclusiveEndDate) {
      item.rollingWarning = 'calendar_end_missing';
      return true;
    }
    return displayDate < exclusiveEndDate;
  }
  const endMs = parseTodayParuruTokyoDateTime_(item.endAt || buildTodayParuruDateTime_(item.eventEnd, item.eventEndTime));
  if (endMs === null) {
    item.rollingWarning = 'calendar_end_missing';
    return true;
  }
  return endMs > nowMs;
}

function sortTodayParuruCalendarItems_(items) {
  return (items || []).slice().sort(function(left, right) {
    if (Boolean(left.allDay) !== Boolean(right.allDay)) return left.allDay ? -1 : 1;
    const leftStart = parseTodayParuruTokyoDateTime_(left.startAt || buildTodayParuruDateTime_(left.eventStart, left.eventStartTime));
    const rightStart = parseTodayParuruTokyoDateTime_(right.startAt || buildTodayParuruDateTime_(right.eventStart, right.eventStartTime));
    if (leftStart === null && rightStart === null) return 0;
    if (leftStart === null) return 1;
    if (rightStart === null) return -1;
    return leftStart - rightStart;
  });
}

function normalizeTodayParuruClock_(value) {
  const match = String(value || '').trim().match(/^(\d{2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return '';
  return match[1] + ':' + match[2];
}

function normalizeTodayParuruDate_(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[1] + '-' + match[2] + '-' + match[3] : '';
}

function buildTodayParuruDateTime_(dateValue, timeValue) {
  const date = normalizeTodayParuruDate_(dateValue);
  const time = normalizeTodayParuruClock_(String(timeValue || '').slice(0, 5));
  return date && time ? date + ' ' + time : '';
}

function parseTodayParuruTokyoDateTime_(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const epoch = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]) - 9, Number(match[5]), Number(match[6] || 0));
  return Number.isFinite(epoch) ? epoch : null;
}

function addTodayParuruDays_(date, days) {
  const match = normalizeTodayParuruDate_(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('invalid date');
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)));
  return Utilities.formatDate(shifted, 'UTC', 'yyyy-MM-dd');
}

function uniqueTodayParuruWarnings_(warnings) {
  const seen = {};
  return (warnings || []).map(function(value) { return String(value || '').trim(); }).filter(function(value) {
    if (!value || seen[value]) return false;
    seen[value] = true;
    return true;
  });
}
