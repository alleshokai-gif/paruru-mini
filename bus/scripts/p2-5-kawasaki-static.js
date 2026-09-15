import { randomUUID, createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseStatic } from '../providers/kawasaki/static.js';
import { KAWASAKI_JOURNEY_QUERIES } from '../providers/kawasaki/journey-config.js';
import { validateKawasakiJourneyArtifact } from '../providers/kawasaki/journey-static.js';
import { iso } from '../core/arrivals.js';

const fail = (code) => { throw new Error(code); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function buildP2_5KawasakiStatic(bytes, { sourceDate, now }) {
  const index = parseStatic(bytes, now, KAWASAKI_JOURNEY_QUERIES);
  const artifact = { artifactVersion: 1, generatedAt: iso(now), sourceDate,
    sourceVersion: index.feedInfo.feed_version, sourceHash: sha256(bytes),
    queryHash: sha256(JSON.stringify(KAWASAKI_JOURNEY_QUERIES)), ...index };
  return validateKawasakiJourneyArtifact(artifact, sourceDate);
}

export function publishP2_5KawasakiStatic(index, output) {
  validateKawasakiJourneyArtifact(index, index.sourceDate);
  const folder = dirname(output), temporary = join(folder, `${randomUUID()}.tmp`);
  mkdirSync(folder, { recursive: true });
  try {
    writeFileSync(temporary, `${JSON.stringify(index)}\n`, { encoding: 'utf8', flag: 'wx', flush: true });
    validateKawasakiJourneyArtifact(JSON.parse(readFileSync(temporary, 'utf8')), index.sourceDate);
    if (existsSync(output)) copyFileSync(output, join(folder, `previous-journey-${index.sourceHash.slice(0, 16)}.json`));
    renameSync(temporary, output);
    return { output, bytes: readFileSync(output).length };
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    if (/^BUS_[A-Z0-9_]+$/.test(error?.message || '')) throw error;
    fail('BUS_KAWASAKI_JOURNEY_PUBLISH_FAILED');
  }
}
