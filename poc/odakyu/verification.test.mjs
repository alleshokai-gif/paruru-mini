import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRecordedChecks } from './verification.mjs';
const trips = [{ id: 'provider:Weekday:odakyu-fixture', sourceTrainId: 'odakyu-fixture', calendar: 'Weekday', stops: [
  { station: 'YoyogiUehara', stop: true, departure: 600 }, { station: 'Noborito', stop: true, arrival: 630 } ] }];
const record = () => ({ schemaVersion: 1, method: 'public_ui_observation', checkedAt: '2026-10-27T09:00:00+09:00', checks: [{
  trainId: trips[0].id, calendar: 'Weekday', serviceDate: '2026-10-27', station: 'Noborito', departure: 600, arrival: 630,
  sourceUrl: 'https://transfer.navitime.biz/odakyu-transit/smart/diagram/StopListDiagram?tCode=fixture&datetime=2026-10-27T10:00:00' }] });
test('別取得経路の照合と別提供者の照合を区別し、着発を変更しない', () => {
  const before = JSON.stringify(trips), report = verifyRecordedChecks(trips, record());
  assert.equal(report.matched, 1); assert.equal(report.independentAcquisition, true); assert.equal(report.independentProvider, false);
  assert.equal(JSON.stringify(trips), before);
});
test('照合記録がなければ未実施と明示する', () => assert.equal(verifyRecordedChecks(trips, null).status, 'not_checked'));
test('着時刻の不一致は便を隔離対象にし、記録値で上書きしない', () => {
  const r = record(); r.checks[0].arrival++; const result = verifyRecordedChecks(trips, r);
  assert.equal(result.status, 'mismatch'); assert.deepEqual(result.quarantinedIds, [trips[0].id]); assert.equal(trips[0].stops[1].arrival, 630);
});
test('別便・異なる日付・不正な取得元・重複記録を受理しない', () => {
  for (const change of [r => r.checks[0].sourceUrl = r.checks[0].sourceUrl.replace('fixture', 'other'),
    r => r.checks[0].serviceDate = '2026-10-28', r => r.checks[0].sourceUrl = 'https://example.com/',
    r => r.checks.push(r.checks[0])]) { const r = record(); change(r); assert.throws(() => verifyRecordedChecks(trips, r)); }
});

// The actual UI observation record is ignored local evidence, not fixture timetable data.
test('保存Staticとは別に閲覧した実便3件の登戸着を再読込して照合する', async () => {
  const { readFile } = await import('node:fs/promises');
  const model = JSON.parse(await readFile(new URL('./data/model.json', import.meta.url), 'utf8'));
  const actual = JSON.parse(await readFile(new URL('./data/arrival-audit.json', import.meta.url), 'utf8'));
  const result = verifyRecordedChecks(model.trips, actual);
  assert.equal(result.matched, 3); assert.equal(result.mismatched, 0); assert.equal(result.independentProvider, false);
});

test('取得URLの発時刻と照合値、平日指定と日付が矛盾した記録を拒否する', () => {
  const wrongTime = record(); wrongTime.checks[0].sourceUrl = wrongTime.checks[0].sourceUrl.replace('10:00:00', '10:01:00');
  assert.throws(() => verifyRecordedChecks(trips, wrongTime));
  const sunday = record(); sunday.checks[0].serviceDate = '2026-10-25'; sunday.checks[0].sourceUrl = sunday.checks[0].sourceUrl.replace('2026-10-27', '2026-10-25');
  assert.throws(() => verifyRecordedChecks(trips, sunday));
});
