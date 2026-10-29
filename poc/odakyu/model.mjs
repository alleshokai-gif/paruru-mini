import { readFile } from 'node:fs/promises';
import { normalize } from './core.mjs';
import { readSnapshot, latest } from './storage.mjs';
import { reconstructTrips } from './reconstruct.mjs';
import { verifyRecordedChecks } from './verification.mjs';
import { demoModel, connectionDemoModel } from './demo.mjs';
import { matchTCode, REVIEW_SCOPE } from './tcode.mjs';
import { datasetModel } from './dataset.mjs';
import { savedApproaches } from './approaches.mjs';
import { HOLIDAY_SOURCE, VERIFIED_HOLIDAY_DATES } from '../../bus/providers/tokyu/calendar.js';
const root = new URL('./', import.meta.url);
export async function loadModel(snapshot, mode = 'real') {
  if (mode === 'demo') return demoModel();
  if (mode === 'demo-seven') return connectionDemoModel();
  if (mode === 'additional') {
    const supplied = JSON.parse(await readFile(new URL('./data/additional-dataset.json', root), 'utf8'));
    if (supplied.kind !== 'additional') throw Error('ADDITIONAL_KIND_INVALID');
    return datasetModel(supplied);
  }
  const [source, rail, stations] = await Promise.all([readSnapshot(snapshot), latest('Railway'), latest('Station')]);
  const model = normalize(source.rows, rail.rows, stations.rows, source.fetchedAt);
  const provider = JSON.parse(await readFile(new URL('../../bus/release-static/kazu-commute-static.json', root), 'utf8'));
  const reconstructed = reconstructTrips(provider, model);
  model.trips = reconstructed.trips.map(t => ({ ...t, datasetId: 'saved-static', dataKind: 'real' }));
  let metro;
  try { metro=JSON.parse(await readFile(new URL('./data/MetroTrainTimetable.json',root),'utf8')); }
  catch(error) { if(error.code!=='ENOENT')throw error; }
  const approaches=savedApproaches(provider,metro,stations.rows);
  model.stations.push(...approaches.stations);
  model.trips.push(...approaches.trips);
  model.approachCoverage=approaches.report;
  // Read-only reuse of the existing bounded national-holiday calendar. This
  // chooses a saved calendar, not proof that the saved timetable is current.
  model.calendarCoverage = { ...HOLIDAY_SOURCE, holidays: VERIFIED_HOLIDAY_DATES };
  model.dataset = { id: 'saved-static', kind: 'real', title: '保存実データ（部分収録）', dailyReady: false,
    rights: { status: 'ODPT限定条件・既存Static追加利用未確認' }, serviceDates: Object.values(reconstructed.report.sourceDates || {}), coverage: reconstructed.report.coverage };
  model.reconstruction = reconstructed.report;
  let audit = null;
  try { audit = JSON.parse(await readFile(new URL('./data/arrival-audit.json', import.meta.url), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  model.arrivalVerification = verifyRecordedChecks(model.trips, audit);
  model.trips = model.trips.filter(t => !model.arrivalVerification.quarantinedIds.includes(t.id));
  model.tCodeReferences = REVIEW_SCOPE.codes.map(tCode => matchTCode(model.trips,
    { tCode, serviceDate: REVIEW_SCOPE.serviceDate, calendar: REVIEW_SCOPE.calendar, revision: provider.sourceCheckedAt }));
  try {
    const reference = JSON.parse(await readFile(new URL('./data/navigation-reference.json', root), 'utf8'));
    model.example = model.trips.some(t => t.id === reference.selectedId) && Number.isInteger(reference.compareAt)
      ? { selectedId: reference.selectedId, compareAt: reference.compareAt } : null;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    model.example = null; // Only the optional replay button is unavailable; train selection remains explicit.
  }
  return model;
}
