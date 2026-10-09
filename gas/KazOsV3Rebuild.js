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
  const properties = deps.properties || PropertiesService.getScriptProperties();
  const token = String(properties.getProperty('KAZ_OS_PROGRESS_READ_TOKEN') || '');
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
