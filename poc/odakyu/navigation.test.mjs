import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalize, minutes } from './core.mjs';
import { latest } from './storage.mjs';
import { reconstructTrips } from './reconstruct.mjs';
import { assessConnection, planNavigation, scheduledPosition, arrivalOrderReversals } from './navigation.mjs';

const [t, r, s] = await Promise.all(['StationTimetable', 'Railway', 'Station'].map(latest));
const model = normalize(t.rows, r.rows, s.rows, t.fetchedAt);
const provider = JSON.parse(await readFile(new URL('../../bus/release-static/kazu-commute-static.json', import.meta.url), 'utf8'));
const real = reconstructTrips(provider, model);
// Real reference values stay in ignored local data, never in Git.
const reference = JSON.parse(await readFile(new URL('./data/navigation-reference.json', import.meta.url), 'utf8'));
const actualLocal = real.trips.find(t => t.id === reference.selectedId);
const stop = (station, index, arrival, departure) => ({ station, index, arrival, departure, stop: true });
const trip = (id, stops, type = 'Local') => ({ id, calendar: 'Weekday', identityBasis: 'provider_id', stops, type });

test('既存実データ695便のIDを保持し、1,633区間の発時刻をODPTと独立照合する', () => {
  assert.equal(real.report.accepted, 695); assert.equal(real.report.rejected, 0);
  assert.equal(real.report.departureChecks, 1633); assert.equal(real.report.departureMismatches, 0);
  assert.equal(real.report.departureAmbiguities, 0); assert.equal(real.report.independentArrivalChecks, 0);
  assert.equal(new Set(real.trips.map(t => t.id)).size, 695);
  for (const t of real.trips) { assert.ok(t.sourceTrainId); assert.equal(t.trainNumber, null); assert.equal(t.identityBasis, 'provider_id'); }
});
test('独立資料と発時刻が食い違った便を隔離し、近い時刻の別便へ付け替えない', () => {
  const altered = structuredClone(provider); const leg = altered.legs.find(l => l.segment === 'odakyu_uehara_noborito');
  leg.departure = '03:00'; const output = reconstructTrips(altered, model);
  assert.ok(output.report.rejected > 0); assert.ok(output.report.departureMismatches > 0);
  assert.ok(!output.trips.some(t => t.sourceTrainId === leg.trainId && t.calendar === (leg.calendarType === 'weekday' ? 'Weekday' : 'SaturdayHoliday')));
});
test('同じ提供元IDの矛盾した着時刻を検出して便ごと隔離する', () => {
  const altered = structuredClone(provider); const leg = altered.legs.find(l => l.segment === 'odakyu_uehara_noborito' && altered.legs.some(x => x.segment === 'odakyu_seijo_noborito' && x.trainId === l.trainId && x.calendarType === l.calendarType));
  leg.stationTime = '23:59'; const output = reconstructTrips(altered, model);
  assert.ok(output.report.rejectedTrains.some(t => t.reasons.includes('CONFLICTING_PROVIDER_TIME')));
});
test('実データの登戸着を使用し、発時刻による差と混同しない', () => {
  const result = planNavigation(real.trips, actualLocal.id, 'Noborito', reference.compareAt);
  assert.equal(result.baseline.arrival, reference.baselineArrival); assert.equal(result.recommendation.arrival, reference.recommendedArrival);
  assert.equal(result.recommendation.saving, 5); assert.equal(result.recommendation.connection, 'likely');
  assert.equal(result.bestConditional.arrival, reference.conditionalArrival); assert.equal(result.bestConditional.connection, 'tight');
});
test('実便の明示停車で成城学園前の着・発を別々に保持する', () => {
  const row = actualLocal.stops.find(s => s.station === 'SeijogakuenMae');
  assert.equal(row.arrival, reference.seijoArrival); assert.equal(row.departure, reference.seijoDeparture);
  assert.ok(!actualLocal.stops.some(s => s.station === 'Shinjuku'));
});
test('実データの向ヶ丘遊園着を推測せず、快速急行も到着列車へ変換しない', () => {
  const plan = planNavigation(real.trips, actualLocal.id, 'MukogaokaYuen', reference.compareAt);
  assert.equal(plan.status, 'ARRIVAL_UNAVAILABLE'); assert.equal(plan.recommendation, null); assert.equal(plan.alternatives.length, 0);
  for (const t of real.trips.filter(t => t.type === 'RapidExpress')) assert.ok(!t.stops.some(s => s.station === 'MukogaokaYuen'));
});
test('同じホームと確認した場合は急行の接続評価が変わるが保証にはしない', () => {
  const plan = planNavigation(real.trips, actualLocal.id, 'Noborito', reference.compareAt, { stationConditions: { YoyogiUehara: 'same_platform' } });
  assert.equal(plan.recommendation.arrival, reference.conditionalArrival); assert.equal(plan.recommendation.saving, 7);
  assert.equal(plan.recommendation.legs[0].connection.guaranteed, false);
});

test('候補を限定しても実便5分短縮を維持し、接続できない先着便を別の推奨へすり替えない',()=>{
  const normal=planNavigation(real.trips,actualLocal.id,'Noborito',actualLocal.stops[0].departure);
  const candidateId=normal.recommendation.legs[0].trainId;
  const matched=planNavigation(real.trips,actualLocal.id,'Noborito',actualLocal.stops[0].departure,{candidateId});
  assert.equal(matched.recommendation.saving,5);
  assert.ok(matched.alternatives.every(p=>p.legs.some(l=>l.trainId===candidateId)));
  const earlier=real.trips.filter(t=>t.calendar===actualLocal.calendar&&t.type==='RapidExpress'
    &&t.stops[0].departure<actualLocal.stops[0].departure).at(-1);
  const unconnected=planNavigation(real.trips,actualLocal.id,'Noborito',actualLocal.stops[0].departure,{candidateId:earlier.id});
  assert.equal(unconnected.alternatives.length,0);assert.equal(unconnected.recommendation.transfers,0);
  assert.equal(unconnected.recommendation.arrival,normal.baseline.arrival);
  assert.throws(()=>planNavigation(real.trips,actualLocal.id,'Noborito',reference.compareAt,{candidateId:actualLocal.id}),/CANDIDATE_INVALID/);
});
test('0分接続は通常・別ホーム・バリアフリーでも自動成功や失敗にしない', () => {
  for (const condition of ['unknown', 'same_platform', 'change_level', 'elevator']) {
    const result = assessConnection({ station: 'SeijogakuenMae', arrival: 600, departure: 600, now: 599, condition });
    assert.equal(result.status, 'tight'); assert.equal(result.guaranteed, false);
    assert.deepEqual(result.availableSeconds, { min: -59, max: 59 });
  }
});
test('発車済み・余裕のある接続・階移動のギリギリを分類する', () => {
  assert.equal(assessConnection({ station: 'YoyogiUehara', arrival: 600, departure: 600, now: 601 }).status, 'difficult');
  assert.equal(assessConnection({ station: 'YoyogiUehara', arrival: 600, departure: 607, now: 599 }).status, 'likely');
  assert.equal(assessConnection({ station: 'ShimoKitazawa', arrival: 600, departure: 604, now: 599 }).status, 'tight');
});
test('同着なら乗換なしを優先し、より遅い便を推奨しない', () => {
  const a = trip('a', [stop('YoyogiUehara', 4, null, 600), stop('Noborito', 17, 630, null)]);
  const b = trip('b', [stop('YoyogiUehara', 4, null, 610), stop('Noborito', 17, 630, null)]);
  assert.equal(planNavigation([a, b], 'a', 'Noborito', 599).recommendation.transfers, 0);
});
test('成城学園前での接続は着時刻を基準にし、停車中は現在からの残り時間を使う', () => {
  const a = trip('a', [stop('YoyogiUehara', 4, null, 600), stop('SeijogakuenMae', 13, 610, 615), stop('Noborito', 17, 630, null)]);
  const b = trip('b', [stop('SeijogakuenMae', 13, null, 617), stop('Noborito', 17, 624, null)], 'Express');
  const r = planNavigation([a, b], 'a', 'Noborito', 613, { stationConditions: { SeijogakuenMae: 'same_platform' } });
  assert.equal(r.recommendation.arrival, 624); assert.equal(r.recommendation.legs[0].connection.gapMinutes, 4);
});
test('実データの追越しは着発順序の逆転として確認し、場所・番線を作らない', () => {
  const rapid = real.trips.find(t => t.calendar === 'Weekday' && t.type === 'RapidExpress' && t.stops[0].departure === reference.rapidDeparture);
  const reversed = arrivalOrderReversals(actualLocal, rapid);
  assert.equal(reversed[0].from, 'YoyogiUehara'); assert.equal(reversed[0].to, 'Noborito'); assert.equal(reversed[0].location, 'unknown');
});
test('部分停車データの範囲外へ位置を外挿せず、実測とは表現しない', () => {
  const p = scheduledPosition(actualLocal, actualLocal.stops[0].departure + 1); assert.equal(p.observed, false);
  assert.equal(scheduledPosition(actualLocal, reference.outsideBefore), null);
  assert.equal(scheduledPosition(actualLocal, reference.outsideAfter), null);
});
test('過去到着済みの列車は定刻上の到着済みとして表示し、未来の推奨を作らない', () => {
  const plan = planNavigation(real.trips, actualLocal.id, 'Noborito', reference.outsideAfter);
  assert.equal(plan.status, 'SCHEDULED_ARRIVED'); assert.equal(plan.recommendation, null);
});
test('仮説IDと不正な移動条件を到着比較へ混入できない', () => {
  assert.throws(() => planNavigation(real.trips, actualLocal.id, 'MukogaokaYuen', reference.compareAt, { extraMinutes: -1 }));
  assert.throws(() => planNavigation(real.trips, actualLocal.id, 'Noborito', reference.compareAt, { stationConditions: { YoyogiUehara: 'guessed' } }));
  assert.throws(() => planNavigation([{ ...actualLocal, identityBasis: 'hypothesis' }], actualLocal.id, 'Noborito', reference.compareAt));
});
test('通過扱いの駅を乗換地点や目的駅到着として使わない', () => {
  const a = trip('a', [stop('YoyogiUehara', 4, null, 600), { ...stop('SeijogakuenMae', 13, 610, 612), stop: false }, stop('Noborito', 17, 630, null)]);
  const b = trip('b', [stop('SeijogakuenMae', 13, null, 620), stop('Noborito', 17, 625, null)]);
  assert.equal(planNavigation([a, b], 'a', 'Noborito', 600).recommendation.transfers, 0);
  const c = trip('c', [stop('YoyogiUehara', 4, null, 610), { ...stop('MukogaokaYuen', 18, 620, null), stop: false }], 'RapidExpress');
  assert.equal(planNavigation([a, c], 'a', 'MukogaokaYuen', 600).recommendation, null);
});
test('遊園通過の快速急行から登戸で乗換する2回経路は明示着発がある場合だけ比較できる', () => {
  const a = trip('a', [stop('YoyogiUehara', 4, null, 600), stop('Noborito', 17, 630, 631), stop('MukogaokaYuen', 18, 635, null)]);
  const b = trip('b', [stop('YoyogiUehara', 4, null, 610), stop('Noborito', 17, 620, null)], 'RapidExpress');
  const c = trip('c', [stop('Noborito', 17, null, 627), stop('MukogaokaYuen', 18, 630, null)]);
  const result = planNavigation([a, b, c], 'a', 'MukogaokaYuen', 599);
  assert.equal(result.recommendation.transfers, 2); assert.equal(result.recommendation.arrival, 630);
  assert.equal(result.recommendation.legs[1].station, 'Noborito');
  assert.equal(planNavigation([a,b,c],'a','MukogaokaYuen',599,{candidateId:'b'}).recommendation.transfers,2);
});

test('目的駅通過便には途中乗換の到着案を示し、架空の短縮分を付けない', () => {
  const a = { ...trip('rapid', [stop('YoyogiUehara', 4, null, 600), stop('Noborito', 17, 620, null)], 'RapidExpress'), knownPasses: ['MukogaokaYuen'] };
  const b = trip('local', [stop('Noborito', 17, null, 627), stop('MukogaokaYuen', 18, 630, null)]);
  const plan = planNavigation([a, b], 'rapid', 'MukogaokaYuen', 599);
  assert.equal(plan.status, 'TRANSFER_REQUIRED'); assert.equal(plan.baseline, null);
  assert.equal(plan.recommendation.arrival, 630); assert.equal(plan.recommendation.saving, null);
  assert.equal(plan.recommendation.legs[0].station, 'Noborito');
});
test('単に着時刻未取得の列車は、通過確定や短縮ありへ変換しない', () => {
  const a = trip('unknown', [stop('YoyogiUehara', 4, null, 600), stop('Noborito', 17, 620, null)]);
  const b = trip('local', [stop('Noborito', 17, null, 627), stop('MukogaokaYuen', 18, 630, null)]);
  const plan = planNavigation([a, b], 'unknown', 'MukogaokaYuen', 599);
  assert.equal(plan.status, 'ARRIVAL_UNAVAILABLE'); assert.equal(plan.recommendation, null);
  assert.equal(plan.alternatives[0].arrival, 630); assert.equal(plan.alternatives[0].saving, null);
});
