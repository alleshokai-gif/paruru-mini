import { CALENDARS } from './config.js';

const JST_SECONDS = 9 * 60 * 60;

// Cabinet Office published national holidays and statutory substitute/citizens' holidays.
// The bounded list is intentional: an uncovered date is not silently treated as a weekday.
export const HOLIDAY_SOURCE = Object.freeze({
  authority: 'Cabinet Office, Government of Japan',
  url: 'https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html',
  coveredFrom: '2026-01-01',
  coveredThrough: '2027-12-31'
});

export const VERIFIED_HOLIDAY_DATES = Object.freeze([
  '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20',
  '2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
  '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23',
  '2026-10-12', '2026-11-03', '2026-11-23',
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21',
  '2027-03-22', '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05',
  '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23', '2027-10-11',
  '2027-11-03', '2027-11-23'
]);

const VERIFIED_HOLIDAYS = new Set(VERIFIED_HOLIDAY_DATES);

export function jstDate(epoch) {
  if (!Number.isFinite(epoch) || epoch < 0) throw new Error('BUS_TOKYU_CALENDAR_INVALID');
  return new Date((epoch + JST_SECONDS) * 1000).toISOString().slice(0, 10);
}

export function resolveTokyuServiceCalendar(epoch, { holidays = VERIFIED_HOLIDAYS,
  coveredFrom = HOLIDAY_SOURCE.coveredFrom, coveredThrough = HOLIDAY_SOURCE.coveredThrough } = {}) {
  if (!(holidays instanceof Set) || typeof coveredFrom !== 'string' || typeof coveredThrough !== 'string')
    throw new Error('BUS_TOKYU_CALENDAR_INVALID');
  const date = jstDate(epoch);
  if (date < coveredFrom || date > coveredThrough) return null;
  if (holidays.has(date)) return { calendar: CALENDARS.sunday, serviceDayType: 'holiday', date };
  const day = new Date((epoch + JST_SECONDS) * 1000).getUTCDay();
  if (day === 0) return { calendar: CALENDARS.sunday, serviceDayType: 'sunday', date };
  if (day === 6) return { calendar: CALENDARS.saturday, serviceDayType: 'saturday', date };
  return { calendar: CALENDARS.weekday, serviceDayType: 'weekday', date };
}
