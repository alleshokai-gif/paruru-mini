const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const componentData = require('../features/kaz-os/v3-component-data');
const personal = require('../features/kaz-os/personal');
const { create } = require('./fixtures/kaz-v3-component-parity');

const { dashboard, inbox } = create();
const views = dashboard.component_data;
const now = Date.parse('2026-10-09T14:30:00+09:00');

for (const [page, itemKey, legacyKey] of [
  ['projects', 'projects', 'projects'], ['work', 'work', 'work_items'],
  ['capa', 'capa', 'capa_items'],
]) {
  assert.deepEqual(dashboard[itemKey], views[page][legacyKey]);
  assert.deepEqual(componentData.dashboard(dashboard, page)[legacyKey], dashboard[itemKey]);
}
for (const [page, oldSource, snapshotSource] of [
  ['projects', 'projects', 'projects'], ['work', 'work_items', 'work'],
  ['capa', 'capa', 'capa'], ['today', 'work_items', 'today'],
]) assert.equal(views[page].sources[oldSource].source_revision,
  dashboard.sources[snapshotSource].revision);
assert.equal(views.projects.sources.tasks.source_revision, dashboard.sources.work.revision);
for (const [key, legacy] of [
  ['now', views.today.today.now.items], ['next', views.today.today.next.items],
  ['scheduled', views.today.today.scheduled], ['waiting', views.today.today.waiting],
  ['kaz_free_windows', views.today.today.kaz_free_windows],
  ['company_free_windows', views.today.today.company_free_windows],
  ['personal_free_windows', views.today.today.calendar_free_windows],
]) assert.deepEqual(dashboard.today[key], legacy, key);
assert.deepEqual(inbox.inbox_items, inbox.component_data.inbox_items);
assert.deepEqual(dashboard.today.confirmations, inbox.inbox_items);

const projected = componentData.dashboard(dashboard, 'today');
assert.deepEqual(projected.today, {
  ...views.today.today,
  confirmations: dashboard.today.confirmations,
});
assert.equal(personal.health(projected.sources.work_items, now), 'ok');
assert.equal(personal.health(projected.sources.work_items, now + 2 * 60 * 60 * 1000), 'ok',
  'event-driven Snapshot status must not inherit the old 15-minute TTL');
assert.equal(personal.health({ ...projected.sources.work_items, snapshot_status: 'stale' }, now), 'stale');
assert.equal(componentData.dashboard(dashboard, 'projects').work_items.length,
  dashboard.work.length);
assert.equal(personal.health(componentData.inbox(inbox).sources.inbox, now), 'ok');
assert.throws(() => componentData.dashboard({ ...dashboard, component_data: null }, 'today'),
  /KAZ_V3_COMPONENT_DATA_UNAVAILABLE/);

const navigation = fs.readFileSync(path.join(__dirname, '..', 'features/kaz-os/navigation.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const config = fs.readFileSync(path.join(__dirname, '..', 'features/transport/read-v2-config.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.match(navigation, /KazV3ComponentData\.dashboard/);
assert.match(navigation, /KazV3ComponentData\.inbox/);
assert.match(navigation, /KazPersonalView\.render\(host, selection, data, Date\.now\(\), options\)/);
assert.doesNotMatch(navigation, /KazV3Preview\?\.render/);
assert.match(navigation, /if \(selection\.page === 'today'\) await renderToday\(selection\)/,
  'rollback v2 reader must remain available');
assert(navigation.includes('const cutover = /^#kaz-os'),
  'normal Kaz OS routes must select the Snapshot branch');
assert.match(config, /dashboardV3: 'DIRECT_V2'/,
  'normal Kaz OS must use the authenticated v3 HTTP route');
const dashboardGate = app.slice(app.indexOf('async function callAuthenticatedKazOsV3Dashboard_()'),
  app.indexOf('async function callAuthenticatedKazOsV3Inbox_()'));
assert(dashboardGate.includes('isViewAllowed_("kaz-os")')
  && dashboardGate.includes('activeMembershipContext?.role !== "admin"')
  && dashboardGate.includes('selectedKazOsReadTransport_("dashboardV3")'),
  'v3 Dashboard read must retain Kaz authorization');
assert(!dashboardGate.includes('PALURU_KAZ_OS_V3_PREVIEW_ENABLED'),
  'normal Kaz OS read must not require the hidden-preview query flag');
assert(!html.includes('data-kaz-page="inbox"'), 'normal navigation must omit INBOX');
assert.deepEqual(dashboard.today.company_free_windows, []);

console.log('PASS same-condition v2 component DTO and v3 Snapshot data consistency');
