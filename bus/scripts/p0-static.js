import { validDate, validateP0Static, validateArtifact, sha256, configHash } from '../runtime/static-artifact.js';
export { validateP0Static, validateArtifact, sha256, configHash } from '../runtime/static-artifact.js';
const fail = (code) => { throw Error(code); };
// Build-time validation and atomic publishing. Never imported by Worker/UI.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { FAVORITES } from '../config/settings.js';
import { P0_QUERIES } from '../config/queries.js';
import { parseStatic } from '../providers/kawasaki/static.js';
import { iso } from '../core/arrivals.js';

export function buildP0Static(bytes, { now, sourceDate }) {
  if (!validDate(sourceDate)) fail('STATIC_SOURCE_DATE');
  const index = validateP0Static(parseStatic(bytes, now, P0_QUERIES));
  return { artifactVersion: 1, generatedAt: iso(now), sourceDate, sourceVersion: index.feedInfo.feed_version,
    sourceHash: sha256(bytes), configHash: configHash(), directionConfig: FAVORITES, ...index };
}
export function publishStatic(index, output, { beforeReplace = () => {} } = {}) {
  validateArtifact(index, index.sourceDate);
  const text = JSON.stringify(index) + '\n';
  const folder = dirname(output); mkdirSync(folder, { recursive: true });
  const temporary = join(folder, `${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, text, { flag: 'wx', encoding: 'utf8', flush: true });
    validateArtifact(JSON.parse(readFileSync(temporary, 'utf8')), index.sourceDate);
    beforeReplace();
    // Snapshot each previous artifact, so repeated builds do not overwrite the rollback copy.
    if (existsSync(output)) copyFileSync(output, join(folder, `previous-${sha256(readFileSync(output)).slice(0, 16)}.json`));
    renameSync(temporary, output);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  return { bytes: Buffer.byteLength(text), sha256: sha256(text), counts: index.stats.selectedRows };
}
