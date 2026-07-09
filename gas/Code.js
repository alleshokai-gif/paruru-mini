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

function doGet(e) {
  try {
    const action = getAction_(e);

    if (action === 'list') {
      return json_({
        success: true,
        data: listInboxItems_(),
        message: 'listed',
      });
    }

    return json_({
      success: false,
      message: 'unknown action',
    });
  } catch (error) {
    return json_({
      success: false,
      message: error.message,
    });
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const action = body.action || 'create';

    if (action === 'update') {
      return updateItem_(body);
    }

    if (action === 'delete') {
      return deleteItem_(body);
    }

    return createItem_(body);
  } catch (error) {
    return json_({
      success: false,
      message: error.message,
    });
  }
}

function createItem_(body) {
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
    body.title || memo.slice(0, 20),
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
}

function updateItem_(body) {
  const id = String(body.id || '').trim();
  if (!id) {
    return json_({ success: false, message: 'id is required' });
  }

  const sheet = getInboxSheet_();
  const index = getHeaderIndex_();
  const rowNumber = findRowNumberById_(sheet, id, index.id + 1);
  if (!rowNumber) {
    return json_({ success: false, message: 'not found' });
  }

  const allowedFields = ['title', 'memo', 'category', 'status', 'priority', 'tags', 'aiComment'];
  allowedFields.forEach(function(field) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      sheet.getRange(rowNumber, index[field] + 1).setValue(body[field]);
    }
  });

  return json_({
    success: true,
    data: { id: id },
    message: 'updated',
  });
}

function deleteItem_(body) {
  const id = String(body.id || '').trim();
  if (!id) {
    return json_({ success: false, message: 'id is required' });
  }

  const sheet = getInboxSheet_();
  const index = getHeaderIndex_();
  const rowNumber = findRowNumberById_(sheet, id, index.id + 1);
  if (!rowNumber) {
    return json_({ success: false, message: 'not found' });
  }

  sheet.deleteRow(rowNumber);

  return json_({
    success: true,
    data: { id: id },
    message: 'deleted',
  });
}

function listInboxItems_() {
  const sheet = getInboxSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }

  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  return values
    .filter(function(row) { return row[0]; })
    .map(function(row) {
      const item = {};
      HEADERS.forEach(function(header, index) {
        const value = row[index];
        item[header] = value instanceof Date ? value.toISOString() : value;
      });
      return item;
    })
    .reverse();
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return {};
  }

  return JSON.parse(e.postData.contents);
}

function getAction_(e) {
  if (!e || !e.parameter) {
    return '';
  }

  return String(e.parameter.action || '');
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
  const hasHeader = HEADERS.every(function(header, index) {
    return firstRow[index] === header;
  });

  if (!hasHeader) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
}

function getHeaderIndex_() {
  return HEADERS.reduce(function(index, header, position) {
    index[header] = position;
    return index;
  }, {});
}

function findRowNumberById_(sheet, id, idColumnNumber) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return 0;
  }

  const ids = sheet.getRange(2, idColumnNumber, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) {
      return i + 2;
    }
  }

  return 0;
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
