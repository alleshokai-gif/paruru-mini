const FAMILY_INBOX_SETUP_RESULTS = Object.freeze({
  CREATED: 'CREATED',
  VERIFIED: 'VERIFIED',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
});

function setupFamilyInboxSchema() {
  let lock;
  try {
    const spreadsheetId = String(PropertiesService.getScriptProperties().getProperty(FAMILY_INBOX_PROPERTIES.spreadsheetId) || '').trim();
    if (!spreadsheetId) return FAMILY_INBOX_SETUP_RESULTS.CONFIGURATION_ERROR;
    lock = LockService.getScriptLock();
    lock.waitLock(30000);
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const definitions = familyInboxSetupDefinitions_();
    const plans = definitions.map(function(definition) {
      return familyInboxSetupInspect_(spreadsheet.getSheetByName(definition.name), definition);
    });
    if (plans.some(function(plan) { return plan.invalid; })) return FAMILY_INBOX_SETUP_RESULTS.CONFIGURATION_ERROR;
    let changed = false;
    plans.forEach(function(plan, index) {
      const definition = definitions[index];
      let sheet = plan.sheet;
      if (!sheet) {
        sheet = spreadsheet.insertSheet(definition.name);
        changed = true;
      }
      if (familyInboxSetupEnsureColumns_(sheet, definition.headers.length)) changed = true;
      if (plan.missingHeaders.length) {
        sheet.getRange(1, plan.headerCount + 1, 1, plan.missingHeaders.length).setValues([plan.missingHeaders]);
        changed = true;
      }
    });
    return changed ? FAMILY_INBOX_SETUP_RESULTS.CREATED : FAMILY_INBOX_SETUP_RESULTS.VERIFIED;
  } catch (_) {
    return FAMILY_INBOX_SETUP_RESULTS.CONFIGURATION_ERROR;
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
}

function familyInboxSetupDefinitions_() {
  const candidateBaseHeaders = FAMILY_INBOX_CANDIDATE_HEADERS.slice();
  const candidateReviewHeaders = candidateBaseHeaders.concat(FAMILY_INBOX_REVIEW_EXTRA_HEADERS);
  const candidatePcReviewHeaders = candidateReviewHeaders.concat(FAMILY_INBOX_PC_REVIEW_CANDIDATE_HEADERS);
  return [
    {
      name: FAMILY_INBOX_SHEET_NAME,
      headers: FAMILY_INBOX_HEADERS.slice(),
      migrationStages: [FAMILY_INBOX_HEADERS.slice()],
    },
    {
      name: FAMILY_INBOX_CANDIDATE_SHEET_NAME,
      headers: candidatePcReviewHeaders,
      migrationStages: [candidateBaseHeaders, candidateReviewHeaders, candidatePcReviewHeaders],
    },
    {
      name: FAMILY_INBOX_PC_REVIEW_SHEET_NAME,
      headers: FAMILY_INBOX_PC_REVIEW_HEADERS.slice(),
      migrationStages: [FAMILY_INBOX_PC_REVIEW_HEADERS.slice()],
    },
  ];
}

function familyInboxSetupInspect_(sheet, definition) {
  if (!sheet) return { sheet: null, headerCount: 0, missingHeaders: definition.headers.slice(), invalid: false };
  const lastRow = Number(sheet.getLastRow());
  const lastColumn = Number(sheet.getLastColumn());
  if (!isFinite(lastRow) || lastRow < 0 || !isFinite(lastColumn) || lastColumn < 0) return { invalid: true };
  const headers = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function(value) { return String(value || '').trim(); })
    : [];
  const hasData = lastRow > 1;
  if (!headers.length) {
    return {
      sheet: sheet,
      headerCount: 0,
      missingHeaders: hasData ? [] : definition.headers.slice(),
      invalid: hasData,
    };
  }
  const invalidHeader = headers.some(function(header, index) {
    return !header || headers.indexOf(header) !== index || definition.headers.indexOf(header) < 0;
  });
  const knownStage = !invalidHeader && definition.migrationStages.some(function(stage) {
    return stage.length === headers.length && stage.every(function(header) { return headers.indexOf(header) >= 0; });
  });
  return {
    sheet: sheet,
    headerCount: headers.length,
    missingHeaders: knownStage ? definition.headers.filter(function(header) { return headers.indexOf(header) < 0; }) : [],
    invalid: !knownStage,
  };
}

function familyInboxSetupEnsureColumns_(sheet, requiredColumns) {
  const currentColumns = Number(sheet.getMaxColumns());
  if (!isFinite(currentColumns) || currentColumns < 1) throw new Error('CONFIGURATION_ERROR');
  if (currentColumns >= requiredColumns) return false;
  sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
  return true;
}
