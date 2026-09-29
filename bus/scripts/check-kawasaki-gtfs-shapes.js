// Read-only official GTFS inventory. Never prints the token, URL, ZIP, or trip IDs.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import source from '../config/static-source.json' with { type: 'json' };
import { readLocalToken } from './local-secret.js';
import { fetchStatic } from '../providers/kawasaki/static-source.js';
import { readZip } from '../providers/kawasaki/static.js';
import { mergeKawasakiStatic } from '../providers/kawasaki/journey-static.js';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
try {
  const bytes = await fetchStatic(readLocalToken(), source.sourceDate);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const index = mergeKawasakiStatic(read('../generated/p0-static.json'),
    read('../generated/kawasaki-p2-5-static.json'));
  if (hash !== index.sourceHash) throw Error('GTFS_STATIC_SOURCE_MISMATCH');
  const selected = new Set(Object.values(index.directions).flat().map(row => row.tripId));
  const count = { allTrips: 0, allWithShapeId: 0, targetTrips: 0, targetWithShapeId: 0,
    shapePoints: 0, uniqueTargetShapeIds: new Set() };
  const seen = readZip(bytes, new Set(['trips', 'shapes', 'feed_info']), (name, columns, values) => {
    if (name === 'shapes') { count.shapePoints++; return; }
    if (name !== 'trips') return;
    const id = values[columns.indexOf('trip_id')];
    const shapeId = columns.includes('shape_id') ? values[columns.indexOf('shape_id')] : '';
    count.allTrips++;
    if (shapeId) count.allWithShapeId++;
    if (!selected.has(id)) return;
    count.targetTrips++;
    if (shapeId) { count.targetWithShapeId++; count.uniqueTargetShapeIds.add(shapeId); }
  });
  if (count.targetTrips !== selected.size || !seen.has('trips')) throw Error('GTFS_TARGET_TRIPS_MISMATCH');
  console.log(JSON.stringify({ status: 'KAWASAKI_GTFS_SHAPES_CHECK', sourceHash: hash,
    shapesTable: seen.has('shapes'), shapePoints: count.shapePoints,
    allTrips: count.allTrips, allWithShapeId: count.allWithShapeId,
    targetTrips: count.targetTrips, targetWithShapeId: count.targetWithShapeId,
    uniqueTargetShapeIds: count.uniqueTargetShapeIds.size }));
} catch (error) {
  const code = /^GTFS_[A-Z_]+$/.test(error?.message || '') ? error.message : 'GTFS_CHECK_UNAVAILABLE';
  console.log(JSON.stringify({ status: 'KAWASAKI_GTFS_SHAPES_FAILED', code }));
  process.exitCode = 1;
}
