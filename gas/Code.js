const SHEET_NAME = '01_Inbox';
const HEADERS = [
  'id',
  'createdAt',
  'title',
  'memo',
  'category',
  'status',
  'priority',
  'source',
  'tags',
  'aiComment',
];

function doPost(e) {
  try {
    const body = parseBody_(e);
    const memo = String(body.memo || '').trim();

    if (!memo) {
      return json_({
        success: false,
        message: 'memo is required',
      });
    }

    const id = Utilities.getUuid();
    const row = [
      id,
      new Date(),
      memo.slice(0, 20),
      memo,
      body.category || '未分類',
      'Inbox',
      body.priority || 'Normal',
      'PWA',
      body.tags || '',
      '',
    ];

    const sheet = getInboxSheet_();
    sheet.appendRow(row);

    return json_({
      success: true,
      data: { id },
      message: 'saved',
    });
  } catch (error) {
    return json_({
      success: false,
      message: error.message,
    });
  }
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }

  return JSON.parse(e.postData.contents);
}

function getInboxSheet_() {
  const spreadsheet = getOrCreateSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  ensureHeader_(sheet);
  return sheet;
}

function getOrCreateSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureHeader_(sheet) {
  const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const hasHeader = HEADERS.every((header, index) => firstRow[index] === header);

  if (!hasHeader) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
