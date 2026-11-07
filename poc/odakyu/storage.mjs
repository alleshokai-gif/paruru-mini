import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export const DATA_DIR=new URL('./data/',import.meta.url);
export const TYPES=['Train','TrainTimetable','StationTimetable','Railway','Station'];
export async function listSnapshots(type='StationTimetable'){
 if(!TYPES.includes(type))throw Error('SNAPSHOT_TYPE_INVALID');
 return(await readdir(DATA_DIR)).filter(f=>new RegExp(`^${type}-[\\dTZ-]+\\.json$`).test(f)).sort().reverse();
}
export async function readSnapshot(name){
 if(!TYPES.some(type=>new RegExp(`^${type}-[\\dTZ-]+\\.json$`).test(name)))throw Error('SNAPSHOT_NAME_INVALID');
 const s=JSON.parse(await readFile(new URL(name,DATA_DIR),'utf8'));
 if(!Array.isArray(s.rows)||!Number.isFinite(Date.parse(s.fetchedAt))||s.rows.length>20000||!/^https:\/\/api-challenge\.odpt\.org\/api\/v4\/odpt:(Train|TrainTimetable|StationTimetable|Railway|Station)$/.test(s.endpoint))throw Error('SNAPSHOT_INVALID');
 const hash=createHash('sha256').update(JSON.stringify(s.rows)).digest('hex');
 if(hash!==(s.rowsSha256||s.sha256))throw Error('SNAPSHOT_INTEGRITY_FAILED');
 return s;
}
export async function latest(type){const names=await listSnapshots(type);if(!names.length)throw Error('SNAPSHOT_MISSING');return readSnapshot(names[0]);}
