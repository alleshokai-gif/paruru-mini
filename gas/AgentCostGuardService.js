// Agent Chat only. This service deliberately has no dependency on client
// role, device, session, message, or reply content.
const AgentCostGuardService = (function() {
  const DAILY_SHEET_NAME = 'Agent_Cost_Daily';
  const LEDGER_SHEET_NAME = 'Agent_Cost_Ledger';
  const LEASE_MS = 45 * 1000;
  const BURST_WINDOW_MS = 10 * 1000;
  const BURST_MAX_REQUESTS = 3;
  const LOCK_WAIT_MS = 5 * 1000;
  const UNKNOWN_MODEL = 'unknown';

  const DAILY_HEADERS = Object.freeze([
    'homeId', 'memberUserId', 'localDate', 'acceptedRequestCount',
    'windowStartedAt', 'windowRequestCount', 'inFlightRequestId',
    'inFlightExpiresAt', 'inputTokens', 'outputTokens', 'totalTokens',
    'modelCallCount', 'updatedAt'
  ]);
  const LEDGER_HEADERS = Object.freeze([
    'recordedAt', 'guardRequestId', 'eventType', 'homeId', 'memberUserId',
    'localDate', 'responsePolicyId', 'model', 'interactionClass',
    'resultStatus', 'modelCallCount', 'inputTokens', 'outputTokens',
    'totalTokens', 'usageStatus', 'guardReason'
  ]);
  const DAILY_LIMITS = Object.freeze({ admin: 300, guardian: 100, self_record: 60 });
  const RESPONSE_POLICIES = Object.freeze({ normal: true, concise: true });
  const INTERACTION_CLASSES = Object.freeze({
    general_no_data: true, tool_read: true, legacy: true, unclassified: true
  });
  const RESULT_STATUSES = Object.freeze({
    SUCCESS: true, STALE: true, PARTIAL: true, UNAVAILABLE: true,
    UPSTREAM_ERROR: true, NO_OP: true, FORBIDDEN: true, INVALID_INPUT: true,
    NOT_FOUND: true
  });

  function preflight(request, overrides) {
    const input = normalizePreflightInput_(request);
    const deps = resolveDependencies_(overrides);
    const nowMs = safeNowMs_(deps.now());
    const localDate = deps.localDate(nowMs);
    const lock = deps.lock;
    let lockAcquired = false;
    try {
      lock.waitLock(LOCK_WAIT_MS);
      lockAcquired = true;
      const dailySheet = ensureSheet_(deps.spreadsheet, DAILY_SHEET_NAME, DAILY_HEADERS);
      const ledgerSheet = ensureSheet_(deps.spreadsheet, LEDGER_SHEET_NAME, LEDGER_HEADERS);
      const daily = readRows_(dailySheet, DAILY_HEADERS);
      const memberRows = daily.rows.filter(function(row) {
        return row.values.homeId === input.homeId && row.values.memberUserId === input.memberUserId;
      });
      clearExpiredInFlights_(dailySheet, daily.headers, memberRows, nowMs);

      const activeInFlight = findActiveInFlight_(memberRows, nowMs);
      if (activeInFlight) {
        appendLedger_(ledgerSheet, LEDGER_HEADERS, guardRejectedLedger_(input, localDate, 'busy', nowMs));
        return rejected_('AGENT_BUSY', 'busy');
      }

      const today = findDailyRow_(memberRows, localDate);
      const latestBurst = findActiveBurst_(memberRows, nowMs);
      if (latestBurst && latestBurst.count >= BURST_MAX_REQUESTS) {
        appendLedger_(ledgerSheet, LEDGER_HEADERS, guardRejectedLedger_(input, localDate, 'burst', nowMs));
        return rejected_('AGENT_RATE_LIMITED', 'burst');
      }

      const currentCount = integerOrZero_(today && today.values.acceptedRequestCount);
      const dailyLimit = dailyLimitForRole_(input.role);
      if (currentCount >= dailyLimit) {
        appendLedger_(ledgerSheet, LEDGER_HEADERS, guardRejectedLedger_(input, localDate, 'daily', nowMs));
        return rejected_('AGENT_RATE_LIMITED', 'daily');
      }

      const nextBurst = latestBurst
        ? { startedAt: latestBurst.startedAt, count: latestBurst.count + 1 }
        : { startedAt: nowMs, count: 1 };
      const state = today || newDailyRow_(daily.headers);
      state.values.homeId = input.homeId;
      state.values.memberUserId = input.memberUserId;
      state.values.localDate = localDate;
      state.values.acceptedRequestCount = currentCount + 1;
      state.values.windowStartedAt = nextBurst.startedAt;
      state.values.windowRequestCount = nextBurst.count;
      state.values.inFlightRequestId = input.guardRequestId;
      state.values.inFlightExpiresAt = nowMs + LEASE_MS;
      state.values.updatedAt = isoAt_(nowMs);
      const rowNumber = writeDailyRow_(dailySheet, daily.headers, state);
      return {
        allowed: true,
        guardRequestId: input.guardRequestId,
        homeId: input.homeId,
        memberUserId: input.memberUserId,
        localDate: localDate,
        responsePolicyId: input.responsePolicyId,
        stateRowNumber: rowNumber
      };
    } catch (error) {
      throw safeCostGuardError_(error);
    } finally {
      if (lockAcquired) {
        try {
          lock.releaseLock();
        } catch (error) {
          throw safeCostGuardError_(error);
        }
      }
    }
  }

  function settle(handle, outcome, overrides) {
    const safeHandle = normalizeHandle_(handle);
    const safeOutcome = normalizeOutcome_(outcome);
    const deps = resolveDependencies_(overrides);
    const nowMs = safeNowMs_(deps.now());
    const lock = deps.lock;
    let lockAcquired = false;
    try {
      lock.waitLock(LOCK_WAIT_MS);
      lockAcquired = true;
      const dailySheet = ensureSheet_(deps.spreadsheet, DAILY_SHEET_NAME, DAILY_HEADERS);
      const ledgerSheet = ensureSheet_(deps.spreadsheet, LEDGER_SHEET_NAME, LEDGER_HEADERS);
      const daily = readRows_(dailySheet, DAILY_HEADERS);
      const state = findDailyRow_(daily.rows.filter(function(row) {
        return row.values.homeId === safeHandle.homeId && row.values.memberUserId === safeHandle.memberUserId;
      }), safeHandle.localDate);
      if (state && String(state.values.inFlightRequestId || '') === safeHandle.guardRequestId) {
        state.values.inFlightRequestId = '';
        state.values.inFlightExpiresAt = '';
        addUsageToDaily_(state.values, safeOutcome.usage);
        state.values.updatedAt = isoAt_(nowMs);
        writeDailyRow_(dailySheet, daily.headers, state);
      }
      appendLedger_(ledgerSheet, LEDGER_HEADERS, {
        recordedAt: isoAt_(nowMs),
        guardRequestId: safeHandle.guardRequestId,
        eventType: safeOutcome.eventType,
        homeId: safeHandle.homeId,
        memberUserId: safeHandle.memberUserId,
        localDate: safeHandle.localDate,
        responsePolicyId: safeHandle.responsePolicyId,
        model: safeOutcome.model,
        interactionClass: safeOutcome.interactionClass,
        resultStatus: safeOutcome.resultStatus,
        modelCallCount: safeOutcome.usage.modelCallCount,
        inputTokens: safeOutcome.usage.inputTokens,
        outputTokens: safeOutcome.usage.outputTokens,
        totalTokens: safeOutcome.usage.totalTokens,
        usageStatus: safeOutcome.usage.usageStatus,
        guardReason: ''
      });
    } catch (error) {
      throw safeCostGuardError_(error);
    } finally {
      if (lockAcquired) {
        try {
          lock.releaseLock();
        } catch (error) {
          throw safeCostGuardError_(error);
        }
      }
    }
  }

  function normalizePreflightInput_(request) {
    const source = request && typeof request === 'object' ? request : {};
    const actor = source.actor && typeof source.actor === 'object' ? source.actor : {};
    const homeId = safeKey_(actor.homeId, 200);
    const memberUserId = safeKey_(actor.memberUserId, 100);
    const guardRequestId = safeKey_(source.guardRequestId, 100);
    if (!homeId || !memberUserId || !guardRequestId) throw safeCostGuardError_();
    const role = String(actor.role || '').trim();
    const requestedPolicy = String(source.responsePolicyId || '').trim();
    return {
      homeId: homeId,
      memberUserId: memberUserId,
      role: role,
      guardRequestId: guardRequestId,
      responsePolicyId: RESPONSE_POLICIES[requestedPolicy] ? requestedPolicy : 'normal'
    };
  }

  function normalizeHandle_(handle) {
    const source = handle && typeof handle === 'object' ? handle : {};
    const normalized = {
      guardRequestId: safeKey_(source.guardRequestId, 100),
      homeId: safeKey_(source.homeId, 200),
      memberUserId: safeKey_(source.memberUserId, 100),
      localDate: safeLocalDate_(source.localDate),
      responsePolicyId: RESPONSE_POLICIES[source.responsePolicyId] ? source.responsePolicyId : 'normal'
    };
    if (!normalized.guardRequestId || !normalized.homeId || !normalized.memberUserId || !normalized.localDate) throw safeCostGuardError_();
    return normalized;
  }

  function normalizeOutcome_(outcome) {
    const source = outcome && typeof outcome === 'object' ? outcome : {};
    const eventType = source.eventType === 'completed' ? 'completed' : 'agent_error';
    const rawStatus = String(source.resultStatus || '').trim();
    const rawClass = String(source.interactionClass || '').trim();
    return {
      eventType: eventType,
      model: safeModel_(source.model),
      interactionClass: INTERACTION_CLASSES[rawClass] ? rawClass : 'unclassified',
      resultStatus: RESULT_STATUSES[rawStatus] ? rawStatus : '',
      usage: normalizeUsage_(source.usage)
    };
  }

  function normalizeUsage_(usage) {
    const source = usage && typeof usage === 'object' ? usage : {};
    const usageStatus = String(source.usageStatus || '').trim() === 'available' ? 'available' : 'unavailable';
    const inputTokens = nonNegativeNumber_(source.inputTokens);
    const outputTokens = nonNegativeNumber_(source.outputTokens);
    const totalTokens = nonNegativeNumber_(source.totalTokens);
    const modelCallCount = nonNegativeInteger_(source.modelCallCount);
    if (usageStatus !== 'available' || inputTokens === null || outputTokens === null || totalTokens === null || modelCallCount === null) {
      return {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        modelCallCount: modelCallCount,
        usageStatus: 'unavailable'
      };
    }
    return {
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      totalTokens: totalTokens,
      modelCallCount: modelCallCount,
      usageStatus: 'available'
    };
  }

  function addUsageToDaily_(row, usage) {
    if (!usage || usage.usageStatus !== 'available') return;
    row.inputTokens = addNullableNumber_(row.inputTokens, usage.inputTokens);
    row.outputTokens = addNullableNumber_(row.outputTokens, usage.outputTokens);
    row.totalTokens = addNullableNumber_(row.totalTokens, usage.totalTokens);
    row.modelCallCount = addNullableNumber_(row.modelCallCount, usage.modelCallCount);
  }

  function guardRejectedLedger_(input, localDate, reason, nowMs) {
    return {
      recordedAt: isoAt_(nowMs),
      guardRequestId: input.guardRequestId,
      eventType: 'guard_rejected',
      homeId: input.homeId,
      memberUserId: input.memberUserId,
      localDate: localDate,
      responsePolicyId: input.responsePolicyId,
      model: UNKNOWN_MODEL,
      interactionClass: 'unclassified',
      resultStatus: '',
      modelCallCount: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      usageStatus: 'unavailable',
      guardReason: reason
    };
  }

  function rejected_(errorCode, guardReason) {
    return { allowed: false, errorCode: errorCode, guardReason: guardReason };
  }

  function dailyLimitForRole_(role) {
    return DAILY_LIMITS[String(role || '').trim()] || DAILY_LIMITS.self_record;
  }

  function findDailyRow_(rows, localDate) {
    const matches = rows.filter(function(row) { return row.values.localDate === localDate; });
    if (!matches.length) return null;
    return matches.sort(function(a, b) { return b.rowNumber - a.rowNumber; })[0];
  }

  function findActiveInFlight_(rows, nowMs) {
    return rows.find(function(row) {
      const requestId = String(row.values.inFlightRequestId || '').trim();
      return !!requestId && numericMillis_(row.values.inFlightExpiresAt) > nowMs;
    }) || null;
  }

  function clearExpiredInFlights_(sheet, headers, rows, nowMs) {
    rows.forEach(function(row) {
      const requestId = String(row.values.inFlightRequestId || '').trim();
      if (!requestId || numericMillis_(row.values.inFlightExpiresAt) > nowMs) return;
      row.values.inFlightRequestId = '';
      row.values.inFlightExpiresAt = '';
      row.values.updatedAt = isoAt_(nowMs);
      writeDailyRow_(sheet, headers, row);
    });
  }

  function findActiveBurst_(rows, nowMs) {
    const candidates = rows.map(function(row) {
      const startedAt = numericMillis_(row.values.windowStartedAt);
      const count = integerOrZero_(row.values.windowRequestCount);
      return { startedAt: startedAt, count: count };
    }).filter(function(value) {
      return value.startedAt > 0 && nowMs >= value.startedAt && nowMs - value.startedAt < BURST_WINDOW_MS;
    });
    if (!candidates.length) return null;
    return candidates.sort(function(a, b) { return b.startedAt - a.startedAt; })[0];
  }

  function ensureSheet_(spreadsheet, name, headers) {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    ensureHeaders_(sheet, headers);
    return sheet;
  }

  function ensureHeaders_(sheet, requiredHeaders) {
    const lastColumn = Number(sheet.getLastColumn() || 0);
    if (!lastColumn) {
      sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders.slice()]);
      if (typeof sheet.setFrozenRows === 'function') sheet.setFrozenRows(1);
      return;
    }
    const existing = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function(value) { return String(value || '').trim(); });
    const seen = {};
    existing.forEach(function(header) {
      if (!header) return;
      if (seen[header]) throw safeCostGuardError_();
      seen[header] = true;
    });
    const missing = requiredHeaders.filter(function(header) { return !seen[header]; });
    if (missing.length) sheet.getRange(1, lastColumn + 1, 1, missing.length).setValues([missing]);
    if (typeof sheet.setFrozenRows === 'function') sheet.setFrozenRows(1);
  }

  function readRows_(sheet, requiredHeaders) {
    const width = Number(sheet.getLastColumn() || 0);
    const headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(function(value) { return String(value || '').trim(); });
    const headerIndex = {};
    headers.forEach(function(header, index) { headerIndex[header] = index; });
    requiredHeaders.forEach(function(header) { if (headerIndex[header] === undefined) throw safeCostGuardError_(); });
    const lastRow = Number(sheet.getLastRow() || 0);
    const values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
    return {
      headers: headers,
      rows: values.map(function(rowValues, index) {
        const valuesByHeader = {};
        headers.forEach(function(header, column) { valuesByHeader[header] = rowValues[column]; });
        return { rowNumber: index + 2, rowValues: rowValues.slice(), values: valuesByHeader };
      })
    };
  }

  function newDailyRow_(headers) {
    const values = {};
    headers.forEach(function(header) { values[header] = ''; });
    return { rowNumber: 0, rowValues: [], values: values };
  }

  function writeDailyRow_(sheet, headers, row) {
    const width = headers.length;
    const output = row.rowValues && row.rowValues.length === width ? row.rowValues.slice() : Array(width).fill('');
    headers.forEach(function(header, index) { output[index] = row.values[header]; });
    if (row.rowNumber) {
      sheet.getRange(row.rowNumber, 1, 1, width).setValues([output]);
      row.rowValues = output;
      return row.rowNumber;
    }
    const nextRow = Math.max(2, Number(sheet.getLastRow() || 0) + 1);
    sheet.getRange(nextRow, 1, 1, width).setValues([output]);
    row.rowNumber = nextRow;
    row.rowValues = output;
    return nextRow;
  }

  function appendLedger_(sheet, headers, values) {
    const output = headers.map(function(header) { return values[header] === null || values[header] === undefined ? '' : values[header]; });
    const nextRow = Math.max(2, Number(sheet.getLastRow() || 0) + 1);
    sheet.getRange(nextRow, 1, 1, headers.length).setValues([output]);
  }

  function resolveDependencies_(overrides) {
    const source = overrides && typeof overrides === 'object' ? overrides : {};
    const spreadsheet = source.spreadsheet || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet());
    const lock = source.lock || (typeof LockService !== 'undefined' && LockService.getScriptLock());
    const now = typeof source.now === 'function' ? source.now : function() { return Date.now(); };
    const localDate = typeof source.localDate === 'function' ? source.localDate : function(nowMs) {
      return Utilities.formatDate(new Date(nowMs), 'Asia/Tokyo', 'yyyy-MM-dd');
    };
    if (!spreadsheet || !lock || typeof lock.waitLock !== 'function' || typeof lock.releaseLock !== 'function') throw safeCostGuardError_();
    return { spreadsheet: spreadsheet, lock: lock, now: now, localDate: localDate };
  }

  function safeNowMs_(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) throw safeCostGuardError_();
    return Math.floor(numeric);
  }

  function safeLocalDate_(value) {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
  }

  function safeKey_(value, maxLength) {
    return String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, maxLength);
  }

  function safeModel_(value) {
    const text = String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80);
    return text || UNKNOWN_MODEL;
  }

  function numericMillis_(value) {
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  }

  function nonNegativeNumber_(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  }

  function nonNegativeInteger_(value) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
  }

  function integerOrZero_(value) {
    const numeric = nonNegativeInteger_(value);
    return numeric === null ? 0 : numeric;
  }

  function addNullableNumber_(current, delta) {
    const base = nonNegativeNumber_(current);
    return (base === null ? 0 : base) + delta;
  }

  function isoAt_(nowMs) {
    return new Date(nowMs).toISOString();
  }

  function safeCostGuardError_() {
    const error = new Error('AGENT_UNAVAILABLE');
    error.code = 'AGENT_UNAVAILABLE';
    error.agentTraceStage = 'COST_GUARD';
    error.agentDiagnostics = { stage: 'COST_GUARD', reason: 'COST_GUARD_STORAGE_UNAVAILABLE' };
    return error;
  }

  return Object.freeze({
    preflight: preflight,
    settle: settle,
    constants: Object.freeze({
      DAILY_SHEET_NAME: DAILY_SHEET_NAME,
      LEDGER_SHEET_NAME: LEDGER_SHEET_NAME,
      DAILY_HEADERS: DAILY_HEADERS,
      LEDGER_HEADERS: LEDGER_HEADERS,
      LEASE_MS: LEASE_MS,
      BURST_WINDOW_MS: BURST_WINDOW_MS,
      BURST_MAX_REQUESTS: BURST_MAX_REQUESTS,
      DAILY_LIMITS: DAILY_LIMITS
    })
  });
})();
