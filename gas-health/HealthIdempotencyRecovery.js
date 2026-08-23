function executeIdempotentWrite_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const payload = healthBusinessPayload_(body);
    const hash = healthRequestHash_(body, payload);
    const logged = healthRequest_(body.clientRequestId);
    if (logged) {
      if (String(logged.requestHash || '') !== hash) throw healthErr_('IDEMPOTENCY_CONFLICT');
      try { return JSON.parse(logged.responseJson); } catch (_) { throw healthErr_('DATA_INTEGRITY_ERROR'); }
    }
    const response = body.operation === 'health.daily.recordSlot'
      ? executeDailyRecordWrite_(body, hash)
      : body.operation === 'health.weight.correct'
        ? executeWeightCorrectionWrite_(body, hash)
        : executeWeightRecordWrite_(body, hash);
    appendRequestLog_(body, hash, response);
    return response;
  } finally { lock.releaseLock(); }
}

function executeDailyRecordWrite_(body, hash) {
  const audit = dailyAuditByRequestId_(body.clientRequestId);
  if (audit) {
    if (audit.requestHash !== hash) throw healthErr_('IDEMPOTENCY_CONFLICT');
    if (audit.homeId !== String(body.homeId) || audit.targetUserId !== String(body.targetUserId)
      || audit.localDate !== String(body.localDate) || audit.slot !== String(body.slot)) {
      throw healthErr_('DATA_INTEGRITY_ERROR');
    }
    const data = audit.commitState === 'pending' ? dailyAuditRecoverPending_(body, audit) : dailyGet_(body);
    return { success:true, data:data };
  }
  const legacy = findLegacyDailyRequest_(body.clientRequestId);
  if (legacy) {
    if (legacy.requestHash !== hash) throw healthErr_('IDEMPOTENCY_CONFLICT');
    return { success:true, data:legacy.result };
  }
  const plan = dailyWritePlan_(body, healthNow_());
  const pending = appendDailyAuditPending_(body, hash, plan);
  dailyApplyWritePlan_(plan);
  commitDailyAudit_(pending);
  return { success:true, data:dailyGet_(body) };
}

function executeWeightRecordWrite_(body, hash) {
  const existing = weightRequestById_(body.clientRequestId);
  if (existing) {
    const rebuilt = rebuildWeightRequest_(existing.table, existing.rawRow);
    if (rebuilt.requestHash !== hash) throw healthErr_('IDEMPOTENCY_CONFLICT');
    return { success:true, data:rebuilt.result };
  }
  return { success:true, data:weightRecord_(body) };
}

function executeWeightCorrectionWrite_(body, hash) {
  const existing = weightRequestById_(body.clientRequestId);
  if (existing) {
    const rebuilt = rebuildWeightRequest_(existing.table, existing.rawRow);
    if (rebuilt.operation !== 'health.weight.correct' || rebuilt.requestHash !== hash) throw healthErr_('IDEMPOTENCY_CONFLICT');
    return { success:true, data:weightRecoverCorrection_(body, existing) };
  }
  return { success:true, data:weightCorrect_(body) };
}

function healthBusinessPayload_(body) {
  if (body.operation === 'health.weight.record') return { measuredDate:body.measuredDate, weightKg:Number(body.weightKg) };
  if (body.operation === 'health.weight.correct') { const corrected={ recordId:body.recordId, measuredDate:body.measuredDate, weightKg:Number(body.weightKg) },reason=normalizeCorrectionReason_(body.correctionReason);if(reason)corrected.correctionReason=reason;return corrected; }
  const daily={ localDate:body.localDate, slot:body.slot, payload:body.payload },reason=normalizeCorrectionReason_(body.correctionReason);if(body.isCorrection===true)daily.isCorrection=true;if(reason)daily.correctionReason=reason;return daily;
}

function appendRequestLog_(body, hash, response) { healthSaveRequest_(body, hash, response); }
function healthRequest_(clientRequestId) { const table=healthMap_(healthSheet_(HEALTH_SHEETS.request)); for(let i=1;i<table.values.length;i++){const row=table.values[i];if(String(row[table.map.clientRequestId]||'')===String(clientRequestId||''))return healthObject_(table,row);} return null; }
function healthSaveRequest_(body,hash,response) { const sheet=healthSheet_(HEALTH_SHEETS.request),table=healthMap_(sheet),row=new Array(table.values[0].length).fill(''),put=function(k,v){row[table.map[k]]=v;}; [['clientRequestId',body.clientRequestId],['operation',body.operation],['actorUserId',body.actorUserId],['targetUserId',body.targetUserId],['requestHash',hash],['responseJson',JSON.stringify(response)],['status','committed'],['createdAt',healthNow_()]].forEach(function(pair){put(pair[0],pair[1]);});sheet.appendRow(row); }

function findLegacyDailyRequest_(clientRequestId) {
  const daily = healthMap_(healthSheet_(HEALTH_SHEETS.daily)), matches=[];
  daily.values.slice(1).forEach(function(row) {
    Object.keys(SLOT_META).forEach(function(slot) {
      const meta=SLOT_META[slot];
      if (String(row[daily.map[meta.id]]||'')===String(clientRequestId||'')) matches.push(rebuildDailyRequest_(daily,row,slot));
    });
  });
  if (matches.length > 1) throw healthErr_('DATA_INTEGRITY_ERROR');
  return matches[0] || null;
}

function rebuildDailyRequest_(table,row,slot) { const meta=SLOT_META[slot],get=function(k){return row[table.map[k]];},payload={}; SLOT[slot].forEach(function(k){const value=get(k);if(value===''||value===undefined||value===null){if(HEALTH_OPTIONAL_SLOT_FIELDS[k])return;throw healthErr_('DATA_INTEGRITY_ERROR');}payload[k]=value;}); if(slot==='condition'){payload.symptoms=safeJsonArray_(payload.conditionSymptomsJson);if(String(payload.conditionSymptomsJson||'')!==JSON.stringify(payload.symptoms))throw healthErr_('DATA_INTEGRITY_ERROR');delete payload.conditionSymptomsJson;payload.note=payload.conditionNote;delete payload.conditionNote;} const body={operation:'health.daily.recordSlot',homeId:String(get('homeId')||''),actorUserId:String(get(meta.by)||''),targetUserId:String(get('targetUserId')||''),localDate:healthDate_(get('localDate')),slot:slot,payload:payload,correctionReason:''}; if(!body.homeId||!body.actorUserId||!body.targetUserId||!body.localDate||!get(meta.at))throw healthErr_('DATA_INTEGRITY_ERROR'); return {requestHash:healthRequestHash_(body,healthBusinessPayload_(body)),result:dailyGet_(body)}; }

function rebuildWeightRequest_(table,row) {
  const get=function(k){return row[table.map[k]];},correctionOfRecordId=String(get('correctionOfRecordId')||'').trim(),body={
    operation:correctionOfRecordId?'health.weight.correct':'health.weight.record', homeId:String(get('homeId')||''),
    actorUserId:String(get('recordedBy')||''),targetUserId:String(get('targetUserId')||''),measuredDate:healthDate_(get('measuredDate')),
    weightKg:Number(get('weightKg')),recordId:correctionOfRecordId,correctionReason:normalizeCorrectionReason_(get('correctionReason')),
  };
  if(!body.homeId||!body.actorUserId||!body.targetUserId||!body.measuredDate||!Number.isFinite(body.weightKg)||(correctionOfRecordId&&!healthUuid_(correctionOfRecordId)))throw healthErr_('DATA_INTEGRITY_ERROR');
  const stored=healthObject_(table,row),result=weightPublic_(stored);
  if(correctionOfRecordId)result.correctionOfRecordId=correctionOfRecordId;
  return {operation:body.operation,requestHash:healthRequestHash_(body,healthBusinessPayload_(body)),result:result};
}
