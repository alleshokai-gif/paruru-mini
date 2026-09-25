(function(root) {
  'use strict';

  const STORAGE_KEY = 'paluru-transport-diagnostics-v1';
  const MAX_RECORDS = 64;
  const REQUEST_CLASSES = new Set(['auth_read', 'kaz_read', 'kaz_answer', 'service_worker']);
  const ACTIONS = new Set([
    'auth.config.get', 'auth.session.resolve',
    'kazOs.projects.get', 'kazOs.work.get', 'kazOs.today.get', 'kazOs.inbox.get', 'kazOs.inbox.answer',
    'service_worker.register', 'service_worker.update', 'service_worker.cache'
  ]);
  const CLASSIFICATIONS = new Set(['none', 'timeout', 'network', 'http', 'parse', 'business', 'cache', 'unknown']);
  const OUTCOMES = new Set(['success', 'retry', 'reconciled', 'unresolved', 'cache_fallback', 'updated']);
  const TRANSPORT_TYPES = new Set(['GAS', 'DIRECT_V2']);
  const SAFE_KEYS = Object.freeze([
    'at', 'requestClass', 'action', 'requestIdSuffix', 'attempt', 'elapsedMs', 'classification',
    'httpStatus', 'backendStage', 'buildId', 'outcome', 'errorCode', 'transportType',
    'serverTotalMs', 'firebaseVerifyMs', 'actorResolveMs', 'upstreamMs', 'serializeMs',
    'questionIdFingerprint', 'questionRevisionFingerprint', 'projectsRevisionFingerprint',
    'workItemsRevisionFingerprint', 'calendarRevisionFingerprint'
  ]);

  function safeEnum_(value, allowed, fallback) {
    const normalized = String(value || '');
    return allowed.has(normalized) ? normalized : fallback;
  }

  function safeCode_(value) {
    const normalized = String(value || '').replace(/[^A-Z0-9_]/g, '').slice(0, 80);
    return normalized || null;
  }

  function safeStage_(value) {
    const normalized = String(value || '').replace(/[^A-Z0-9_]/g, '').slice(0, 80);
    return normalized || null;
  }

  function safeSuffix_(value) {
    const compact = String(value || '').toLowerCase().replace(/[^a-f0-9]/g, '');
    return compact.length >= 8 ? compact.slice(-8) : '';
  }

  function safeInteger_(value, min, max, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
  }

  function safeFingerprint_(value) {
    const normalized = String(value || '').toLowerCase();
    return /^[a-f0-9]{8,12}$/.test(normalized) ? normalized : null;
  }

  async function sha256Prefix_(value) {
    const cryptoApi = root.crypto;
    if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.digest !== 'function'
        || typeof root.TextEncoder !== 'function') return null;
    const digest = await cryptoApi.subtle.digest('SHA-256', new root.TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), function(byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('').slice(0, 12);
  }

  function sanitizeRecord_(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const at = String(value.at || '');
    if (!Number.isFinite(Date.parse(at))) return null;
    const requestClass = safeEnum_(value.requestClass, REQUEST_CLASSES, '');
    const action = safeEnum_(value.action, ACTIONS, '');
    if (!requestClass || !action) return null;
    const record = {
      at,
      requestClass,
      action,
      requestIdSuffix: safeSuffix_(value.requestIdSuffix),
      attempt: safeInteger_(value.attempt, 1, 2, 1),
      elapsedMs: safeInteger_(value.elapsedMs, 0, 600000, 0),
      classification: safeEnum_(value.classification, CLASSIFICATIONS, 'unknown'),
      httpStatus: value.httpStatus == null ? null : safeInteger_(value.httpStatus, 100, 599, null),
      backendStage: safeStage_(value.backendStage),
      buildId: String(value.buildId || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 100),
      outcome: safeEnum_(value.outcome, OUTCOMES, 'unresolved'),
      errorCode: safeCode_(value.errorCode),
      transportType: value.transportType == null ? null : safeEnum_(value.transportType, TRANSPORT_TYPES, null),
      serverTotalMs: value.serverTotalMs == null ? null : safeInteger_(Math.round(Number(value.serverTotalMs)), 0, 600000, null),
      firebaseVerifyMs: value.firebaseVerifyMs == null ? null : safeInteger_(Math.round(Number(value.firebaseVerifyMs)), 0, 600000, null),
      actorResolveMs: value.actorResolveMs == null ? null : safeInteger_(Math.round(Number(value.actorResolveMs)), 0, 600000, null),
      upstreamMs: value.upstreamMs == null ? null : safeInteger_(Math.round(Number(value.upstreamMs)), 0, 600000, null),
      serializeMs: value.serializeMs == null ? null : safeInteger_(Math.round(Number(value.serializeMs)), 0, 600000, null),
      questionIdFingerprint: safeFingerprint_(value.questionIdFingerprint),
      questionRevisionFingerprint: safeFingerprint_(value.questionRevisionFingerprint),
      projectsRevisionFingerprint: safeFingerprint_(value.projectsRevisionFingerprint),
      workItemsRevisionFingerprint: safeFingerprint_(value.workItemsRevisionFingerprint),
      calendarRevisionFingerprint: safeFingerprint_(value.calendarRevisionFingerprint)
    };
    return Object.fromEntries(SAFE_KEYS.map(function(key) { return [key, record[key]]; }));
  }

  function read_() {
    try {
      const parsed = JSON.parse(root.localStorage && root.localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.map(sanitizeRecord_).filter(Boolean).slice(-MAX_RECORDS);
    } catch (_) {
      return [];
    }
  }

  function write_(records) {
    try {
      if (root.localStorage) root.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
    } catch (_) {
      // Diagnostics must never change the request result.
    }
  }

  function requestId() {
    try {
      return root.crypto && typeof root.crypto.randomUUID === 'function' ? root.crypto.randomUUID() : '';
    } catch (_) {
      return '';
    }
  }

  function start(requestClass, action, suppliedRequestId) {
    return Object.freeze({
      requestClass: safeEnum_(requestClass, REQUEST_CLASSES, ''),
      action: safeEnum_(action, ACTIONS, ''),
      requestId: String(suppliedRequestId || requestId()),
      startedAtMs: Date.now()
    });
  }

  function record(context, values) {
    try {
      const input = values && typeof values === 'object' ? values : {};
      const safe = sanitizeRecord_({
        at: new Date().toISOString(),
        requestClass: context && context.requestClass,
        action: context && context.action,
        requestIdSuffix: context && context.requestId,
        attempt: input.attempt,
        elapsedMs: input.elapsedMs == null ? Math.max(0, Date.now() - Number(context && context.startedAtMs || Date.now())) : input.elapsedMs,
        classification: input.classification,
        httpStatus: input.httpStatus,
        backendStage: input.backendStage,
        buildId: typeof root.BUILD_ID === 'string' ? root.BUILD_ID : '',
        outcome: input.outcome,
        errorCode: input.errorCode,
        transportType: input.transportType,
        serverTotalMs: input.serverTotalMs,
        firebaseVerifyMs: input.firebaseVerifyMs,
        actorResolveMs: input.actorResolveMs,
        upstreamMs: input.upstreamMs,
        serializeMs: input.serializeMs,
        questionIdFingerprint: input.questionIdFingerprint,
        questionRevisionFingerprint: input.questionRevisionFingerprint,
        projectsRevisionFingerprint: input.projectsRevisionFingerprint,
        workItemsRevisionFingerprint: input.workItemsRevisionFingerprint,
        calendarRevisionFingerprint: input.calendarRevisionFingerprint
      });
      if (!safe) return null;
      const records = read_();
      records.push(safe);
      write_(records);
      try {
        if (root.console && typeof root.console.info === 'function') root.console.info('[PALURU Transport]', safe);
      } catch (_) {}
      try {
        if (typeof root.CustomEvent === 'function' && root.document && typeof root.document.dispatchEvent === 'function') {
          root.document.dispatchEvent(new root.CustomEvent('paluru:transport-diagnostic', { detail: safe }));
        }
      } catch (_) {}
      return safe;
    } catch (_) {
      return null;
    }
  }

  async function recordInboxRevisionFingerprints(context, value, transportType) {
    try {
      if (!context || context.action !== 'kazOs.inbox.get'
          || !TRANSPORT_TYPES.has(String(transportType || ''))) return 0;
      const items = value && Array.isArray(value.inbox_items) ? value.inbox_items.slice(0, 30) : [];
      let recorded = 0;
      for (const item of items) {
        const refs = item && item.source_revision_references;
        const raw = [item && item.id, item && item.question_revision,
          refs && refs.projects, refs && refs.work_items, refs && refs.calendar];
        if (!raw.every(entry => typeof entry === 'string' && entry.length > 0)) continue;
        const fingerprints = await Promise.all(raw.map(sha256Prefix_));
        if (!fingerprints.every(Boolean)) return recorded;
        const safe = record(context, {
          attempt: 1,
          elapsedMs: 0,
          classification: 'none',
          outcome: 'success',
          transportType,
          questionIdFingerprint: fingerprints[0],
          questionRevisionFingerprint: fingerprints[1],
          projectsRevisionFingerprint: fingerprints[2],
          workItemsRevisionFingerprint: fingerprints[3],
          calendarRevisionFingerprint: fingerprints[4]
        });
        if (safe) recorded += 1;
      }
      return recorded;
    } catch (_) {
      return 0;
    }
  }

  function classifyError(error) {
    const classification = String(error && error.transportClassification || '');
    if (CLASSIFICATIONS.has(classification) && classification !== 'none') return classification;
    if (String(error && error.name || error && error.cause && error.cause.name || '') === 'AbortError') return 'timeout';
    if (error instanceof TypeError || error && error.cause instanceof TypeError) return 'network';
    if (Number.isFinite(Number(error && error.httpStatus))) return Number(error.httpStatus) >= 400 ? 'http' : 'parse';
    if (error && error.code && error.code !== 'HOME_CONTROL_UNAVAILABLE' && error.code !== 'TRANSPORT_FAILURE') return 'business';
    return 'unknown';
  }

  function list() {
    return read_().map(function(item) { return Object.assign({}, item); });
  }

  function clear() {
    try { if (root.localStorage) root.localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }

  root.PALURUTransportDiagnostics = Object.freeze({
    start,
    record,
    recordInboxRevisionFingerprints,
    classifyError,
    list,
    clear,
    requestId,
    storageKey: STORAGE_KEY,
    maxRecords: MAX_RECORDS
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
