// Manual, read-only Kaz OS INBOX production diagnostic.
// Run from the Apps Script editor only. It never mutates Notion, Calendar,
// Context, or the decision ledger. Output is bounded metadata only.
function diagnoseKazOsInboxProduction() {
  const result = {
    diagnostic: 'kaz-os-inbox-production-v1',
    stage: 'START',
    ok: false,
    detail: null
  };

  function safeLog_() {
    const text = JSON.stringify(result);
    if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') Logger.log('[KAZ_OS_INBOX_DIAGNOSTIC] ' + text);
    if (typeof console !== 'undefined' && typeof console.log === 'function') console.log('[KAZ_OS_INBOX_DIAGNOSTIC] ' + text);
    return result;
  }

  function safeError_(stage, error) {
    const code = String(error && error.code || '');
    result.stage = stage;
    result.ok = false;
    result.detail = {
      error_code: code && /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'UNCLASSIFIED_ERROR'
    };
    return safeLog_();
  }

  let observed;
  try {
    result.stage = 'READ_START';
    const trace = createKazOsInboxTrace_(Utilities.getUuid());
    if (!trace) throw homeMembershipError_('KAZ_REQUEST_ID_INVALID');
    observed = readKazOsInbox_(trace);
    result.stage = 'READ_OK';
    result.detail = summarizeKazOsInboxDiagnosticPayload_(observed);
  } catch (error) {
    return safeError_('READ_FAILED', error);
  }

  let sanitized;
  try {
    sanitized = sanitizeKazOsInbox_(observed);
    result.stage = 'SANITIZE_OK';
    result.detail = summarizeKazOsInboxDiagnosticPayload_(sanitized);
  } catch (error) {
    return safeError_('SANITIZE_FAILED', error);
  }

  try {
    const projected = typeof applyKazOsDecisionLedger_ === 'function'
      ? applyKazOsDecisionLedger_(JSON.parse(JSON.stringify(sanitized)))
      : sanitized;
    result.stage = 'LEDGER_OK';
    result.ok = true;
    result.detail = summarizeKazOsInboxDiagnosticPayload_(projected);
    return safeLog_();
  } catch (error) {
    return safeError_('LEDGER_FAILED', error);
  }
}

function summarizeKazOsInboxDiagnosticPayload_(value) {
  const sourceStatus = {};
  const sourceNames = ['inbox', 'projects', 'tasks', 'calendar', 'resolution'];
  sourceNames.forEach(function(name) {
    const source = value && value.sources && value.sources[name];
    sourceStatus[name] = source ? {
      status: typeof source.status === 'string' ? source.status : null,
      complete: typeof source.complete === 'boolean' ? source.complete : null,
      has_fetched_at: typeof source.fetched_at === 'string' && source.fetched_at.length > 0,
      has_valid_until: typeof source.valid_until === 'string' && source.valid_until.length > 0,
      has_source_revision: typeof source.source_revision === 'string' && source.source_revision.length > 0
    } : null;
  });

  return {
    schema_version: value && typeof value.schema_version === 'string' ? value.schema_version : null,
    origin: value && typeof value.origin === 'string' ? value.origin : null,
    mode: value && typeof value.mode === 'string' ? value.mode : null,
    fixture_only: value && typeof value.fixture_only === 'boolean' ? value.fixture_only : null,
    fixture_fallback: value && typeof value.fixture_fallback === 'boolean' ? value.fixture_fallback : null,
    source_status: sourceStatus,
    project_count: Array.isArray(value && value.projects) ? value.projects.length : null,
    work_item_count: Array.isArray(value && value.work_items) ? value.work_items.length : null,
    calendar_event_count: Array.isArray(value && value.calendar_events) ? value.calendar_events.length : null,
    inbox_item_count: Array.isArray(value && value.inbox_items) ? value.inbox_items.length : null,
    persistence_kind: value && value.persistence && typeof value.persistence.kind === 'string' ? value.persistence.kind : null,
    persistence_status: value && value.persistence && typeof value.persistence.status === 'string' ? value.persistence.status : null,
    writes: value && value.writes ? {
      notion: Number.isInteger(value.writes.notion) ? value.writes.notion : null,
      calendar: Number.isInteger(value.writes.calendar) ? value.writes.calendar : null,
      context: Number.isInteger(value.writes.context) ? value.writes.context : null
    } : null
  };
}
