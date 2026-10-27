export const BUILD = 'odakyu-navi-20261027-v3';
export const TYPES = Object.freeze({Local:'各駅停車',SemiExpress:'準急',Express:'急行',RapidExpress:'快速急行'});
export const POLICY = Object.freeze({serviceDayBoundary:180,maxHopMinutes:18,localMaxHopMinutes:10,minTransferMinutes:3,shimoKitazawaTransferMinutes:6});
export const tail = value => String(value ?? '').split(/[.:]/).at(-1);
export function minutes(value) {
 if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw Error('TIME_INVALID');
 const [h,m]=value.split(':').map(Number);const v=h*60+m;return v<POLICY.serviceDayBoundary?v+1440:v;
}
export function clock(value) { if(!Number.isFinite(value))return '不明'; const v=((value%1440)+1440)%1440;return `${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`; }
export function normalize(rows, railwayRows, stationRows, fetchedAt) {
 if(!Array.isArray(rows)||!Array.isArray(railwayRows)||!Array.isArray(stationRows)||!Number.isFinite(Date.parse(fetchedAt)))throw Error('SOURCE_INVALID');
 const railway=railwayRows.find(r=>r['owl:sameAs']==='odpt.Railway:Odakyu.Odawara');
 if(!railway?.['odpt:stationOrder'])throw Error('RAILWAY_MISSING');
 const stations=railway['odpt:stationOrder'].filter(x=>x['odpt:index']<=19).map(x=>({id:tail(x['odpt:station']),name:x['odpt:stationTitle'].ja,index:x['odpt:index']-1}));
 const names=new Map(stationRows.map(r=>[r['owl:sameAs'],r['dc:title']]));
 const departures=[];const unique=new Set();
 for(const row of rows){
  if(row['odpt:operator']!=='odpt.Operator:Odakyu'||row['odpt:railway']!==railway['owl:sameAs']||row['odpt:railDirection']!=='odpt.RailDirection:Outbound')continue;
  const station=stations.find(x=>x.id===tail(row['odpt:station']));const calendar=tail(row['odpt:calendar']);
  if(!station||!['Weekday','SaturdayHoliday'].includes(calendar))continue;
  if(!Array.isArray(row['odpt:stationTimetableObject']))throw Error('TIMETABLE_INVALID');
  for(const [n,obj] of row['odpt:stationTimetableObject'].entries()){
   const type=tail(obj['odpt:trainType']);if(!TYPES[type])continue;
   const destinations=obj['odpt:destinationStation'];if(!Array.isArray(destinations)||destinations.length!==1)throw Error('DESTINATION_INVALID');
   const destination=destinations[0],time=minutes(obj['odpt:departureTime']);
   const id=`${calendar}:${station.id}:${n}`;if(unique.has(id))throw Error('DUPLICATE_EVENT');unique.add(id);
   departures.push({id,station:station.id,index:station.index,calendar,type,destination,destinationName:names.get(destination)||tail(destination),time,sourceTime:obj['odpt:departureTime'],isOrigin:obj['odpt:isOrigin']===true,sourceUpdatedAt:row['dc:date'],arrival:null,trainId:null});
  }
 }
 if(!departures.length)throw Error('EMPTY_CORRIDOR');
 return {schemaVersion:1,build:BUILD,timezone:'Asia/Tokyo',fetchedAt,stations,departures,capabilities:{realtimePosition:false,trainId:false,arrival:false,delay:false,departure:true},source:'ODPT / 小田急電鉄（チャレンジ2026限定）'};
}
const stationStops=(type,stations)=>type==='Local'?stations.map(x=>x.id):type==='RapidExpress'?['Shinjuku','YoyogiUehara','ShimoKitazawa','Noborito']:type==='Express'?['Shinjuku','YoyogiUehara','ShimoKitazawa','Kyodo','SeijogakuenMae','Noborito','MukogaokaYuen']:['YoyogiUehara','ShimoKitazawa',...stations.filter(x=>x.index>=stations.find(s=>s.id==='Kyodo').index).map(x=>x.id)];
// There is NO source train ID. These are explicit hypotheses, never authoritative trip joins.
export function hypotheses(model,calendar){
 if(!['Weekday','SaturdayHoliday'].includes(calendar))throw Error('CALENDAR_INVALID');
 const events=model.departures.filter(x=>x.calendar===calendar);const trains=[];const covered=new Set();
 const anchors=events.filter(x=>['Shinjuku','YoyogiUehara'].includes(x.station)).sort((a,b)=>a.index-b.index||a.time-b.time);
 for(const anchor of anchors){
  if(covered.has(anchor.id))continue;
  const stops=[anchor],expected=stationStops(anchor.type,model.stations);const dest=tail(anchor.destination);let unresolved=null;
  for(const name of expected){
   const station=model.stations.find(x=>x.id===name);const last=stops.at(-1);if(!station||station.index<=last.index)continue;
   const terminal=model.stations.find(x=>x.id===dest);if(terminal&&station.index>=terminal.index){unresolved={reason:'TERMINAL_ARRIVAL_UNAVAILABLE',station:name};break;}
   const min=1,max=anchor.type==='Local'?POLICY.localMaxHopMinutes:POLICY.maxHopMinutes;
   const candidates=events.filter(e=>e.station===name&&e.type===anchor.type&&e.destination===anchor.destination&&!e.isOrigin&&e.time-last.time>=min&&e.time-last.time<=max);
   if(candidates.length!==1){unresolved={reason:candidates.length?'AMBIGUOUS_JOIN':'NO_JOIN',station:name,candidates:candidates.length};break;}
   stops.push(candidates[0]);
  }
  if(stops.some(s=>s.station==='YoyogiUehara'))covered.add(stops.find(s=>s.station==='YoyogiUehara').id);
  trains.push({id:`hypothesis:${anchor.id}`,sourceTrainId:null,type:anchor.type,destination:anchor.destinationName,destinationId:anchor.destination,origin:anchor.station,throughChiyoda:anchor.station==='YoyogiUehara'?'unknown':false,stops,unresolved,confidence:'hypothesis',lane:['RapidExpress','Express'].includes(anchor.type)?'急行線（種別からの概略）':'緩行線（種別からの概略）'});
 }
 return trains;
}
export function position(train,now){
 if(!Number.isFinite(now))throw Error('TIME_INVALID');
 const a=train.stops.findLast(s=>s.time<=now);const b=train.stops.find(s=>s.time>now);
 if(!a||!b)return null;
 return {index:a.index+(b.index-a.index)*(now-a.time)/(b.time-a.time),from:a.station,to:b.station,kind:'timetable_interpolation',observed:false};
}
export function neighbours(trains,selected,now){
 const selectedPosition=position(selected,now);if(!selectedPosition)return {ahead:null,behind:null};
 const others=trains.filter(t=>t.id!==selected.id).map(t=>({id:t.id,p:position(t,now)})).filter(x=>x.p);
 return {ahead:others.filter(x=>x.p.index>selectedPosition.index).sort((a,b)=>a.p.index-b.p.index)[0]?.id||null,behind:others.filter(x=>x.p.index<selectedPosition.index).sort((a,b)=>b.p.index-a.p.index)[0]?.id||null};
}
export function overtakes(a,b){
 const common=a.stops.map(x=>({a:x,b:b.stops.find(y=>x.station===y.station)})).filter(x=>x.b);const result=[];
 for(let i=1;i<common.length;i++){const prev=common[i-1],next=common[i];if((prev.a.time-prev.b.time)*(next.a.time-next.b.time)<0)result.push({from:prev.a.station,to:next.a.station,kind:'departure_order_reversal',confidence:'hypothesis'});}
 return result;
}
export function compare(trains,selectedId,destination,now,buffer=POLICY.minTransferMinutes,maxTransfers=2){
 if(!Number.isFinite(now)||!Number.isInteger(buffer)||buffer<3||buffer>30||![1,2].includes(maxTransfers))throw Error('COMPARISON_INPUT_INVALID');
 if(!['Noborito','MukogaokaYuen'].includes(destination))throw Error('DESTINATION_INVALID');
 const selected=trains.find(t=>t.id===selectedId);if(!selected)throw Error('TRAIN_NOT_FOUND');
 const baseline=selected.stops.find(s=>s.station===destination&&s.time>=now),alternatives=[];
 const targetIndex=trains.flatMap(t=>t.stops).find(s=>s.station===destination)?.index;
 const exchange=new Set(['YoyogiUehara','ShimoKitazawa','Kyodo','SeijogakuenMae','Noborito']);
 const byStation=new Map();
 for(const train of trains)for(const stop of train.stops){
  if(!exchange.has(stop.station)||stop.time<now||stop.time>now+120)continue;
  if(!byStation.has(stop.station))byStation.set(stop.station,[]);
  byStation.get(stop.station).push({train,stop});
 }
 function visit(current,boardedIndex,earliest,legs,visited){
  const end=current.stops.find(s=>s.station===destination&&s.time>=earliest&&s.time<=now+120);
  if(end&&legs.length){
   const first=legs[0];alternatives.push({...first,destinationDeparture:end.time,baselineDeparture:baseline?.time??null,saving:baseline?baseline.time-end.time:null,arrival:null,guaranteed:false,confidence:'hypothesis',legs,overtakes:legs.flatMap(leg=>leg.overtakes)});
  }
  if(legs.length>=maxTransfers||targetIndex===undefined)return;
  for(const stop of current.stops){
   if(stop.time<earliest||stop.time>now+120||stop.index<=boardedIndex||stop.index>=targetIndex||!exchange.has(stop.station))continue;
   const required=Math.max(buffer,stop.station==='ShimoKitazawa'?POLICY.shimoKitazawaTransferMinutes:POLICY.minTransferMinutes);
   for(const next of byStation.get(stop.station)||[]){
    if(visited.has(next.train.id)||next.stop.time<stop.time+required)continue;
    const leg={station:stop.station,trainId:next.train.id,connectionTime:next.stop.time,minimumTransfer:required,scheduledGap:next.stop.time-stop.time,overtakes:overtakes(current,next.train)};
    visit(next.train,stop.index,next.stop.time,[...legs,leg],new Set([...visited,next.train.id]));
   }
  }
 }
 visit(selected,-1,now,[],new Set([selected.id]));
 alternatives.sort((a,b)=>a.destinationDeparture-b.destinationDeparture||a.legs.length-b.legs.length||a.connectionTime-b.connectionTime);
 return {status:'REFERENCE_ONLY',arrival:null,baselineDeparture:baseline?.time??null,best:alternatives[0]||null,alternatives:alternatives.slice(0,10),maxTransfers,recommendation:null,reasons:['列車IDなし。同一便の結合は時刻表照合の仮説','着時刻なし。目的駅の発時刻同士の参考比較',`乗換は最大${maxTransfers}回、再生時刻から120分以内の取得範囲を探索`,'乗換時間は保守的な設定値。実測・接続保証なし','遅延・運休・番線変更・列車種別変更は未取得'],neighbours:neighbours(trains,selected,now)};
}
