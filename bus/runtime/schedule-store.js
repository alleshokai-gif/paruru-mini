import { createHash } from 'node:crypto';

export const PROVIDERS = ['kawasaki', 'tokyu', 'seibu'];
export const sha = value => createHash('sha256').update(value).digest('hex');
export const jstDate = ms => new Date(ms + 32400000).toISOString().slice(0,10).replaceAll('-', '');
export const effectiveAt = date => Date.parse(date.replace(/^(\d{4})(\d\d)(\d\d)$/, '$1-$2-$3') + 'T00:00:00+09:00');
const tokenUrl = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
export const stateKey = provider => `schedules/v1/${provider}/state.json`;
export const objectKey = (provider, hash) => `schedules/v1/${provider}/${hash}.json`;

export function createScheduleStore(bucket, fetcher = fetch) {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw Error('SCHEDULE_BUCKET_INVALID');
  const base = 'https://storage.googleapis.com';
  let token, expires = 0, pending;
  async function authorization() {
    if (expires > Date.now() + 30000) return token;
    if (!pending) pending = (async () => {
      const r = await fetcher(tokenUrl, { headers: { 'Metadata-Flavor':'Google' }, signal: AbortSignal.timeout(2500), redirect:'error' });
      if (!r.ok) throw Error('SCHEDULE_AUTH');
      const data = await r.json();
      if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in)) throw Error('SCHEDULE_AUTH');
      token = data.access_token; expires = Date.now() + data.expires_in * 1000;
      return token;
    })().finally(() => { pending = null; });
    return pending;
  }
  return {
    async read(key, maxBytes = 32 * 1024 * 1024) {
      const r = await fetcher(`${base}/storage/v1/b/${bucket}/o/${encodeURIComponent(key)}?alt=media`,
        { headers:{ Authorization:`Bearer ${await authorization()}` }, signal:AbortSignal.timeout(8000), redirect:'error' });
      if (r.status === 404) return { generation:'0', body:null };
      if (!r.ok) throw Error('SCHEDULE_STORAGE_READ');
      const generation = r.headers.get('x-goog-generation');
      const chunks = []; let size = 0;
      for await (const chunk of r.body) {
        size += chunk.length;
        if (size > maxBytes) throw Error('SCHEDULE_STORAGE_SIZE');
        chunks.push(chunk);
      }
      return { generation, body:Buffer.concat(chunks).toString('utf8') };
    },
    async write(key, body, generation) {
      if (!/^\d+$/.test(generation ?? '')) throw Error('SCHEDULE_GENERATION_MISSING');
      const query = new URLSearchParams({ uploadType:'media', name:key, ifGenerationMatch:generation });
      const r = await fetcher(`${base}/upload/storage/v1/b/${bucket}/o?${query}`, {
        method:'POST', headers:{ Authorization:`Bearer ${await authorization()}`, 'Content-Type':'application/json' },
        body, signal:AbortSignal.timeout(20000), redirect:'error' });
      await r.body?.cancel();
      if (r.status === 412) return false;
      if (!r.ok) throw Error('SCHEDULE_STORAGE_WRITE');
      return true;
    }
  };
}

function validRef(ref) {
  return ref === null || Boolean(ref && /^[a-f0-9]{64}$/.test(ref.hash) && /^[a-f0-9]{64}$/.test(ref.sourceHash)
    && typeof ref.version === 'string' && ref.version.length > 0 && ref.version.length <= 100
    && Number.isFinite(ref.effectiveAt) && Number.isFinite(ref.fetchedAt)
    && (ref.endDate === null || /^\d{8}$/.test(ref.endDate)));
}
export function parseScheduleState(body, provider) {
  const state = JSON.parse(body);
  if (state?.schema !== 1 || state.provider !== provider
    || ![state.active,state.pending,state.previous].every(validRef) || !Number.isFinite(state.checkedAt))
    throw Error('SCHEDULE_STATE_INVALID');
  return state;
}
export const appliedRef = (state, now) => state.pending && state.pending.effectiveAt <= now ? state.pending
  : state.active && state.active.effectiveAt <= now ? state.active : null;
export const safeCode = error => /^(?:SCHEDULE|BUS|STATIC|POSITION)_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'SCHEDULE_UPDATE_FAILED';

export async function refreshSchedule({ provider, store, discover, now = Date.now(), minIntervalMs = 20 * 3600000 }) {
  const key = stateKey(provider), old = await store.read(key, 32768);
  const state = old.body ? parseScheduleState(old.body, provider)
    : { schema:1, provider, checkedAt:0, active:null, pending:null, previous:null, sourceTag:null, error:null };
  if (state.rollbackHold) return {provider,result:'rollback_held'};
  if (now - state.checkedAt < minIntervalMs) return { provider, result:'recent' };
  // A failed discovery may not lose a previously validated pending version.
  if (state.pending?.effectiveAt <= now) {
    state.previous = state.active; state.active = state.pending; state.pending = null;
  }
  state.checkedAt = now;
  let result = 'unchanged';
  try {
    const candidate = await discover(state);
    if (candidate) {
      const { payload, sourceTag, ...ref } = candidate;
      const body = JSON.stringify(payload);
      ref.hash = sha(body);
      if (!validRef(ref) || ref.endDate && ref.endDate < jstDate(Math.max(now, ref.effectiveAt))) throw Error('SCHEDULE_CANDIDATE_INVALID');
      const newest = ref.effectiveAt > now ? state.pending : state.active;
      if (state.active && ref.effectiveAt < state.active.effectiveAt || ref.effectiveAt > now && state.pending && ref.effectiveAt < state.pending.effectiveAt)
        throw Error('SCHEDULE_DOWNGRADE');
      if (ref.sourceHash !== newest?.sourceHash) {
        await store.write(objectKey(provider, ref.hash), body, '0');
        if (ref.effectiveAt > now) { state.pending = ref; result = 'staged'; }
        else { state.previous = state.active; state.active = ref; result = 'activated'; }
      }
      state.sourceTag = sourceTag ?? state.sourceTag;
    }
    state.error = null;
  } catch (error) { state.error = safeCode(error); result = 'retained'; }
  if (!await store.write(key, JSON.stringify(state), old.generation)) return { provider, result:'concurrent' };
  return { provider, result, version:state.active?.version ?? null, pending:state.pending?.version ?? null, error:state.error };
}

// Emergency rollback is a CAS update. The daily job will not undo it until resumed.
export async function changeRollback({provider, store, resume = false, now = Date.now()}) {
  if (!PROVIDERS.includes(provider)) throw Error('SCHEDULE_PROVIDER_INVALID');
  const key = stateKey(provider), old = await store.read(key,32768);
  const state = parseScheduleState(old.body,provider);
  if (resume) { state.rollbackHold = false; state.checkedAt = 0; state.sourceTag = null; }
  else {
    const ref = state.previous;
    if (!ref || ref.effectiveAt > now || ref.endDate && ref.endDate < jstDate(now)) throw Error('SCHEDULE_ROLLBACK_UNAVAILABLE');
    const value = await store.read(objectKey(provider,ref.hash));
    if (!value.body || sha(value.body) !== ref.hash) throw Error('SCHEDULE_HASH_MISMATCH');
    state.previous = state.active; state.active = ref; state.pending = null; state.rollbackHold = true;
  }
  if (!await store.write(key,JSON.stringify(state),old.generation)) throw Error('SCHEDULE_CONCURRENT');
  return {provider,result:resume?'resumed':'rolled_back',version:state.active?.version};
}

export function createScheduleReader({ store, accept, log = () => {}, clock = Date.now, intervalMs = 60000 }) {
  const records = Object.fromEntries(PROVIDERS.map(provider => [provider, { state:null, ref:null, error:null }]));
  let next = 0, pending;
  async function poll() {
    const now = clock();
    if (pending) return pending;
    if (now < next) return;
    next = now + intervalMs;
    pending = Promise.all(PROVIDERS.map(async provider => {
      const record = records[provider];
      try {
        const { body } = await store.read(stateKey(provider), 32768);
        if (!body) throw Error('SCHEDULE_STATE_MISSING');
        const state = parseScheduleState(body, provider), ref = appliedRef(state, clock());
        if (ref && record.ref?.hash !== ref.hash) {
          const value = await store.read(objectKey(provider, ref.hash));
          if (!value.body || sha(value.body) !== ref.hash) throw Error('SCHEDULE_HASH_MISMATCH');
          accept(provider, JSON.parse(value.body), ref);
          record.ref = ref;
          log({ event:'bus_schedule_applied', provider, version:ref.version, hash:ref.sourceHash, effectiveAt:ref.effectiveAt });
        }
        record.state = state;
        record.error = null;
      } catch (error) { record.error = safeCode(error); }
    })).finally(() => { pending = null; });
    return pending;
  }
  function status(fallback = {}) {
    return Object.fromEntries(PROVIDERS.map(provider => {
      const { state, ref, error } = records[provider], value = ref || fallback[provider] || {};
      const now = clock(), checkedAt = state?.checkedAt ?? null;
      return [provider, { version:value.version ?? null, effectiveAt:value.effectiveAt ?? null,
        sourceHash:value.sourceHash ?? null, fetchedAt:value.fetchedAt ?? null, checkedAt,
        status:value.endDate && value.endDate < jstDate(now) ? 'stale' : error || state?.error || state?.rollbackHold ? 'update_failed'
          : !checkedAt || now - checkedAt > 48 * 3600000 ? 'stale' : 'current' }];
    }));
  }
  return { poll, status };
}
