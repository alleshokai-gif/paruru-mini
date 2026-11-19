import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFile, stat, rename, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import poc from '../../features/shopping/supermarket-poc.js';

export const INDEX = 'https://ok-corporation.jp/flyer/';
const ROBOTS = 'https://ok-corporation.jp/robots.txt';
const USER_AGENT = 'PALURU-Supermarket-PoC/1.0';
const LIMIT = 256 * 1024;
const STORE = 'ok';
const sha = data => createHash('sha256').update(data).digest('hex');
const publisherPdf = s => /^https:\/\/ok-corporation\.jp\/media-download\/\d+\/[a-f0-9]+\/PDF\/$/.test(s);
const jsonLimit = async (p, max) => {
  if ((await stat(p)).size > max) throw new Error('INPUT_TOO_LARGE');
  return JSON.parse(await readFile(p, 'utf8'));
};

export function openDb(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA busy_timeout=2000;
    CREATE TABLE IF NOT EXISTS status (store TEXT PRIMARY KEY, day TEXT NOT NULL, state TEXT NOT NULL,
      source TEXT, evidence_id TEXT, error TEXT);
    CREATE TABLE IF NOT EXISTS editions (evidence_id TEXT PRIMARY KEY, store TEXT NOT NULL, source TEXT NOT NULL,
      from_day TEXT NOT NULL, until_day TEXT NOT NULL, obtained_at TEXT NOT NULL, offers TEXT NOT NULL);`);
  return db;
}

export function identifyEdition(html) {
  const match = html.match(/【関東】商品情報紙[^<]*<\/h3>([\s\S]*?)(?=<h3\b|$)/i);
  const pdf = match?.[1].match(/href="(https:\/\/ok-corporation\.jp\/media-download\/\d+\/[a-f0-9]+\/PDF\/)"/i)?.[1];
  // Fail closed if the current known distribution note changes.
  if (!pdf || !publisherPdf(pdf) || !/※清瀬店は除きます。/.test(match[1])) throw new Error('INDEX_FORMAT_OR_SCOPE_CHANGED');
  return { source: pdf, id: sha(pdf) };
}

async function get(url, fetcher) {
  const result = await fetcher(url, {
    method:'GET', redirect:'error', signal:AbortSignal.timeout(12000),
    headers:{'User-Agent': USER_AGENT, 'Accept':'text/html, text/plain;q=0.9'}
  });
  if (url === ROBOTS && [404,410].includes(result.status)) {
    if (result.body) await result.body.cancel();
    return '';
  }
  if (!result.ok) {
    if (result.body) await result.body.cancel();
    throw new Error('HTTP_' + result.status);
  }
  if (!/^text\/(html|plain)(?:[;\s]|$)/i.test(result.headers.get('content-type') || '')) {
    if (result.body) await result.body.cancel();
    throw new Error('CONTENT_TYPE');
  }
  let bytes = 0; const chunks = [];
  for await (const block of result.body) {
    bytes += block.length;
    if (bytes > LIMIT) throw new Error('BODY_LIMIT');
    chunks.push(Buffer.from(block));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function collect(db, date, fetcher = fetch) {
  const set = db.prepare('INSERT OR REPLACE INTO status VALUES (?, ?, ?, ?, ?, ?)');
  for (const store of Object.keys(poc.stores).filter(id => id !== STORE)) set.run(store, date, 'held', null, null, 'NOT_ENABLED');
  const previous = db.prepare('SELECT * FROM status WHERE store=?').get(STORE);
  try {
    // For the PoC any nonempty Robots policy means manual re-evaluation.
    const robots = await get(ROBOTS, fetcher);
    if (robots.trim()) throw new Error('ROBOTS_POLICY_REVIEW_REQUIRED');
    const edition = identifyEdition(await get(INDEX, fetcher));
    const loaded = db.prepare('SELECT until_day FROM editions WHERE evidence_id=?').get(edition.id);
    const state = loaded ? (loaded.until_day < date ? 'expired' : previous?.evidence_id === edition.id ? 'unchanged' : 'checked') : 'needs_review';
    set.run(STORE, date, state, edition.source, edition.id, null);
  } catch (error) {
    const code = /^(HTTP_\d{3}|CONTENT_TYPE|BODY_LIMIT|ROBOTS_POLICY_REVIEW_REQUIRED|INDEX_FORMAT_OR_SCOPE_CHANGED)$/.test(error.message)
      ? error.message : error.name === 'TimeoutError' ? 'TIMEOUT' : 'REQUEST_FAILED';
    set.run(STORE, date, 'failed', null, null, code);
  }
  return snapshot(db, date);
}

function realDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function verifyImport(db, edition) {
  const current = db.prepare('SELECT * FROM status WHERE store=?').get(STORE);
  if (edition?.store !== STORE || !current?.source || current.source !== edition.source || !publisherPdf(edition.source) ||
      !realDay(edition.from) || !realDay(edition.until) || edition.from > current.day || edition.until < current.day ||
      (Date.parse(edition.until) - Date.parse(edition.from)) / 86400000 > 14 ||
      !Array.isArray(edition.offers) || !edition.offers.length || edition.offers.length > 50) throw new Error('INVALID_EDITION');
  for (const o of edition.offers) {
    if (![o.title,o.spec,o.unit,o.conditions].every(v => typeof v === 'string' && v.trim() && v.length <= 160) ||
        !Number.isInteger(o.net_yen) || o.net_yen < 1 || o.net_yen > 100000 ||
        !Number.isInteger(o.tax_included_sen) || o.tax_included_sen < o.net_yen * 100 ||
        !['weekly_information','special'].includes(o.kind)) throw new Error('INVALID_OFFER');
  }
  if (new Set(edition.offers.map(o => o.title + '\0' + o.unit + '\0' + o.conditions)).size !== edition.offers.length) {
    throw new Error('DUPLICATE_OFFER');
  }
  const offers = edition.offers.map(({title,spec,unit,net_yen,tax_included_sen,conditions,kind}) =>
    ({title,spec,unit,net_yen,tax_included_sen,conditions,kind,confidence:'visually_verified'}));
  const normalized = JSON.stringify(offers);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db.prepare('SELECT * FROM editions WHERE evidence_id=?').get(current.evidence_id);
    if (existing && (existing.from_day !== edition.from || existing.until_day !== edition.until || existing.offers !== normalized)) {
      throw new Error('EDITION_CONFLICT');
    }
    if (!existing) {
      db.prepare('INSERT INTO editions VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(current.evidence_id, STORE, edition.source, edition.from, edition.until, new Date().toISOString(), normalized);
    }
    db.prepare("UPDATE status SET state=?, error=NULL WHERE store=? AND evidence_id=?")
      .run(existing ? 'unchanged' : 'checked', STORE, current.evidence_id);
    db.exec('COMMIT');
    return { duplicate: !!existing, offers: offers.length };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function snapshot(db, date) {
  const stateRows = db.prepare('SELECT * FROM status WHERE day=? ORDER BY store').all(date);
  const states = Object.fromEntries(stateRows.map(o => [o.store, o.state]));
  const sources = stateRows.map(({store,state,source,error}) => ({store,state,source,error}));
  const offers = db.prepare(`SELECT e.* FROM editions e JOIN status s USING(evidence_id)
    WHERE s.day=? AND s.state IN ('checked','unchanged') AND e.from_day<=? AND e.until_day>=?`).all(date,date,date)
    .flatMap(e => JSON.parse(e.offers).map(o => ({...o,store:e.store,source:e.source,from:e.from_day,until:e.until_day,obtained_at:e.obtained_at})));
  return {schema:1,date,states,sources,offers};
}

async function main() {
  const [command, dbFile, arg] = process.argv.slice(2);
  if (!['collect','verified-import','export'].includes(command) || !dbFile || (command !== 'collect' && !arg)) {
    throw new Error('Usage: collector.mjs collect <db> | verified-import <db> <review.json> | export <db> <output.json>');
  }
  if (command === 'collect') {
    // Existing task runner may invoke once daily; prevent overlapping store GETs globally for this database.
    const lock = await import('node:fs/promises').then(fs => fs.open(dbFile + '.collect.lock', 'wx', 0o600));
    try {
      const db = openDb(dbFile);
      try { const r = await collect(db, poc.dayTokyo()); console.log(JSON.stringify(r.sources)); }
      finally { db.close(); }
    } finally {
      await lock.close();
      await import('node:fs/promises').then(fs => fs.unlink(dbFile + '.collect.lock'));
    }
    return;
  }
  const db = openDb(dbFile);
  try {
    if (command === 'verified-import') console.log(JSON.stringify(verifyImport(db, await jsonLimit(arg, LIMIT))));
    if (command === 'export') {
      const temp = arg + '.' + randomUUID() + '.tmp';
      await writeFile(temp, JSON.stringify(snapshot(db, poc.dayTokyo())), { mode:0o600 });
      await rename(temp, arg);
    }
  } finally { db.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  main().catch(e => { console.error(e.code || e.message); process.exitCode = 1; });
}
