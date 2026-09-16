// Offline promotion only. Runtime never downloads OSM, MLIT, GTFS or GPS captures.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { buildApprovedPositionShadowBundle, validateApprovedPositionShadowBundle }
  from '../observation/position-shadow-geometry.js';

const roadPath = new URL('../generated/road-geometry-home-to-noborito.json', import.meta.url);
const staticPath = new URL('../generated/p1-position-static.json', import.meta.url);
const outputPath = new URL('../observation/position-shadow-geometry.json', import.meta.url);
const temporaryPath = new URL(`../observation/.${randomUUID()}.position-shadow.tmp`, import.meta.url);

try {
  const roadArtifact = JSON.parse(readFileSync(roadPath, 'utf8'));
  const positionStatic = JSON.parse(readFileSync(staticPath, 'utf8'));
  const bundle = buildApprovedPositionShadowBundle({ roadArtifact, positionStatic });
  validateApprovedPositionShadowBundle(bundle, positionStatic);
  const text = `${JSON.stringify(bundle, null, 2)}\n`;
  writeFileSync(temporaryPath, text, { flag: 'wx', encoding: 'utf8', flush: true });
  validateApprovedPositionShadowBundle(JSON.parse(readFileSync(temporaryPath, 'utf8')), positionStatic);
  renameSync(temporaryPath, outputPath);
  const source = bundle.sources[0], chain = Object.values(source.chains)[0];
  console.log(JSON.stringify({ status: 'POSITION_SHADOW_GEOMETRY_PASS',
    sourceVersion: source.sourceVersion, approvalVersion: source.approvalVersion,
    approvedForShadow: source.approvedForShadow, approvedForPublic: source.approvedForPublic,
    geometryReady: source.geometryReady, points: chain.points.length,
    gaps: source.validation.gapCount, stops: chain.stopProjections.length,
    selfIntersections: source.validation.selfIntersectionCount }));
} catch (error) {
  const allow = new Set(['SHADOW_GEOMETRY_SOURCE_INVALID', 'SHADOW_GEOMETRY_PROVENANCE_INVALID',
    'SHADOW_GEOMETRY_VALIDATION_INVALID', 'SHADOW_GEOMETRY_STOP_PROJECTION_INVALID',
    'SHADOW_GEOMETRY_CORRIDOR_INVALID', 'SHADOW_GEOMETRY_SELF_INTERSECTION',
    'POSITION_SHADOW_BUNDLE_INVALID']);
  console.log(JSON.stringify({ status: 'POSITION_SHADOW_GEOMETRY_FAILED',
    code: allow.has(error?.message) ? error.message : 'POSITION_SHADOW_BUILD_UNAVAILABLE' }));
  process.exitCode = 1;
} finally {
  if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
}
