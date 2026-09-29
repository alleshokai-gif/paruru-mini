// Read-only production/validation smoke. Prints counts, never raw trips, vehicles or coordinates.
import assert from 'node:assert/strict';

const base = String(process.env.BUS_REMOTE_URL || '').replace(/\/$/, '');
assert.match(base, /^https?:\/\/[^/]+(?::\d+)?$/);
const paths = ['/api/bus/hub?id=kibukihoncho', '/api/bus/hub?id=mizonokuchi-minamiguchi',
  '/api/bus/journey?id=noborito-mukougaoka'];
const rows = new Map();
const counts = { kawasaki: { eta: 0, stopSequence: 0, geometry: 0, origin: 0, turnaround: 0 },
  tokyu: { officialEta: 0, staticFallback: 0 } };
const providerStates = new Set();

try {
  const p0 = await fetch(`${base}/api/bus/arrivals`, { headers: { Origin: 'https://alleshokai-gif.github.io' },
    signal: AbortSignal.timeout(30000), cache: 'no-store' });
  assert.equal(p0.status, 200);
  const p0Body = await p0.text();
  assert.doesNotMatch(p0Body, /acl:consumerKey|ODPT_ACCESS_TOKEN|"(?:lat|lon|latitude|longitude|vehicleId)"\s*:/i);
  const p0Data = JSON.parse(p0Body);
  assert.equal(p0Data.positionUiEnabled, false);
  for (const path of paths) {
    const response = await fetch(`${base}${path}`, { headers: { Origin: 'https://alleshokai-gif.github.io' },
      signal: AbortSignal.timeout(30000), cache: 'no-store' });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.doesNotMatch(body, /acl:consumerKey|ODPT_ACCESS_TOKEN|ODPT_CHALLENGE_ACCESS_TOKEN|"(?:lat|lon|latitude|longitude|vehicleId)"\s*:/i);
    const data = JSON.parse(body);
    assert.equal(data.success, true);
    const sources = data.children ? data.children.flatMap((child) => [child, child.decisionGroup]) : [data];
    for (const source of sources) {
      for (const provider of source.providers || []) {
        if (provider && typeof provider === 'object' && provider.provider) {
          providerStates.add(`${provider.provider}:${provider.state}`);
        }
      }
      for (const row of source.arrivals || []) rows.set(`${row.provider}:${row.id}`, row);
    }
  }
  for (const row of rows.values()) {
    if (row.provider === 'kawasaki') {
      if (Number.isInteger(row.etaMinutes)) counts.kawasaki.eta++;
      if (row.position?.supported === true) {
        assert.ok(Number.isInteger(row.position.stopsAway));
        assert.ok(typeof row.position.nextStop === 'string' && row.position.nextStop.length);
        if (row.position.fidelity === 'stop_sequence') counts.kawasaki.stopSequence++;
        else if (row.position.shadowReady === true) counts.kawasaki.geometry++;
        else assert.fail('UNKNOWN_POSITION_FIDELITY');
      }
      if (row.isOrigin === true) {
        counts.kawasaki.origin++;
        assert.ok(typeof row.platform === 'string' && Number.isFinite(row.scheduledDeparture));
        if (['turnaround_candidate', 'likely_turnaround'].includes(row.originNotice)) counts.kawasaki.turnaround++;
      }
    } else if (row.provider === 'tokyu') {
      if (Number.isInteger(row.officialApproach?.waitMinutes)) counts.tokyu.officialEta++;
      else if (row.realtimeState === 'static_only') counts.tokyu.staticFallback++;
    }
  }
  console.log(JSON.stringify({ status: 'PROGRESSIVE_REMOTE_PASS', rows: rows.size,
    ...counts, providerStates: [...providerStates].sort() }));
} catch (error) {
  console.log(JSON.stringify({ status: 'PROGRESSIVE_REMOTE_FAILED', reason:
    error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'REMOTE_READ_FAILED' }));
  process.exitCode = 1;
}
