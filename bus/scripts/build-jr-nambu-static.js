import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readChallengeToken, fetchChallengeRows } from '../rail/challenge-client.js';
import { buildJrNambuStatic } from '../rail/jr-nambu-static.js';

const output = fileURLToPath(new URL('../generated/rail-nambu-challenge-static.json', import.meta.url));
const token = await readChallengeToken();
if (!token) throw Error('CHALLENGE_CREDENTIAL_UNAVAILABLE');
const rows = await fetchChallengeRows('odpt:TrainTimetable', { token });
const artifact = buildJrNambuStatic(rows);
let previous = null;
try { previous = JSON.parse(await readFile(output, 'utf8')); } catch { /* first build */ }
const key = (train) => `${train.calendarType}:${train.trainNumber}`;
const before = new Map((previous?.trains || []).map((train) => [key(train), train]));
const after = new Map(artifact.trains.map((train) => [key(train), train]));
const added = [...after.keys()].filter((id) => !before.has(id)).length;
const removed = [...before.keys()].filter((id) => !after.has(id)).length;
const changed = [...after].filter(([id, train]) => before.has(id)
  && JSON.stringify(train) !== JSON.stringify(before.get(id))).length;
if (previous && added === 0 && removed === 0 && changed === 0) {
  console.log(JSON.stringify({ status: 'JR_NAMBU_STATIC_UNCHANGED',
    count: artifact.trains.length, outputKind: 'gitignored-server-only' }));
  process.exit(0);
}
await mkdir(dirname(output), { recursive: true });
const temporary = `${output}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
await rename(temporary, output);
console.log(JSON.stringify({ status: 'JR_NAMBU_STATIC_BUILT', count: artifact.trains.length,
  weekday: artifact.trains.filter((train) => train.calendarType === 'weekday').length,
  weekend: artifact.trains.filter((train) => train.calendarType === 'weekend').length,
  added, removed, changed, outputKind: 'gitignored-server-only' }));
