// Internal source-change notification only. PWA reads never call this endpoint.
const KAZ_OS_V3_REBUILD_ENDPOINT_ = 'https://kaz-os-v3-shadow-preview-898497371682.asia-northeast1.run.app/v3/rebuild';
const KAZ_OS_V3_REBUILD_REASONS_ = Object.freeze({
  WORK_DONE: 'work', WORK_CREATE: 'work', WORK_UPDATE: 'work',
  PROJECT_UPDATE: 'projects', CAPA_CREATE: 'capa', CAPA_UPDATE: 'capa',
  INBOX_ANSWER: 'inbox', WORK_BUSY_IMPORT: 'work_busy',
  CALENDAR_CHANGED: 'calendar', RECONCILE: 'reconcile'
});

function requestKazOsV3Rebuild_(reason, source, correlationId, dependencies) {
  const deps = dependencies || {};
  if (!Object.prototype.hasOwnProperty.call(KAZ_OS_V3_REBUILD_REASONS_, reason)
      || KAZ_OS_V3_REBUILD_REASONS_[reason] !== source
      || !/^[A-Za-z0-9:_-]{8,256}$/.test(String(correlationId || ''))) {
    throw kazOsV3RebuildError_('REBUILD_REQUEST_INVALID');
  }
  const token = deps.token != null ? String(deps.token || '').trim() : String(getKazOsProgressReadToken_() || '').trim();
  if (token.length < 32) throw kazOsV3RebuildError_('REBUILD_AUTH_UNAVAILABLE');
  const fetch = deps.fetch || UrlFetchApp.fetch;
  let response;
  try {
    response = fetch(KAZ_OS_V3_REBUILD_ENDPOINT_, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ reason: reason, source: source,
        correlation_id: String(correlationId) }),
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true, followRedirects: false,
      validateHttpsCertificates: true
    });
  } catch (_) {
    throw kazOsV3RebuildError_('REBUILD_REQUEST_UNAVAILABLE');
  }
  const status = response.getResponseCode();
  if (status !== 200 && status !== 202) {
    throw kazOsV3RebuildError_('REBUILD_REQUEST_UNAVAILABLE');
  }
  let body;
  try { body = JSON.parse(response.getContentText()); }
  catch (_) { throw kazOsV3RebuildError_('REBUILD_RESPONSE_INVALID'); }
  if (!body || !/^[a-f0-9]{64}$/.test(String(body.event_id || ''))
      || (status === 200 && body.status !== 'already_published')
      || (status === 202 && body.status !== 'requested')) {
    throw kazOsV3RebuildError_('REBUILD_RESPONSE_INVALID');
  }
  return { status: body.status, event_id: body.event_id };
}

function kazOsV3RebuildError_(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}


function diagnoseKazOsV3RebuildProduction() {
  const result = {
    diagnostic: 'kaz-os-v3-rebuild-production-v1',
    ok: false,
    stage: 'START',
    detail: null
  };

  try {
    result.stage = 'SECRET_READ';
    const token = String(getKazOsProgressReadToken_() || '').trim();
    if (token.length < 32) throw kazOsV3RebuildError_('REBUILD_AUTH_UNAVAILABLE');

    result.stage = 'REQUEST';
    const correlation = 'diagnostic-' + Utilities.getUuid().replace(/-/g, '').slice(0, 24);
    const response = UrlFetchApp.fetch(KAZ_OS_V3_REBUILD_ENDPOINT_, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        reason: 'RECONCILE',
        source: 'reconcile',
        correlation_id: correlation
      }),
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
      followRedirects: false,
      validateHttpsCertificates: true
    });

    const status = response.getResponseCode();
    let body = null;
    try { body = JSON.parse(response.getContentText()); } catch (_) {}

    result.stage = 'RESPONSE';
    result.detail = {
      http_status: status,
      status: body && typeof body.status === 'string' ? body.status : null,
      has_event_id: Boolean(body && /^[a-f0-9]{64}$/.test(String(body.event_id || '')))
    };
    result.ok = (status === 200 && result.detail.status === 'already_published')
      || (status === 202 && result.detail.status === 'requested');

    if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
      Logger.log('[KAZ_OS_V3_REBUILD_DIAGNOSTIC] ' + JSON.stringify(result));
    }
    return result;
  } catch (error) {
    result.stage = 'FAILED';
    result.detail = {
      error_code: /^[A-Z0-9_]{1,80}$/.test(String(error && error.code || ''))
        ? String(error.code) : 'UNCLASSIFIED_ERROR'
    };
    if (typeof Logger !== 'undefined' && typeof Logger.log === 'function') {
      Logger.log('[KAZ_OS_V3_REBUILD_DIAGNOSTIC] ' + JSON.stringify(result));
    }
    return result;
  }
}
