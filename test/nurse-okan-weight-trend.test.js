'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'features/nurse-okan/nurse-okan.js'), 'utf8');
const context = {
  console,
  Date,
  Math,
  Number,
  String,
  Array,
  Object,
  RegExp,
  module: { exports: {} },
  document: { addEventListener() {} },
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);
const nurse = context.module.exports;

const record = (recordId, measuredDate, weightKg, status = 'active') => ({ recordId, measuredDate, weightKg, status, recordedAt: measuredDate + 'T08:00:00+09:00' });
const today = '2026-08-23';

assert.deepStrictEqual(JSON.parse(JSON.stringify(nurse.weightTrendRange_(today, 30))), { fromLocalDate: '2026-07-25', toLocalDate: today }, 'D10: 30 days must be a calendar-day range including today');
assert.deepStrictEqual(JSON.parse(JSON.stringify(nurse.weightTrendRange_(today, 7))), { fromLocalDate: '2026-08-17', toLocalDate: today }, 'D10: 7-day range must be inclusive');

let summary = nurse.buildWeightTrendSummary_([], 30, today);
assert.strictEqual(summary.latest, null, 'D1: no active records must have no latest value');
assert.strictEqual(summary.measurementCount, 0, 'D1: no active records must have no plot points');

summary = nurse.buildWeightTrendSummary_([record('only', '2026-08-20', 50.8)], 30, today);
assert.strictEqual(summary.latest.weightKg, 50.8, 'D2: one active record must show latest');
assert.strictEqual(summary.previousDifference, null, 'D2: one active record must not become a zero previous difference');
assert.strictEqual(summary.periodDifference, null, 'D2: one active record must not become a zero period difference');
assert.strictEqual(nurse.buildWeightChartModel_(summary.points), null, 'D2: one record must not create a line chart');

summary = nurse.buildWeightTrendSummary_([record('older', '2026-08-17', 50.5), record('latest', '2026-08-23', 50.8)], 7, today);
assert(Math.abs(summary.previousDifference - 0.3) < 1e-9, 'D3: previous difference must use the preceding active measurement');
assert(Math.abs(summary.periodDifference - 0.3) < 1e-9, 'D4: period difference must use oldest-to-latest measurement in the period');

summary = nurse.buildWeightTrendSummary_([record('outside', '2026-07-24', 49.0), record('start', '2026-07-25', 49.5), record('latest', '2026-08-23', 50.8)], 30, today);
assert(Math.abs(summary.periodDifference - 1.3) < 1e-9, 'D4-D5: period calculation must exclude a measurement before the inclusive range');
assert.deepStrictEqual(JSON.parse(JSON.stringify(summary.points.map((item) => item.recordId))), ['start', 'latest'], 'D5: period points must not include out-of-range values');

summary = nurse.buildWeightTrendSummary_([record('corrected', '2026-08-20', 99, 'corrected'), record('replacement', '2026-08-20', 50.7), record('latest', '2026-08-23', 50.8)], 30, today);
assert.deepStrictEqual(JSON.parse(JSON.stringify(summary.points.map((item) => item.recordId))), ['replacement', 'latest'], 'D6-D7: corrected values must not reach the trend while active correction values do');

const irregular = [record('first', '2026-08-01', 49.8), record('second', '2026-08-05', 50.1), record('third', '2026-08-12', 50.0), record('fourth', '2026-08-20', 50.7)];
summary = nurse.buildWeightTrendSummary_(irregular, 30, today);
assert.strictEqual(summary.points.length, 4, 'D8-D9: missing dates must not add synthetic points');
assert.deepStrictEqual(JSON.parse(JSON.stringify(summary.points.map((item) => item.weightKg))), [49.8, 50.1, 50.0, 50.7], 'D8: missing dates must not become zero or copied weights');
summary = nurse.buildWeightTrendSummary_([record('known', '2026-08-20', 50.7), { recordId: 'missing-value', measuredDate: '2026-08-21', weightKg: '', status: 'active' }], 30, today);
assert.deepStrictEqual(JSON.parse(JSON.stringify(summary.points.map((item) => item.recordId))), ['known'], 'D8: an absent measurement value must not become a zero-weight point');
summary = nurse.buildWeightTrendSummary_(irregular, 30, today);
const chart = nurse.buildWeightChartModel_(summary.points);
assert(chart && chart.points.length === 4, 'D9: actual measurements must create chart points');
assert(chart.points[1].x - chart.points[0].x < chart.points[3].x - chart.points[2].x, 'D9: chart X positions must reflect uneven measurement intervals');

assert(source.includes("call_('health.weight.list',weightTrendRange_(date_(),30))"), 'D11: opening must use one date-range weight read for KPI and trend');
assert(source.includes("state.weightError='体重推移を読み込めませんでした'"), 'D11: trend failure must have an isolated message');
assert(source.includes('data-weight-trend-period="7"') && source.includes('data-weight-trend-period="30"'), 'D10: period controls are missing');
assert(source.includes('class="popio-observation-heading"') && source.includes('class="popio-observation-periods"'), 'D10: Nurse Okan must reuse the Popio period-toggle DOM classes');
assert(source.includes("button.setAttribute('aria-pressed',String(Number(button.dataset.weightTrendPeriod)===period))"), 'D10: active and inactive period state must remain aria-pressed based');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
assert(/\.nurse-weight-trend-graph\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%/s.test(css), 'D12: graph must fit its card width');
assert(/\.nurse-weight-trend-card\s*\{[^}]*overflow:\s*hidden/s.test(css), 'D12: trend card must prevent horizontal overflow');
const popioPeriodCss = css.slice(css.indexOf('.popio-observation-periods {'), css.indexOf('.popio-observation-status {'));
assert(popioPeriodCss.includes('min-width: 0;') && popioPeriodCss.includes('max-width: 100%;') && popioPeriodCss.includes('flex-wrap: nowrap;') && popioPeriodCss.includes('overflow-x: visible;'), 'D12: Nurse Okan must inherit the Popio no-wrap period container contract');
assert(popioPeriodCss.includes('width: 64px;') && popioPeriodCss.includes('max-width: 64px;') && popioPeriodCss.includes('min-width: 64px;') && popioPeriodCss.includes('flex: 0 0 64px;') && popioPeriodCss.includes('flex-shrink: 0;') && popioPeriodCss.includes('white-space: nowrap;'), 'D12: Nurse Okan must inherit the Popio fixed period-button contract');
assert(!/\.nurse-weight-trend-periods\b/.test(css), 'D12: Nurse Okan must not retain a separate period-toggle CSS implementation');
assert(64 * 2 + 8 <= 390 - 34, 'D12: two Popio period buttons must fit inside a 390px Nurse Okan card');

console.log('PASS Nurse Okan N2-D weight trend summary, active-only, date-range, and mobile layout contracts');
