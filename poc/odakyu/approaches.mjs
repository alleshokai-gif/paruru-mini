import {minutes} from './core.mjs';

// Reuse the saved, same-service-date commute legs. Metro timetable rows only
// enrich an exact provider-ID/calendar/endpoints match; they never link to an
// Odakyu train. Negative indices are on this approach, not Odakyu station order.
const CALENDARS={weekday:'Weekday',weekend:'SaturdayHoliday'};
const METRO_STATIONS=[['Hibiya','日比谷'],['Kasumigaseki','霞ケ関'],['KokkaiGijidomae','国会議事堂前'],
  ['Akasaka','赤坂'],['Nogizaka','乃木坂'],['OmoteSando','表参道'],['MeijiJingumae','明治神宮前'],['YoyogiKoen','代々木公園']];
const stationId=name=>`Chiyoda.${name}`;
const UEHARA_INDEX=4;
export function savedApproaches(artifact,metro,stationRows=[]) {
  const rows=metro?.rows??[];
  if(!Array.isArray(rows)||metro&&!Number.isFinite(Date.parse(metro.fetchedAt)))throw Error('METRO_SNAPSHOT_INVALID');
  const names=new Map(stationRows.map(r=>[String(r['owl:sameAs']).split('.').at(-1),r['dc:title']]));
  const stations=METRO_STATIONS.map(([name,title],i)=>({id:stationId(name),name:title,index:i-METRO_STATIONS.length}));
  const trips=[],rejected=[];
  for(const leg of artifact.legs.filter(l=>l.segment==='chiyoda')) {
    const calendar=CALENDARS[leg.calendarType];
    if(!calendar||leg.source!=='odpt:TrainTimetable'||leg.stationTimeSource!=='arrival'
      ||!leg.trainId?.startsWith('odpt.Train:TokyoMetro.Chiyoda.'))throw Error('APPROACH_SOURCE_INVALID');
    const matches=rows.filter(r=>r['odpt:train']===leg.trainId&&r['odpt:calendar']===`odpt.Calendar:${calendar}`);
    const [fromTime,toTime]=[minutes(leg.departure),minutes(leg.stationTime)];
    if(toTime<=fromTime)throw Error('APPROACH_TIME_INVALID');
    const stops=[{station:stationId('Hibiya'),index:stations[0].index,arrival:null,departure:fromTime,platform:null,stop:true},
      {station:'YoyogiUehara',index:UEHARA_INDEX,arrival:toTime,departure:null,platform:null,stop:true}];
    let enriched=false;
    if(matches.length===1&&matches[0]['odpt:railDirection']==='odpt.RailDirection:TokyoMetro.YoyogiUehara') {
      const raw=matches[0]['odpt:trainTimetableObject'];
      const from=raw?.findIndex(s=>s['odpt:departureStation']==='odpt.Station:TokyoMetro.Chiyoda.Hibiya'&&s['odpt:departureTime']===leg.departure);
      const end=raw?.findIndex(s=>s['odpt:arrivalStation']==='odpt.Station:TokyoMetro.Chiyoda.YoyogiUehara'&&s['odpt:arrivalTime']===leg.stationTime);
      if(from>=0&&end>from) {
        const middle=raw.slice(from+1,end).map(s=>{
          const name=String(s['odpt:departureStation']||'').split('.').at(-1),station=stations.find(x=>x.id===stationId(name));
          return station&&s['odpt:departureTime']?{station:station.id,index:station.index,arrival:null,departure:minutes(s['odpt:departureTime']),platform:null,stop:true}:null;
        }).filter(Boolean);
        if(middle.every((s,i)=>s.departure>=(middle[i-1]?.departure??fromTime)&&s.departure<toTime)) {
          stops.splice(1,0,...middle);enriched=true;
        }
      }
    }
    if(!enriched)rejected.push({id:leg.trainId,calendar,reason:'INTERMEDIATE_TIMES_NOT_MATCHED'});
    const terminal=leg.destination==='YoyogiUehara';
    trips.push({id:`metro:${calendar}:${leg.trainId}`,sourceTrainId:leg.trainId,trainNumber:null,
      calendar,type:'Local',destination:terminal?'代々木上原':names.get(leg.destination)||leg.destination,origin:stationId('Hibiya'),
      stops,knownPasses:[],identityBasis:'provider_id',confidence:'provider_static',
      datasetId:'saved-static',dataKind:'real',checkedAt:artifact.sourceCheckedAt,
      sourceServiceDate:artifact.sourceDates?.[leg.calendarType]??null,source:'既存通勤Static / ODPT Metro TrainTimetable',
      approach:{route:'chiyoda',terminatesAtUehara:terminal,onwardIdentity:'unknown',intermediateDepartures:enriched,
        supplementaryFetchedAt:enriched?metro.fetchedAt:null},boundary:{station:'YoyogiUehara',identity:'unknown'}});
  }
  return {stations,trips,report:{accepted:trips.length,intermediateMatched:trips.length-rejected.length,rejected,
    sameTrainLinks:0,shinjukuAccepted:0}};
}
