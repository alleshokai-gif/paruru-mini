import { readFile } from 'node:fs/promises';

const ORIGIN = 'https://api-challenge.odpt.org/api/v4/';
const TOKEN_LINE = /^\s*ODPT_CHALLENGE_ACCESS_TOKEN\s*=\s*(['"]?)([^\s'"#]+)\1\s*$/;

// The challenge credential never enters the PWA or the ordinary Bus provider.
export async function readChallengeToken(env = process.env) {
  if (env.ODPT_CHALLENGE_ACCESS_TOKEN) {
    if (/\s/.test(env.ODPT_CHALLENGE_ACCESS_TOKEN)) throw Error('CHALLENGE_CREDENTIAL_INVALID');
    return env.ODPT_CHALLENGE_ACCESS_TOKEN;
  }
  if (!env.PALURU_CHALLENGE_SECRET_FILE) return null;
  const source = await readFile(env.PALURU_CHALLENGE_SECRET_FILE, 'utf8');
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/)
    .filter((line) => /^\s*ODPT_CHALLENGE_ACCESS_TOKEN\s*=/.test(line));
  if (lines.length !== 1) throw Error('CHALLENGE_CREDENTIAL_INVALID');
  const match = TOKEN_LINE.exec(lines[0]);
  if (!match) throw Error('CHALLENGE_CREDENTIAL_INVALID');
  return match[2];
}

export async function fetchChallengeRows(type, { token, fetchImpl = fetch } = {}) {
  if (!token || !['odpt:TrainTimetable', 'odpt:Train'].includes(type))
    throw Error('CHALLENGE_REQUEST_INVALID');
  const url = new URL(`./${type}`, ORIGIN);
  url.searchParams.set('odpt:operator', 'odpt.Operator:JR-East');
  url.searchParams.set('odpt:railway', 'odpt.Railway:JR-East.Nambu');
  url.searchParams.set('acl:consumerKey', token);
  let response;
  try { response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) }); }
  catch { throw Error('CHALLENGE_FETCH_FAILED'); }
  if (!response.ok) throw Error(`CHALLENGE_HTTP_${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error('CHALLENGE_RESPONSE_INVALID');
  return rows;
}
