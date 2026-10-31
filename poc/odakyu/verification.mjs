// Read-only audit of observations acquired separately from the saved Static artifact.
// This never imports stop times, identifies another train by proximity, or grants a licence.
import {createHash} from 'node:crypto';
export function timetableReviewFingerprint(trips){
  const saved=trips.map(({id,calendar,type,destination,stops,knownPasses})=>({id,calendar,type,destination,stops,knownPasses})).sort((a,b)=>a.id.localeCompare(b.id));
  return createHash('sha256').update(JSON.stringify(saved)).digest('hex');
}
// A service-pattern review is deliberately separate from the same-ID arrival
// audit below. Provider web codes can change; this never merges those codes.
export function verifyTimetableReview(trips,record){
  if(record===null)return {status:'not_checked',currentForAllTrips:false};
  if(record?.schemaVersion!==1||record.method!=='public_ui_pattern_comparison'
      ||!Number.isFinite(Date.parse(record.checkedAt))||!/^\d{4}-\d{2}-\d{2}$/.test(record.officialRevision?.effectiveDate)
      ||!Array.isArray(record.checks)||record.checks.length>20||!record.checks.length)throw Error('TIMETABLE_REVIEW_INVALID');
  if(timetableReviewFingerprint(trips)!==record.savedFingerprint)return {status:'saved_data_changed',currentForAllTrips:false,checkedAt:record.checkedAt};
  const seen=new Set(),calendars={};
  for(const check of record.checks){
    const trip=trips.find(t=>t.id===check.tripId),url=new URL(check.sourceUrl);
    if(!trip||!trip.id.startsWith('provider:')||seen.has(trip.id)||!['matched','mismatched'].includes(check.result)
        ||url.origin!=='https://transfer.navitime.biz'||url.pathname!=='/odakyu-transit/smart/diagram/StopListDiagram'
        ||!check.fields?.length)throw Error('TIMETABLE_REVIEW_CHECK_INVALID');
    seen.add(trip.id);
    const c=calendars[trip.calendar]??={matched:0,mismatched:0};c[check.result]++;
  }
  for(const [calendar,c]of Object.entries(calendars)){
    c.total=trips.filter(t=>t.id.startsWith('provider:')&&t.calendar===calendar).length;
    c.notChecked=c.total-c.matched-c.mismatched;
  }
  return {status:'partial',currentForAllTrips:false,checkedAt:record.checkedAt,officialRevision:record.officialRevision,
    calendars,checks:record.checks,supplemental:record.supplemental,unknown:record.unknown,
    identityMappingConfirmed:false,timetableImported:false};
}
export function verifyRecordedChecks(trips, record) {
  if (record === null) return { status: 'not_checked', matched: 0, mismatched: 0, quarantinedIds: [], independentProvider: false };
  if (record?.schemaVersion !== 1 || record.method !== 'public_ui_observation'
      || !Number.isFinite(Date.parse(record.checkedAt)) || !Array.isArray(record.checks)
      || !record.checks.length || record.checks.length > 20) throw Error('AUDIT_RECORD_INVALID');
  const results = [], seen = new Set();
  for (const check of record.checks) {
    const url = new URL(check.sourceUrl);
    if (url.origin !== 'https://transfer.navitime.biz' || url.pathname !== '/odakyu-transit/smart/diagram/StopListDiagram'
        || !['Weekday', 'SaturdayHoliday'].includes(check.calendar) || !/^\d{4}-\d{2}-\d{2}$/.test(check.serviceDate)
        || !Number.isInteger(check.departure) || !Number.isInteger(check.arrival)
        || seen.has(check.trainId) || !['Noborito', 'SeijogakuenMae'].includes(check.station)) throw Error('AUDIT_CHECK_INVALID');
    const day = new Date(`${check.serviceDate}T00:00:00Z`);
    const sourceTime = url.searchParams.get('datetime')?.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):00$/);
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== check.serviceDate
        || (check.calendar === 'Weekday' && [0, 6].includes(day.getUTCDay()))
        || !sourceTime || Number(sourceTime[1]) * 60 + Number(sourceTime[2]) !== check.departure % 1440) throw Error('AUDIT_CALENDAR_TIME_INVALID');
    seen.add(check.trainId);
    const trip = trips.find(t => t.id === check.trainId && t.calendar === check.calendar);
    if (!trip || url.searchParams.get('tCode') !== trip.sourceTrainId.replace(/^odakyu-/, '')
        || url.searchParams.get('datetime')?.slice(0, 10) !== check.serviceDate) throw Error('AUDIT_IDENTITY_INVALID');
    const anchor = trip.stops.find(s => s.station === 'YoyogiUehara' && s.stop === true);
    const stop = trip.stops.find(s => s.station === check.station && s.stop === true);
    results.push({ trainId: trip.id, matched: anchor?.departure === check.departure && stop?.arrival === check.arrival });
  }
  const quarantinedIds = results.filter(r => !r.matched).map(r => r.trainId);
  return { status: quarantinedIds.length ? 'mismatch' : 'matched', matched: results.length - quarantinedIds.length,
    mismatched: quarantinedIds.length, quarantinedIds, checkedAt: record.checkedAt,
    method: record.method, independentAcquisition: true, independentProvider: false,
    serviceDates: [...new Set(record.checks.map(c => c.serviceDate))],
    scope: '保存Staticとは別に公式画面を閲覧して照合。同じ提供元であり別提供者の照合ではない。新しい時刻表データは取り込まない' };
}
