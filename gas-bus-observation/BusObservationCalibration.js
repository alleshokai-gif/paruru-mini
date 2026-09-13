const BUS_OBSERVATION_RAW_SHEET = 'Bus_Observation_Raw';
const BUS_OBSERVATION_DAILY_SHEET = 'Bus_Observation_Daily';
const BUS_OBSERVATION_SPREADSHEET_PROPERTY = 'PALURU_BUS_OBSERVATION_SPREADSHEET_ID';
const BUS_OBSERVATION_RAW_HEADERS = Object.freeze([
  'observation_id','run_id','sample_index','observation_kind','observed_at','provider','direction_id','route_id','trip_id',
  'service_date','origin_stop_id','platform','scheduled_departure','evidence_type','departure_state',
  'elapsed_from_scheduled_sec','gps_age_sec','rt_age_sec','next_bus_gap_min','censored','vehicle_hash','gps_timestamp',
  'position_lat','position_lon','position_state','position_confidence','position_reason','previous_stop_id','next_stop_id',
  'position_segment_key','position_expected_segments','aux_stop_id','aux_stop_sequence','aux_status'
]);
const BUS_OBSERVATION_DAILY_HEADERS = Object.freeze([
  'summary_id','generated_at','local_date','provider','direction_id','route_id','origin_stop_id','platform','raw_rows',
  'unique_observations','unique_trips','positive_trips','censored_trips','departure_anomaly_rows','median_sec','p80_sec','p90_sec','p95_sec',
  'gps_rows','position_supported_rows','position_missing_rows','position_stale_rows','position_anomaly_rows',
  'observed_segment_count','expected_segment_count','position_coverage','missing_field_rows','duplicate_rows',
  'calibration_ready','candidate_overdue_sec','candidate_unknown_sec'
]);
const BUS_OBSERVATION_POSITIVE_EVIDENCE = Object.freeze(['gps_origin_passed','vehicle_next_trip','trip_next_stop','rt_departed']);
const BUS_OBSERVATION_CALIBRATION_REVIEW_GATE_ENABLED = false;

function busObsErr_(code) { const error = new Error(code); error.code = code; return error; }
function busObsSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(BUS_OBSERVATION_SPREADSHEET_PROPERTY);
  if (!id || !/^[A-Za-z0-9_-]{20,128}$/.test(id)) throw busObsErr_('OBSERVATION_SPREADSHEET_NOT_CONFIGURED');
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book || book.getId() !== id) throw busObsErr_('OBSERVATION_SPREADSHEET_BINDING_MISMATCH');
  return book;
}
function busObsHeaders_(sheet, expected) {
  const width = expected.length;
  if (sheet.getLastRow() < 1) return [];
  if (sheet.getLastColumn() !== width) throw busObsErr_('OBSERVATION_SHEET_SCHEMA_MISMATCH');
  return sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
}
function busObsEnsureSheet_(book, name, headers, create) {
  let sheet = book.getSheetByName(name);
  if (!sheet && create) sheet = book.insertSheet(name);
  if (!sheet) throw busObsErr_('OBSERVATION_SHEET_MISSING');
  if (create && sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  const actual = busObsHeaders_(sheet, headers);
  if (!actual.length && create) sheet.getRange(1, 1, 1, headers.length).setValues([headers.slice()]);
  else if (JSON.stringify(actual) !== JSON.stringify(headers)) throw busObsErr_('OBSERVATION_SHEET_SCHEMA_MISMATCH');
  return sheet;
}
function setupBusObservationSheets() {
  const book = busObsSpreadsheet_();
  const raw = busObsEnsureSheet_(book, BUS_OBSERVATION_RAW_SHEET, BUS_OBSERVATION_RAW_HEADERS, true);
  const daily = busObsEnsureSheet_(book, BUS_OBSERVATION_DAILY_SHEET, BUS_OBSERVATION_DAILY_HEADERS, true);
  raw.setFrozenRows(1); daily.setFrozenRows(1);
  return { status: 'OBSERVATION_SHEETS_READY', raw: raw.getName(), daily: daily.getName() };
}
function installBusObservationDailyTrigger() {
  const handler = 'runWeekdayBusObservationCalibration', legacyHandler = 'runDailyBusObservationCalibration';
  const managed = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return [handler, legacyHandler].indexOf(trigger.getHandlerFunction()) >= 0;
  });
  if (managed.length > 1) throw busObsErr_('OBSERVATION_TRIGGER_DUPLICATE');
  if (managed.length === 1 && managed[0].getHandlerFunction() === legacyHandler) throw busObsErr_('OBSERVATION_TRIGGER_LEGACY_PRESENT');
  if (!managed.length) ScriptApp.newTrigger(handler).timeBased().atHour(20).nearMinute(45).everyDays(1).inTimezone('Asia/Tokyo').create();
  return { status: 'OBSERVATION_TRIGGER_READY', existing: managed.length === 1, handler: handler, timezone: 'Asia/Tokyo' };
}
function busObsObject_(headers, row) {
  const value = {}; headers.forEach(function(header, index) { value[header] = row[index] === undefined ? '' : row[index]; }); return value;
}
function busObsNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value); return Number.isFinite(number) ? number : null;
}
function busObsBoolean_(value) { return value === true || String(value).toLowerCase() === 'true'; }
function busObsPercentile_(values, fraction) {
  if (!values.length) return null;
  const sorted = values.slice().sort(function(a, b) { return a - b; });
  if (fraction === 0.5 && sorted.length % 2 === 0) return (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}
function busObsHash_(parts) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, parts.join('\u001f'), Utilities.Charset.UTF_8);
  return bytes.map(function(value) { return ('0' + ((value + 256) % 256).toString(16)).slice(-2); }).join('').slice(0, 32);
}
function busObsIso_(date) { return Utilities.formatDate(date, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function busObsTargetDate_() {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return Utilities.formatDate(yesterday, 'Asia/Tokyo', 'yyyy-MM-dd');
}
function aggregateBusObservationRows_(values, targetDate, generatedAt) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate || '') || !Array.isArray(values) || !values.length
    || JSON.stringify(values[0].map(String)) !== JSON.stringify(BUS_OBSERVATION_RAW_HEADERS)) throw busObsErr_('OBSERVATION_AGGREGATE_INPUT_INVALID');
  const groups = new Map(), seen = new Map();
  values.slice(1).forEach(function(row) {
    const value = busObsObject_(BUS_OBSERVATION_RAW_HEADERS, row), observedAt = String(value.observed_at || '');
    if (observedAt.slice(0, 10) !== targetDate) return;
    const required = ['observation_id','provider','direction_id','route_id','trip_id','service_date','origin_stop_id','scheduled_departure'];
    if (required.some(function(name) { return !String(value[name] || ''); }) || !/^obs_[a-f0-9]{32}$/.test(String(value.observation_id)))
      throw busObsErr_('OBSERVATION_RAW_DATA_INVALID');
    const groupKey = [value.provider,value.direction_id,value.route_id,value.origin_stop_id,value.platform].map(String).join('\u001f');
    if (!groups.has(groupKey)) groups.set(groupKey, { key: groupKey, provider:String(value.provider),directionId:String(value.direction_id),
      routeId:String(value.route_id),originStopId:String(value.origin_stop_id),platform:String(value.platform || ''),rawRows:0,duplicateRows:0,
      ids:new Set(),trips:new Set(),positive:new Map(),censored:new Set(),gpsRows:0,positionSupported:0,positionMissing:0,
      positionStale:0,positionAnomaly:0,departureAnomaly:0,segments:new Set(),expectedSegments:0,missingFields:0 });
    const group = groups.get(groupKey); group.rawRows++;
    if (seen.has(value.observation_id)) {
      if (seen.get(value.observation_id) !== groupKey) throw busObsErr_('OBSERVATION_DUPLICATE_CONFLICT');
      group.duplicateRows++; return;
    }
    seen.set(value.observation_id, groupKey); group.ids.add(String(value.observation_id));
    const tripKey = `${value.service_date}:${value.trip_id}`; group.trips.add(tripKey);
    const evidence = String(value.evidence_type || ''), state = String(value.departure_state || '');
    const elapsed = busObsNumber_(value.elapsed_from_scheduled_sec);
    if (state === 'departed' && BUS_OBSERVATION_POSITIVE_EVIDENCE.indexOf(evidence) >= 0 && elapsed !== null && elapsed >= 0) {
      const previous = group.positive.get(tripKey); if (previous === undefined || elapsed < previous) group.positive.set(tripKey, elapsed);
    }
    if (state === 'departed' && BUS_OBSERVATION_POSITIVE_EVIDENCE.indexOf(evidence) >= 0 && (elapsed === null || elapsed < 0)) group.departureAnomaly++;
    if (busObsBoolean_(value.censored)) group.censored.add(tripKey);
    const positionKind = String(value.observation_kind).indexOf('position') >= 0;
    if (positionKind) {
      const lat = busObsNumber_(value.position_lat), lon = busObsNumber_(value.position_lon), gpsAge = busObsNumber_(value.gps_age_sec);
      if (lat === null || lon === null) { group.positionMissing++; group.missingFields++; }
      else if (Math.abs(lat) > 90 || Math.abs(lon) > 180) group.positionAnomaly++;
      else group.gpsRows++;
      const reason = String(value.position_reason || '');
      if (gpsAge !== null && gpsAge > 120 || /stale|future/.test(reason)) group.positionStale++;
      if (/jump|reverse|conflict|off_route|mismatch|excessive/.test(reason)) group.positionAnomaly++;
      if (String(value.position_state || '') && value.position_state !== 'unknown' && String(value.position_segment_key || '')) {
        group.positionSupported++; group.segments.add(String(value.position_segment_key));
      }
      const expected = busObsNumber_(value.position_expected_segments);
      if (expected !== null && expected > group.expectedSegments) group.expectedSegments = Math.floor(expected);
    }
  });
  return Array.from(groups.values()).map(function(group) {
    const elapsed = Array.from(group.positive.values()), censored = Array.from(group.censored).filter(function(key) { return !group.positive.has(key); });
    const median = busObsPercentile_(elapsed, 0.5), p80 = busObsPercentile_(elapsed, 0.8), p90 = busObsPercentile_(elapsed, 0.9), p95 = busObsPercentile_(elapsed, 0.95);
    const ready = BUS_OBSERVATION_CALIBRATION_REVIEW_GATE_ENABLED && elapsed.length >= 20 && censored.length > 0;
    return {
      summary_id:'sum_' + busObsHash_([targetDate,group.key]),generated_at:generatedAt,local_date:targetDate,
      provider:group.provider,direction_id:group.directionId,route_id:group.routeId,origin_stop_id:group.originStopId,platform:group.platform,
      raw_rows:group.rawRows,unique_observations:group.ids.size,unique_trips:group.trips.size,positive_trips:elapsed.length,
      censored_trips:censored.length,departure_anomaly_rows:group.departureAnomaly,median_sec:median,p80_sec:p80,p90_sec:p90,p95_sec:p95,gps_rows:group.gpsRows,
      position_supported_rows:group.positionSupported,position_missing_rows:group.positionMissing,position_stale_rows:group.positionStale,
      position_anomaly_rows:group.positionAnomaly,observed_segment_count:group.segments.size,expected_segment_count:group.expectedSegments || null,
      position_coverage:group.expectedSegments ? group.segments.size / group.expectedSegments : null,missing_field_rows:group.missingFields,
      duplicate_rows:group.duplicateRows,calibration_ready:ready,candidate_overdue_sec:ready?p80:null,candidate_unknown_sec:ready?p95:null
    };
  }).sort(function(a, b) { return [a.provider,a.direction_id,a.route_id,a.origin_stop_id,a.platform].join('|').localeCompare(
    [b.provider,b.direction_id,b.route_id,b.origin_stop_id,b.platform].join('|')); });
}
function busObsSummaryKey_(value) {
  return ['local_date','provider','direction_id','route_id','origin_stop_id','platform'].map(function(header) {
    const cell = value[header];
    if (header === 'local_date' && Object.prototype.toString.call(cell) === '[object Date]' && !isNaN(cell.getTime())) {
      return Utilities.formatDate(cell, 'Asia/Tokyo', 'yyyy-MM-dd');
    }
    return String(cell === undefined || cell === null ? '' : cell);
  }).join('\u001f');
}
function busObsPlanDailyUpsert_(summaries, values) {
  if (!Array.isArray(summaries) || !Array.isArray(values) || !values.length
    || JSON.stringify(values[0].map(String)) !== JSON.stringify(BUS_OBSERVATION_DAILY_HEADERS)) throw busObsErr_('OBSERVATION_DAILY_DATA_INVALID');
  const existing = new Map();
  values.slice(1).forEach(function(row, index) {
    const value = busObsObject_(BUS_OBSERVATION_DAILY_HEADERS, row), summaryId = String(value.summary_id || '');
    if (!/^sum_[a-f0-9]{32}$/.test(summaryId) || !String(value.local_date || '') || !String(value.provider || '')
      || !String(value.direction_id || '') || !String(value.route_id || '') || !String(value.origin_stop_id || ''))
      throw busObsErr_('OBSERVATION_DAILY_DATA_INVALID');
    const key = busObsSummaryKey_(value);
    if (existing.has(key)) throw busObsErr_('OBSERVATION_DAILY_DUPLICATE_KEY');
    existing.set(key, { rowNumber: index + 2, summaryId: summaryId });
  });
  const updates = [], inserts = [];
  summaries.forEach(function(summary) {
    const row = Object.assign({}, summary), match = existing.get(busObsSummaryKey_(row));
    if (match) { row.summary_id = match.summaryId; updates.push({ rowNumber: match.rowNumber, summary: row }); }
    else inserts.push(row);
  });
  return { updates: updates, inserts: inserts };
}
function busObsDailyValues_(summary) {
  return BUS_OBSERVATION_DAILY_HEADERS.map(function(header) { return summary[header] === null ? '' : summary[header]; });
}
function runDailyBusObservationCalibration(targetDate) {
  const localDate = targetDate || busObsTargetDate_(), generatedAt = busObsIso_(new Date()), book = busObsSpreadsheet_();
  const raw = busObsEnsureSheet_(book, BUS_OBSERVATION_RAW_SHEET, BUS_OBSERVATION_RAW_HEADERS, false);
  const daily = busObsEnsureSheet_(book, BUS_OBSERVATION_DAILY_SHEET, BUS_OBSERVATION_DAILY_HEADERS, false);
  const summaries = aggregateBusObservationRows_(raw.getDataRange().getValues(), localDate, generatedAt);
  const plan = busObsPlanDailyUpsert_(summaries, daily.getDataRange().getValues());
  plan.updates.forEach(function(update) {
    daily.getRange(update.rowNumber, 1, 1, BUS_OBSERVATION_DAILY_HEADERS.length).setValues([busObsDailyValues_(update.summary)]);
  });
  if (plan.inserts.length) daily.getRange(daily.getLastRow() + 1, 1, plan.inserts.length, BUS_OBSERVATION_DAILY_HEADERS.length)
    .setValues(plan.inserts.map(busObsDailyValues_));
  SpreadsheetApp.flush();
  return { status:'OBSERVATION_DAILY_PASS',localDate:localDate,groups:summaries.length,inserted:plan.inserts.length,updated:plan.updates.length };
}

function runTodayBusObservationCalibration() {
  const localDate = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  return runDailyBusObservationCalibration(localDate);
}
function busObsIsWeekday_(localDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate || '')) throw busObsErr_('OBSERVATION_LOCAL_DATE_INVALID');
  const parts = localDate.split('-').map(Number), weekday = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}
function runWeekdayBusObservationCalibration() {
  const localDate = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  if (!busObsIsWeekday_(localDate)) return { status:'OBSERVATION_DAILY_SKIPPED_WEEKEND',localDate:localDate };
  return runDailyBusObservationCalibration(localDate);
}
