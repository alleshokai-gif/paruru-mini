(function(root) {
  'use strict';

  const MODES = Object.freeze({ GAS: 'GAS', DIRECT_V2: 'DIRECT_V2' });
  const ROUTES = Object.freeze({
    projects: Object.freeze({ key: 'projects', path: '/v2/read/projects', action: 'kazOs.projects.get' }),
    work: Object.freeze({ key: 'work', path: '/v2/read/work', action: 'kazOs.work.get' }),
    today: Object.freeze({ key: 'today', path: '/poc/read-v2/today', action: 'kazOs.today.get' }),
    inbox: Object.freeze({ key: 'inbox', path: '/poc/read-v2/inbox', action: 'kazOs.inbox.get' })
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
    const requestedRoutes = source.routeModes && typeof source.routeModes === 'object'
      ? source.routeModes : {};
    const routeModes = Object.freeze({
      projects: requestedRoutes.projects === MODES.GAS ? MODES.GAS : mode,
      work: requestedRoutes.work === MODES.GAS ? MODES.GAS : mode,
      today: requestedRoutes.today === MODES.DIRECT_V2 ? MODES.DIRECT_V2 : MODES.GAS,
      inbox: requestedRoutes.inbox === MODES.DIRECT_V2 ? MODES.DIRECT_V2 : MODES.GAS
    });
    return Object.freeze({ mode, baseUrl, canaryCapability, routeModes });
  }

  function selectMode(input, membership, routeKey) {
    const config = normalizeConfig_(input);
    const context = membership && typeof membership === 'object' ? membership : {};
    const capabilities = Array.isArray(context.capabilities) ? context.capabilities : [];
    const selected = routeKey && Object.hasOwn(config.routeModes, routeKey)
      ? config.routeModes[routeKey] : config.mode;
    if (selected !== MODES.DIRECT_V2) return MODES.GAS;
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

  function zeroWrites_(value) {
    const writes = value && value.writes;
    return writes && writes.notion === 0 && writes.calendar === 0 && writes.context === 0;
  }

  function healthySource_(value) {
    return value && value.status === 'ok' && value.complete === true
      && typeof value.source_revision === 'string' && value.source_revision;
  }

  function validateToday_(value) {
    const sources = value && value.sources;
    const today = value && value.today;
    if (!value || value.schema_version !== 'kaz-today-plan-v1'
        || value.origin !== 'real_operational_sources' || value.mode !== 'read_only'
        || value.fixture_only !== false || !zeroWrites_(value)
        || !healthySource_(sources && sources.work_items)
        || !healthySource_(sources && sources.calendar)
        || !today || !Array.isArray(today.now)
        || !Array.isArray(today.next) || today.next.length > 2
        || !Array.isArray(today.waiting) || !Array.isArray(today.availability)
        || !today.calendar_state || !Array.isArray(today.calendar_state.unknown)) {
      throw codedError_('TODAY_CONTRACT_INVALID', { transportClassification: 'parse' });
    }
    return value;
  }

  function validateInbox_(value) {
    const sources = value && value.sources;
    const sourceKeys = ['inbox', 'projects', 'tasks', 'calendar', 'resolution'];
    if (!value || value.schema_version !== 'kaz-secretary-inbox-0.1'
        || value.origin !== 'real_operational_sources'
        || !['read_only_display', 'controlled_proposal'].includes(value.mode)
        || value.fixture_only !== false || value.fixture_fallback !== false
        || !zeroWrites_(value) || !sources
        || sourceKeys.some(key => !healthySource_(sources[key]))
        || !Array.isArray(value.projects) || value.projects.length > 20
        || !Array.isArray(value.work_items) || value.work_items.length > 50
        || !Array.isArray(value.calendar_events) || value.calendar_events.length > 200
        || !Array.isArray(value.inbox_items) || value.inbox_items.length > 30
        || value.inbox_items.some(item => !item || item.owner !== 'kaz'
          || item.decision_requested !== true || item.decision_status !== 'pending'
          || item.write_allowed !== false || typeof item.question_revision !== 'string'
          || !item.source_revision_references || !item.answer_contract
          || item.answer_contract.question_revision !== item.question_revision)) {
      throw codedError_('INBOX_CONTRACT_INVALID', { transportClassification: 'parse' });
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
      if (config.mode !== MODES.DIRECT_V2 || config.routeModes[route.key] !== MODES.DIRECT_V2) {
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
      work: function() { return read_(ROUTES.work, validateWork_); },
      today: function() { return read_(ROUTES.today, validateToday_); },
      inbox: function() { return read_(ROUTES.inbox, validateInbox_); }
    });
  }

  root.PALURUReadTransportV2 = Object.freeze({ MODES, ROUTES, selectMode, create });
})(typeof globalThis !== 'undefined' ? globalThis : this);
