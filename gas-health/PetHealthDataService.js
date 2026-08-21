function petHealthCellPresent_(value){return value!==''&&value!==undefined&&value!==null;}
function petHealthPut_(row,map,key,value){if(map[key]===undefined)throw healthErr_('CONFIGURATION_ERROR');row[map[key]]=value;}
function petHealthCorrectionType_(value){const type=String(value||'').trim();return type||'original';}
function petHealthDraftStoredEvent_(request,eventId,occurredAt,occurredAtSource,recordedAt,requestHash){
  const instant=petHealthParseInstant_(occurredAt),recordedInstant=petHealthParseInstant_(recordedAt),event=request.event||{};
  return {eventId:String(eventId||''),homeId:request.homeId,petId:request.petId,eventType:event.eventType,occurredAt:occurredAt,occurredAtSource:occurredAtSource,localDate:petHealthLocalDate_(instant),eventData:event.eventData||{},source:request.source,recordedBy:request.actorUserId,recordedAt:recordedAt,clientRequestId:request.clientRequestId,requestHash:requestHash,correctionType:request.correctionType||'original',correctionOfEventId:request.correctionOfEventId||'',instantMs:instant.getTime(),recordedInstantMs:recordedInstant.getTime()};
}
function petHealthEventRow_(request,eventId,occurredAt,occurredAtSource,recordedAt,requestHash){
  const sheet=healthSheet_(PET_HEALTH_SHEETS.events),table=healthMap_(sheet),row=new Array(table.values[0].length).fill(''),data=request.event.eventData;
  [['eventId',eventId],['homeId',request.homeId],['petId',request.petId],['eventType',request.event.eventType],['occurredAt',occurredAt],['occurredAtSource',occurredAtSource],['localDate',petHealthLocalDate_(petHealthParseInstant_(occurredAt))],['source',request.source],['recordedBy',request.actorUserId],['recordedAt',recordedAt],['clientRequestId',request.clientRequestId],['requestHash',requestHash],['correctionType',request.correctionType||'original'],['correctionOfEventId',request.correctionOfEventId||'']].forEach(function(pair){petHealthPut_(row,table.map,pair[0],pair[1]);});
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
    const get=function(key){return row[table.map[key]];};
    const correctionType=petHealthCorrectionType_(get('correctionType'));
    const correctionOfEventId=String(get('correctionOfEventId')||'').trim();
    if(['original','correction','void'].indexOf(correctionType)<0||(correctionType==='original'&&correctionOfEventId)||(correctionType!=='original'&&!healthUuid_(correctionOfEventId)))throw healthErr_('DATA_INTEGRITY_ERROR');
    const rawEvent={eventType:String(get('eventType')||''),occurredAt:String(get('occurredAt')||'')};
    ['mealSlot','amountG','completion','amountMl','remainingMl','newFillMl','stoolForm','stoolAmount','coprophagy','urineStatus','weightKg','energy','appetite','note'].forEach(function(key){if(petHealthCellPresent_(get(key)))rawEvent[key]=get(key);});
    if(petHealthCellPresent_(get('flagsJson'))){const flags=JSON.parse(String(get('flagsJson')));if(!Array.isArray(flags)||JSON.stringify(flags)!==String(get('flagsJson')))throw healthErr_('DATA_INTEGRITY_ERROR');rawEvent.flags=flags;}
    const instant=petHealthParseInstant_(rawEvent.occurredAt),recordedInstant=petHealthParseInstant_(String(get('recordedAt')||''));
    let event;
    if(correctionType==='void'){
      if(Object.keys(rawEvent).some(function(key){return key!=='eventType'&&key!=='occurredAt';}))throw healthErr_('DATA_INTEGRITY_ERROR');
      event={eventType:petHealthOneOf_(rawEvent.eventType,PET_HEALTH_ENUMS_.eventType),eventData:{}};
    }else event=petHealthNormalizeEvent_(rawEvent,new Date(8640000000000000),null);
    const stored={eventId:String(get('eventId')||''),homeId:String(get('homeId')||''),petId:String(get('petId')||''),eventType:event.eventType,occurredAt:correctionType==='void'?petHealthInstant_(instant):event.occurredAt,occurredAtSource:String(get('occurredAtSource')||''),localDate:healthDate_(get('localDate')),eventData:event.eventData,source:String(get('source')||''),recordedBy:String(get('recordedBy')||''),recordedAt:petHealthInstant_(recordedInstant),clientRequestId:String(get('clientRequestId')||''),requestHash:String(get('requestHash')||''),correctionType:correctionType,correctionOfEventId:correctionOfEventId,instantMs:instant.getTime()};
    const rawDataKeys=Object.keys(rawEvent).filter(function(key){return key!=='eventType'&&key!=='occurredAt';}),normalizedDataKeys=Object.keys(stored.eventData);
    const dataChanged=rawDataKeys.length!==normalizedDataKeys.length||rawDataKeys.some(function(key){return !petHealthHas_(stored.eventData,key)||JSON.stringify(rawEvent[key])!==JSON.stringify(stored.eventData[key]);});
    if(!healthUuid_(stored.eventId)||!stored.homeId.trim()||stored.homeId!==stored.homeId.trim()||stored.petId!=='popio'||String(get('occurredAt')||'')!==stored.occurredAt||String(get('recordedAt')||'')!==stored.recordedAt||dataChanged||['explicit','server_default'].indexOf(stored.occurredAtSource)<0||!stored.localDate||stored.localDate!==petHealthLocalDate_(instant)||PET_HEALTH_ENUMS_.source.indexOf(stored.source)<0||!stored.recordedBy.trim()||stored.recordedBy!==stored.recordedBy.trim()||instant.getTime()>recordedInstant.getTime()+5*60*1000||!healthUuid_(stored.clientRequestId)||!stored.requestHash)throw healthErr_('DATA_INTEGRITY_ERROR');
    return stored;
  } catch(error){if(error&&error.code==='DATA_INTEGRITY_ERROR')throw error;throw healthErr_('DATA_INTEGRITY_ERROR');}
}
function petHealthPublicEvent_(stored){
  const event={eventId:stored.eventId,petId:stored.petId,eventType:stored.eventType,occurredAt:stored.occurredAt,occurredAtSource:stored.occurredAtSource,localDate:stored.localDate};
  Object.keys(stored.eventData).forEach(function(key){event[key]=stored.eventData[key];});
  if(stored.correctionType!=='original'){event.correctionType=stored.correctionType;event.correctionOfEventId=stored.correctionOfEventId;}
  event.source=stored.source;event.recordedBy=stored.recordedBy;event.recordedAt=stored.recordedAt;
  return event;
}
function petHealthWriteResponse_(operation,stored,replayed){return petHealthResponse_(operation,{event:petHealthPublicEvent_(stored),idempotency:{replayed:!!replayed}});}
function petHealthRecordResponse_(stored,replayed){return petHealthWriteResponse_('pet.health.record',stored,replayed);}
function petHealthEventsByRequestId_(clientRequestId){
  const table=healthMap_(healthSheet_(PET_HEALTH_SHEETS.events)),found=[];
  table.values.slice(1).forEach(function(row){if(String(row[table.map.clientRequestId]||'')===String(clientRequestId||''))found.push(petHealthStoredEvent_(table,row));});
  return found;
}
function petHealthVerifyPersistedEvent_(request,expected){
  const events=petHealthEventsByRequestId_(request.clientRequestId);
  if(events.length!==1)throw healthErr_('DATA_INTEGRITY_ERROR');
  const stored=events[0];
  if(stored.eventId!==expected.eventId||stored.clientRequestId!==request.clientRequestId||stored.clientRequestId!==expected.clientRequestId||stored.requestHash!==expected.requestHash||stored.homeId!==request.homeId||stored.homeId!==expected.homeId||stored.petId!==request.petId||stored.petId!==expected.petId||stored.correctionType!==request.correctionType||stored.correctionOfEventId!==request.correctionOfEventId)throw healthErr_('DATA_INTEGRITY_ERROR');
  return stored;
}
function petHealthScopedEvents_(homeId,petId){
  const table=healthMap_(healthSheet_(PET_HEALTH_SHEETS.events)),found=[];
  table.values.slice(1).forEach(function(row){if(String(row[table.map.homeId]||'')===homeId&&String(row[table.map.petId]||'')===petId)found.push(petHealthStoredEvent_(table,row));});
  return found;
}
function petHealthResolveEffectiveEvents_(events){
  const byId=Object.create(null),children=Object.create(null),reached=Object.create(null),effective=[];
  (Array.isArray(events)?events:[]).forEach(function(event){if(!event||!healthUuid_(event.eventId)||byId[event.eventId])throw healthErr_('DATA_INTEGRITY_ERROR');byId[event.eventId]=event;});
  Object.keys(byId).forEach(function(eventId){
    const event=byId[eventId];
    if(event.correctionType==='original'){if(event.correctionOfEventId)throw healthErr_('DATA_INTEGRITY_ERROR');return;}
    const target=byId[event.correctionOfEventId];
    if(!target||target.eventType!==event.eventType||target.correctionType==='void'||children[target.eventId])throw healthErr_('DATA_INTEGRITY_ERROR');
    children[target.eventId]=event.eventId;
  });
  Object.keys(byId).forEach(function(eventId){
    if(byId[eventId].correctionType!=='original')return;
    const visited=Object.create(null);let current=byId[eventId];
    while(current){
      if(visited[current.eventId])throw healthErr_('DATA_INTEGRITY_ERROR');
      visited[current.eventId]=true;reached[current.eventId]=true;
      const childId=children[current.eventId];
      if(!childId){if(current.correctionType!=='void')effective.push(current);break;}
      current=byId[childId];
    }
  });
  if(Object.keys(reached).length!==Object.keys(byId).length)throw healthErr_('DATA_INTEGRITY_ERROR');
  return effective.sort(function(a,b){return a.instantMs-b.instantMs||a.eventId.localeCompare(b.eventId);});
}
function petHealthCorrectionTarget_(rawEvents,request){
  const target=(rawEvents||[]).find(function(event){return event.eventId===request.correctionOfEventId;});
  if(!target||target.correctionType==='void'||!petHealthResolveEffectiveEvents_(rawEvents).some(function(event){return event.eventId===target.eventId;}))throw healthErr_('INVALID_INPUT');
  if(request.correctionType==='correction'&&request.event.eventType!==target.eventType)throw healthErr_('INVALID_INPUT');
  return target;
}
function petHealthValidateWaterBottleChain_(events){
  const bottles=(events||[]).filter(function(event){return event.eventType==='water_bottle';}).sort(function(a,b){return a.instantMs-b.instantMs||a.eventId.localeCompare(b.eventId);});
  bottles.forEach(function(current,index){
    const previous=index?bottles[index-1]:null;
    if(!previous){if(petHealthHas_(current.eventData,'remainingMl'))throw healthErr_('INVALID_INPUT');return;}
    if(current.instantMs<=previous.instantMs||!petHealthHas_(current.eventData,'remainingMl')||current.eventData.remainingMl>previous.eventData.newFillMl)throw healthErr_('INVALID_INPUT');
  });
}
function petHealthValidateWriteCandidate_(request,draft,rawEvents){
  const raw=rawEvents||petHealthScopedEvents_(request.homeId,request.petId);
  if(request.correctionType!=='original')petHealthCorrectionTarget_(raw,request);
  const effective=petHealthResolveEffectiveEvents_(raw.concat([draft]));
  if(request.correctionType==='original'&&draft.eventType==='water_bottle'){
    const current=effective.filter(function(event){return event.eventType==='water_bottle'&&event.eventId!==draft.eventId;});
    if(current.length&&draft.instantMs<=current[current.length-1].instantMs)throw healthErr_('INVALID_INPUT');
  }
  petHealthValidateWaterBottleChain_(effective);
}
function petHealthWaterBottleEvents_(homeId,petId){return petHealthResolveEffectiveEvents_(petHealthScopedEvents_(homeId,petId)).filter(function(event){return event.eventType==='water_bottle';});}
function petHealthValidateWaterBottleAppend_(request,occurredAt){
  const draft=petHealthDraftStoredEvent_(request,request.clientRequestId,occurredAt,request.event.occurredAt?'explicit':'server_default',occurredAt,'draft');
  petHealthValidateWriteCandidate_(request,draft);
}
