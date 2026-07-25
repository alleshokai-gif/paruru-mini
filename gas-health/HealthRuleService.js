function evaluateHealthRules_(row, weights) {
  const codes = [];
  const recorded = function(key) { return String(row[key] || '') !== ''; };
  if (!recorded('morningRecordedAt')) codes.push('morning_not_recorded');
  if (!recorded('postTrainingRecordedAt')) codes.push('post_training_not_recorded');
  if (!recorded('dinnerRecordedAt')) codes.push('dinner_not_recorded');
  if (recorded('morningRecordedAt') && row.morningStaple === 'none') codes.push('morning_fuel_missing');
  if (row.postTrainingStatus === 'recorded' && Number(row.postTrainingOnigiriCount) === 0 && row.postTrainingProteinSource === 'none') codes.push('post_training_fuel_missing');
  const proteinValues = [row.morningProteinSource, row.lunchProteinSource, row.postTrainingProteinSource, row.dinnerExtraProteinSource];
  if (recorded('morningRecordedAt') && recorded('lunchRecordedAt') && recorded('dinnerRecordedAt') && proteinValues.every(function(v) { return !v || v === 'none' || v === 'unknown'; })) codes.push('protein_source_missing');
  try { if (recorded('conditionRecordedAt') && JSON.parse(row.conditionSymptomsJson || '[]').length) codes.push('symptom_attention'); } catch (_) { codes.push('symptom_attention'); }
  if (isWeightGainStalled_(weights || [])) codes.push('weight_gain_stalled');
  return codes.length ? codes : ['on_track'];
}

function isWeightGainStalled_(weights) {
  const usable = weights.filter(function(item) { return item && /^\d{4}-\d{2}-\d{2}$/.test(String(item.measuredDate || '')) && Number.isFinite(Number(item.weightKg)); })
    .sort(function(a, b) { return String(a.measuredDate).localeCompare(String(b.measuredDate)); });
  if (usable.length < 3) return false;
  const first = usable[0], last = usable[usable.length - 1];
  const days = Math.round((Date.parse(last.measuredDate + 'T00:00:00Z') - Date.parse(first.measuredDate + 'T00:00:00Z')) / 86400000);
  return days >= 12 && days <= 21 && Number(last.weightKg) - Number(first.weightKg) < 0.2;
}
