(function(root) {
  'use strict';

  const AUTH_STATES = Object.freeze({
    BOOTING: 'booting',
    SIGNED_OUT: 'signed_out',
    RESOLVING: 'resolving',
    ACTIVE: 'active',
    REGISTRATION_REQUIRED: 'registration_required',
    LINK_PENDING: 'link_pending',
    ERROR: 'error',
  });

  function createPaluruFirebaseAuth(options) {
    const settings = options || {};
    const firebase = settings.firebase;
    const gis = settings.gis;
    const firebaseConfig = settings.firebaseConfig || {};
    const googleClientId = String(settings.googleClientId || '').trim();
    const resolveActor = typeof settings.resolveActor === 'function' ? settings.resolveActor : null;
    const registerUser = typeof settings.registerUser === 'function' ? settings.registerUser : null;
    const onState = typeof settings.onState === 'function' ? settings.onState : function() {};
    if (!firebase || !gis || !resolveActor || !registerUser) throw authError_('AUTH_CONFIGURATION_ERROR');
    if (!firebaseConfig.apiKey || !firebaseConfig.authDomain || !firebaseConfig.projectId || !firebaseConfig.appId || !googleClientId) {
      throw authError_('AUTH_CONFIGURATION_ERROR');
    }

    let auth = null;
    let currentUser = null;
    let actorContext = null;
    let generation = 0;
    let initialized = false;

    function publish_(state, safeCode) {
      onState(Object.freeze({
        state: state,
        safeCode: String(safeCode || ''),
        signedIn: Boolean(currentUser),
        actor: actorContext ? cloneActor_(actorContext) : null,
      }));
    }

    function clearActor_() {
      actorContext = null;
      generation += 1;
    }

    async function resolveCurrentUser_(user) {
      const previousUser = currentUser;
      const retainedActor = user && previousUser && previousUser.uid === user.uid && actorContext
        ? cloneActor_(actorContext)
        : null;
      const expectedGeneration = ++generation;
      currentUser = user || null;
      if (!currentUser) {
        actorContext = null;
        publish_(AUTH_STATES.SIGNED_OUT);
        return null;
      }
      if (!retainedActor) {
        actorContext = null;
        publish_(AUTH_STATES.RESOLVING);
      }
      try {
        const idToken = await firebase.getIdToken(currentUser);
        const resolved = await resolveActor({ provider: 'firebase', idToken: idToken });
        if (expectedGeneration !== generation || !currentUser || currentUser.uid !== user.uid) return null;
        actorContext = validateActorContext_(resolved);
        publish_(AUTH_STATES.ACTIVE);
        return cloneActor_(actorContext);
      } catch (error) {
        if (expectedGeneration !== generation) return null;
        if (retainedActor && isTransientAuthError_(error) && currentUser && currentUser.uid === user.uid) {
          actorContext = retainedActor;
          return cloneActor_(actorContext);
        }
        actorContext = null;
        const code = safeCode_(error);
        if (code === 'REGISTRATION_REQUIRED') {
          publish_(AUTH_STATES.REGISTRATION_REQUIRED, code);
          return null;
        }
        if (code === 'MEMBER_LINK_PENDING') {
          publish_(AUTH_STATES.LINK_PENDING, code);
          return null;
        }
        publish_(AUTH_STATES.ERROR, code);
        throw error;
      }
    }

    async function handleGoogleCredential_(response) {
      const googleIdToken = String(response && response.credential || '').trim();
      if (!googleIdToken) throw authError_('GOOGLE_CREDENTIAL_MISSING');
      const credential = firebase.GoogleAuthProvider.credential(googleIdToken);
      return firebase.signInWithCredential(auth, credential);
    }

    async function initialize() {
      if (initialized) return;
      initialized = true;
      publish_(AUTH_STATES.BOOTING);
      const app = firebase.initializeApp(firebaseConfig);
      auth = firebase.initializeAuth(app, { persistence: firebase.browserLocalPersistence });
      gis.initialize({
        client_id: googleClientId,
        callback: function(response) {
          handleGoogleCredential_(response).catch(function(error) {
            publish_(AUTH_STATES.ERROR, safeCode_(error));
          });
        },
        auto_select: false,
        cancel_on_tap_outside: false,
      });
      firebase.onIdTokenChanged(auth, function(user) {
        resolveCurrentUser_(user).catch(function() {});
      });
    }

    function renderGoogleButton(element, buttonOptions) {
      if (!element) throw authError_('AUTH_UI_MISSING');
      gis.renderButton(element, Object.assign({
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        width: 280,
      }, buttonOptions || {}));
    }

    async function getAuthEnvelope(forceRefresh) {
      if (!currentUser) throw authError_('AUTHENTICATION_REQUIRED');
      const idToken = await firebase.getIdToken(currentUser, forceRefresh === true);
      return { provider: 'firebase', idToken: idToken };
    }

    async function register(displayName) {
      if (!currentUser) throw authError_('AUTHENTICATION_REQUIRED');
      const authEnvelope = await getAuthEnvelope(false);
      const result = await registerUser(authEnvelope, { displayName: String(displayName || '').trim() });
      publish_(AUTH_STATES.LINK_PENDING, 'MEMBER_LINK_PENDING');
      return result;
    }

    async function retryResolve() {
      if (!currentUser) throw authError_('AUTHENTICATION_REQUIRED');
      return resolveCurrentUser_(currentUser);
    }

    async function logout() {
      clearActor_();
      currentUser = null;
      publish_(AUTH_STATES.SIGNED_OUT);
      await firebase.signOut(auth);
      gis.disableAutoSelect();
    }

    async function beginAccountSwitch() {
      clearActor_();
      currentUser = null;
      publish_(AUTH_STATES.SIGNED_OUT);
      await firebase.signOut(auth);
      gis.disableAutoSelect();
    }

    return Object.freeze({
      initialize: initialize,
      renderGoogleButton: renderGoogleButton,
      getAuthEnvelope: getAuthEnvelope,
      register: register,
      retryResolve: retryResolve,
      logout: logout,
      beginAccountSwitch: beginAccountSwitch,
      getSafeState: function() {
        return Object.freeze({ signedIn: Boolean(currentUser), actor: actorContext ? cloneActor_(actorContext) : null });
      },
    });
  }

  function validateActorContext_(value) {
    const actor = value && typeof value === 'object' ? value : {};
    const memberUserId = String(actor.memberUserId || '').trim();
    const displayName = String(actor.displayName || '').trim();
    const role = String(actor.role || '').trim();
    if (!memberUserId || !displayName) throw authError_('IDENTITY_MAPPING_INVALID');
    return {
      memberUserId: memberUserId,
      displayName: displayName,
      role: role,
      calendarSuffix: String(actor.calendarSuffix || ''),
      addressTerms: actor.addressTerms && typeof actor.addressTerms === 'object' ? Object.assign({}, actor.addressTerms) : {},
      capabilities: Array.isArray(actor.capabilities) ? actor.capabilities.map(String) : [],
      allowedViews: Array.isArray(actor.allowedViews) ? actor.allowedViews.map(String) : [],
      canHomeControl: actor.canHomeControl === true,
    };
  }

  function cloneActor_(actor) {
    return {
      memberUserId: actor.memberUserId,
      displayName: actor.displayName,
      role: actor.role,
      calendarSuffix: actor.calendarSuffix,
      addressTerms: Object.assign({}, actor.addressTerms),
      capabilities: actor.capabilities.slice(),
      allowedViews: actor.allowedViews.slice(),
      canHomeControl: actor.canHomeControl === true,
    };
  }

  function isTransientAuthError_(error) {
    const rawCode = String(error && error.code || '');
    const code = safeCode_(error);
    return code === 'TRANSPORT_FAILURE'
      || rawCode === 'auth/network-request-failed'
      || rawCode === 'auth/internal-error';
  }

  function safeCode_(error) {
    return String(error && error.code || 'AUTH_UNAVAILABLE').replace(/[^A-Z0-9_]/g, '').slice(0, 80) || 'AUTH_UNAVAILABLE';
  }

  function authError_(code) {
    const error = new Error(String(code || 'AUTH_ERROR'));
    error.code = String(code || 'AUTH_ERROR');
    return error;
  }

  root.PALURUFirebaseAuth = Object.freeze({ create: createPaluruFirebaseAuth, states: AUTH_STATES });
})(typeof globalThis !== 'undefined' ? globalThis : this);
