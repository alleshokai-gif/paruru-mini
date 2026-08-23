function normalizeCorrectionReason_(value) {
  if (value === undefined || value === null) return '';
  const reason = String(value).trim();
  if (reason.length > 200) throw healthErr_('INVALID_INPUT');
  return reason;
}

function dailyAuditJson_(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function dailyAuditParseJson_(value) {
  try {
    const parsed = JSON.parse(String(value || 'null'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    throw healthErr_('DATA_INTEGRITY_ERROR');
  }
}

function dailyAuditEntry_(table, row, rowNumber) {
  const entry = healthObject_(table, row);
  const state = String(entry.commitState || '');
  if (!healthUuid_(entry.auditId) || !entry.homeId || !entry.targetUserId || !healthDate_(entry.localDate)
    || !SLOT[entry.slot] || !healthUuid_(entry.clientRequestId) || !entry.requestHash
    || ['create', 'update'].indexOf(String(entry.operation || '')) < 0 || ['pending', 'committed'].indexOf(state) < 0) {
    throw healthErr_('DATA_INTEGRITY_ERROR');
  }
  return {
    rowNumber: rowNumber,
    table: table,
    auditId: String(entry.auditId),
    homeId: String(entry.homeId),
    targetUserId: String(entry.targetUserId),
    localDate: healthDate_(entry.localDate),
    slot: String(entry.slot),
    before: dailyAuditParseJson_(entry.beforeJson),
    after: dailyAuditParseJson_(entry.afterJson),
    operation: String(entry.operation),
    recordedBy: String(entry.recordedBy || ''),
    recordedAt: String(entry.recordedAt || ''),
    clientRequestId: String(entry.clientRequestId),
    isCorrection: healthBoolean_(entry.isCorrection),
    correctionReason: normalizeCorrectionReason_(entry.correctionReason),
    requestHash: String(entry.requestHash),
    commitState: state,
  };
}

function dailyAuditByRequestId_(clientRequestId) {
  const sheet = healthSheet_(HEALTH_SHEETS.dailyAudit);
  const table = healthMap_(sheet);
  const matches = [];
  table.values.slice(1).forEach(function(row, index) {
    if (String(row[table.map.clientRequestId] || '') === String(clientRequestId || '')) {
      matches.push(dailyAuditEntry_(table, row, index + 2));
    }
  });
  if (matches.length > 1) throw healthErr_('DATA_INTEGRITY_ERROR');
  return matches[0] || null;
}

function appendDailyAuditPending_(body, requestHash, plan) {
  const sheet = healthSheet_(HEALTH_SHEETS.dailyAudit);
  const table = healthMap_(sheet);
  const row = new Array(table.values[0].length).fill('');
  const put = function(key, value) { row[table.map[key]] = value; };
  const reason = normalizeCorrectionReason_(body.correctionReason);
  [
    ['auditId', Utilities.getUuid()], ['homeId', body.homeId], ['targetUserId', body.targetUserId],
    ['localDate', body.localDate], ['slot', body.slot], ['beforeJson', dailyAuditJson_(plan.before)],
    ['afterJson', dailyAuditJson_(plan.after)], ['operation', plan.before ? 'update' : 'create'],
    ['recordedBy', body.actorUserId], ['recordedAt', plan.now], ['clientRequestId', body.clientRequestId],
    ['isCorrection', body.isCorrection === true], ['correctionReason', reason], ['requestHash', requestHash], ['commitState', 'pending'],
  ].forEach(function(pair) { put(pair[0], pair[1]); });
  sheet.appendRow(row);
  return dailyAuditEntry_(table, row, sheet.getLastRow());
}

function commitDailyAudit_(entry) {
  const sheet = healthSheet_(HEALTH_SHEETS.dailyAudit);
  sheet.getRange(entry.rowNumber, entry.table.map.commitState + 1, 1, 1).setValues([['committed']]);
  entry.commitState = 'committed';
  return entry;
}

function dailyAuditCurrentSlot_(entry) {
  const found = healthRow_(healthSheet_(HEALTH_SHEETS.daily), entry.homeId, entry.targetUserId, entry.localDate);
  if (!found.rowNumber) return null;
  return dailySlotFromRow_(healthObject_(found.table, found.row), entry.slot);
}

function dailyAuditRecoverPending_(body, entry) {
  const current = dailyAuditCurrentSlot_(entry);
  const expectedBefore = dailyAuditJson_(entry.before);
  const expectedAfter = dailyAuditJson_(entry.after);
  const currentJson = dailyAuditJson_(current);
  if (currentJson === expectedAfter) {
    commitDailyAudit_(entry);
    return dailyGet_(body);
  }
  if (currentJson !== expectedBefore) throw healthErr_('DATA_INTEGRITY_ERROR');
  const plan = dailyWritePlan_(body, entry.recordedAt);
  if (dailyAuditJson_(plan.before) !== expectedBefore || dailyAuditJson_(plan.after) !== expectedAfter) throw healthErr_('DATA_INTEGRITY_ERROR');
  dailyApplyWritePlan_(plan);
  commitDailyAudit_(entry);
  return dailyGet_(body);
}
