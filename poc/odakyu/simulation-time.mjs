import {POLICY} from './core.mjs';
const DAY_MINUTES=24*60,MINUTE_MS=60*1000,JST_OFFSET_MS=9*60*MINUTE_MS;

// All clock input is converted to Asia/Tokyo before choosing the service day.
// Before 03:00, 24:00–26:59 belongs to the previous day's timetable.
export function japanServiceTime(date, coverage) {
  const epoch=date instanceof Date?date.getTime():NaN;
  if(!Number.isFinite(epoch))throw Error('SIMULATION_DATE_INVALID');
  const japan=new Date(epoch+JST_OFFSET_MS);
  const civilMinute=japan.getUTCHours()*60+japan.getUTCMinutes();
  const overnight=civilMinute<POLICY.serviceDayBoundary;
  const service=new Date(japan.getTime()-(overnight?DAY_MINUTES*MINUTE_MS:0));
  const serviceDate=service.toISOString().slice(0,10),day=service.getUTCDay();
  const covered=coverage&&Array.isArray(coverage.holidays)
    &&serviceDate>=coverage.coveredFrom&&serviceDate<=coverage.coveredThrough;
  const holiday=covered&&coverage.holidays.includes(serviceDate);
  return {serviceDate,minute:civilMinute+(overnight?DAY_MINUTES:0),
    calendar:covered?(holiday||day===0||day===6?'SaturdayHoliday':'Weekday'):null};
}
