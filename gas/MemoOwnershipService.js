const MEMO_OWNERSHIP_SHEET_NAME = '01_Inbox';
const MEMO_OWNERSHIP_HEADERS = Object.freeze(['ownerUserId', 'createdByUserId']);
const MEMO_OWNERSHIP_REQUIRED_HEADERS = Object.freeze(['id', 'memo']);
const LEGACY_MEMO_OWNER_USER_ID = 'father';

// Trusted operator-only maintenance function. Run manually from the Apps Script editor; never route from doPost.
function setupMemoOwnershipSchema() {
  const sheet = getMemoOwnershipSheet_();
  const schema = getMemoOwnershipSchema_(sheet, false);
  const missingHeaders = MEMO_OWNERSHIP_HEADERS.filter(function(header) {
    return schema.index[header] === undefined;
  });

  if (missingHeaders.length > 0) {
    sheet.getRange(1, schema.lastColumn + 1, 1, missingHeaders.length).setValues([missingHeaders]);
    sheet.setFrozenRows(1);
  }

  return {
    addedHeaders: missingHeaders.slice(),
    addedHeaderCount: missingHeaders.length,
  };
}

// Trusted operator-only audit. Run manually from the Apps Script editor; counts never include memo text or row contents.
function auditLegacyMemoOwnership() {
  const sheet = getMemoOwnershipSheet_();
  const schema = getMemoOwnershipSchema_(sheet, true);
  const ownerColumn = schema.index.ownerUserId + 1;
  const creatorColumn = schema.index.createdByUserId + 1;
  const rowCount = Math.max(sheet.getLastRow() - 1, 0);
  let ownerUnsetCount = 0;
  let ownerSetCount = 0;

  if (rowCount > 0) {
    const owners = sheet.getRange(2, ownerColumn, rowCount, 1).getValues();
    const creators = sheet.getRange(2, creatorColumn, rowCount, 1).getValues();
    owners.forEach(function(row, position) {
      const owner = String(row[0] || '').trim();
      const creator = String(creators[position][0] || '').trim();
      if (Boolean(owner) !== Boolean(creator)) {
        throw createMemoOwnershipError_('MEMO_OWNERSHIP_INCONSISTENT');
      }
      if (owner) {
        ownerSetCount += 1;
      } else {
        ownerUnsetCount += 1;
      }
    });
  }

  return {
    ownerUnsetCount: ownerUnsetCount,
    ownerSetCount: ownerSetCount,
    duplicateHeaders: [],
  };
}

// Trusted operator-only migration. Run manually from the Apps Script editor; existing ownership is never overwritten.
function migrateLegacyMemosToFather() {
  const sheet = getMemoOwnershipSheet_();
  const schema = getMemoOwnershipSchema_(sheet, true);
  const rowCount = Math.max(sheet.getLastRow() - 1, 0);
  const ownerColumn = schema.index.ownerUserId + 1;
  const creatorColumn = schema.index.createdByUserId + 1;
  let migratedCount = 0;

  if (rowCount === 0) {
    return { migratedCount: migratedCount };
  }

  const owners = sheet.getRange(2, ownerColumn, rowCount, 1).getValues();
  const creators = sheet.getRange(2, creatorColumn, rowCount, 1).getValues();
  const rowsToMigrate = [];

  owners.forEach(function(ownerRow, position) {
    const owner = String(ownerRow[0] || '').trim();
    const creator = String(creators[position][0] || '').trim();
    if (!owner && creator) {
      throw createMemoOwnershipError_('MEMO_OWNERSHIP_INCONSISTENT');
    }
    if (owner && !creator) {
      throw createMemoOwnershipError_('MEMO_OWNERSHIP_INCONSISTENT');
    }
    if (!owner) {
      rowsToMigrate.push(position + 2);
    }
  });

  rowsToMigrate.forEach(function(rowNumber) {
    sheet.getRange(rowNumber, ownerColumn, 1, 1).setValues([[LEGACY_MEMO_OWNER_USER_ID]]);
    sheet.getRange(rowNumber, creatorColumn, 1, 1).setValues([[LEGACY_MEMO_OWNER_USER_ID]]);
  });
  migratedCount = rowsToMigrate.length;

  return { migratedCount: migratedCount };
}

function getMemoOwnershipSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet && spreadsheet.getSheetByName(MEMO_OWNERSHIP_SHEET_NAME);
  if (!sheet) {
    throw createMemoOwnershipError_('MEMO_OWNERSHIP_CONFIGURATION_ERROR');
  }
  return sheet;
}

function getMemoOwnershipSchema_(sheet, requireOwnershipHeaders) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) {
    throw createMemoOwnershipError_('MEMO_OWNERSHIP_CONFIGURATION_ERROR');
  }
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function(header) {
    return String(header || '').trim();
  });
  const index = {};
  headers.forEach(function(header, position) {
    if (!header) return;
    if (index[header] !== undefined) {
      throw createMemoOwnershipError_('MEMO_OWNERSHIP_CONFIGURATION_ERROR');
    }
    index[header] = position;
  });
  MEMO_OWNERSHIP_REQUIRED_HEADERS.forEach(function(header) {
    if (index[header] === undefined) {
      throw createMemoOwnershipError_('MEMO_OWNERSHIP_CONFIGURATION_ERROR');
    }
  });
  if (requireOwnershipHeaders) {
    MEMO_OWNERSHIP_HEADERS.forEach(function(header) {
      if (index[header] === undefined) {
        throw createMemoOwnershipError_('MEMO_OWNERSHIP_CONFIGURATION_ERROR');
      }
    });
  }
  return { index: index, lastColumn: lastColumn };
}

function createMemoOwnershipError_(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
