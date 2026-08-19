'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'gas', 'AgentCostGuardService.js'), 'utf8');
const context = { Date, JSON, Math, Number, Object, Array, String, RegExp, Error };
vm.createContext(context);
new vm.Script(source, { filename: 'AgentCostGuardService.js' }).runInContext(context);
const service = vm.runInContext('AgentCostGuardService', context);

function createSheet(name) {
  return {
    name,
    headers: [],
    rows: [],
    frozenRows: 0,
    afterSetValues: null,
    getLastColumn() { return this.headers.length; },
    getLastRow() { return this.headers.length ? this.rows.length + 1 : 0; },
    getRange(row, column, numRows, numColumns) {
      const sheet = this;
      return {
        getValues() {
          const values = [];
          for (let offset = 0; offset < numRows; offset += 1) {
            const targetRow = row + offset;
            const sourceRow = targetRow === 1 ? sheet.headers : (sheet.rows[targetRow - 2] || []);
            values.push(Array.from({ length: numColumns }, (_, index) => sourceRow[column - 1 + index] === undefined ? '' : sourceRow[column - 1 + index]));
          }
          return values;
        },
        setValues(values) {
          values.forEach((input, offset) => {
            const targetRow = row + offset;
            if (targetRow === 1) {
              input.forEach((value, index) => { sheet.headers[column - 1 + index] = value; });
              return;
            }
            const rowIndex = targetRow - 2;
            if (!sheet.rows[rowIndex]) sheet.rows[rowIndex] = Array(sheet.headers.length).fill('');
            input.forEach((value, index) => { sheet.rows[rowIndex][column - 1 + index] = value; });
          });
          if (typeof sheet.afterSetValues === 'function') {
            sheet.afterSetValues({ row, column, numRows, numColumns });
          }
        }
      };
    },
    setFrozenRows(value) { this.frozenRows = value; }
  };
}

function createEnvironment() {
  const sheets = {};
  let nowMs = Date.UTC(2026, 7, 18, 3, 0, 0);
  let flushCount = 0;
  const lock = {
    held: false,
    waits: 0,
    waitLock() { if (this.held) throw new Error('lock overlap'); this.held = true; this.waits += 1; },
    releaseLock() { if (!this.held) throw new Error('unheld lock release'); this.held = false; }
  };
  const spreadsheet = {
    getSheetByName(name) { return sheets[name] || null; },
    insertSheet(name) { const sheet = createSheet(name); sheets[name] = sheet; return sheet; }
  };
  return {
    sheets,
    lock,
    getFlushCount() { return flushCount; },
    setNow(value) { nowMs = value; },
    advance(ms) { nowMs += ms; },
    deps: {
      spreadsheet,
      lock,
      now: () => nowMs,
      localDate: (value) => new Date(value + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
      flush: () => { flushCount += 1; }
    }
  };
}

function request(index, options = {}) {
  const role = options.role || 'admin';
  return {
    guardRequestId: options.guardRequestId || ('request-' + index),
    responsePolicyId: options.responsePolicyId || (role === 'admin' ? 'normal' : 'concise'),
    actor: {
      homeId: options.homeId || 'home-a',
      memberUserId: options.memberUserId || 'father',
      role,
      // These client-shaped fields must be irrelevant to Cost Guard.
      userId: options.userId || 'spoofed-user',
      capabilities: options.capabilities || ['spoofed.capability']
    }
  };
}

function completeUsage(modelCallCount = 1) {
  return { inputTokens: 10, outputTokens: 5, totalTokens: 15, modelCallCount, usageStatus: 'available' };
}

function settle(env, handle, options = {}) {
  service.settle(handle, {
    eventType: options.eventType || 'completed',
    model: 'unknown',
    interactionClass: options.interactionClass || 'unclassified',
    resultStatus: options.resultStatus || 'SUCCESS',
    usage: Object.prototype.hasOwnProperty.call(options, 'usage') ? options.usage : completeUsage()
  }, env.deps);
}

function rows(env, sheetName) {
  const sheet = env.sheets[sheetName];
  if (!sheet) return [];
  return sheet.rows.map((row) => Object.fromEntries(sheet.headers.map((header, index) => [header, row[index]])));
}

function dailySheet(env) {
  const sheet = env.sheets.Agent_Cost_Daily;
  if (!sheet) throw new Error('Daily sheet was not created');
  return sheet;
}

function setDailyValue(env, rowIndex, header, value) {
  const sheet = dailySheet(env);
  sheet.rows[rowIndex][sheet.headers.indexOf(header)] = value;
}

function corruptNextDailyWrite(env, field, value) {
  const sheet = dailySheet(env);
  sheet.afterSetValues = function(write) {
    if (write.row < 2 || write.column !== 1) return;
    const row = sheet.rows[write.row - 2];
    row[sheet.headers.indexOf(field)] = value;
    sheet.afterSetValues = null;
  };
}

function expectCostGuardError(fn, expectedReason, message) {
  let caught = null;
  try { fn(); } catch (error) { caught = error; }
  assert(caught && caught.code === 'AGENT_UNAVAILABLE', message + ' did not fail closed');
  assert(caught.agentDiagnostics && caught.agentDiagnostics.reason === expectedReason, message + ' reason changed');
}

function assert(value, message) { if (!value) throw new Error(message); }
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('COST-01 in-flight rejects the second accepted member request', () => {
  const env = createEnvironment();
  const first = service.preflight(request(1), env.deps);
  const second = service.preflight(request(2), env.deps);
  assert(first.allowed === true, 'first request was rejected');
  assert(second.allowed === false && second.errorCode === 'AGENT_BUSY' && second.guardReason === 'busy', 'in-flight request was not rejected safely');
  assert(rows(env, 'Agent_Cost_Daily')[0].acceptedRequestCount === 1, 'guard rejection consumed daily quota');
});

test('COST-02 stale lease recovers after 45 seconds', () => {
  const env = createEnvironment();
  service.preflight(request(1), env.deps);
  env.advance(45001);
  const recovered = service.preflight(request(2), env.deps);
  assert(recovered.allowed === true, 'expired in-flight lease did not recover');
});

test('COST-03 and COST-04 enforce and reset the 3 per 10 second burst', () => {
  const env = createEnvironment();
  for (let index = 1; index <= 3; index += 1) {
    const handle = service.preflight(request(index), env.deps);
    assert(handle.allowed === true, 'burst request ' + index + ' was rejected early');
    settle(env, handle);
    env.advance(1);
  }
  const rejected = service.preflight(request(4), env.deps);
  assert(rejected.allowed === false && rejected.errorCode === 'AGENT_RATE_LIMITED' && rejected.guardReason === 'burst', 'fourth burst request was accepted');
  env.advance(10000);
  const reset = service.preflight(request(5), env.deps);
  assert(reset.allowed === true, 'burst window did not reset');
});

test('COST-05 through COST-07 apply the role daily limits', () => {
  [
    { role: 'admin', limit: 300 },
    { role: 'guardian', limit: 100 },
    { role: 'self_record', limit: 60 }
  ].forEach(({ role, limit }) => {
    const env = createEnvironment();
    const handle = service.preflight(request(role + '-seed', { role }), env.deps);
    settle(env, handle, { usage: null });
    const state = rows(env, 'Agent_Cost_Daily')[0];
    state.acceptedRequestCount = limit - 1;
    const sheet = env.sheets.Agent_Cost_Daily;
    sheet.rows[0][sheet.headers.indexOf('acceptedRequestCount')] = limit - 1;
    const boundary = service.preflight(request(role + '-limit', { role }), env.deps);
    assert(boundary.allowed === true, role + ' limit request was rejected early');
    settle(env, boundary, { usage: null });
    const rejected = service.preflight(request(role + '-over', { role }), env.deps);
    assert(rejected.allowed === false && rejected.guardReason === 'daily', role + ' daily limit did not reject');
  });
});

test('COST-08 daily quota rolls over in Asia Tokyo', () => {
  const env = createEnvironment();
  env.setNow(Date.UTC(2026, 7, 18, 14, 59, 59));
  const handle = service.preflight(request(1), env.deps);
  settle(env, handle, { usage: null });
  const sheet = env.sheets.Agent_Cost_Daily;
  sheet.rows[0][sheet.headers.indexOf('acceptedRequestCount')] = 300;
  env.setNow(Date.UTC(2026, 7, 18, 15, 0, 1));
  const nextDay = service.preflight(request(2), env.deps);
  assert(nextDay.allowed === true && nextDay.localDate === '2026-08-19', 'Asia Tokyo date rollover retained prior daily quota');
});

test('COST-09 and COST-10 isolate members and ignore client role spoofing', () => {
  const env = createEnvironment();
  const first = service.preflight(request(1, { memberUserId: 'member-a', role: 'self_record' }), env.deps);
  settle(env, first, { usage: null });
  const sheet = env.sheets.Agent_Cost_Daily;
  sheet.rows[0][sheet.headers.indexOf('acceptedRequestCount')] = 60;
  const spoofed = service.preflight(request(2, { memberUserId: 'member-a', role: 'self_record', responsePolicyId: 'normal', userId: 'admin-user' }), env.deps);
  assert(spoofed.allowed === false && spoofed.guardReason === 'daily', 'client role spoof changed quota');
  const isolated = service.preflight(request(3, { memberUserId: 'member-b', role: 'self_record' }), env.deps);
  assert(isolated.allowed === true, 'member quota leaked to another member');
});

test('COST-12 accepted Agent errors still consume a request and release in-flight', () => {
  const env = createEnvironment();
  const handle = service.preflight(request(1), env.deps);
  settle(env, handle, { eventType: 'agent_error', usage: null });
  const state = rows(env, 'Agent_Cost_Daily')[0];
  assert(state.acceptedRequestCount === 1, 'accepted Agent failure did not consume quota');
  assert(state.inFlightRequestId === '' && state.inFlightExpiresAt === '', 'Agent error did not release in-flight lease');
  assert(rows(env, 'Agent_Cost_Ledger')[0].eventType === 'agent_error', 'Agent failure ledger type changed');
});

test('COST-13 and COST-14 add complete usage only and never fabricate unavailable usage', () => {
  const env = createEnvironment();
  const completed = service.preflight(request(1), env.deps);
  settle(env, completed, { usage: completeUsage(2) });
  const unavailable = service.preflight(request(2), env.deps);
  settle(env, unavailable, { usage: { inputTokens: null, outputTokens: null, totalTokens: null, modelCallCount: 1, usageStatus: 'unavailable' } });
  const state = rows(env, 'Agent_Cost_Daily')[0];
  assert(state.inputTokens === 10 && state.outputTokens === 5 && state.totalTokens === 15 && state.modelCallCount === 2, 'complete usage totals changed');
  const ledger = rows(env, 'Agent_Cost_Ledger');
  assert(ledger[1].inputTokens === '' && ledger[1].totalTokens === '' && ledger[1].usageStatus === 'unavailable', 'unavailable usage was stored as zero');
});

test('COST-15 ledger is append-only and excludes request and response content', () => {
  const env = createEnvironment();
  const handle = service.preflight(request(1), env.deps);
  settle(env, handle, {
    interactionClass: 'tool_read',
    usage: completeUsage(),
    message: 'private user message',
    reply: 'private reply',
    toolResult: { calendar: 'private event' },
    sessionId: 'private-session'
  });
  const sheet = env.sheets.Agent_Cost_Ledger;
  assert(JSON.stringify(sheet.rows).includes('private') === false, 'Ledger stored private request or response data');
  assert(JSON.stringify(sheet.headers) === JSON.stringify(service.constants.LEDGER_HEADERS), 'Ledger headers changed or reordered');
});

test('COST-16 and COST-17 release in-flight for completed and Agent-error outcomes', () => {
  ['completed', 'agent_error'].forEach((eventType, index) => {
    const env = createEnvironment();
    const handle = service.preflight(request(index + 1), env.deps);
    settle(env, handle, { eventType, usage: null });
    const next = service.preflight(request(index + 11), env.deps);
    assert(next.allowed === true, eventType + ' did not release in-flight state');
  });
});

test('COST-ROW-01 and COST-ROW-02 canonicalize persisted Date and trimmed string localDate values', () => {
  const env = createEnvironment();
  const dateHandle = service.preflight(request('date'), env.deps);
  setDailyValue(env, 0, 'localDate', new Date(Date.UTC(2026, 7, 17, 15, 0, 0)));
  settle(env, dateHandle);
  const stringHandle = service.preflight(request('string'), env.deps);
  assert(stringHandle.stateRowNumber === dateHandle.stateRowNumber, 'Date localDate did not reuse the same Daily row');
  setDailyValue(env, 0, 'localDate', ' 2026-08-18 ');
  settle(env, stringHandle);
  const next = service.preflight(request('trimmed'), env.deps);
  assert(next.stateRowNumber === dateHandle.stateRowNumber, 'trimmed string localDate did not reuse the same Daily row');
});

test('COST-ROW-03 and COST-ROW-04 retain one same-day row and settle cumulative usage', () => {
  const env = createEnvironment();
  const first = service.preflight(request(1), env.deps);
  setDailyValue(env, 0, 'localDate', new Date(Date.UTC(2026, 7, 17, 15, 0, 0)));
  settle(env, first, { usage: completeUsage(1) });
  const second = service.preflight(request(2), env.deps);
  assert(second.stateRowNumber === first.stateRowNumber, 'same key did not retain its original stateRowNumber');
  settle(env, second, { usage: completeUsage(2) });
  const daily = rows(env, 'Agent_Cost_Daily');
  assert(daily.length === 1, 'same logical key created a duplicate Daily row');
  assert(daily[0].acceptedRequestCount === 2, 'same-day accepted count did not accumulate');
  assert(daily[0].inFlightRequestId === '' && daily[0].inFlightExpiresAt === '', 'completed settle did not clear in-flight');
  assert(daily[0].inputTokens === 20 && daily[0].outputTokens === 10 && daily[0].totalTokens === 30 && daily[0].modelCallCount === 3, 'completed settle did not accumulate usage');
});

test('COST-ROW-05 clears a Date-backed in-flight lease for agent_error', () => {
  const env = createEnvironment();
  const handle = service.preflight(request('agent-error'), env.deps);
  setDailyValue(env, 0, 'localDate', new Date(Date.UTC(2026, 7, 17, 15, 0, 0)));
  settle(env, handle, { eventType: 'agent_error', usage: null });
  const daily = rows(env, 'Agent_Cost_Daily')[0];
  assert(daily.inFlightRequestId === '' && daily.inFlightExpiresAt === '', 'agent_error did not clear Date-backed in-flight state');
});

test('COST-ROW-06 rejects duplicate canonical state without creating another row', () => {
  const env = createEnvironment();
  service.preflight(request('first'), env.deps);
  const sheet = dailySheet(env);
  sheet.rows.push(sheet.rows[0].slice());
  expectCostGuardError(() => service.preflight(request('duplicate'), env.deps), 'COST_STATE_DUPLICATE', 'duplicate Daily state');
  assert(sheet.rows.length === 2, 'duplicate handling mutated existing Daily rows');
  assert(rows(env, 'Agent_Cost_Ledger').length === 0, 'duplicate handling appended a ledger record without a valid state');
});

test('COST-ROW-07 through COST-ROW-09 revalidate state row and request identity before settle', () => {
  const env = createEnvironment();
  const handle = service.preflight(request('row-check'), env.deps);
  expectCostGuardError(() => settle(env, Object.assign({}, handle, { stateRowNumber: handle.stateRowNumber + 1 })), 'COST_STATE_ROW_MISMATCH', 'state row mismatch');
  const before = rows(env, 'Agent_Cost_Daily')[0];
  assert(before.inFlightRequestId === handle.guardRequestId, 'row mismatch cleared the original in-flight state');
  expectCostGuardError(() => settle(env, Object.assign({}, handle, { guardRequestId: 'other-request' })), 'COST_STATE_REQUEST_MISMATCH', 'request mismatch');
  const after = rows(env, 'Agent_Cost_Daily')[0];
  assert(after.inFlightRequestId === handle.guardRequestId, 'request mismatch cleared another request lease');
});

test('COST-ROW-10 preserves unavailable usage as null after canonical row resolution', () => {
  const env = createEnvironment();
  const handle = service.preflight(request('unavailable'), env.deps);
  setDailyValue(env, 0, 'localDate', new Date(Date.UTC(2026, 7, 17, 15, 0, 0)));
  settle(env, handle, { usage: { inputTokens: null, outputTokens: null, totalTokens: null, modelCallCount: 1, usageStatus: 'unavailable' } });
  const daily = rows(env, 'Agent_Cost_Daily')[0];
  assert(daily.inputTokens === '' && daily.outputTokens === '' && daily.totalTokens === '' && daily.modelCallCount === '', 'unavailable usage was converted into Daily zero values');
});

test('COST-PERSIST-01 preflight fails closed when Daily read-back does not retain its accepted state', () => {
  const env = createEnvironment();
  const first = service.preflight(request('persist-seed'), env.deps);
  settle(env, first, { usage: null });
  corruptNextDailyWrite(env, 'acceptedRequestCount', 1);
  expectCostGuardError(() => service.preflight(request('persist-preflight-failure'), env.deps), 'COST_STATE_WRITE_FAILED', 'preflight persistence verification');
  assert(rows(env, 'Agent_Cost_Ledger').length === 1, 'failed preflight appended a completed Ledger row');
  assert(env.getFlushCount() >= 3, 'preflight did not flush Daily state before returning');
});

test('COST-PERSIST-02 settle does not append completed Ledger when Daily read-back fails', () => {
  const env = createEnvironment();
  const handle = service.preflight(request('persist-settle-failure'), env.deps);
  corruptNextDailyWrite(env, 'inFlightRequestId', handle.guardRequestId);
  expectCostGuardError(() => settle(env, handle), 'COST_STATE_WRITE_FAILED', 'settle persistence verification');
  assert(rows(env, 'Agent_Cost_Ledger').length === 0, 'failed settle appended a completed Ledger row');
  assert(env.getFlushCount() >= 2, 'settle did not flush Daily state before Ledger append');
});

test('COST-PERSIST-03 settle preserves preflight-owned count and burst fields', () => {
  const env = createEnvironment();
  const handle = service.preflight(request('ownership'), env.deps);
  const before = rows(env, 'Agent_Cost_Daily')[0];
  settle(env, handle, { usage: completeUsage(2) });
  const after = rows(env, 'Agent_Cost_Daily')[0];
  ['acceptedRequestCount', 'windowStartedAt', 'windowRequestCount'].forEach((field) => {
    assert(after[field] === before[field], 'settle rewrote preflight-owned field: ' + field);
  });
  assert(after.inFlightRequestId === '' && after.inFlightExpiresAt === '', 'settle did not release its lease');
  assert(after.modelCallCount === 2, 'settle did not write owned usage field');
});

test('COST-PERSIST-04 Daily aggregate equals seven sequential completed Ledger entries', () => {
  const env = createEnvironment();
  let expectedInput = 0;
  let expectedOutput = 0;
  let expectedTotal = 0;
  let expectedModelCalls = 0;
  for (let index = 1; index <= 7; index += 1) {
    const handle = service.preflight(request('aggregate-' + index), env.deps);
    const usage = {
      inputTokens: index * 10,
      outputTokens: index,
      totalTokens: index * 11,
      modelCallCount: index,
      usageStatus: 'available'
    };
    settle(env, handle, { usage });
    expectedInput += usage.inputTokens;
    expectedOutput += usage.outputTokens;
    expectedTotal += usage.totalTokens;
    expectedModelCalls += usage.modelCallCount;
    env.advance(10001);
  }
  const daily = rows(env, 'Agent_Cost_Daily')[0];
  const ledger = rows(env, 'Agent_Cost_Ledger');
  assert(daily.acceptedRequestCount === 7, 'Daily accepted count diverged from completed request count');
  assert(daily.inputTokens === expectedInput && daily.outputTokens === expectedOutput && daily.totalTokens === expectedTotal, 'Daily token totals diverged from completed Ledger totals');
  assert(daily.modelCallCount === expectedModelCalls, 'Daily model call total diverged from completed Ledger total');
  assert(ledger.length === 7 && ledger.every((entry) => entry.eventType === 'completed'), 'Ledger did not retain seven completed entries');
});

test('new state and ledger sheets use the specified header order', () => {
  const env = createEnvironment();
  const handle = service.preflight(request(1), env.deps);
  settle(env, handle, { usage: null });
  assert(JSON.stringify(env.sheets.Agent_Cost_Daily.headers) === JSON.stringify(service.constants.DAILY_HEADERS), 'Daily header order changed');
  assert(JSON.stringify(env.sheets.Agent_Cost_Ledger.headers) === JSON.stringify(service.constants.LEDGER_HEADERS), 'Ledger header order changed');
  assert(env.lock.held === false && env.lock.waits >= 2, 'Lock was not released around preflight and settle');
});

let failures = 0;
tests.forEach((item) => {
  try { item.fn(); console.log('PASS ' + item.name); }
  catch (error) { failures += 1; console.error('FAIL ' + item.name + ': ' + error.message); }
});
if (failures) process.exitCode = 1;
else console.log('PASS all ' + tests.length + ' tests');
