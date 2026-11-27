const MEDICATION_TABLES_ = Object.freeze({
  plans:{name:'Health_Routine_Plans',headers:['homeId','targetUserId','planId','revision','planJson','clientRequestId','requestHash','recordedBy','recordedAt']},
  events:{name:'Health_Routine_Events',headers:['eventId','homeId','targetUserId','planId','planRevision','localDate','slot','status','occurredAt','expectedEventId','correctionReasonJson','clientRequestId','requestHash','recordedBy','recordedAt']}
});
const MEDICATION_OPERATIONS_ = Object.freeze({'health.medication.get':true,'health.medication.plan.put':true,'health.medication.record':true});
function medicationNow_(){return new Date().toISOString();}
function setupMedicationRoutineSchema() {
  const ss=SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('HEALTH_SPREADSHEET_ID')||'');
  Object.keys(MEDICATION_TABLES_).forEach(function(key){const spec=MEDICATION_TABLES_[key];let sheet=ss.getSheetByName(spec.name);if(!sheet)sheet=ss.insertSheet(spec.name);const headers=sheet.getLastColumn()?sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String):[];medicationAssert_(headers.every(function(h,i){return spec.headers[i]===h;}),'CONFIGURATION_ERROR');if(headers.length<spec.headers.length)sheet.getRange(1,headers.length+1,1,spec.headers.length-headers.length).setValues([spec.headers.slice(headers.length)]);sheet.setFrozenRows(1);});
}
function medicationTables_() {
  const ss=SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('HEALTH_SPREADSHEET_ID')||''),out={};
  Object.keys(MEDICATION_TABLES_).forEach(function(key){const spec=MEDICATION_TABLES_[key],sheet=ss.getSheetByName(spec.name);medicationAssert_(sheet,'ROUTINE_NOT_CONFIGURED');const table=healthMap_(sheet);medicationAssert_(spec.headers.every(function(h){return table.map[h]!==undefined;}),'CONFIGURATION_ERROR');out[key]={sheet:sheet,table:table,rows:table.values.slice(1).map(function(row){return healthObject_(table,row);})};});
  return out;
}
function medicationAuthorizeService_(body,configure) {
  medicationAssert_(body&&typeof body.homeId==='string'&&body.homeId&&typeof body.actorUserId==='string'&&body.actorUserId&&typeof body.targetUserId==='string'&&body.targetUserId,'INVALID_INPUT');
  const guardian=['admin','guardian'].indexOf(body.actorRole)>=0;
  medicationAssert_(guardian||['','self_record'].indexOf(body.actorRole)>=0,'FORBIDDEN');
  medicationAssert_(!configure||guardian,'FORBIDDEN');
  medicationAssert_(body.actorUserId===body.targetUserId||guardian,'FORBIDDEN');
}
function medicationStoredInstant_(value) {
  const text=Object.prototype.toString.call(value)==='[object Date]'?value.toISOString():String(value||'');
  return text?medicationInstant_(text).toISOString():'';
}
function medicationStoredDate_(value) {
  return medicationDate_(Object.prototype.toString.call(value)==='[object Date]'?medicationLocalDate_(value.toISOString()):String(value));
}
function medicationRows_(tables,body) {
  const match=function(row){return row.homeId===body.homeId&&row.targetUserId===body.targetUserId;};
  const plans=tables.plans.rows.filter(match).map(function(row){let plan;try{plan=medicationPlan_(JSON.parse(row.planJson));}catch(_){throw medicationError_('DATA_INTEGRITY_ERROR');}medicationAssert_(medicationUuid_(row.planId)&&Number.isInteger(Number(row.revision))&&Number(row.revision)>0,'DATA_INTEGRITY_ERROR');return {planId:row.planId,revision:Number(row.revision),plan:plan,recordedAt:medicationStoredInstant_(row.recordedAt)};});
  const events=tables.events.rows.filter(match).map(function(row){return {eventId:String(row.eventId),planId:String(row.planId),planRevision:Number(row.planRevision),localDate:medicationStoredDate_(row.localDate),slot:String(row.slot),status:String(row.status),occurredAt:medicationStoredInstant_(row.occurredAt),expectedEventId:String(row.expectedEventId||''),recordedAt:medicationStoredInstant_(row.recordedAt)};});
  return {plans:plans,events:events};
}
function medicationGet_(body) {
  medicationAuthorizeService_(body,false);
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try {return medicationReadLocked_(body);}finally{lock.releaseLock();}
}
function medicationReadLocked_(body) {
  const now=medicationNow_(),localDate=medicationDate_(body.localDate||medicationLocalDate_(now));let tables;
  try{tables=medicationTables_();}catch(error){if(error.code!=='ROUTINE_NOT_CONFIGURED')throw error;return {configured:false,localDate:localDate,serverNow:now,plans:[],occurrences:[],notificationTransport:'not_connected'};}
  const rows=medicationRows_(tables,body),current={};
  rows.plans.forEach(function(row){if(!current[row.planId]||current[row.planId].revision<row.revision)current[row.planId]=row;});
  return {configured:true,localDate:localDate,serverNow:now,plans:Object.keys(current).map(function(id){const row=current[id];return Object.assign({planId:id,revision:row.revision},row.plan);}),occurrences:medicationOccurrences_(rows.plans,rows.events,localDate,now),notificationTransport:'not_connected'};
}
function medicationAppend_(table,value) {
  const row=new Array(table.table.values[0].length).fill('');
  Object.keys(value).forEach(function(key){medicationAssert_(table.table.map[key]!==undefined,'CONFIGURATION_ERROR');row[table.table.map[key]]=value[key];});
  table.sheet.appendRow(row);
}
function medicationReceipt_(row,kind,replayed) {return {persisted:true,planId:String(row.planId),eventId:kind==='events'?String(row.eventId):'',revision:Number(kind==='events'?row.planRevision:row.revision),recordedAt:medicationStoredInstant_(row.recordedAt),replayed:Boolean(replayed)};}
function medicationWrite_(body) {
  const configure=body.operation==='health.medication.plan.put';
  medicationAuthorizeService_(body,configure);
  medicationAssert_(medicationUuid_(body.clientRequestId));
  const lock=LockService.getScriptLock();lock.waitLock(30000);
  try {
    const tables=medicationTables_(),payload=body.payload||{},hash=healthRequestHash_(body,{payload:payload,localDate:body.localDate||'',slot:body.slot||''});
    // Recovery is before CAS/current-plan checks: a lost response must not write twice.
    const previous=[];
    ['plans','events'].forEach(function(kind){tables[kind].rows.forEach(function(row){if(row.clientRequestId===body.clientRequestId)previous.push({kind:kind,row:row});});});
    medicationAssert_(previous.length<=1,'DATA_INTEGRITY_ERROR');
    if(previous.length){medicationAssert_(previous[0].row.requestHash===hash,'IDEMPOTENCY_CONFLICT');return medicationReceipt_(previous[0].row,previous[0].kind,true);}
    const rows=medicationRows_(tables,body),now=medicationNow_();
    medicationAssert_(medicationUuid_(payload.planId));
    const versions=rows.plans.filter(function(row){return row.planId===payload.planId;}),latest=versions.reduce(function(best,row){return !best||row.revision>best.revision?row:best;},null);
    if(configure){
      medicationObject_(payload,['planId','expectedRevision','plan']);
      medicationAssert_(Number.isInteger(payload.expectedRevision)&&payload.expectedRevision>=0);
      medicationAssert_(payload.expectedRevision===(latest?latest.revision:0),'REVISION_CONFLICT');
      const plan=medicationPlan_(payload.plan,latest&&latest.plan);
      const row={homeId:body.homeId,targetUserId:body.targetUserId,planId:payload.planId,revision:payload.expectedRevision+1,planJson:JSON.stringify(plan),clientRequestId:body.clientRequestId,requestHash:hash,recordedBy:body.actorUserId,recordedAt:now};
      medicationAppend_(tables.plans,row);return medicationReceipt_(row,'plans',false);
    }
    medicationObject_(payload,['planId','planRevision','expectedEventId','status','occurredAt','correctionReason']);
    medicationDate_(body.localDate);medicationAssert_(body.localDate<=medicationLocalDate_(now));
    medicationAssert_(MEDICATION_SLOTS_.indexOf(body.slot)>=0&&Number.isInteger(payload.planRevision));
    medicationAssert_(typeof payload.expectedEventId==='string'&&(payload.expectedEventId===''||medicationUuid_(payload.expectedEventId)));
    medicationAssert_(['completed','held','unrecorded'].indexOf(payload.status)>=0);
    const occurrences=medicationOccurrences_(rows.plans,rows.events,body.localDate,now),occurrence=occurrences.find(function(item){return item.planId===payload.planId&&item.slot===body.slot;});
    medicationAssert_(occurrence&&occurrence.eventId===payload.expectedEventId&&occurrence.planRevision===payload.planRevision,'REVISION_CONFLICT');
    if(occurrence.eventId)medicationText_(payload.correctionReason,200,true);
    // The occurrence already selects the plan valid at that day's end/server now.
    // A later plan must not make an earlier day's first record impossible.
    const occurredAt=payload.status==='completed'?medicationInstant_(payload.occurredAt).toISOString():'';
    if(occurredAt)medicationAssert_(medicationInstant_(occurredAt).getTime()<=medicationInstant_(now).getTime());
    else medicationAssert_(payload.occurredAt===undefined||payload.occurredAt==='');
    // JSON keeps arbitrary caregiver text literal in Sheets (never a formula).
    const row={eventId:Utilities.getUuid(),homeId:body.homeId,targetUserId:body.targetUserId,planId:payload.planId,planRevision:payload.planRevision,localDate:body.localDate,slot:body.slot,status:payload.status,occurredAt:occurredAt,expectedEventId:payload.expectedEventId,correctionReasonJson:JSON.stringify(medicationText_(payload.correctionReason||'',200,false)),clientRequestId:body.clientRequestId,requestHash:hash,recordedBy:body.actorUserId,recordedAt:now};
    medicationAppend_(tables.events,row);return medicationReceipt_(row,'events',false);
  } finally {lock.releaseLock();}
}
function medicationDispatch_(body) {return body.operation==='health.medication.get'?medicationGet_(body):medicationWrite_(body);}
