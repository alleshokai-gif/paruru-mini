import { JR_NAMBU_IDS } from './jr-nambu-static.js';
import { fetchChallengeRows, readChallengeToken } from './challenge-client.js';

const STALE_SECONDS = 120;
const JST_SECONDS = 9 * 3600;
const serviceDateAt = (epoch) => new Date((epoch + JST_SECONDS) * 1000).toISOString().slice(0, 10);
const key = (operator, railway, date, number) => `${operator}|${railway}|${date}|${number}`;
const fallback = (train, reason) => ({ ...train, railRealtimeState: 'static_fallback',
  railRealtimeReason: reason, delaySeconds: null, position: null,
  effectiveStationTimes: null });

export function attachJrNambuLocations(trains, rows, now) {
  if (!Array.isArray(trains) || !Array.isArray(rows) || !Number.isFinite(now))
    throw Error('JR_CHALLENGE_INPUT_INVALID');
  const counts = new Map();
  for (const train of trains) {
    if (train.provider !== 'jr_east') continue;
    const id = key(JR_NAMBU_IDS.operator, train.railway, train.serviceDate, train.trainNumber);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const byKey = new Map();
  for (const row of rows) {
    if (row?.['odpt:operator'] !== JR_NAMBU_IDS.operator
      || row['odpt:railway'] !== JR_NAMBU_IDS.railway
      || row['odpt:railDirection'] !== JR_NAMBU_IDS.direction) continue;
    const observedAt = Date.parse(row['dc:date']) / 1000;
    const number = row['odpt:trainNumber'];
    if (!Number.isFinite(observedAt) || typeof number !== 'string') continue;
    const id = key(JR_NAMBU_IDS.operator, row['odpt:railway'], serviceDateAt(observedAt), number);
    byKey.set(id, [...(byKey.get(id) || []), row]);
  }
  return trains.map((train) => {
    if (train.provider !== 'jr_east') return train;
    const id = key(JR_NAMBU_IDS.operator, train.railway, train.serviceDate, train.trainNumber);
    if (counts.get(id) !== 1 || byKey.get(id)?.length > 1) return fallback(train, 'ambiguous');
    const row = byKey.get(id)?.[0];
    if (!row) return fallback(train, 'unmatched');
    const observedAt = Date.parse(row['dc:date']) / 1000;
    const validUntil = Date.parse(row['dct:valid']) / 1000;
    const delaySeconds = row['odpt:delay'];
    if (serviceDateAt(now) !== train.serviceDate || !Number.isFinite(validUntil)
      || observedAt > now + 15 || now - observedAt > STALE_SECONDS || validUntil < now)
      return fallback(train, 'stale');
    if (!Number.isSafeInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 3600)
      return fallback(train, 'invalid_delay');
    const fromStation = row['odpt:fromStation'], toStation = row['odpt:toStation'];
    if ((fromStation != null && typeof fromStation !== 'string')
      || (toStation != null && typeof toStation !== 'string')
      || (fromStation == null && toStation == null))
      return fallback(train, 'invalid_position');
    return { ...train, railRealtimeState: 'confirmed_delay', railRealtimeReason: null,
      delaySeconds, position: { fromStation: fromStation ?? null, toStation: toStation ?? null, observedAt },
      effectiveStationTimes: Object.fromEntries(Object.entries(train.stationTimes)
        .map(([station, time]) => [station, time + delaySeconds])) };
  });
}

// Only server code imports this. On auth/feed failure callers keep the Static list.
export async function loadJrNambuLocations({ now, env = process.env,
  fetchImpl = fetch } = {}) {
  const token = await readChallengeToken(env);
  if (!token) return null;
  const rows = await fetchChallengeRows('odpt:Train', { token, fetchImpl });
  return { rows, fetchedAt: now };
}
