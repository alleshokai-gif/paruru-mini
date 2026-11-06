import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshSchedule, changeRollback, createScheduleReader, stateKey, objectKey, effectiveAt, parseScheduleState } from '../runtime/schedule-store.js';

function memory() {
  const objects = new Map();
  return {
    async read(key) { return objects.get(key) ?? { body:null,generation:'0' }; },
    async write(key,body,generation) {
      const previous = await this.read(key);
      if (previous.generation !== generation) return false;
      objects.set(key,{body,generation:String(Number(generation)+1)});
      return true;
    }
  };
}
const at = effectiveAt('20261101');
const discover = (version,time=at, extra={}) => async () => ({
  payload:{version}, sourceHash:version.repeat(64), version,
  fetchedAt:at, effectiveAt:time, endDate:'20261231', ...extra
});
const advance = (store,discoverer,now=at,provider='kawasaki') =>
  refreshSchedule({store,provider,discover:discoverer,now,minIntervalMs:0});

test('three providers independently stage a revision and apply only at service start', async () => {
  const store = memory(), active = {}, now = { value:at };
  const reader = createScheduleReader({store,clock:()=>now.value,intervalMs:0,
    accept:(provider,payload)=>{ active[provider]=payload.version; }});
  for (const provider of ['kawasaki','tokyu','seibu']) {
    await advance(store,discover('a',at-1),at,provider);
    assert.equal((await advance(store,discover('b',at+60),at,provider)).result,'staged');
  }
  await reader.poll();
  assert.deepEqual(active,{kawasaki:'a',tokyu:'a',seibu:'a'});
  now.value += 60;
  await reader.poll();
  assert.deepEqual(active,{kawasaki:'b',tokyu:'b',seibu:'b'});
});

test('download or validation failure keeps the last good object and publishes an error state', async () => {
  const store = memory();
  await advance(store,discover('a'));
  for (const invalid of [async()=>{ throw Error('BUS_UPSTREAM_HTTP'); },
    discover('b',at,{endDate:'20261031'}),discover('c',at-1000)]) {
    assert.equal((await advance(store,invalid)).result,'retained');
    const state = parseScheduleState((await store.read(stateKey('kawasaki'))).body,'kawasaki');
    assert.equal(state.active.version,'a');
    assert.ok(state.error);
  }
});

test('runtime rejects corrupt content and retains the in-memory good snapshot', async () => {
  const store = memory(), versions=[];
  await advance(store,discover('a'));
  const reader = createScheduleReader({store,clock:()=>at,intervalMs:0,
    accept:(_,payload)=>versions.push(payload.version)});
  await reader.poll();
  await advance(store,discover('b'));
  const ref = JSON.parse((await store.read(stateKey('kawasaki'))).body).active;
  const key = objectKey('kawasaki',ref.hash);
  await store.write(key,'broken',(await store.read(key)).generation);
  await reader.poll();
  assert.deepEqual(versions,['a']);
  assert.equal(reader.status().kawasaki.status,'update_failed');
});

test('same version is not republished; rollback holds until an explicit resume', async () => {
  const store = memory();
  await advance(store,discover('a'));
  await advance(store,discover('b'));
  assert.equal((await advance(store,discover('b'))).result,'unchanged');
  assert.equal((await changeRollback({provider:'kawasaki',store,now:at})).version,'a');
  assert.equal((await advance(store,discover('c'))).result,'rollback_held');
  await changeRollback({provider:'kawasaki',store,resume:true,now:at});
  assert.equal((await advance(store,discover('c'))).version,'c');
});

test('daily gate skips redundant source checks', async () => {
  const store = memory();
  await advance(store,discover('a'));
  let calls=0;
  const result=await refreshSchedule({provider:'kawasaki',store,now:at+60000,discover:async()=>{calls++;}});
  assert.equal(result.result,'recent'); assert.equal(calls,0);
});
