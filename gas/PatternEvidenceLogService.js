// Append-only learning evidence. Agent_Trace_Log remains a diagnostic ledger.
const PALURU_PATTERN_EVIDENCE_SHEET_NAME = 'Pattern_Evidence_Log';
const PALURU_PATTERN_EVIDENCE_HEADERS = [
  'record_id', 'record_type', 'recorded_at', 'source_kind', 'session_id',
  'timestamp', 'outcome', 'pattern_key', 'title', 'summary', 'excerpt',
  'target', 'temporary', 'countermeasure_id', 'evidence_record_id',
  'feedback_action', 'payload_hash'
];
const PALURU_PATTERN_EVIDENCE_PAYLOAD_FIELDS = [
  'record_id', 'record_type', 'source_kind', 'session_id', 'timestamp',
  'outcome', 'pattern_key', 'title', 'summary', 'excerpt', 'target',
  'temporary', 'countermeasure_id', 'evidence_record_id', 'feedback_action'
];
const PALURU_PATTERN_EVIDENCE_MAX_BATCH = 10;

function persistPatternEvidenceFromProducerDtos_(value) {
  if (value === undefined) return { appended: 0, noOp: 0 };
  if (!Array.isArray(value) || value.length > PALURU_PATTERN_EVIDENCE_MAX_BATCH) {
    throw new Error('PATTERN_EVIDENCE_BATCH_INVALID');
  }
  if (!value.length) return { appended: 0, noOp: 0 };

  const dtos = value.map(normalizePatternEvidenceProducerDto_);
  const pending = Object.create(null);
  dtos.forEach(function(dto) {
    const current = pending[dto.record_id];
    if (current && current.payload_hash !== dto.payload_hash) {
      throw new Error('PATTERN_EVIDENCE_ID_CONFLICT');
    }
    pending[dto.record_id] = dto;
  });

  let lock = null;
  try {
    if (typeof SpreadsheetApp === 'undefined' || !SpreadsheetApp.getActiveSpreadsheet) {
      throw new Error('PATTERN_EVIDENCE_SPREADSHEET_UNAVAILABLE');
    }
    if (typeof LockService === 'undefined' || !LockService.getScriptLock) {
      throw new Error('PATTERN_EVIDENCE_LOCK_UNAVAILABLE');
    }
    lock = LockService.getScriptLock();
    lock.waitLock(5000);
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName(PALURU_PATTERN_EVIDENCE_SHEET_NAME)
      || spreadsheet.insertSheet(PALURU_PATTERN_EVIDENCE_SHEET_NAME);
    ensurePatternEvidenceHeaders_(sheet);

    const existing = Object.create(null);
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      ids.forEach(function(row, index) {
        const recordId = String(row[0] || '');
        if (!recordId) throw new Error('PATTERN_EVIDENCE_ROW_INVALID');
        if (existing[recordId]) throw new Error('PATTERN_EVIDENCE_DUPLICATE_ID');
        existing[recordId] = index + 2;
      });
    }

    const newRows = [];
    let noOp = 0;
    const evidenceIds = Object.create(null);
    Object.keys(pending).forEach(function(recordId) {
      const dto = pending[recordId];
      if (dto.record_type === 'EVIDENCE') evidenceIds[recordId] = true;
      const existingRow = existing[recordId];
      if (!existingRow) {
        newRows.push(dto);
        return;
      }
      const stored = sheet.getRange(existingRow, 1, 1, PALURU_PATTERN_EVIDENCE_HEADERS.length).getValues()[0];
      if (String(stored[16] || '') !== dto.payload_hash) {
        throw new Error('PATTERN_EVIDENCE_ID_CONFLICT');
      }
      if (patternEvidenceStoredPayloadHash_(stored) !== dto.payload_hash) {
        throw new Error('PATTERN_EVIDENCE_EXISTING_ROW_INVALID');
      }
      noOp += 1;
    });

    newRows.forEach(function(dto) {
      if (dto.record_type !== 'FEEDBACK') return;
      const targetRow = existing[dto.evidence_record_id];
      if (targetRow) {
        const target = sheet.getRange(targetRow, 1, 1, PALURU_PATTERN_EVIDENCE_HEADERS.length).getValues()[0];
        if (String(target[1] || '') !== 'EVIDENCE') throw new Error('PATTERN_EVIDENCE_FEEDBACK_TARGET_INVALID');
      } else if (!evidenceIds[dto.evidence_record_id]) {
        throw new Error('PATTERN_EVIDENCE_FEEDBACK_TARGET_MISSING');
      }
    });

    if (newRows.length) {
      const recordedAt = Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX");
      const firstRow = sheet.getLastRow() + 1;
      const rows = newRows.map(function(dto) {
        return [
          dto.record_id, dto.record_type, recordedAt, dto.source_kind, dto.session_id,
          dto.timestamp, dto.outcome, dto.pattern_key, dto.title, dto.summary, dto.excerpt,
          dto.target, dto.temporary ? 'TRUE' : (dto.record_type === 'EVIDENCE' ? 'FALSE' : ''),
          dto.countermeasure_id, dto.evidence_record_id, dto.feedback_action, dto.payload_hash
        ];
      });
      const range = sheet.getRange(firstRow, 1, rows.length, PALURU_PATTERN_EVIDENCE_HEADERS.length);
      range.setNumberFormat('@');
      range.setValues(rows);
    }
    return { appended: newRows.length, noOp: noOp };
  } catch (error) {
    if (error && /^PATTERN_EVIDENCE_[A-Z_]+$/.test(String(error.message || ''))) throw error;
    throw new Error('PATTERN_EVIDENCE_WRITE_FAILED');
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (releaseError) { /* no-op */ }
    }
  }
}

function normalizePatternEvidenceProducerDto_(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('PATTERN_EVIDENCE_DTO_INVALID');
  }
  const type = String(value.record_type || '');
  const evidenceFields = [
    'record_id', 'record_type', 'source_kind', 'session_id', 'timestamp', 'outcome',
    'pattern_key', 'title', 'summary', 'excerpt', 'target', 'temporary', 'countermeasure_id'
  ];
  const feedbackFields = ['record_id', 'record_type', 'timestamp', 'evidence_record_id', 'feedback_action'];
  const allowed = type === 'EVIDENCE' ? evidenceFields : type === 'FEEDBACK' ? feedbackFields : [];
  if (!allowed.length || Object.keys(value).some(function(key) { return allowed.indexOf(key) < 0; })) {
    throw new Error('PATTERN_EVIDENCE_DTO_FIELDS_INVALID');
  }

  const dto = {
    record_id: patternEvidenceId_(value.record_id, 'PATTERN_EVIDENCE_RECORD_ID_INVALID'),
    record_type: type,
    source_kind: '', session_id: '', timestamp: patternEvidenceTimestamp_(value.timestamp),
    outcome: '', pattern_key: '', title: '', summary: '', excerpt: '', target: '',
    temporary: false, countermeasure_id: '', evidence_record_id: '', feedback_action: ''
  };
  if (type === 'EVIDENCE') {
    dto.source_kind = String(value.source_kind || '');
    if (dto.source_kind !== 'EXECUTION' && dto.source_kind !== 'CONTEXT') {
      throw new Error('PATTERN_EVIDENCE_SOURCE_KIND_INVALID');
    }
    dto.session_id = patternEvidenceId_(value.session_id, 'PATTERN_EVIDENCE_SESSION_ID_INVALID');
    dto.outcome = String(value.outcome || '');
    if (dto.outcome !== 'FAILURE' && dto.outcome !== 'SUCCESS') throw new Error('PATTERN_EVIDENCE_OUTCOME_INVALID');
    dto.pattern_key = String(value.pattern_key || '');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(dto.pattern_key)) throw new Error('PATTERN_EVIDENCE_KEY_INVALID');
    dto.title = patternEvidenceText_(value.title, 160, false);
    dto.summary = patternEvidenceText_(value.summary, 500, false);
    dto.excerpt = patternEvidenceText_(value.excerpt, 280, true);
    dto.target = String(value.target || '');
    if (dto.target && ['CONTEXT', 'SKILL', 'BOTH'].indexOf(dto.target) < 0) throw new Error('PATTERN_EVIDENCE_TARGET_INVALID');
    dto.temporary = value.temporary === undefined ? false : value.temporary;
    if (typeof dto.temporary !== 'boolean') throw new Error('PATTERN_EVIDENCE_TEMPORARY_INVALID');
    dto.countermeasure_id = value.countermeasure_id === undefined || value.countermeasure_id === null || value.countermeasure_id === ''
      ? '' : patternEvidenceCountermeasureId_(value.countermeasure_id);
  } else {
    dto.evidence_record_id = patternEvidenceId_(value.evidence_record_id, 'PATTERN_EVIDENCE_FEEDBACK_TARGET_INVALID');
    dto.feedback_action = String(value.feedback_action || '');
    if (dto.feedback_action !== 'CONFIRM' && dto.feedback_action !== 'REJECT') {
      throw new Error('PATTERN_EVIDENCE_FEEDBACK_ACTION_INVALID');
    }
  }
  dto.payload_hash = patternEvidencePayloadHash_(dto);
  return dto;
}

function ensurePatternEvidenceHeaders_(sheet) {
  const lastColumn = Math.max(0, sheet.getLastColumn());
  const current = lastColumn ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
  if (!current.length || current.every(function(value) { return !value; })) {
    if (sheet.getLastRow() > 0) throw new Error('PATTERN_EVIDENCE_SCHEMA_MISMATCH');
    sheet.getRange(1, 1, 1, PALURU_PATTERN_EVIDENCE_HEADERS.length).setValues([PALURU_PATTERN_EVIDENCE_HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }
  if (current.length !== PALURU_PATTERN_EVIDENCE_HEADERS.length
      || current.some(function(value, index) { return value !== PALURU_PATTERN_EVIDENCE_HEADERS[index]; })) {
    throw new Error('PATTERN_EVIDENCE_SCHEMA_MISMATCH');
  }
}

function patternEvidencePayloadHash_(dto) {
  const payload = PALURU_PATTERN_EVIDENCE_PAYLOAD_FIELDS.map(function(field) { return dto[field]; });
  return patternEvidenceSha256_(JSON.stringify(payload));
}

function patternEvidenceStoredPayloadHash_(row) {
  const dto = {
    record_id: row[0], record_type: row[1], source_kind: row[3], session_id: row[4],
    timestamp: row[5], outcome: row[6], pattern_key: row[7], title: row[8],
    summary: row[9], excerpt: row[10], target: row[11],
    temporary: row[12] === true || row[12] === 'TRUE' || row[12] === 'true',
    countermeasure_id: row[13], evidence_record_id: row[14], feedback_action: row[15]
  };
  return patternEvidencePayloadHash_(dto);
}

function patternEvidenceSha256_(text) {
  if (typeof Utilities === 'undefined' || !Utilities.computeDigest) {
    throw new Error('PATTERN_EVIDENCE_HASH_UNAVAILABLE');
  }
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return digest.map(function(value) { return ('0' + ((value + 256) % 256).toString(16)).slice(-2); }).join('');
}

function patternEvidenceId_(value, code) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(normalized)) throw new Error(code);
  return normalized;
}

function patternEvidenceCountermeasureId_(value) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(normalized)) {
    throw new Error('PATTERN_EVIDENCE_COUNTERMEASURE_INVALID');
  }
  return normalized;
}

function patternEvidenceTimestamp_(value) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)
      || !Number.isFinite(Date.parse(normalized))) {
    throw new Error('PATTERN_EVIDENCE_TIMESTAMP_INVALID');
  }
  return normalized;
}

function patternEvidenceText_(value, limit, required) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) {
    throw new Error('PATTERN_EVIDENCE_TEXT_INVALID');
  }
  const normalized = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.length > limit || /(?:https?:\/\/|www\.)|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\bBearer\s+|\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,})\b/i.test(normalized)
      || /^[=+@]/.test(normalized)) {
    throw new Error('PATTERN_EVIDENCE_PRIVACY_REJECTED');
  }
  return normalized;
}
