// Bounded Agent generation only. This service deliberately has no dependency
// on client role, device, session, message, Health facts, or reply content.
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
    general_no_data: true, tool_read: true, legacy: true, health_comment: true, unclassified: true
  });
  const COST_GUARD_FAILURE_REASONS = Object.freeze({
    COST_GUARD_STORAGE_UNAVAILABLE: true,
    COST_STATE_DUPLICATE: true,
    COST_STATE_WRITE_FAILED: true,
    COST_STATE_MISSING: true,
    COST_STATE_ROW_MISMATCH: true,
    COST_STATE_REQUEST_MISMATCH: true,
    COST_STATE_INVALID_KEY: true
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
    const localDate = canonicalLocalDate_(deps.localDate(nowMs));
    const dailyKey = canonicalDailyKey_({
      homeId: input.homeId,
      memberUserId: input.memberUserId,
      localDate: localDate
    });
    const lock = deps.lock;
    let lockAcquired = false;
    try {
      lock.waitLock(LOCK_WAIT_MS);
      lockAcquired = true;
      const dailySheet = ensureSheet_(deps.spreadsheet, DAILY_SHEET_NAME, DAILY_HEADERS);
      const ledgerSheet = ensureSheet_(deps.spreadsheet, LEDGER_SHEET_NAME, LEDGER_HEADERS);
      const daily = readRows_(dailySheet, DAILY_HEADERS);
      const memberRows = findMemberRows_(daily.rows, dailyKey);
      // A quota state with more than one current-day row is ambiguous. Reject
      // it before changing any persisted state or calling the Agent.
      const today = findSingleDailyRow_(memberRows, dailyKey);
      clearExpiredInFlights_(dailySheet, daily.headers, memberRows, nowMs);

      const activeInFlight = findActiveInFlight_(memberRows, nowMs);
      if (activeInFlight) {
        appendLedger_(ledgerSheet, LEDGER_HEADERS, guardRejectedLedger_(input, localDate, 'busy', nowMs));
        return rejected_('AGENT_BUSY', 'busy');
      }

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
      state.values.homeId = dailyKey.homeId;
      state.values.memberUserId = dailyKey.memberUserId;
      state.values.localDate = dailyKey.localDate;
      state.values.acceptedRequestCount = currentCount + 1;
      state.values.windowStartedAt = nextBurst.startedAt;
      state.values.windowRequestCount = nextBurst.count;
      state.values.inFlightRequestId = input.guardRequestId;
      state.values.inFlightExpiresAt = nowMs + LEASE_MS;
      state.values.updatedAt = isoAt_(nowMs);
      const rowNumber = writeAndVerifyDailyRow_(dailySheet, daily.headers, state, deps, {
        homeId: dailyKey.homeId,
        memberUserId: dailyKey.memberUserId,
        localDate: dailyKey.localDate,
        acceptedRequestCount: currentCount + 1,
        windowStartedAt: nextBurst.startedAt,
        windowRequestCount: nextBurst.count,
        inFlightRequestId: input.guardRequestId,
        inFlightExpiresAt: nowMs + LEASE_MS
      });
      return {
        allowed: true,
        guardRequestId: input.guardRequestId,
        homeId: input.homeId,
        memberUserId: input.memberUserId,
        localDate: dailyKey.localDate,
        responsePolicyId: input.responsePolicyId,
        interactionClass: input.interactionClass,
        stateRowNumber: rowNumber
      };
    } catch (error) {
      throw preserveOrWrapCostGuardError_(error);
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
    const dailyKey = canonicalDailyKey_(safeHandle);
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
      const memberRows = findMemberRows_(daily.rows, dailyKey);
      const state = resolveSettleDailyRow_(memberRows, dailyKey, safeHandle.stateRowNumber);
      if (String(state.values.inFlightRequestId || '') !== safeHandle.guardRequestId) {
        throw safeCostGuardError_('COST_STATE_REQUEST_MISMATCH');
      }
      const preservedPreflightState = {
        homeId: safeKey_(state.values.homeId, 200),
        memberUserId: safeKey_(state.values.memberUserId, 100),
        localDate: canonicalLocalDate_(state.values.localDate),
        acceptedRequestCount: integerOrZero_(state.values.acceptedRequestCount),
        windowStartedAt: numericMillis_(state.values.windowStartedAt),
        windowRequestCount: integerOrZero_(state.values.windowRequestCount)
      };
      state.values.inFlightRequestId = '';
      state.values.inFlightExpiresAt = '';
      addUsageToDaily_(state.values, safeOutcome.usage);
      state.values.updatedAt = isoAt_(nowMs);
      writeAndVerifyDailyRow_(dailySheet, daily.headers, state, deps, {
        homeId: preservedPreflightState.homeId,
        memberUserId: preservedPreflightState.memberUserId,
        localDate: preservedPreflightState.localDate,
        acceptedRequestCount: preservedPreflightState.acceptedRequestCount,
        windowStartedAt: preservedPreflightState.windowStartedAt,
        windowRequestCount: preservedPreflightState.windowRequestCount,
        inFlightRequestId: '',
        inFlightExpiresAt: '',
        inputTokens: state.values.inputTokens,
        outputTokens: state.values.outputTokens,
        totalTokens: state.values.totalTokens,
        modelCallCount: state.values.modelCallCount
      });
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
      throw preserveOrWrapCostGuardError_(error);
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
      responsePolicyId: RESPONSE_POLICIES[requestedPolicy] ? requestedPolicy : 'normal',
      interactionClass: INTERACTION_CLASSES[String(source.interactionClass || '').trim()]
        ? String(source.interactionClass || '').trim()
        : 'unclassified'
    };
  }

  function normalizeHandle_(handle) {
    const source = handle && typeof handle === 'object' ? handle : {};
    const normalized = {
      guardRequestId: safeKey_(source.guardRequestId, 100),
      homeId: safeKey_(source.homeId, 200),
      memberUserId: safeKey_(source.memberUserId, 100),
      localDate: canonicalLocalDate_(source.localDate),
      stateRowNumber: safeRowNumber_(source.stateRowNumber),
      responsePolicyId: RESPONSE_POLICIES[source.responsePolicyId] ? source.responsePolicyId : 'normal',
      interactionClass: INTERACTION_CLASSES[String(source.interactionClass || '').trim()]
        ? String(source.interactionClass || '').trim()
        : 'unclassified'
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
      interactionClass: input.interactionClass,
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

  function findMemberRows_(rows, dailyKey) {
    return rows.filter(function(row) {
      return safeKey_(row.values.homeId, 200) === dailyKey.homeId
        && safeKey_(row.values.memberUserId, 100) === dailyKey.memberUserId;
    });
  }

  function findSingleDailyRow_(memberRows, dailyKey) {
    const matches = memberRows.filter(function(row) {
      return canonicalLocalDate_(row.values.localDate) === dailyKey.localDate;
    });
    if (matches.length > 1) throw safeCostGuardError_('COST_STATE_DUPLICATE');
    return matches.length === 1 ? matches[0] : null;
  }

  function resolveSettleDailyRow_(memberRows, dailyKey, stateRowNumber) {
    const state = findSingleDailyRow_(memberRows, dailyKey);
    if (!state) throw safeCostGuardError_('COST_STATE_MISSING');
    if (stateRowNumber !== null && state.rowNumber !== stateRowNumber) {
      throw safeCostGuardError_('COST_STATE_ROW_MISMATCH');
    }
    return state;
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

  function writeAndVerifyDailyRow_(sheet, headers, row, deps, expected) {
    const rowNumber = writeDailyRow_(sheet, headers, row);
    deps.flush();
    const persisted = readDailyRowByNumber_(sheet, headers, rowNumber);
    if (!persisted || !dailyRowMatches_(persisted.values, expected)) {
      throw safeCostGuardError_('COST_STATE_WRITE_FAILED');
    }
    return rowNumber;
  }

  function readDailyRowByNumber_(sheet, headers, rowNumber) {
    const row = Number(rowNumber);
    if (!Number.isInteger(row) || row < 2) return null;
    const rowValues = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
    if (!Array.isArray(rowValues)) return null;
    const values = {};
    headers.forEach(function(header, index) { values[header] = rowValues[index]; });
    return { rowNumber: row, values: values };
  }

  function dailyRowMatches_(actual, expected) {
    const source = actual && typeof actual === 'object' ? actual : {};
    const checks = expected && typeof expected === 'object' ? expected : {};
    return Object.keys(checks).every(function(field) {
      const expectedValue = checks[field];
      const actualValue = source[field];
      if (field === 'homeId') return safeKey_(actualValue, 200) === expectedValue;
      if (field === 'memberUserId') return safeKey_(actualValue, 100) === expectedValue;
      if (field === 'localDate') {
        try {
          return canonicalLocalDate_(actualValue) === expectedValue;
        } catch (error) {
          return false;
        }
      }
      if (field === 'inFlightRequestId') return String(actualValue || '') === String(expectedValue || '');
      if (field === 'inFlightExpiresAt' || field === 'windowStartedAt') return numericMillis_(actualValue) === numericMillis_(expectedValue);
      if (field === 'acceptedRequestCount' || field === 'windowRequestCount' || field === 'modelCallCount') {
        return integerOrZero_(actualValue) === integerOrZero_(expectedValue);
      }
      if (field === 'inputTokens' || field === 'outputTokens' || field === 'totalTokens') {
        const actualNumber = nonNegativeNumber_(actualValue);
        const expectedNumber = nonNegativeNumber_(expectedValue);
        return actualNumber === expectedNumber || (actualNumber === null && expectedNumber === null);
      }
      return false;
    });
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
    const flush = typeof source.flush === 'function'
      ? source.flush
      : function() {
        if (typeof SpreadsheetApp === 'undefined' || typeof SpreadsheetApp.flush !== 'function') throw safeCostGuardError_();
        SpreadsheetApp.flush();
      };
    if (!spreadsheet || !lock || typeof lock.waitLock !== 'function' || typeof lock.releaseLock !== 'function') throw safeCostGuardError_();
    return { spreadsheet: spreadsheet, lock: lock, now: now, localDate: localDate, flush: flush };
  }

  function safeNowMs_(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) throw safeCostGuardError_();
    return Math.floor(numeric);
  }

  function canonicalDailyKey_(value) {
    const source = value && typeof value === 'object' ? value : {};
    const key = {
      homeId: safeKey_(source.homeId, 200),
      memberUserId: safeKey_(source.memberUserId, 100),
      localDate: canonicalLocalDate_(source.localDate)
    };
    if (!key.homeId || !key.memberUserId || !key.localDate) {
      throw safeCostGuardError_('COST_STATE_INVALID_KEY');
    }
    return key;
  }

  function canonicalLocalDate_(value) {
    if (Object.prototype.toString.call(value) === '[object Date]') {
      const utcMs = value.getTime();
      if (!Number.isFinite(utcMs)) throw safeCostGuardError_('COST_STATE_INVALID_KEY');
      // Japan has no daylight-saving adjustment. Convert a persisted Date to
      // the same Asia/Tokyo yyyy-MM-dd form used by the runtime key.
      return new Date(utcMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw safeCostGuardError_('COST_STATE_INVALID_KEY');
    return text;
  }

  function safeRowNumber_(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 2 ? number : null;
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

  function preserveOrWrapCostGuardError_(error) {
    const reason = error && error.agentDiagnostics && error.agentDiagnostics.reason;
    if (error && error.code === 'AGENT_UNAVAILABLE' && COST_GUARD_FAILURE_REASONS[reason]) return error;
    return safeCostGuardError_();
  }

  function safeCostGuardError_(reason) {
    const safeReason = COST_GUARD_FAILURE_REASONS[reason]
      ? reason
      : 'COST_GUARD_STORAGE_UNAVAILABLE';
    const error = new Error('AGENT_UNAVAILABLE');
    error.code = 'AGENT_UNAVAILABLE';
    error.agentTraceStage = 'COST_GUARD';
    error.agentDiagnostics = { stage: 'COST_GUARD', reason: safeReason };
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
