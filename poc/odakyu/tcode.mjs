// Reference matching only. Never imports Web times or upgrades a dated timetable.
export const REVIEW_SCOPE = Object.freeze({ serviceDate: '2026-10-27', calendar: 'Weekday',
  codes: ['81ff0057', '81ff0058', '81ff005b', '81ff0052', '81ff0062'] });
const DETAIL_BASE = 'https://transfer.navitime.biz';
const DETAIL_PATH = '/odakyu-transit/smart/diagram/StopListDiagram';
const NODES = Object.freeze({ YoyogiUehara: ['00005508', '代々木上原'], SeijogakuenMae: ['00004633', '成城学園前'] });
const KINDS = Object.freeze({ Local: '各停', SemiExpress: '準急', Express: '急行', RapidExpress: '快速急行' });
export function matchTCode(trips, { tCode, serviceDate, calendar, revision }) {
  if (!/^[a-f0-9]{8}$/.test(tCode) || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)
      || !Number.isFinite(Date.parse(serviceDate)) || new Date(serviceDate).toISOString().slice(0,10) !== serviceDate
      || !['Weekday','SaturdayHoliday'].includes(calendar) || !Number.isFinite(Date.parse(revision))) throw Error('TCODE_SCOPE_INVALID');
  const matches = trips.filter(t => t.identityBasis === 'provider_id' && t.calendar === calendar
    && t.checkedAt === revision && t.sourceTrainId === `odakyu-${tCode}`);
  const result = { tCode, serviceDate, calendar, revision, status: matches.length === 1 ? 'unique_reference' : matches.length ? 'ambiguous' : 'unmatched',
    count: matches.length, referenceOnly: true, operatingTrainNumber: null };
  if (matches.length !== 1) return result;
  const trip = matches[0], node = NODES[trip.origin], time = trip.stops[0].departure;
  Object.assign(result, { tripId: trip.id, sourceServiceDate: trip.sourceServiceDate,
    sameServiceDate: trip.sourceServiceDate === serviceDate });
  if (!node || !KINDS[trip.type] || !Number.isInteger(time) || time < 0 || time >= 1440) return result;
  const hour = Math.floor(time / 60), minute = time % 60;
  const clock = `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
  const [year,month,day] = serviceDate.split('-');
  const url = new URL(DETAIL_PATH, DETAIL_BASE);
  for (const [key,value] of Object.entries({tCode,datetime:`${serviceDate}T${clock}:00`,posType:'1',node:node[0],nodeName:node[1],
    year,month,day,hour,minute,destination:'小田原/片瀬江ノ島',direction:'down',kind:`小田急小田原線${KINDS[trip.type]}`,parentUrl:'https://www.odakyu.jp'})) url.searchParams.set(key,value);
  result.url = url.href;
  return result;
}
