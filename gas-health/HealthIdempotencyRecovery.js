function executeIdempotentWrite_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const payload = healthBusinessPayload_(body);
    const hash = healthRequestHash_(body, payload);
    const existing = findCommittedRequestById_(body.clientRequestId);
    if (existing.state === 'corrupt') throw healthErr_('DATA_INTEGRITY_ERROR');
    if (existing.state === 'committed' || existing.state === 'recoverable') {
      if (existing.requestHash !== hash) throw healthErr_('IDEMPOTENCY_CONFLICT');
      const response = existing.logEntry ? JSON.parse(existing.logEntry.responseJson) : { success:true, data:existing.businessEntry.result };
      if (!existing.logEntry) appendRequestLog_(body, hash, response);
      return response;
    }
    const data = body.operation === 'health.daily.recordSlot' ? dailyRecord_(body) : weightRecord_(body);
    const response = { success:true, data:data };
    appendRequestLog_(body, hash, response);
    return response;
  } finally { lock.releaseLock(); }
}
function healthBusinessPayload_(body) { return body.operation === 'health.weight.record' ? {measuredDate:body.measuredDate,weightKg:Number(body.weightKg)} : {localDate:body.localDate,slot:body.slot,payload:body.payload}; }
function findCommittedRequestById_(id) { const log=healthRequest_(id), matches=findBusinessRequest_(id); if(matches.length > 1 || (log && !matches.length)) return {state:'corrupt'}; if(log) return {state:'committed',logEntry:log,requestHash:log.requestHash}; if(matches.length) return {state:'recoverable',businessEntry:matches[0],requestHash:matches[0].requestHash}; return {state:'new'}; }
function appendRequestLog_(body,hash,response) { healthSaveRequest_(body,hash,response); }
function healthRequest_(clientRequestId) { const table=healthMap_(healthSheet_(HEALTH_SHEETS.request)); for(let i=1;i<table.values.length;i++){const row=table.values[i];if(String(row[table.map.clientRequestId]||'')===String(clientRequestId||''))return healthObject_(table,row);} return null; }
function healthSaveRequest_(body,hash,response) { const sheet=healthSheet_(HEALTH_SHEETS.request),table=healthMap_(sheet),row=new Array(table.values[0].length).fill(''),put=function(k,v){row[table.map[k]]=v;}; [['clientRequestId',body.clientRequestId],['operation',body.operation],['actorUserId',body.actorUserId],['targetUserId',body.targetUserId],['requestHash',hash],['responseJson',JSON.stringify(response)],['status','committed'],['createdAt',healthNow_()]].forEach(function(pair){put(pair[0],pair[1]);});sheet.appendRow(row); }
function findBusinessRequest_(id) {
  const found=[];
  const daily=healthMap_(healthSheet_(HEALTH_SHEETS.daily));
  daily.values.slice(1).forEach(function(row){Object.keys(SLOT_META).forEach(function(slot){const meta=SLOT_META[slot];if(String(row[daily.map[meta.id]]||'')===String(id))found.push(rebuildDailyRequest_(daily,row,slot));});});
  const weight=healthMap_(healthSheet_(HEALTH_SHEETS.weight));
  weight.values.slice(1).forEach(function(row){if(String(row[weight.map.clientRequestId]||'')===String(id))found.push(rebuildWeightRequest_(weight,row));});
  return found;
}
function rebuildDailyRequest_(table,row,slot) { const meta=SLOT_META[slot],get=function(k){return row[table.map[k]];},payload={}; SLOT[slot].forEach(function(k){const value=get(k);if(value===''||value===undefined||value===null){if(HEALTH_OPTIONAL_SLOT_FIELDS[k])return;throw healthErr_('DATA_INTEGRITY_ERROR');}payload[k]=value;}); if(slot==='condition'){payload.symptoms=safeJsonArray_(payload.conditionSymptomsJson);if(String(payload.conditionSymptomsJson||'')!==JSON.stringify(payload.symptoms))throw healthErr_('DATA_INTEGRITY_ERROR');delete payload.conditionSymptomsJson;payload.note=payload.conditionNote;delete payload.conditionNote;} const body={operation:'health.daily.recordSlot',homeId:String(get('homeId')||''),actorUserId:String(get(meta.by)||''),targetUserId:String(get('targetUserId')||''),localDate:healthDate_(get('localDate')),slot:slot,payload:payload}; if(!body.homeId||!body.actorUserId||!body.targetUserId||!body.localDate||!get(meta.at))throw healthErr_('DATA_INTEGRITY_ERROR'); return {requestHash:healthRequestHash_(body,healthBusinessPayload_(body)),result:dailyGet_(body)}; }
function rebuildWeightRequest_(table,row) { const get=function(k){return row[table.map[k]];},body={operation:'health.weight.record',homeId:String(get('homeId')||''),actorUserId:String(get('recordedBy')||''),targetUserId:String(get('targetUserId')||''),measuredDate:healthDate_(get('measuredDate')),weightKg:Number(get('weightKg'))};if(!body.homeId||!body.actorUserId||!body.targetUserId||!body.measuredDate||!Number.isFinite(body.weightKg))throw healthErr_('DATA_INTEGRITY_ERROR');return {requestHash:healthRequestHash_(body,healthBusinessPayload_(body)),result:{measuredDate:body.measuredDate,weightKg:body.weightKg}}; }
