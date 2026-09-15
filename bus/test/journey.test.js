import test from 'node:test';
import assert from 'node:assert/strict';
import { JOURNEYS, NOBORITO_MUKOUGAOKA_JOURNEY } from '../journey/config.js';
import { createJourneyService } from '../journey/service.js';

const NOW = 1_789_260_000;
const arrival = (id, provider, seconds) => ({ id, provider, routeId: `${provider}-route`, routeLabel: provider === 'tokyu' ? '向０１' : '登０５',
  destination: provider === 'tokyu' ? '梶が谷駅' : '生田緑地入口', platform: provider === 'tokyu' ? '6' : '1番',
  scheduledDeparture: NOW + seconds, estimatedDeparture: provider === 'tokyu' ? null : NOW + seconds,
  effectiveDeparture: null, etaMinutes: provider === 'tokyu' ? null : Math.round(seconds / 60), delayMinutes: null,
  realtimeState: provider === 'tokyu' ? 'static_only' : 'realtime', departureState: 'scheduled', actionability: null,
  confidence: null, recommendable: true, recommendationQuality: provider === 'tokyu' ? 'static_only' : 'realtime',
  rankingBasis: provider === 'tokyu' ? 'scheduled_departure' : 'eta', rankingTime: NOW + seconds,
  position: { supported: false, state: null, stopsAway: null, previousStop: null, nextStop: null, confidence: null } });

function hub(id) {
  const noborito = id === 'noborito-eki';
  const arrivals = noborito ? [arrival('n1', 'kawasaki', 300), arrival('n2', 'kawasaki', 600), arrival('n3', 'kawasaki', 900)]
    : [arrival('m1', 'kawasaki', 240), arrival('m2', 'tokyu', 360), arrival('m3', 'kawasaki', 720)];
  const groupId = noborito ? 'noborito_kibukihoncho' : 'mukougaoka_kibukihoncho';
  return { success: true, hubId: id, generatedAt: NOW, providers: [], attributions: [],
    decisionGroups: [{ id: groupId, recommendedArrivalId: arrivals[0].id, arrivals }] };
}

test('Journey config has two independently ranked child Hubs and no cross-card recommendation', () => {
  assert.deepEqual(JOURNEYS, [NOBORITO_MUKOUGAOKA_JOURNEY]);
  assert.equal(NOBORITO_MUKOUGAOKA_JOURNEY.label, '登戸・遊園');
  assert.deepEqual(NOBORITO_MUKOUGAOKA_JOURNEY.children.map((row) => row.hubId),
    ['noborito-eki', 'mukougaoka-yuen-minamiguchi']);
  assert.ok(NOBORITO_MUKOUGAOKA_JOURNEY.children.every((row) => row.purposeLabel === '神木本町方面'));
  assert.equal(Object.hasOwn(NOBORITO_MUKOUGAOKA_JOURNEY, 'recommendedChildId'), false);
});

test('Journey service preserves each child next-three order and Provider mixture', async () => {
  const known = new Set(NOBORITO_MUKOUGAOKA_JOURNEY.children.map((row) => row.hubId));
  const service = createJourneyService({ journeys: JOURNEYS, now: () => NOW,
    hubService: { hasHub: (id) => known.has(id), getHub: async (id) => hub(id) } });
  const value = await service.getJourney('noborito-mukougaoka');
  assert.equal(value.success, true); assert.equal(value.journeyGroupLabel, '登戸・遊園');
  assert.equal(value.children.length, 2); assert.ok(value.children.every((row) => row.decisionGroup.arrivals.length === 3));
  assert.deepEqual(value.children[0].decisionGroup.arrivals.map((row) => row.id), ['n1', 'n2', 'n3']);
  assert.deepEqual([...new Set(value.children[1].decisionGroup.arrivals.map((row) => row.provider))], ['kawasaki', 'tokyu']);
  assert.equal(Object.hasOwn(value, 'recommendedChildId'), false);
  assert.equal(service.hasJourney('unknown'), false);
  await assert.rejects(service.getJourney('unknown'), /BUS_JOURNEY_NOT_FOUND/);
});

test('Journey service isolates one child Hub failure', async () => {
  const service = createJourneyService({ journeys: JOURNEYS, now: () => NOW,
    hubService: { hasHub: () => true, async getHub(id) { if (id === 'noborito-eki') throw Error('private'); return hub(id); } } });
  const value = await service.getJourney('noborito-mukougaoka');
  assert.equal(value.children[0].state, 'unavailable'); assert.equal(value.children[0].decisionGroup, null);
  assert.equal(value.children[1].state, 'available'); assert.equal(value.children[1].decisionGroup.arrivals.length, 3);
});
