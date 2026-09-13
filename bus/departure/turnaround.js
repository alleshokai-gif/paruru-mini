const percentile=(values,p)=>{const rows=[...values].sort((a,b)=>a-b);return rows[Math.min(rows.length-1,Math.floor((rows.length-1)*p))];};
const defaultPolicy=Object.freeze({minSamples:12,maxSamplesPerKey:256,maxTurnaroundSec:60*60,confidence:0.9});
const key=value=>JSON.stringify([value.terminalId,value.platform,value.timeBand]);
export function createTurnaroundEstimator({policy:overrides={}}={}) {
  const policy={...defaultPolicy,...overrides},samples=new Map();
  if(!Number.isInteger(policy.minSamples)||policy.minSamples<1||!Number.isInteger(policy.maxSamplesPerKey)
    ||policy.maxSamplesPerKey<policy.minSamples||policy.maxTurnaroundSec<=0)throw Error('TURNAROUND_CONFIG_INVALID');
  function record(value) {
    const duration=value?.originDepartureAt-value?.terminalArrivalAt;
    if(value?.linkLevel!=='A'||!value.vehicleKey||!value.incomingTrip||!value.outgoingTrip
      ||value.incomingTrip===value.outgoingTrip||!value.terminalId||!value.platform||!value.timeBand
      ||!Number.isFinite(value.confidence)||value.confidence<policy.confidence||!Number.isFinite(duration)
      ||duration<0||duration>policy.maxTurnaroundSec)return false;
    const id=key(value),rows=samples.get(id)||[];rows.push(duration);samples.set(id,rows.slice(-policy.maxSamplesPerKey));return true;
  }
  function estimate(query) {
    const rows=samples.get(key(query))||[];
    if(rows.length<policy.minSamples)return null;
    return {sampleCount:rows.length,medianSec:percentile(rows,0.5),p80Sec:percentile(rows,0.8),estimateSec:percentile(rows,0.8)};
  }
  return {record,estimate,sampleCount:query=>(samples.get(key(query))||[]).length};
}
