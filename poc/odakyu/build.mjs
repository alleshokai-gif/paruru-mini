import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { latest, DATA_DIR } from './storage.mjs';
import { normalize } from './core.mjs';
import { reconstructTrips } from './reconstruct.mjs';
import { planNavigation } from './navigation.mjs';

const [t, r, s] = await Promise.all(['StationTimetable', 'Railway', 'Station'].map(latest));
const model = normalize(t.rows, r.rows, s.rows, t.fetchedAt);
const providerBytes = await readFile(new URL('../../bus/release-static/kazu-commute-static.json', import.meta.url));
const reconstructed = reconstructTrips(JSON.parse(providerBytes), model);
model.trips = reconstructed.trips;
model.reconstruction = reconstructed.report;
model.providerArtifactSha256 = createHash('sha256').update(providerBytes).digest('hex');
let example = null;
try {
  const reference = JSON.parse(await readFile(new URL('navigation-reference.json', DATA_DIR), 'utf8'));
  if (model.trips.some(t => t.id === reference.selectedId)) example = reference;
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const results = example ? Object.fromEntries(['Noborito', 'MukogaokaYuen'].map(destination =>
  [destination, planNavigation(model.trips, example.selectedId, destination, example.compareAt)])) : null;
for (const [name, value] of [['model.json', model], ['analysis.json', { report: reconstructed.report, results, exampleAvailable: Boolean(example) }]]) {
  await writeFile(new URL(name + '.tmp', DATA_DIR), JSON.stringify(value, null, 2));
  await rename(new URL(name + '.tmp', DATA_DIR), new URL(name, DATA_DIR));
}
console.log(JSON.stringify({ departures: model.departures.length, providerTrains: model.trips.length,
  checkedDepartures: reconstructed.report.departureChecks, rejected: reconstructed.report.rejected,
  exampleAvailable: Boolean(example), comparisonStatus: results ? Object.fromEntries(Object.entries(results).map(([key, result]) => [key, result.status])) : null }));
