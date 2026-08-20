function petHealthAmountSummary_(events,key){
  if(!events.length)return {total:null,known:0,status:'no_events'};
  const known=events.filter(function(event){return petHealthHas_(event.eventData,key);}),sum=known.reduce(function(total,event){return total+event.eventData[key];},0);
  if(!known.length)return {total:null,known:0,status:'unknown'};
  if(known.length<events.length)return {total:null,known:sum,status:'partial'};
  return {total:sum,known:sum,status:'complete'};
}
function petHealthMealBucket_(events){const amount=petHealthAmountSummary_(events,'amountG');return {eventCount:events.length,totalAmountG:amount.total,knownAmountG:amount.known,amountStatus:amount.status};}
function petHealthObservation_(event){
  const out={eventId:event.eventId,occurredAt:event.occurredAt};
  ['stoolForm','stoolAmount','coprophagy','weightKg','energy','appetite','flags','note'].forEach(function(key){if(petHealthHas_(event.eventData,key))out[key]=event.eventData[key];});
  return out;
}
function petHealthSummary_(body,options){
  const deps=options||{},now=deps.now?deps.now():new Date(),request=petHealthNormalizeSummaryRequest_(body,now,deps),all=petHealthScopedEvents_(request.homeId,request.petId);
  all.sort(function(a,b){return a.instantMs-b.instantMs||a.eventId.localeCompare(b.eventId);});
  const start=petHealthParseInstant_(request.localDate+'T00:00:00+09:00').getTime(),end=start+24*60*60*1000;
  const daily=all.filter(function(event){if(event.localDate===request.localDate&&(event.instantMs<start||event.instantMs>=end))throw healthErr_('DATA_INTEGRITY_ERROR');return event.localDate===request.localDate;});
  const meals=daily.filter(function(event){return event.eventType==='meal';}),water=daily.filter(function(event){return event.eventType==='water';}),stool=daily.filter(function(event){return event.eventType==='stool';}),urine=daily.filter(function(event){return event.eventType==='urine';}),observations=daily.filter(function(event){return event.eventType==='observation';});
  const mealAmount=petHealthAmountSummary_(meals,'amountG'),bySlot={},completionCounts={finished:0,partial:0,refused:0};
  PET_HEALTH_ENUMS_.mealSlot.forEach(function(slot){bySlot[slot]=petHealthMealBucket_(meals.filter(function(event){return event.eventData.mealSlot===slot;}));});
  meals.forEach(function(event){completionCounts[event.eventData.completion]++;});
  const waterAmount=petHealthAmountSummary_(water,'amountMl');
  const weights=all.filter(function(event){return event.eventType==='weight'&&event.instantMs<end;}),latest=weights.length?weights[weights.length-1]:null;
  const notable=observations.filter(function(event){const data=event.eventData;return data.energy==='low'||data.appetite==='low'||(data.flags&&data.flags.length)||String(data.note||'');}).map(petHealthObservation_);
  return petHealthResponse_('pet.health.getDailySummary',{petId:request.petId,localDate:request.localDate,timezone:PET_HEALTH_TIMEZONE_,meal:{eventCount:meals.length,totalAmountG:mealAmount.total,knownAmountG:mealAmount.known,amountStatus:mealAmount.status,bySlot:bySlot,completionCounts:completionCounts},water:{eventCount:water.length,totalAmountMl:waterAmount.total,amountStatus:waterAmount.status},stool:{count:stool.length,observations:stool.map(petHealthObservation_)},urine:{count:urine.length,concernCount:urine.filter(function(event){return event.eventData.urineStatus==='concern';}).length},latestWeight:latest?petHealthObservation_(latest):null,notableObservations:notable});
}
function petHealthDispatch_(body){if(body.operation==='pet.health.record')return petHealthRecord_(body);if(body.operation==='pet.health.getDailySummary')return petHealthSummary_(body);throw healthErr_('UNSUPPORTED_ACTION');}
