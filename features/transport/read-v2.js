(function(root) {
  'use strict';

  const MODES = Object.freeze({ GAS: 'GAS', DIRECT_V2: 'DIRECT_V2' });
  const ROUTES = Object.freeze({
    projects: Object.freeze({ path: '/v2/read/projects', action: 'kazOs.projects.get' }),
    work: Object.freeze({ path: '/v2/read/work', action: 'kazOs.work.get' })
  });

  function codedError_(code, details) {
    const error = new Error(String(code || 'DIRECT_READ_FAILED'));
    error.code = String(code || 'DIRECT_READ_FAILED');
    const input = details && typeof details === 'object' ? details : {};
    if (Number.isFinite(Number(input.httpStatus))) error.httpStatus = Number(input.httpStatus);
    if (input.cause) error.cause = input.cause;
    if (input.transportClassification) error.transportClassification = String(input.transportClassification);
    return error;
  }

  function normalizeConfig_(input) {
    const source = input && typeof input === 'object' ? input : {};
    const mode = source.mode === MODES.DIRECT_V2 ? MODES.DIRECT_V2 : MODES.GAS;
    const baseUrl = String(source.baseUrl || '').replace(/\/+$/, '');
    const canaryCapability = String(source.canaryCapability || '');
    if (mode === MODES.DIRECT_V2 && !/^https:\/\/[^/]+(?:\/[^?#]*)?$/.test(baseUrl)) {
      throw codedError_('DIRECT_READ_CONFIG_INVALID', { transportClassification: 'business' });
    }
    if (mode === MODES.DIRECT_V2 && canaryCapability
        && !/^[a-z][a-z0-9_.-]{2,79}$/.test(canaryCapability)) {
      throw codedError_('DIRECT_READ_CONFIG_INVALID', { transportClassification: 'business' });
    }
    return Object.freeze({ mode, baseUrl, canaryCapability });
  }

  function selectMode(input, membership) {
    const config = normalizeConfig_(input);
    const context = membership && typeof membership === 'object' ? membership : {};
    const capabilities = Array.isArray(context.capabilities) ? context.capabilities : [];
    if (config.mode !== MODES.DIRECT_V2) return MODES.GAS;
    return context.role === 'admin'
      && (!config.canaryCapability || capabilities.includes(config.canaryCapability))
      ? MODES.DIRECT_V2 : MODES.GAS;
  }

  function validateSource_(value, sourceName) {
    const source = value && value.sources && value.sources[sourceName];
    const rows = value && value[sourceName];
    return value && value.mode === 'read_only'
      && value.fixture_only === false
      && source && source.status === 'ok' && source.complete === true
      && Array.isArray(rows);
  }

  function validateProjects_(value) {
    if (!validateSource_(value, 'projects')) throw codedError_('PROJECTS_CONTRACT_INVALID', { transportClassification: 'parse' });
    return value;
  }

  function validateWork_(value) {
    const writes = value && value.writes;
    if (!validateSource_(value, 'work_items') || !writes
        || writes.notion !== 0 || writes.calendar !== 0 || writes.context !== 0) {
      throw codedError_('WORK_CONTRACT_INVALID', { transportClassification: 'parse' });
    }
    return value;
  }

  function parseTiming_(value) {
    const result = {};
    String(value || '').split(',').forEach(function(part) {
      const match = /^\s*([a-z]+);dur=([0-9]+(?:\.[0-9]+)?)\s*$/.exec(part);
      if (match) result[match[1]] = Math.max(0, Number(match[2]));
    });
    return result;
  }

  function retryable_(error) {
    if (!error) return false;
    if (Number.isFinite(error.httpStatus)) return error.httpStatus >= 500;
    const name = String(error.name || error.cause && error.cause.name || '');
    return name === 'AbortError' || error instanceof TypeError || error.cause instanceof TypeError;
  }

  function create(options) {
    const source = options && typeof options === 'object' ? options : {};
    const config = normalizeConfig_(source.config);
    const fetchImpl = source.fetchImpl || root.fetch;
    const getAuthEnvelope = source.getAuthEnvelope;
    const diagnostics = source.diagnostics || null;
    const timeoutMs = Number(source.timeoutMs);
    const retryDelayMs = Number(source.retryDelayMs);
    if (typeof fetchImpl !== 'function' || typeof getAuthEnvelope !== 'function'
        || !Number.isInteger(timeoutMs) || timeoutMs <= 0
        || !Number.isInteger(retryDelayMs) || retryDelayMs < 0) {
      throw codedError_('DIRECT_READ_CONFIG_INVALID', { transportClassification: 'business' });
    }

    async function read_(route, validator) {
      if (config.mode !== MODES.DIRECT_V2) {
        throw codedError_('DIRECT_READ_NOT_SELECTED', { transportClassification: 'business' });
      }
      const requestId = String(diagnostics && diagnostics.requestId ? diagnostics.requestId() : '');
      if (!requestId) throw codedError_('DIRECT_READ_REQUEST_ID_UNAVAILABLE', { transportClassification: 'business' });
      const diagnostic = diagnostics && diagnostics.start
        ? diagnostics.start('kaz_read', route.action, requestId)
        : null;
      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const startedAt = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(function() { controller.abort(); }, timeoutMs);
        try {
          const auth = await getAuthEnvelope(false);
          const token = String(auth && auth.provider === 'firebase' && auth.idToken || '');
          if (!token) throw codedError_('AUTHENTICATION_REQUIRED', { transportClassification: 'business' });
          const response = await fetchImpl(config.baseUrl + route.path, {
            method: 'GET',
            cache: 'no-store',
            redirect: 'error',
            headers: {
              Authorization: 'Bearer ' + token,
              'X-Paluru-Request-Id': requestId
            },
            signal: controller.signal
          });
          const timings = parseTiming_(response.headers && response.headers.get('Server-Timing'));
          if (!response.ok) {
            let code = response.status === 401 ? 'AUTHENTICATION_REQUIRED'
              : response.status === 403 ? 'FORBIDDEN' : 'DIRECT_READ_FAILED';
            try {
              const body = await response.clone().json();
              if (body && body.error && /^[A-Z0-9_]{1,80}$/.test(String(body.error.code || ''))) code = body.error.code;
            } catch (_) {}
            throw codedError_(code, { httpStatus: response.status, transportClassification: 'http' });
          }
          let value;
          try { value = await response.json(); }
          catch (cause) { throw codedError_('DIRECT_READ_RESPONSE_INVALID', { httpStatus: response.status, cause, transportClassification: 'parse' }); }
          value = validator(value);
          if (diagnostics && diagnostics.record) diagnostics.record(diagnostic, {
            attempt: attempt + 1,
            elapsedMs: Date.now() - startedAt,
            classification: 'none',
            httpStatus: response.status,
            backendStage: 'DIRECT_COMPLETE',
            transportType: MODES.DIRECT_V2,
            serverTotalMs: timings.total,
            firebaseVerifyMs: timings.firebase,
            actorResolveMs: timings.actor,
            upstreamMs: timings.upstream,
            serializeMs: timings.serialize,
            outcome: 'success'
          });
          return value;
        } catch (error) {
          lastError = error instanceof Error ? error : codedError_('DIRECT_READ_FAILED', { transportClassification: 'unknown' });
          const shouldRetry = attempt === 0 && retryable_(lastError);
          if (diagnostics && diagnostics.record) diagnostics.record(diagnostic, {
            attempt: attempt + 1,
            elapsedMs: Date.now() - startedAt,
            classification: diagnostics.classifyError ? diagnostics.classifyError(lastError) : 'unknown',
            httpStatus: Number.isFinite(lastError.httpStatus) ? lastError.httpStatus : null,
            backendStage: 'DIRECT_RESPONSE',
            transportType: MODES.DIRECT_V2,
            outcome: shouldRetry ? 'retry' : 'unresolved',
            errorCode: lastError.code || null
          });
          if (!shouldRetry) throw lastError;
          await new Promise(function(resolve) { setTimeout(resolve, retryDelayMs); });
        } finally {
          clearTimeout(timer);
        }
      }
      throw lastError || codedError_('DIRECT_READ_FAILED', { transportClassification: 'unknown' });
    }

    return Object.freeze({
      mode: config.mode,
      projects: function() { return read_(ROUTES.projects, validateProjects_); },
      work: function() { return read_(ROUTES.work, validateWork_); }
    });
  }

  root.PALURUReadTransportV2 = Object.freeze({ MODES, ROUTES, selectMode, create });
})(typeof globalThis !== 'undefined' ? globalThis : this);
