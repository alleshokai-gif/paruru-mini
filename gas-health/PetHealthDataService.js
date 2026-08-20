function petHealthCellPresent_(value){return value!==''&&value!==undefined&&value!==null;}
function petHealthPut_(row,map,key,value){if(map[key]===undefined)throw healthErr_('CONFIGURATION_ERROR');row[map[key]]=value;}
function petHealthEventRow_(request,eventId,occurredAt,occurredAtSource,recordedAt,requestHash){
  const sheet=healthSheet_(PET_HEALTH_SHEETS.events),table=healthMap_(sheet),row=new Array(table.values[0].length).fill(''),data=request.event.eventData;
  [['eventId',eventId],['homeId',request.homeId],['petId',request.petId],['eventType',request.event.eventType],['occurredAt',occurredAt],['occurredAtSource',occurredAtSource],['localDate',petHealthLocalDate_(petHealthParseInstant_(occurredAt))],['source',request.source],['recordedBy',request.actorUserId],['recordedAt',recordedAt],['clientRequestId',request.clientRequestId],['requestHash',requestHash]].forEach(function(pair){petHealthPut_(row,table.map,pair[0],pair[1]);});
  Object.keys(data).forEach(function(key){if(key==='flags')petHealthPut_(row,table.map,'flagsJson',JSON.stringify(data.flags));else petHealthPut_(row,table.map,key,data[key]);});
  return {sheet:sheet,table:table,row:row};
}
function petHealthAppendEvent_(request,eventId,occurredAt,occurredAtSource,recordedAt,requestHash){
  const built=petHealthEventRow_(request,eventId,occurredAt,occurredAtSource,recordedAt,requestHash);
  built.sheet.appendRow(built.row);
  return petHealthStoredEvent_(built.table,built.row);
}
function petHealthStoredEvent_(table,row){
  try {
    const get=function(key){return row[table.map[key]];},event={eventType:String(get('eventType')||''),occurredAt:String(get('occurredAt')||'')};
    ['mealSlot','amountG','completion','amountMl','stoolForm','stoolAmount','coprophagy','urineStatus','weightKg','energy','appetite','note'].forEach(function(key){if(petHealthCellPresent_(get(key)))event[key]=get(key);});
    if(petHealthCellPresent_(get('flagsJson'))){const flags=JSON.parse(String(get('flagsJson')));if(!Array.isArray(flags)||JSON.stringify(flags)!==String(get('flagsJson')))throw healthErr_('DATA_INTEGRITY_ERROR');event.flags=flags;}
    const normalized=petHealthNormalizeEvent_(event,new Date(8640000000000000),null),instant=petHealthParseInstant_(String(get('occurredAt')||'')),recordedInstant=petHealthParseInstant_(String(get('recordedAt')||'')),rawDataKeys=Object.keys(event).filter(function(key){return key!=='eventType'&&key!=='occurredAt';}),normalizedDataKeys=Object.keys(normalized.eventData);
    const stored={eventId:String(get('eventId')||''),homeId:String(get('homeId')||''),petId:String(get('petId')||''),eventType:normalized.eventType,occurredAt:normalized.occurredAt,occurredAtSource:String(get('occurredAtSource')||''),localDate:String(get('localDate')||''),eventData:normalized.eventData,source:String(get('source')||''),recordedBy:String(get('recordedBy')||''),recordedAt:petHealthInstant_(recordedInstant),clientRequestId:String(get('clientRequestId')||''),requestHash:String(get('requestHash')||''),instantMs:instant.getTime()};
    const dataChanged=rawDataKeys.length!==normalizedDataKeys.length||rawDataKeys.some(function(key){return !petHealthHas_(normalized.eventData,key)||JSON.stringify(event[key])!==JSON.stringify(normalized.eventData[key]);});
    if(!healthUuid_(stored.eventId)||!stored.homeId.trim()||stored.homeId!==stored.homeId.trim()||stored.petId!=='popio'||String(get('occurredAt')||'')!==stored.occurredAt||String(get('recordedAt')||'')!==stored.recordedAt||dataChanged||['explicit','server_default'].indexOf(stored.occurredAtSource)<0||stored.localDate!==petHealthLocalDate_(instant)||PET_HEALTH_ENUMS_.source.indexOf(stored.source)<0||!stored.recordedBy.trim()||stored.recordedBy!==stored.recordedBy.trim()||instant.getTime()>recordedInstant.getTime()+5*60*1000||!healthUuid_(stored.clientRequestId)||!stored.requestHash)throw healthErr_('DATA_INTEGRITY_ERROR');
    return stored;
  } catch(error){if(error&&error.code==='DATA_INTEGRITY_ERROR')throw error;throw healthErr_('DATA_INTEGRITY_ERROR');}
}
function petHealthPublicEvent_(stored){
  const event={eventId:stored.eventId,petId:stored.petId,eventType:stored.eventType,occurredAt:stored.occurredAt,occurredAtSource:stored.occurredAtSource,localDate:stored.localDate};
  Object.keys(stored.eventData).forEach(function(key){event[key]=stored.eventData[key];});
  event.source=stored.source;event.recordedBy=stored.recordedBy;event.recordedAt=stored.recordedAt;
  return event;
}
function petHealthRecordResponse_(stored,replayed){return petHealthResponse_('pet.health.record',{event:petHealthPublicEvent_(stored),idempotency:{replayed:!!replayed}});}
function petHealthEventsByRequestId_(clientRequestId){
  const table=healthMap_(healthSheet_(PET_HEALTH_SHEETS.events)),found=[];
  table.values.slice(1).forEach(function(row){if(String(row[table.map.clientRequestId]||'')===String(clientRequestId||''))found.push(petHealthStoredEvent_(table,row));});
  return found;
}
function petHealthVerifyPersistedEvent_(request,expected){
  const events=petHealthEventsByRequestId_(request.clientRequestId);
  if(events.length!==1)throw healthErr_('DATA_INTEGRITY_ERROR');
  const stored=events[0];
  if(stored.eventId!==expected.eventId||stored.clientRequestId!==request.clientRequestId||stored.clientRequestId!==expected.clientRequestId||stored.requestHash!==expected.requestHash||stored.homeId!==request.homeId||stored.homeId!==expected.homeId||stored.petId!==request.petId||stored.petId!==expected.petId)throw healthErr_('DATA_INTEGRITY_ERROR');
  return stored;
}
function petHealthScopedEvents_(homeId,petId){
  const table=healthMap_(healthSheet_(PET_HEALTH_SHEETS.events)),found=[];
  table.values.slice(1).forEach(function(row){if(String(row[table.map.homeId]||'')===homeId&&String(row[table.map.petId]||'')===petId)found.push(petHealthStoredEvent_(table,row));});
  return found;
}
