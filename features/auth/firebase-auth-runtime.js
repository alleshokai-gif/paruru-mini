(function(root) {
  'use strict';

  const FIREBASE_VERSION = '12.19.0';
  const READ_ONLY_REQUEST_TIMEOUT_MS = 8000;

  async function createRuntime(options) {
    const settings = options || {};
    const gasWebAppUrl = String(settings.gasWebAppUrl || '').trim();
    if (!gasWebAppUrl || !root.PALURUFirebaseAuth) throw codedError_('AUTH_RUNTIME_UNAVAILABLE');

    let config;
    try {
      config = await loadPublicConfig_(gasWebAppUrl);
    } catch (error) {
      if (safeCode_(error) === 'TRANSPORT_FAILURE') throw error;
      throw codedError_('AUTH_CONFIG_LOAD_FAILED');
    }

    let modules;
    try {
      modules = await loadFirebase_();
    } catch (_) {
      throw codedError_('FIREBASE_SDK_LOAD_FAILED');
    }

    try {
      await loadGis_();
    } catch (_) {
      throw codedError_('GIS_LOAD_FAILED');
    }

    let service;
    try {
      service = root.PALURUFirebaseAuth.create({
        firebase: modules,
        gis: root.google.accounts.id,
        firebaseConfig: config.firebaseConfig,
        googleClientId: config.googleClientId,
        resolveActor: function(auth) { return resolveActor_(gasWebAppUrl, auth); },
        registerUser: function(auth, profile) { return registerUser_(gasWebAppUrl, auth, profile); },
        onState: settings.onState,
      });
      await service.initialize();
    } catch (_) {
      throw codedError_('AUTH_INITIALIZE_FAILED');
    }
    return service;
  }

  async function loadPublicConfig_(url) {
    const payload = await readOnlyRequest_(url, { action: 'auth.config.get' }, 'AUTH_CONFIGURATION_ERROR');
    const value = payload.data || {};
    if (!value.firebaseConfig || !value.googleClientId) throw codedError_('AUTH_CONFIGURATION_ERROR');
    return value;
  }

  async function resolveActor_(url, auth) {
    const payload = await readOnlyRequest_(url, { action: 'auth.session.resolve', auth: auth }, 'AUTHENTICATION_FAILED');
    return payload.data;
  }

  async function readOnlyRequest_(url, body, fallbackCode) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchWithTimeout_(url, {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body),
        }, READ_ONLY_REQUEST_TIMEOUT_MS);
        if (response.status >= 500 && response.status <= 599) {
          lastError = codedError_('TRANSPORT_FAILURE');
          if (attempt === 0) {
            await shortDelay_();
            continue;
          }
          throw lastError;
        }
        return await parseEnvelope_(response, fallbackCode);
      } catch (error) {
        const code = safeCode_(error);
        if (code !== 'TRANSPORT_FAILURE' && !(error instanceof TypeError)) throw error;
        lastError = codedError_('TRANSPORT_FAILURE');
        if (attempt === 0) {
          await shortDelay_();
          continue;
        }
        throw lastError;
      }
    }
    throw lastError || codedError_('TRANSPORT_FAILURE');
  }

  function shortDelay_() {
    return new Promise(function(resolve) { setTimeout(resolve, 120); });
  }

  async function fetchWithTimeout_(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(function() { controller.abort(); }, timeoutMs);
    try {
      return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    } catch (error) {
      if (error && error.name === 'AbortError') throw codedError_('TRANSPORT_FAILURE');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function registerUser_(url, auth, profile) {
    const response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'auth.registration.create',
        auth: auth,
        displayName: String(profile && profile.displayName || '').trim(),
      }),
    });
    const payload = await parseEnvelope_(response, 'REGISTRATION_FAILED');
    return payload.data || {};
  }

  async function parseEnvelope_(response, fallbackCode) {
    let payload;
    try { payload = await response.json(); } catch (_) { throw codedError_('TRANSPORT_FAILURE'); }
    if (!response.ok || !payload || payload.success !== true) {
      throw codedError_(payload && payload.error && payload.error.code || fallbackCode);
    }
    return payload;
  }

  async function loadFirebase_() {
    const base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/';
    const modules = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js')]);
    return {
      initializeApp: modules[0].initializeApp,
      initializeAuth: modules[1].initializeAuth,
      browserLocalPersistence: modules[1].browserLocalPersistence,
      GoogleAuthProvider: modules[1].GoogleAuthProvider,
      signInWithCredential: modules[1].signInWithCredential,
      onIdTokenChanged: modules[1].onIdTokenChanged,
      getIdToken: modules[1].getIdToken,
      signOut: modules[1].signOut,
    };
  }

  function loadGis_() {
    if (root.google && root.google.accounts && root.google.accounts.id) return Promise.resolve();
    return new Promise(function(resolve, reject) {
      const existing = document.querySelector('script[data-paluru-gis]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', function() { reject(codedError_('GIS_LOAD_FAILED')); }, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.dataset.paluruGis = 'true';
      script.onload = resolve;
      script.onerror = function() { reject(codedError_('GIS_LOAD_FAILED')); };
      document.head.appendChild(script);
    });
  }

  function safeCode_(error) {
    return String(error && error.code || '').replace(/[^A-Z0-9_]/g, '').slice(0, 80);
  }

  function codedError_(code) {
    const error = new Error(String(code || 'AUTH_UNAVAILABLE'));
    error.code = String(code || 'AUTH_UNAVAILABLE');
    return error;
  }

  root.PALURUFirebaseAuthRuntime = Object.freeze({ create: createRuntime });
})(typeof globalThis !== 'undefined' ? globalThis : this);
