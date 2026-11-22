const test = require('node:test');
const assert = require('node:assert/strict');
const {dashboard} = require('../features/kaz-os/v3-component-data');
test('three V3 views retain bounded source evidence without promoting failed data', () => {
  for (const [page,key,sourceKey] of [['work','work_items','work'],['projects','projects','projects'],['capa','capa','capa']]) {
    const snapshot={schema_version:'kaz-os-dashboard-v3', component_data:{[page]:{sources:{[key]:{status:'failed',complete:false}}}},sources:{[sourceKey]:{
      status:'stale',updated_at:'2026-11-21T00:00:00Z',valid_until:'2026-11-21T01:00:00Z',
      last_success_at:'2026-11-20T00:00:00Z',failure_code:'SOURCE_CAPTURE_FAILED',source_revision:'a'.repeat(64),private_payload:'DO NOT COPY'}}};
    const s=dashboard(snapshot,page).sources[key];
    assert.equal(s.status,'failed');assert.equal(s.complete,false);assert.equal(s.snapshot_status,'stale');
    assert.equal(s.snapshot_updated_at,snapshot.sources[sourceKey].updated_at);
    assert.equal(s.snapshot_error_code,'SOURCE_CAPTURE_FAILED');assert.equal(s.snapshot_last_success_at,'2026-11-20T00:00:00Z');
    assert.equal(s.private_payload,undefined);
    snapshot.sources[sourceKey].failure_code='private provider message';snapshot.sources[sourceKey].updated_at='invalid';
    const invalid=dashboard(snapshot,page).sources[key];assert.equal(invalid.snapshot_error_code,null);assert.equal(invalid.snapshot_updated_at,null);
  }
});
