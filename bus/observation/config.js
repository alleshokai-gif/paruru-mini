const integer=(value,fallback,min,max,code)=>{
  const number=value===undefined||value===''?fallback:Number(value);
  if(!Number.isInteger(number)||number<min||number>max)throw Error(code);
  return number;
};
const time=value=>{
  const match=/^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(value||'');
  return match?Number(match[1])*60+Number(match[2]):null;
};
export function parseTimeBands(value='') {
  if(!value.trim())return Object.freeze([]);
  const bands=value.split(',').map(item=>{
    const parts=item.trim().split('-'),start=time(parts[0]),end=time(parts[1]);
    if(parts.length!==2||start===null||end===null||start===end)throw Error('OBSERVATION_TIME_BANDS_INVALID');
    return Object.freeze({start,end});
  });
  if(bands.length>8)throw Error('OBSERVATION_TIME_BANDS_INVALID');
  return Object.freeze(bands);
}
export function withinTimeBands(epochSeconds,bands) {
  if(!Array.isArray(bands)||!bands.length)return true;
  if(!Number.isFinite(epochSeconds))return false;
  const jst=new Date((epochSeconds+9*3600)*1000),minutes=jst.getUTCHours()*60+jst.getUTCMinutes();
  return bands.some(({start,end})=>start<end?minutes>=start&&minutes<end:minutes>=start||minutes<end);
}
export function observationConfig(env=process.env) {
  const token=env.ODPT_ACCESS_TOKEN,hashKey=env.OBSERVATION_HMAC_KEY,spreadsheetId=env.PALURU_BUS_OBSERVATION_SPREADSHEET_ID;
  if(typeof token!=='string'||!token||/\s/.test(token))throw Error('OBSERVATION_ODPT_SECRET_MISSING');
  if(typeof hashKey!=='string'||hashKey.length<32||/\s/.test(hashKey))throw Error('OBSERVATION_HASH_SECRET_INVALID');
  if(typeof spreadsheetId!=='string'||!/^[A-Za-z0-9_-]{20,128}$/.test(spreadsheetId))throw Error('OBSERVATION_SPREADSHEET_ID_INVALID');
  const sampleCount=integer(env.OBSERVATION_SAMPLE_COUNT,10,1,12,'OBSERVATION_SAMPLE_COUNT_INVALID');
  const intervalSec=integer(env.OBSERVATION_INTERVAL_SEC,32,30,35,'OBSERVATION_INTERVAL_INVALID');
  const maxRunSec=integer(env.OBSERVATION_MAX_RUN_SEC,330,60,420,'OBSERVATION_MAX_RUN_INVALID');
  if((sampleCount-1)*intervalSec>=maxRunSec)throw Error('OBSERVATION_BOUNDS_INVALID');
  const execution=env.CLOUD_RUN_EXECUTION;
  const runId=typeof execution==='string'&&/^[a-z][a-z0-9-]{0,62}$/.test(execution)?execution:null;
  return Object.freeze({token,hashKey,spreadsheetId,sampleCount,intervalSec,maxRunSec,
    timeBands:parseTimeBands(env.OBSERVATION_TIME_BANDS||''),runId});
}
