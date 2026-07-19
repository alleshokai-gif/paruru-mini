const CalendarReadService = (function() {
  const TIMEZONE = 'Asia/Tokyo';
  const MAX_CONTEXT_EVENTS = 100;
  const SLOW_THRESHOLD_MS = 5000;
  const PERIODS = { today: true, tomorrow: true, this_week: true, next_7_days: true };
  const SCOPES = { mine: true, family: true };
  const ACTOR_MEMBER_KEYS = Object.freeze({
    father: 'father', mother: 'mother', son1: 'son1', daughter1: 'daughter1',
    son2: 'son2', daughter2: 'daughter2'
  });

  function readContext(options) {
    const input = options || {};
    const period = String(input.period || '');
    const scope = String(input.scope || '');
    if (!PERIODS[period] || !SCOPES[scope]) throw calendarReadError_('INVALID_INPUT');
    const actorKey = resolveActorMemberKey_(input.actor);
    const now = input.now instanceof Date ? new Date(input.now.getTime()) : new Date();
    const range = buildPeriodRange_(period, now);
    const startedAt = Date.now();
    let normalized;
    try {
      normalized = readNormalizedRange_(range.queryFrom, range.to, input.calendar);
    } catch (error) {
      throw calendarReadError_('UPSTREAM_ERROR');
    }
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const warnings = [];
    if (elapsedMs >= SLOW_THRESHOLD_MS) warnings.push('calendar_upstream_slow');

    const filtered = deduplicateOccurrences_(normalized.filter(function(event) {
      if (scope === 'mine' && event.memberKey !== actorKey) return false;
      if (event.allDay) return event.end.getTime() > range.queryFrom.getTime();
      return event.end.getTime() > range.from.getTime();
    })).sort(compareEvents_);
    const totalEvents = filtered.length;
    const returned = filtered.slice(0, MAX_CONTEXT_EVENTS);
    const truncated = totalEvents > returned.length;
    if (truncated) warnings.push('events_truncated');
    const events = returned.map(toPublicEvent_);
    return {
      data: {
        status: 'current', period: period, scope: scope,
        from: formatDateTime_(range.from), to: formatDateTime_(range.to),
        events: events,
        summary: {
          totalEvents: totalEvents,
          returnedEvents: events.length,
          allDayEvents: events.filter(function(event) { return event.allDay; }).length,
          truncated: truncated
        }
      },
      warnings: warnings,
      elapsedMs: elapsedMs
    };
  }

  function readNormalizedDay(targetDate, calendar) {
    const start = parseDateOnly_(targetDate);
    const end = addDays_(start, 1);
    return readNormalizedRange_(start, end, calendar).filter(function(event) {
      return overlapsRange_(event, start, end);
    });
  }

  function readNormalizedRange_(start, end, suppliedCalendar) {
    const calendar = suppliedCalendar || getCalendarByConfig_(getCalendarConfig_('family'));
    return (calendar.getEvents(start, end) || []).filter(function(event) {
      return !isCancelled_(event);
    }).map(normalizeEvent_).filter(function(event) {
      return event && overlapsRange_(event, start, end);
    });
  }

  function normalizeEvent_(event) {
    if (!event || typeof event.getStartTime !== 'function' || typeof event.getEndTime !== 'function') return null;
    const start = event.getStartTime();
    const end = event.getEndTime();
    if (!(start instanceof Date) || !(end instanceof Date) || end.getTime() <= start.getTime()) return null;
    const legacyRawTitle = String(event.getTitle ? event.getTitle() : '');
    const rawTitle = sanitizeTitle_(legacyRawTitle);
    const member = parseCalendarMemberTag_(legacyRawTitle);
    return {
      legacyRawTitle: legacyRawTitle,
      rawTitle: rawTitle,
      title: sanitizeTitle_(member.cleanTitle),
      memberKey: String(member.memberKey || 'unknown'),
      personLabel: sanitizePersonLabel_(member.memberLabel),
      matched: member.matched === true,
      start: new Date(start.getTime()),
      end: new Date(end.getTime()),
      allDay: Boolean(event.isAllDayEvent && event.isAllDayEvent()),
      rawEventId: event.getId ? String(event.getId() || '') : ''
    };
  }

  function buildPeriodRange_(period, now) {
    const todayStart = startOfTokyoDay_(now);
    if (period === 'tomorrow') {
      const from = addDays_(todayStart, 1);
      return { from: from, queryFrom: from, to: addDays_(from, 1) };
    }
    if (period === 'this_week') {
      const daysUntilMonday = 8 - isoWeekday_(todayStart);
      return { from: now, queryFrom: todayStart, to: addDays_(todayStart, daysUntilMonday) };
    }
    if (period === 'next_7_days') {
      return { from: now, queryFrom: todayStart, to: addDays_(todayStart, 7) };
    }
    return { from: now, queryFrom: todayStart, to: addDays_(todayStart, 1) };
  }

  function resolveActorMemberKey_(actor) {
    const userId = String(actor && actor.userId || '').trim();
    if (!ACTOR_MEMBER_KEYS[userId]) throw calendarReadError_('INVALID_INPUT');
    return ACTOR_MEMBER_KEYS[userId];
  }

  function toPublicEvent_(event) {
    return {
      title: event.title,
      startAt: event.allDay ? formatDate_(event.start) : formatDateTime_(event.start),
      endAt: event.allDay ? formatDate_(event.end) : formatDateTime_(event.end),
      allDay: event.allDay,
      personLabel: event.personLabel
    };
  }

  function deduplicateOccurrences_(events) {
    const seen = {};
    return events.filter(function(event) {
      const start = event.start.getTime();
      const end = event.end.getTime();
      const key = event.rawEventId
        ? 'id:' + event.rawEventId + ':' + start + ':' + end
        : 'fallback:' + start + ':' + end + ':' + event.rawTitle + ':' + event.memberKey;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function compareEvents_(left, right) {
    if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
    return left.start.getTime() - right.start.getTime() || left.end.getTime() - right.end.getTime();
  }

  function overlapsRange_(event, start, end) {
    return event.start.getTime() < end.getTime() && event.end.getTime() > start.getTime();
  }

  function isCancelled_(event) {
    if (typeof event.isCancelled === 'function' && event.isCancelled()) return true;
    if (typeof event.getEventStatus === 'function') {
      const status = String(event.getEventStatus() || '').toLowerCase();
      if (status === 'cancelled' || status === 'canceled') return true;
    }
    return false;
  }

  function sanitizeTitle_(value) {
    return Array.from(String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim())
      .slice(0, 200).join('');
  }

  function sanitizePersonLabel_(value) {
    return Array.from(String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim()).slice(0, 30).join('');
  }

  function startOfTokyoDay_(date) {
    return parseDateOnly_(formatDate_(date));
  }

  function isoWeekday_(date) {
    const value = Number(Utilities.formatDate(date, TIMEZONE, 'u'));
    return value >= 1 && value <= 7 ? value : 1;
  }

  function addDays_(date, days) {
    const value = new Date(date.getTime());
    value.setDate(value.getDate() + Number(days || 0));
    return value;
  }

  function parseDateOnly_(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw calendarReadError_('INVALID_INPUT');
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
  }

  function formatDate_(date) {
    return Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd');
  }

  function formatDateTime_(date) {
    return Utilities.formatDate(date, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
  }

  function calendarReadError_(code) {
    const error = new Error(String(code || 'UPSTREAM_ERROR'));
    error.code = String(code || 'UPSTREAM_ERROR');
    return error;
  }

  return {
    readContext: readContext,
    readNormalizedDay: readNormalizedDay,
    normalizeEvent: normalizeEvent_
  };
})();
