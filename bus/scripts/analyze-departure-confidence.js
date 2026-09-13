import { readFileSync,readdirSync,writeFileSync } from 'node:fs';

const percentile=(values,p)=>{if(!values.length)return null;const rows=[...values].sort((a,b)=>a-b);
  return rows[Math.min(rows.length-1,Math.floor((rows.length-1)*p))];};
const summarize=values=>({samples:values.length,medianSec:percentile(values,0.5),p80Sec:percentile(values,0.8),
  p95Sec:percentile(values,0.95),minSec:percentile(values,0),maxSec:percentile(values,1)});

try {
  const folder=new URL('../generated/',import.meta.url),files=readdirSync(folder)
    .filter(name=>/^departure-confidence-[0-9]{8}T[0-9]{6}\.json$/.test(name));
  const records=new Map();
  for(const name of files)for(const record of JSON.parse(readFileSync(new URL(name,folder),'utf8')).records||[]) {
    const existing=records.get(record.tripKey);
    if(!existing||(!existing.firstPositiveDepartedEvidence&&record.firstPositiveDepartedEvidence))records.set(record.tripKey,record);
  }
  const groups={},coverage={observedAcrossSchedule:0,leftCensored:0,futureAtEnd:0,rightCensoredAfterSchedule:0};
  for(const record of records.values()) {
    const firstObserved=record.observations?.[0]?.receivedAt??null,lastObserved=record.observations?.at(-1)?.receivedAt??null;
    if(Number.isFinite(firstObserved)&&Number.isFinite(lastObserved)) {
      if(record.scheduledDeparture<firstObserved)coverage.leftCensored++;
      else if(record.scheduledDeparture>lastObserved)coverage.futureAtEnd++;
      else {
        coverage.observedAcrossSchedule++;
        if(!record.firstPositiveDepartedEvidence)coverage.rightCensoredAfterSchedule++;
      }
    }
    const key=`${record.directionId}:${record.routeId}:${record.originStopId}`,group=groups[key]||{tripInstances:0,positive:[],censored:0,
      evidenceTypes:{},vehicles:new Set(),rtSamples:0,gpsSamples:0};
    group.tripInstances++;
    const evidence=record.firstPositiveDepartedEvidence;
    if(evidence) {
      group.positive.push(evidence.elapsedSeconds);group.evidenceTypes[evidence.type]=(group.evidenceTypes[evidence.type]||0)+1;
      if(evidence.vehicleKey)group.vehicles.add(evidence.vehicleKey);
    } else group.censored++;
    for(const observation of record.observations||[]) {
      if(observation.tripUpdatePresent)group.rtSamples++;
      if(observation.gpsTimestamp!==null)group.gpsSamples++;
      if(observation.vehicleKey)group.vehicles.add(observation.vehicleKey);
    }
    groups[key]=group;
  }
  const normalized=Object.fromEntries(Object.entries(groups).map(([key,value])=>[key,{tripInstances:value.tripInstances,
    positiveEvidence:summarize(value.positive),censored:value.censored,evidenceTypes:value.evidenceTypes,
    distinctHashedVehicles:value.vehicles.size,rtSamples:value.rtSamples,gpsSamples:value.gpsSamples}]));
  const positiveRows=[...records.values()].filter(value=>value.firstPositiveDepartedEvidence),positive=positiveRows.length,censored=records.size-positive;
  const calibrationElapsed=positiveRows.filter(value=>(value.observations?.[0]?.receivedAt??Infinity)<=value.scheduledDeparture)
    .map(value=>value.firstPositiveDepartedEvidence.elapsedSeconds);
  const result={researchOnly:true,productionInput:false,generatedAt:new Date().toISOString(),captureFiles:files.length,
    tripInstances:records.size,positiveEvidence:positive,censored,coverage,calibrationElapsed:summarize(calibrationElapsed),groups:normalized,
    thresholdCalibrationReady:false,calibrationRequirement:{minimumPositivePerRouteOrigin:20,includeCensored:true},
    conclusion:positive?'evidence_observed_but_sample_insufficient':'positive_departure_evidence_not_observed'};
  writeFileSync(new URL('departure-confidence-summary.json',folder),JSON.stringify(result,null,2)+'\n',{encoding:'utf8',flush:true});
  console.log(JSON.stringify({status:'DEPARTURE_CONFIDENCE_ANALYSIS_PASS',captureFiles:files.length,tripInstances:records.size,
    positiveEvidence:positive,censored,thresholdCalibrationReady:false}));
} catch {
  console.log('{"status":"DEPARTURE_CONFIDENCE_ANALYSIS_FAILED"}');process.exitCode=1;
}
