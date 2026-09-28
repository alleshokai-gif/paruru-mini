// Offline update tool. Runtime and Preview only read the generated Static file.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChallengeToken } from '../rail/challenge-client.js';
import { buildOdakyuStatic, extractOdakyuDetail, extractOdakyuDetailLinks,
  ODAKYU_IDS } from '../rail/odakyu-static.js';

const OUTPUT = fileURLToPath(new URL('../generated/rail-odakyu-static.json', import.meta.url));
const SOURCE = 'https://transfer.navitime.biz/odakyu-transit/smart/diagram/Search'
  + '?startId=00001803&linkId=00000686&direction=up&nodeType=train&initDispWeekdayTab=weekday';
const CHALLENGE = 'https://api-challenge.odpt.org/api/v4/odpt:StationTimetable';
const MAX_DETAILS = 160; // Bounded to the user's two calendars, after 12:00 only.

async function readHtml(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`ODAKYU_PUBLIC_HTTP_${response.status}`);
  return response.text();
}

const token = await readChallengeToken();
if (!token) throw Error('CHALLENGE_CREDENTIAL_UNAVAILABLE');
const challengeUrl = new URL(CHALLENGE);
challengeUrl.searchParams.set('odpt:operator', ODAKYU_IDS.operator);
challengeUrl.searchParams.set('odpt:station', ODAKYU_IDS.station);
challengeUrl.searchParams.set('acl:consumerKey', token);
let response;
try { response = await fetch(challengeUrl, { signal: AbortSignal.timeout(20000) }); }
catch { throw Error('CHALLENGE_FETCH_FAILED'); }
if (!response.ok) throw Error(`CHALLENGE_HTTP_${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows)) throw Error('CHALLENGE_RESPONSE_INVALID');
const links = extractOdakyuDetailLinks(await readHtml(SOURCE));
if (links.length > MAX_DETAILS) throw Error('ODAKYU_DETAIL_LIMIT_EXCEEDED');
const details = new Array(links.length);
let next = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (next < links.length) {
    const index = next++;
    details[index] = extractOdakyuDetail(await readHtml(links[index].url), links[index]);
  }
}));
const artifact = buildOdakyuStatic(rows, details);
let previous = null;
try { previous = JSON.parse(await readFile(OUTPUT, 'utf8')); } catch { /* first build */ }
const key = (train) => `${train.calendarType}:${train.sourceDeparture}`;
const before = new Map((previous?.trains || []).map((train) => [key(train), train]));
const after = new Map(artifact.trains.map((train) => [key(train), train]));
const added = [...after.keys()].filter((id) => !before.has(id)).length;
const removed = [...before.keys()].filter((id) => !after.has(id)).length;
const changed = [...after].filter(([id, train]) => before.has(id)
  && JSON.stringify(train) !== JSON.stringify(before.get(id))).length;
if (previous && added === 0 && removed === 0 && changed === 0) {
  console.log(JSON.stringify({ status: 'ODAKYU_STATIC_UNCHANGED', count: artifact.trains.length,
    outputKind: 'gitignored-preview-only' }));
  process.exit(0);
}
await mkdir(dirname(OUTPUT), { recursive: true });
const temporary = `${OUTPUT}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
await rename(temporary, OUTPUT);
console.log(JSON.stringify({ status: 'ODAKYU_STATIC_BUILT', count: artifact.trains.length,
  weekday: artifact.trains.filter((train) => train.calendarType === 'weekday').length,
  weekend: artifact.trains.filter((train) => train.calendarType === 'weekend').length,
  skippedTerminating: artifact.sourceMetadata.skippedTerminating.length,
  added, removed, changed, outputKind: 'gitignored-preview-only' }));
