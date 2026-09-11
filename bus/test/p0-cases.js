// Synthetic P0 regression cases. Expected DTO hashes were recorded before the P1 refactor.
import { NOW, indexFixture, realtimeFixture } from './fixtures.js';
export function p0Cases() {
  const cases = [];
  const add = (name, edit = () => {}) => {
    const input = { index: indexFixture(), realtime: realtimeFixture(), now: NOW };
    for (const [id, rows] of Object.entries(input.index.directions)) {
      input.index.directions[id] = [0, 1, 2].map((i) => ({ ...rows[0],
        tripId: i ? `${rows[0].tripId}-${i}` : rows[0].tripId, scheduledSeconds: rows[0].scheduledSeconds + i * 600 }));
    }
    edit(input); cases.push({ name, input });
  };
  add('realtime');
  add('static', i => { i.realtime = null; });
  add('delay_only_zero', i => { i.realtime = realtimeFixture({ time: null, delay: 0 }); });
  add('missing_prediction', i => { i.realtime = realtimeFixture({ time: null, delay: null }); });
  add('stale_feed', i => { i.realtime.timestamp = NOW - 121; });
  add('stale_trip', i => { i.realtime.updates[0].timestamp = NOW - 181; });
  add('fetch_error', i => { i.fetchError = true; });
  add('static_stale', i => { i.realtime = null; i.staticStale = true; });
  add('past_eta', i => { i.now = NOW + 600; i.realtime = realtimeFixture({ timestamp: i.now }); });
  add('origin_prediction_pending', i => {
    i.now = NOW + 600; i.realtime = realtimeFixture({ timestamp: i.now });
    i.realtime.vehicles.push({ trip: i.realtime.updates[0].trip, timestamp: i.now, stopId: '184_2', sequence: 1, status: 1 });
  });
  add('reordered', i => { i.index.directions.home_to_noborito[1].scheduledSeconds = 28500; });
  add('cancelled', i => { i.realtime = realtimeFixture({ relationship: 3 }); });
  add('previous_service_day', i => { i.now = Date.parse('2026-09-11T00:50:00+09:00') / 1000;
    i.realtime = null; i.index.directions.home_to_noborito[0].scheduledSeconds = 90000; });
  return cases;
}
