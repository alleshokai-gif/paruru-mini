function petHealthRequestLogsById_(clientRequestId){
  const table=healthMap_(healthSheet_(PET_HEALTH_SHEETS.request)),found=[];
  table.values.slice(1).forEach(function(row){if(String(row[table.map.clientRequestId]||'')===String(clientRequestId||''))found.push(healthObject_(table,row));});
  return found;
}
function petHealthValidateLog_(log,event,expectedResponse,request){
  if(String(log.clientRequestId||'')!==request.clientRequestId||String(log.clientRequestId||'')!==event.clientRequestId||String(log.operation||'')!==request.operation||String(log.actorUserId||'')!==request.actorUserId||String(log.actorUserId||'')!==event.recordedBy||String(log.petId||'')!==request.petId||String(log.petId||'')!==event.petId||String(log.requestHash||'')!==event.requestHash||String(log.eventId||'')!==event.eventId||String(log.status||'')!=='committed'||String(log.createdAt||'')!==event.recordedAt)throw healthErr_('DATA_INTEGRITY_ERROR');
  let response;
  try{response=JSON.parse(String(log.responseJson||''));}catch(_){throw healthErr_('DATA_INTEGRITY_ERROR');}
  if(!response||!response.data||!response.data.event||String(response.data.event.eventId||'')!==event.eventId||JSON.stringify(response)!==JSON.stringify(expectedResponse))throw healthErr_('DATA_INTEGRITY_ERROR');
}
function petHealthAppendRequestLog_(request,event,response,createdAt){
  const sheet=healthSheet_(PET_HEALTH_SHEETS.request),table=healthMap_(sheet),row=new Array(table.values[0].length).fill('');
  [['clientRequestId',request.clientRequestId],['operation',request.operation],['actorUserId',request.actorUserId],['petId',request.petId],['requestHash',event.requestHash],['eventId',event.eventId],['responseJson',JSON.stringify(response)],['status','committed'],['createdAt',createdAt]].forEach(function(pair){petHealthPut_(row,table.map,pair[0],pair[1]);});
  sheet.appendRow(row);
}
function petHealthFlushPersistence_(){
  try{SpreadsheetApp.flush();}catch(_){throw healthErr_('DATA_INTEGRITY_ERROR');}
}
function petHealthVerifyPersistedRequestLog_(request,event,response){
  const logs=petHealthRequestLogsById_(request.clientRequestId);
  if(logs.length!==1)throw healthErr_('DATA_INTEGRITY_ERROR');
  petHealthValidateLog_(logs[0],event,response,request);
  return logs[0];
}
function petHealthIdempotencyState_(request){
  const events=petHealthEventsByRequestId_(request.clientRequestId),logs=petHealthRequestLogsById_(request.clientRequestId);
  if(events.length>1||logs.length>1||(logs.length===1&&events.length===0))throw healthErr_('DATA_INTEGRITY_ERROR');
  return {event:events[0]||null,log:logs[0]||null};
}
function petHealthRecord_(body,options){
  const deps=options||{},receivedAt=deps.now?deps.now():new Date(),request=petHealthNormalizeRecordRequest_(body,receivedAt,deps),requestHash=petHealthRecordHash_(request),lock=deps.lock||(LockService&&LockService.getScriptLock());
  lock.waitLock(30000);
  try {
    const state=petHealthIdempotencyState_(request);
    if(state.event){
      const original=petHealthRecordResponse_(state.event,false);
      if(state.log)petHealthValidateLog_(state.log,state.event,original,request);
      if(state.event.requestHash!==requestHash)throw healthErr_('IDEMPOTENCY_CONFLICT');
      if(!state.log){
        petHealthAppendRequestLog_(request,state.event,original,state.event.recordedAt);
        petHealthFlushPersistence_();
        petHealthVerifyPersistedRequestLog_(request,state.event,original);
      }
      return petHealthRecordResponse_(state.event,true);
    }
    const occurredAt=request.event.occurredAt||petHealthInstant_(receivedAt,deps),occurredAtSource=request.event.occurredAt?'explicit':'server_default',recordedAt=petHealthInstant_(receivedAt,deps),eventId=deps.uuid?deps.uuid():Utilities.getUuid();
    petHealthValidateWaterBottleAppend_(request,occurredAt);
    if(!healthUuid_(eventId))throw healthErr_('INTERNAL_ERROR');
    const appendedEvent=petHealthAppendEvent_(request,eventId,occurredAt,occurredAtSource,recordedAt,requestHash);
    petHealthFlushPersistence_();
    const event=petHealthVerifyPersistedEvent_(request,appendedEvent),response=petHealthRecordResponse_(event,false);
    petHealthAppendRequestLog_(request,event,response,recordedAt);
    petHealthFlushPersistence_();
    petHealthVerifyPersistedRequestLog_(request,event,response);
    return response;
  } finally {lock.releaseLock();}
}
