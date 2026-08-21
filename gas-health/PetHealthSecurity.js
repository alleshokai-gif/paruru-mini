const PET_HEALTH_TIMEZONE_ = 'Asia/Tokyo';
const PET_HEALTH_SCHEMA_VERSION_ = 'pet-health-1.0';
const PET_HEALTH_RECORD_HASH_VERSION_ = 'pet-health-record-1';
const PET_HEALTH_CORRECTION_HASH_VERSION_ = 'pet-health-correction-1';
const PET_HEALTH_SERVER_DEFAULT_OCCURRED_AT_ = '__SERVER_DEFAULT__';
const PET_HEALTH_OPERATIONS_ = Object.freeze({'pet.health.record':true,'pet.health.correct':true,'pet.health.void':true,'pet.health.getDailySummary':true,'pet.health.listRecentEvents':true,'pet.health.getDashboard':true});
const PET_HEALTH_ENUMS_ = Object.freeze({
  eventType:['meal','water','water_bottle','stool','urine','weight','observation'],
  mealSlot:['breakfast','lunch','dinner','snack'],
  completion:['finished','partial','refused'],
  stoolForm:['pellet','formed','banana','soft','watery'],
  stoolAmount:['small','normal','large'],
  urineStatus:['normal','concern'],
  energy:['good','normal','low'],
  appetite:['good','normal','low'],
  flags:['vomiting','sneeze_cough','pain_behavior'],
  source:['manual','agent']
});
const PET_HEALTH_EVENT_FIELDS_ = Object.freeze({
  meal:['mealSlot','amountG','completion'],
  water:['amountMl'],
  water_bottle:['remainingMl','newFillMl'],
  stool:['stoolForm','stoolAmount','coprophagy'],
  urine:['urineStatus'],
  weight:['weightKg'],
  observation:['energy','appetite','flags']
});
const PET_HEALTH_SERVER_EVENT_FIELDS_ = Object.freeze({eventId:true,homeId:true,petId:true,occurredAtSource:true,localDate:true,flagsJson:true,source:true,recordedBy:true,recordedAt:true,clientRequestId:true,requestHash:true,actorUserId:true,operation:true,correctionType:true,correctionOfEventId:true});

function petHealthHas_(object,key){return Object.prototype.hasOwnProperty.call(object||{},key);}
function petHealthRejectNull_(value){if(value===null)throw healthErr_('INVALID_INPUT');if(Array.isArray(value))value.forEach(petHealthRejectNull_);else if(value&&typeof value==='object')Object.keys(value).forEach(function(key){petHealthRejectNull_(value[key]);});}
function petHealthNonEmptyString_(value){if(typeof value!=='string'||!value.trim())throw healthErr_('INVALID_INPUT');return value.trim();}
function petHealthOneOf_(value,values){if(typeof value!=='string'||values.indexOf(value)<0)throw healthErr_('INVALID_INPUT');return value;}
function petHealthNumber_(value,min,max,decimals,integerOnly){
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw healthErr_('INVALID_INPUT');
  if(integerOnly&&!Number.isInteger(value))throw healthErr_('INVALID_INPUT');
  const scale=Math.pow(10,decimals),rounded=Math.round(value*scale)/scale;
  if(rounded!==value)throw healthErr_('INVALID_INPUT');
  return Object.is(rounded,-0)?0:rounded;
}
function petHealthNote_(value){
  if(typeof value!=='string')throw healthErr_('INVALID_INPUT');
  const normalized=value.replace(/\r\n?/g,'\n').normalize('NFC').trim();
  if(Array.from(normalized).length>500)throw healthErr_('INVALID_INPUT');
  return normalized;
}
function petHealthValidDate_(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw healthErr_('INVALID_INPUT');
  const parts=value.split('-').map(Number),date=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));
  if(date.getUTCFullYear()!==parts[0]||date.getUTCMonth()!==parts[1]-1||date.getUTCDate()!==parts[2])throw healthErr_('INVALID_INPUT');
  return value;
}
function petHealthParseInstant_(value){
  if(typeof value!=='string')throw healthErr_('INVALID_INPUT');
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if(!match)throw healthErr_('INVALID_INPUT');
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),hour=Number(match[4]),minute=Number(match[5]),second=Number(match[6]);
  const milliseconds=Number(('0.'+(match[7]||'0')))*1000;
  let offsetMinutes=0;
  if(match[8]!=='Z'){
    const offsetHour=Number(match[10]),offsetMinute=Number(match[11]);
    if(offsetHour>14||offsetMinute>59||(offsetHour===14&&offsetMinute!==0))throw healthErr_('INVALID_INPUT');
    offsetMinutes=(match[9]==='-'?-1:1)*(offsetHour*60+offsetMinute);
  }
  if(month<1||month>12||day<1||day>31||hour>23||minute>59||second>59)throw healthErr_('INVALID_INPUT');
  const localEpoch=Date.UTC(year,month-1,day,hour,minute,second,Math.floor(milliseconds));
  const check=new Date(localEpoch);
  if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day||check.getUTCHours()!==hour||check.getUTCMinutes()!==minute||check.getUTCSeconds()!==second)throw healthErr_('INVALID_INPUT');
  const instant=new Date(localEpoch-offsetMinutes*60000);
  if(!Number.isFinite(instant.getTime()))throw healthErr_('INVALID_INPUT');
  return instant;
}
function petHealthFormat_(date,format,deps){return (deps&&deps.formatDate?deps.formatDate(date,PET_HEALTH_TIMEZONE_,format):Utilities.formatDate(date,PET_HEALTH_TIMEZONE_,format));}
function petHealthInstant_(date,deps){return petHealthFormat_(date,"yyyy-MM-dd'T'HH:mm:ssXXX",deps);}
function petHealthLocalDate_(date,deps){return petHealthFormat_(date,'yyyy-MM-dd',deps);}
function petHealthNormalizeOccurredAt_(value,now,deps){
  const instant=petHealthParseInstant_(value);
  if(instant.getTime()>now.getTime()+5*60*1000)throw healthErr_('INVALID_INPUT');
  return {value:petHealthInstant_(instant,deps),instant:instant};
}
function petHealthNormalizeFlags_(value){
  if(!Array.isArray(value)||value.length>3)throw healthErr_('INVALID_INPUT');
  const seen={};
  value.forEach(function(flag){petHealthOneOf_(flag,PET_HEALTH_ENUMS_.flags);if(seen[flag])throw healthErr_('INVALID_INPUT');seen[flag]=true;});
  return PET_HEALTH_ENUMS_.flags.filter(function(flag){return !!seen[flag];});
}
function petHealthNormalizeEvent_(event,now,deps){
  if(!event||Object.prototype.toString.call(event)!=='[object Object]')throw healthErr_('INVALID_INPUT');
  Object.keys(event).forEach(function(key){if(event[key]===null||PET_HEALTH_SERVER_EVENT_FIELDS_[key])throw healthErr_('INVALID_INPUT');});
  const eventType=petHealthOneOf_(event.eventType,PET_HEALTH_ENUMS_.eventType),allowed={eventType:true,occurredAt:true,note:true};
  PET_HEALTH_EVENT_FIELDS_[eventType].forEach(function(key){allowed[key]=true;});
  Object.keys(event).forEach(function(key){if(!allowed[key])throw healthErr_('INVALID_INPUT');});
  const normalized={eventType:eventType},data={};
  if(petHealthHas_(event,'occurredAt')){const occurred=petHealthNormalizeOccurredAt_(event.occurredAt,now,deps);normalized.occurredAt=occurred.value;normalized.occurredAtInput=occurred.value;normalized.occurredAtInstant=occurred.instant;}else normalized.occurredAtInput=PET_HEALTH_SERVER_DEFAULT_OCCURRED_AT_;
  if(petHealthHas_(event,'note'))data.note=petHealthNote_(event.note);
  if(eventType==='meal'){
    data.mealSlot=petHealthOneOf_(event.mealSlot,PET_HEALTH_ENUMS_.mealSlot);
    data.completion=petHealthOneOf_(event.completion,PET_HEALTH_ENUMS_.completion);
    if(petHealthHas_(event,'amountG'))data.amountG=petHealthNumber_(event.amountG,0,5000,1,false);
    if(data.completion==='refused'&&petHealthHas_(data,'amountG')&&data.amountG!==0)throw healthErr_('INVALID_INPUT');
    if(data.completion!=='refused'&&petHealthHas_(data,'amountG')&&data.amountG<=0)throw healthErr_('INVALID_INPUT');
  }else if(eventType==='water')data.amountMl=petHealthNumber_(event.amountMl,1,10000,0,true);
  else if(eventType==='water_bottle'){
    data.newFillMl=petHealthNumber_(event.newFillMl,1,5000,0,true);
    if(petHealthHas_(event,'remainingMl'))data.remainingMl=petHealthNumber_(event.remainingMl,0,5000,0,true);
  }
  else if(eventType==='stool'){
    if(petHealthHas_(event,'stoolForm'))data.stoolForm=petHealthOneOf_(event.stoolForm,PET_HEALTH_ENUMS_.stoolForm);
    if(petHealthHas_(event,'stoolAmount'))data.stoolAmount=petHealthOneOf_(event.stoolAmount,PET_HEALTH_ENUMS_.stoolAmount);
    if(petHealthHas_(event,'coprophagy')){if(typeof event.coprophagy!=='boolean')throw healthErr_('INVALID_INPUT');data.coprophagy=event.coprophagy;}
  }else if(eventType==='urine'){
    if(petHealthHas_(event,'urineStatus'))data.urineStatus=petHealthOneOf_(event.urineStatus,PET_HEALTH_ENUMS_.urineStatus);
  }else if(eventType==='weight')data.weightKg=petHealthNumber_(event.weightKg,0.1,200,3,false);
  else {
    if(petHealthHas_(event,'energy'))data.energy=petHealthOneOf_(event.energy,PET_HEALTH_ENUMS_.energy);
    if(petHealthHas_(event,'appetite'))data.appetite=petHealthOneOf_(event.appetite,PET_HEALTH_ENUMS_.appetite);
    if(petHealthHas_(event,'flags'))data.flags=petHealthNormalizeFlags_(event.flags);
    if(!petHealthHas_(data,'energy')&&!petHealthHas_(data,'appetite')&&(!petHealthHas_(data,'flags')||!data.flags.length)&&!String(data.note||''))throw healthErr_('INVALID_INPUT');
  }
  normalized.eventData=data;
  return normalized;
}
function petHealthNormalizeRecordRequest_(body,now,deps){
  petHealthRejectNull_(body);
  if(!body||body.operation!=='pet.health.record'||!healthUuid_(body.clientRequestId))throw healthErr_('INVALID_INPUT');
  const normalized={operation:body.operation,homeId:petHealthNonEmptyString_(body.homeId),actorUserId:petHealthNonEmptyString_(body.actorUserId),petId:petHealthOneOf_(body.petId,['popio']),source:petHealthOneOf_(body.source,PET_HEALTH_ENUMS_.source),clientRequestId:body.clientRequestId,correctionType:'original',correctionOfEventId:''};
  normalized.event=petHealthNormalizeEvent_(body.event,now,deps);
  return normalized;
}
function petHealthNormalizeCorrectionTarget_(value){if(typeof value!=='string'||!healthUuid_(value))throw healthErr_('INVALID_INPUT');return value;}
function petHealthNormalizeCorrectionRequest_(body,now,deps){
  petHealthRejectNull_(body);
  if(!body||body.operation!=='pet.health.correct'||!healthUuid_(body.clientRequestId))throw healthErr_('INVALID_INPUT');
  const normalized={operation:body.operation,homeId:petHealthNonEmptyString_(body.homeId),actorUserId:petHealthNonEmptyString_(body.actorUserId),petId:petHealthOneOf_(body.petId,['popio']),source:petHealthOneOf_(body.source,PET_HEALTH_ENUMS_.source),clientRequestId:body.clientRequestId,correctionType:'correction',correctionOfEventId:petHealthNormalizeCorrectionTarget_(body.correctionOfEventId)};
  normalized.event=petHealthNormalizeEvent_(body.event,now,deps);
  return normalized;
}
function petHealthNormalizeVoidRequest_(body){
  petHealthRejectNull_(body);
  if(!body||body.operation!=='pet.health.void'||!healthUuid_(body.clientRequestId)||petHealthHas_(body,'event'))throw healthErr_('INVALID_INPUT');
  return {operation:body.operation,homeId:petHealthNonEmptyString_(body.homeId),actorUserId:petHealthNonEmptyString_(body.actorUserId),petId:petHealthOneOf_(body.petId,['popio']),source:petHealthOneOf_(body.source,PET_HEALTH_ENUMS_.source),clientRequestId:body.clientRequestId,correctionType:'void',correctionOfEventId:petHealthNormalizeCorrectionTarget_(body.correctionOfEventId),event:null};
}
function petHealthNormalizeSummaryRequest_(body,now,deps){
  petHealthRejectNull_(body);
  if(!body||body.operation!=='pet.health.getDailySummary')throw healthErr_('INVALID_INPUT');
  const normalized={operation:body.operation,homeId:petHealthNonEmptyString_(body.homeId),actorUserId:petHealthNonEmptyString_(body.actorUserId),petId:petHealthOneOf_(body.petId,['popio'])};
  if(petHealthHas_(body,'localDate')){if(body.localDate===null||body.localDate==='')throw healthErr_('INVALID_INPUT');normalized.localDate=petHealthValidDate_(body.localDate);}else normalized.localDate=petHealthLocalDate_(now,deps);
  return normalized;
}
function petHealthNormalizeRecentRequest_(body){
  petHealthRejectNull_(body);
  if(!body||body.operation!=='pet.health.listRecentEvents'||body.days!==7)throw healthErr_('INVALID_INPUT');
  return {operation:body.operation,homeId:petHealthNonEmptyString_(body.homeId),actorUserId:petHealthNonEmptyString_(body.actorUserId),petId:petHealthOneOf_(body.petId,['popio']),days:7};
}
function petHealthNormalizeDashboardRequest_(body,now,deps){
  petHealthRejectNull_(body);
  if(!body||body.operation!=='pet.health.getDashboard')throw healthErr_('INVALID_INPUT');
  const normalized={operation:body.operation,homeId:petHealthNonEmptyString_(body.homeId),actorUserId:petHealthNonEmptyString_(body.actorUserId),petId:petHealthOneOf_(body.petId,['popio'])};
  if(petHealthHas_(body,'localDate')){if(body.localDate===null||body.localDate==='')throw healthErr_('INVALID_INPUT');normalized.localDate=petHealthValidDate_(body.localDate);}else normalized.localDate=petHealthLocalDate_(now,deps);
  return normalized;
}
function petHealthCanonical_(value){
  if(Array.isArray(value))return value.map(petHealthCanonical_);
  if(value&&typeof value==='object')return Object.keys(value).sort().reduce(function(out,key){out[key]=petHealthCanonical_(value[key]);return out;},{});
  if(typeof value==='number'&&Object.is(value,-0))return 0;
  return value;
}
function petHealthRecordHash_(request){
  const canonical=petHealthCanonical_({schemaVersion:PET_HEALTH_RECORD_HASH_VERSION_,operation:request.operation,homeId:request.homeId,actorUserId:request.actorUserId,petId:request.petId,source:request.source,occurredAtInput:request.event.occurredAtInput,eventType:request.event.eventType,eventData:request.event.eventData});
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(canonical),Utilities.Charset.UTF_8));
}
function petHealthCorrectionHash_(request){
  const canonical={schemaVersion:PET_HEALTH_CORRECTION_HASH_VERSION_,operation:request.operation,homeId:request.homeId,actorUserId:request.actorUserId,petId:request.petId,source:request.source,correctionOfEventId:request.correctionOfEventId};
  if(request.operation==='pet.health.correct'){
    canonical.occurredAtInput=request.event.occurredAtInput;
    canonical.eventType=request.event.eventType;
    canonical.eventData=request.event.eventData;
  }
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(petHealthCanonical_(canonical)),Utilities.Charset.UTF_8));
}
function petHealthResponse_(operation,data){return {success:true,status:'SUCCESS',operation:operation,data:data,warnings:[],error:null,schemaVersion:PET_HEALTH_SCHEMA_VERSION_};}
function petHealthErrorResponse_(operation,error){
  const allowed=['UNAUTHORIZED','INVALID_INPUT','IDEMPOTENCY_CONFLICT','DATA_INTEGRITY_ERROR','CONFIGURATION_ERROR','INTERNAL_ERROR'],code=error&&allowed.indexOf(error.code)>=0?error.code:'INTERNAL_ERROR';
  return {success:false,status:'ERROR',operation:operation||null,data:null,warnings:[],error:{code:code},schemaVersion:PET_HEALTH_SCHEMA_VERSION_};
}
