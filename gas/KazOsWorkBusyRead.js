// TODAY-only read of the accepted five-column WorkBusy sheet. Never writes to the sheet.
function buildKazOsWorkBusyToday_(date) {
  const unavailable = function(status) {
    return { status: status, source: null, generated_at: null, date: date, intervals: [] };
  };
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet && spreadsheet.getSheetByName(PALURU_WORK_BUSY_SHEET_NAME);
    if (!sheet) return unavailable('not_connected');
    const columns = sheet.getLastColumn();
    if (columns !== PALURU_WORK_BUSY_HEADERS.length) return unavailable('failed');
    const headers = sheet.getRange(1, 1, 1, columns).getValues()[0].map(function(value) {
      return String(value || '').trim();
    });
    if (PALURU_WORK_BUSY_HEADERS.some(function(header) { return headers.indexOf(header) < 0; })
        || new Set(headers).size !== headers.length) return unavailable('failed');
    const rows = readWorkBusyRows_(sheet);
    if (!rows.length) return unavailable('empty');
    const generatedAt = rows[0].generated_at;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/.test(generatedAt)
        || !Number.isFinite(Date.parse(generatedAt))
        || rows.some(function(row) { return row.generated_at !== generatedAt; })) {
      return unavailable('failed');
    }
    const intervals = rows.filter(function(row) { return row.date === date; }).map(function(row) {
      return { start: date + 'T' + row.start + ':00+09:00', end: date + 'T' + row.end + ':00+09:00' };
    });
    if (intervals.length > 200) return unavailable('failed');
    return { status: 'ok', source: PALURU_WORK_BUSY_SOURCE, generated_at: generatedAt,
      date: date, intervals: intervals };
  } catch (_) {
    return unavailable('failed');
  }
}
