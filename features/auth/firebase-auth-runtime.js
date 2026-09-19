(function(root) {
  'use strict';

  const FIREBASE_VERSION = '12.19.0';

  async function createRuntime(options) {
    const settings = options || {};
    const gasWebAppUrl = String(settings.gasWebAppUrl || '').trim();
    if (!gasWebAppUrl || !root.PALURUFirebaseAuth) throw codedError_('AUTH_CONFIGURATION_ERROR');
    const config = await loadPublicConfig_(gasWebAppUrl);
    const modules = await loadFirebase_();
    await loadGis_();
    const service = root.PALURUFirebaseAuth.create({
      firebase: modules,
      gis: root.google.accounts.id,
      firebaseConfig: config.firebaseConfig,
      googleClientId: config.googleClientId,
      resolveActor: function(auth) { return resolveActor_(gasWebAppUrl, auth); },
      onState: settings.onState,
    });
    await service.initialize();
    return service;
  }

  async function loadPublicConfig_(url) {
    const response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'auth.config.get' }),
    });
    const payload = await parseEnvelope_(response, 'AUTH_CONFIGURATION_ERROR');
    const value = payload.data || {};
    if (!value.firebaseConfig || !value.googleClientId) throw codedError_('AUTH_CONFIGURATION_ERROR');
    return value;
  }

  async function resolveActor_(url, auth) {
    const response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'auth.session.resolve', auth: auth }),
    });
    const payload = await parseEnvelope_(response, 'AUTHENTICATION_FAILED');
    return payload.data;
  }

  async function parseEnvelope_(response, fallbackCode) {
    let payload;
    try { payload = await response.json(); } catch (_) { throw codedError_(fallbackCode); }
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

  function codedError_(code) {
    const error = new Error(String(code || 'AUTH_UNAVAILABLE'));
    error.code = String(code || 'AUTH_UNAVAILABLE');
    return error;
  }

  root.PALURUFirebaseAuthRuntime = Object.freeze({ create: createRuntime });
})(typeof globalThis !== 'undefined' ? globalThis : this);
