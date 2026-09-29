import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokyuApproachSource, parseTokyuApproaches, withTokyuApproaches } from '../providers/tokyu/approach.js';
import { KIBUKIHONCHO_TO_MUKOUGAOKA } from '../providers/tokyu/config.js';
import { KIBUKIHONCHO_HUB } from '../hub/config.js';
import { aggregateHub } from '../hub/aggregator.js';

const NOW = Date.parse('2026-09-29T09:21:30+09:00') / 1000;
const stop = (name, selected = false) => `<tr class="trOdd${selected ? 'Select' : ''}"><td class="stopName">${name}</td></tr>`;
const bus = (label, side = 'balloonR') => `<tr class="trEven"><td class="${side}"><dl><dt><img alt="バス"></dt><dd>${label}<em></em></dd></dl></td></tr>`;
const segment = () => '<tr class="trEven"><td class="balloonL">&nbsp;</td><td class="balloonR">&nbsp;</td></tr>';

function html({ label = '向丘駅行 05分待ち', extra = '', time = '09:21', route = '向01' } = {}) {
  return `<h3>${route}</h3><div>${time}時点の情報</div><table class="routeListTbl"><tbody>
    ${stop('梶が谷駅')}${bus(label)}${stop('姿見台')}${segment()}${stop('笹の原交差点')}
    ${segment()}${stop('向丘南原')}${segment()}${stop('神木天満宮')}${extra}${segment()}
    ${stop('神木本町', true)}${segment()}${stop('神木不動')}
    </tbody></table>`;
}

function row() {
  const q = KIBUKIHONCHO_TO_MUKOUGAOKA;
  return { id: 'tokyu:scheduled:1', sourceId: q.sourceId, provider: 'tokyu', routeId: q.routeId,
    routeLabel: q.routeLabel, destination: q.destinationName,
    originStop: { id: q.fromStopId, name: q.fromStopName },
    targetStop: { id: q.fromStopId, name: q.fromStopName },
    scheduledDeparture: NOW + 180, estimatedDeparture: null, effectiveDeparture: null,
    etaMinutes: null, delayMinutes: null, platform: q.platform, realtimeState: 'static_only',
    departureState: 'scheduled', actionability: null, confidence: null, position: { supported: false } };
}

test('official approach is independent of the scheduled trip and survives Hub DTO normalization', () => {
  const approaches = parseTokyuApproaches(html(), NOW);
  const official = approaches[KIBUKIHONCHO_TO_MUKOUGAOKA.sourceId];
  assert.deepEqual(official, { matchedTripId: null, uniqueNext: true,
    sourceId: KIBUKIHONCHO_TO_MUKOUGAOKA.sourceId, routeLabel: '向０１',
    destination: '向ヶ丘遊園駅南口', boardingStopId: KIBUKIHONCHO_TO_MUKOUGAOKA.fromStopId,
    waitMinutes: 5, stopsAwayMin: 4, stopsAwayMax: 5,
    retrievedAt: Date.parse('2026-09-29T09:21:00+09:00') / 1000 });
  const enriched = withTokyuApproaches({ provider: 'tokyu', arrivals: [row()] }, approaches);
  const result = aggregateHub({ hub: KIBUKIHONCHO_HUB, generatedAt: NOW, providerResults: [
    { provider: 'kawasaki', arrivals: [] }, enriched
  ] });
  const arrival = result.decisionGroups[0].arrivals[0];
  assert.deepEqual(arrival.officialApproach, official);
  assert.equal(arrival.realtimeState, 'static_only');
  assert.equal(arrival.etaMinutes, null);
  assert.equal(arrival.delayMinutes, null);
  assert.equal(arrival.scheduledDeparture, NOW + 180);
  assert.equal(arrival.position.supported, false);
  assert.ok(!JSON.stringify(result).includes('PC_00.png'));
  const stale = aggregateHub({ hub: KIBUKIHONCHO_HUB, generatedAt: NOW + 181, providerResults: [
    { provider: 'kawasaki', arrivals: [] }, enriched
  ] });
  assert.equal(stale.decisionGroups[0].arrivals[0].officialApproach, undefined);
  assert.equal(stale.decisionGroups[0].arrivals[0].realtimeState, 'static_only');
});

test('official ETA survives coarse position and multiple vehicles, while wrong route or missing ETA does not', () => {
  assert.equal(parseTokyuApproaches(html({ time: '09:19' }), NOW)
    [KIBUKIHONCHO_TO_MUKOUGAOKA.sourceId].waitMinutes, 5);
  assert.deepEqual(parseTokyuApproaches(html({ time: '09:17' }), NOW), {});
  assert.deepEqual(parseTokyuApproaches(html({ route: '向02' }), NOW), {});
  assert.deepEqual(parseTokyuApproaches(html({ label: '(折)向丘駅行 05分待ち' }), NOW), {});
  assert.deepEqual(parseTokyuApproaches(html({ label: '向丘駅行' }), NOW), {});
  const next = parseTokyuApproaches(html({ extra: bus('向丘駅行 07分待ち') }), NOW)
    [KIBUKIHONCHO_TO_MUKOUGAOKA.sourceId];
  assert.equal(next.waitMinutes, 5);
  assert.equal(next.uniqueNext, true);
  const tied = parseTokyuApproaches(html({ extra: bus('向丘駅行 05分待ち') }), NOW)
    [KIBUKIHONCHO_TO_MUKOUGAOKA.sourceId];
  assert.equal(tied.waitMinutes, 5);
  assert.equal(tied.uniqueNext, false);
  assert.equal(tied.stopsAwayMin, null);
  assert.deepEqual(parseTokyuApproaches(html().replace('神木本町', '別の停留所'), NOW), {});
});

test('opposite direction uses the official left-side bus block without trip matching', () => {
  const north = html().replace(`${stop('神木本町', true)}${segment()}`,
    `${stop('神木本町', true)}${bus('梶谷駅行 07分待ち', 'balloonL')}`);
  const approaches = parseTokyuApproaches(north, NOW);
  assert.equal(approaches.kibukihoncho_to_kajigaya.waitMinutes, 7);
  assert.equal(approaches.kibukihoncho_to_kajigaya.stopsAwayMax, 1);
  assert.equal(approaches.kibukihoncho_to_kajigaya.matchedTripId, null);
});

test('official fetch failure preserves Static, and bounded cache prevents repeated requests', async () => {
  let calls = 0;
  const source = createTokyuApproachSource({ now: () => NOW, fetcher: async () => {
    calls++;
    throw Error('network details are never exposed');
  } });
  assert.deepEqual(await source.getApproaches(), {});
  assert.deepEqual(await source.getApproaches(), {});
  assert.equal(calls, 1);
  assert.deepEqual(withTokyuApproaches({ provider: 'tokyu', arrivals: [row()] }, {}).arrivals[0].officialApproach, null);
  const success = createTokyuApproachSource({ now: () => NOW, fetcher: async () => {
    calls++;
    return new Response(html(), { headers: { 'content-type': 'text/html; charset=UTF-8' } });
  } });
  assert.equal((await success.getApproaches())[KIBUKIHONCHO_TO_MUKOUGAOKA.sourceId].waitMinutes, 5);
  assert.equal(calls, 2);
});
