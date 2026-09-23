'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'features', 'auth', 'firebase-auth.js'), 'utf8');
const context = { console, Object, Array, String, Boolean, Error, Promise, globalThis: null };
context.globalThis = context;
vm.createContext(context);
new vm.Script(source).runInContext(context);

function assert(value, message) { if (!value) throw new Error(message); }
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
async function flush() { await new Promise((resolve) => setImmediate(resolve)); }

function fixture(resolveActor, registerUser) {
  const calls = { states: [], credentials: [], idTokens: [], rendered: [], disableAutoSelect: 0, registrations: [] };
  let authObserver = null;
  let gisCallback = null;
  let signOutResult = Promise.resolve();
  const firebase = {
    browserLocalPersistence: { name: 'LOCAL' },
    initializeApp: (config) => ({ config }),
    initializeAuth: (app, options) => {
      calls.initializeAuth = { app, options };
      return { name: 'auth' };
    },
    GoogleAuthProvider: { credential: (token) => ({ googleIdToken: token }) },
    signInWithCredential: async (_auth, credential) => { calls.credentials.push(credential); return { user: true }; },
    onIdTokenChanged: (_auth, callback) => { authObserver = callback; },
    getIdToken: async (user, forceRefresh) => {
      calls.idTokens.push({ uid: user.uid, forceRefresh: forceRefresh === true });
      return `firebase-token-${user.uid}-${forceRefresh === true ? 'fresh' : 'cached'}`;
    },
    signOut: async () => signOutResult,
  };
  const gis = {
    initialize: (config) => { gisCallback = config.callback; calls.gisConfig = config; },
    renderButton: (element, options) => calls.rendered.push({ element, options }),
    disableAutoSelect: () => { calls.disableAutoSelect += 1; },
  };
  const service = context.PALURUFirebaseAuth.create({
    firebase,
    gis,
    firebaseConfig: { apiKey: 'public-key', authDomain: 'test.firebaseapp.com', projectId: 'test-project', appId: 'public-app' },
    googleClientId: 'client.apps.googleusercontent.com',
    resolveActor,
    registerUser: registerUser || (async (auth, profile) => { calls.registrations.push({ auth, profile }); return { status: 'pending_link' }; }),
    onState: (state) => calls.states.push(state),
  });
  return {
    calls,
    service,
    observe: (user) => authObserver(user),
    gisSignIn: (token) => gisCallback({ credential: token }),
    delaySignOut: (promise) => { signOutResult = promise; },
  };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('uses Firebase LOCAL persistence and the official GIS button callback', async () => {
  const f = fixture(async () => ({ memberUserId: 'father', displayName: '父', role: 'admin', capabilities: ['home.read'], allowedViews: ['home'] }));
  await f.service.initialize();
  f.service.renderGoogleButton({ id: 'button' });
  assert(f.calls.initializeAuth.options.persistence.name === 'LOCAL', 'Firebase LOCAL persistence was not selected');
  assert(f.calls.gisConfig.auto_select === false, 'GIS auto select must remain disabled');
  assert(f.calls.rendered.length === 1, 'official GIS button was not rendered');
});

test('restores an existing Firebase session and refreshes its ID token', async () => {
  const f = fixture(async () => ({ memberUserId: 'father', displayName: '父', role: 'admin', capabilities: ['home.read'], allowedViews: ['home'] }));
  await f.service.initialize();
  f.observe({ uid: 'father-uid' });
  await flush();
  assert(f.service.getSafeState().actor.memberUserId === 'father', 'reload observer did not resolve actor');
  const envelope = await f.service.getAuthEnvelope(true);
  assert(envelope.provider === 'firebase' && envelope.idToken.includes('fresh'), 'forced refresh did not return Firebase envelope');
  assert(f.calls.idTokens.some((item) => item.forceRefresh), 'getIdToken was not forced');
});

test('exchanges the GIS Google token through signInWithCredential without publishing it', async () => {
  const f = fixture(async () => ({ memberUserId: 'father', displayName: '父', role: 'admin', capabilities: ['home.read'], allowedViews: ['home'] }));
  await f.service.initialize();
  f.service.renderGoogleButton({ id: 'button' });
  f.gisSignIn('google-id-token-secret');
  await flush();
  assert(f.calls.credentials[0].googleIdToken === 'google-id-token-secret', 'GIS credential was not exchanged');
  assert(f.calls.rendered[0].options.text === 'continue_with', 'official continue_with button was not rendered');
  assert(!JSON.stringify(f.calls.states).includes('google-id-token-secret'), 'Google token leaked into published state');
});

test('transient token re-resolution failure keeps the active actor and does not publish an auth error', async () => {
  let failTransiently = false;
  const transient = new Error('TRANSPORT_FAILURE');
  transient.code = 'TRANSPORT_FAILURE';
  const f = fixture(async () => {
    if (failTransiently) throw transient;
    return { memberUserId: 'father', displayName: '父', role: 'admin', capabilities: ['home.read'], allowedViews: ['home', 'bus'] };
  });
  await f.service.initialize();
  const user = { uid: 'father-uid' };
  f.observe(user);
  await flush();
  assert(f.service.getSafeState().actor.memberUserId === 'father', 'initial actor resolution failed');
  const stateCount = f.calls.states.length;
  failTransiently = true;
  f.observe(user);
  await flush();
  assert(f.service.getSafeState().actor.memberUserId === 'father', 'transient refresh failure cleared active actor');
  assert(f.calls.states.length === stateCount, 'transient refresh failure published a new auth state');
  assert(!f.calls.states.slice(stateCount).some((state) => state.state === 'error' || state.state === 'resolving'),
    'transient refresh failure must not lock or re-resolve the visible UI');
});

test('unmapped account enters registration state and can self-register without becoming a member', async () => {
  const required = new Error('REGISTRATION_REQUIRED');
  required.code = 'REGISTRATION_REQUIRED';
  const f = fixture(async () => { throw required; });
  await f.service.initialize();
  f.observe({ uid: 'new-user' });
  await flush();
  assert(f.calls.states.some((state) => state.state === 'registration_required'), 'registration_required state was not published');
  const result = await f.service.register('次男');
  assert(result.status === 'pending_link', 'registration did not enter pending_link');
  assert(f.calls.registrations.length === 1, 'registration API was not called exactly once');
  assert(f.calls.registrations[0].profile.displayName === '次男', 'displayName was not sent to registration');
  assert(f.calls.states.at(-1).state === 'link_pending', 'link_pending state was not published');
});

test('registered but unlinked account stays locked until admin linking is complete', async () => {
  let linked = false;
  const f = fixture(async () => {
    if (!linked) {
      const pending = new Error('MEMBER_LINK_PENDING');
      pending.code = 'MEMBER_LINK_PENDING';
      throw pending;
    }
    return { memberUserId: 'second_son', displayName: '次男', role: 'self_record', capabilities: ['home.read'], allowedViews: ['home'] };
  });
  await f.service.initialize();
  f.observe({ uid: 'second-son-uid' });
  await flush();
  assert(f.calls.states.at(-1).state === 'link_pending', 'unlinked user was not kept in link_pending');
  linked = true;
  await f.service.retryResolve();
  assert(f.service.getSafeState().actor.memberUserId === 'second_son', 'linked user did not become active');
});

test('logout clears actor context before Firebase sign-out completes', async () => {
  const pending = deferred();
  const f = fixture(async () => ({ memberUserId: 'father', displayName: '父', role: 'admin', capabilities: ['home.read'], allowedViews: ['home'] }));
  await f.service.initialize();
  f.observe({ uid: 'father-uid' });
  await flush();
  f.delaySignOut(pending.promise);
  const signingOut = f.service.logout();
  assert(f.service.getSafeState().actor === null && !f.service.getSafeState().signedIn, 'logout retained old actor');
  pending.resolve();
  await signingOut;
  assert(f.calls.disableAutoSelect === 1, 'GIS auto-select was not disabled');
});

test('account switch rejects a stale actor response and accepts only the new account', async () => {
  const oldResolution = deferred();
  const f = fixture(async ({ idToken }) => {
    if (idToken.includes('old-uid')) return oldResolution.promise;
    return { memberUserId: 'second_son', displayName: '次男', role: 'self_record', capabilities: ['home.read'], allowedViews: ['home'] };
  });
  await f.service.initialize();
  f.observe({ uid: 'old-uid' });
  await flush();
  await f.service.beginAccountSwitch();
  assert(f.service.getSafeState().actor === null, 'account switch retained old actor');
  oldResolution.resolve({ memberUserId: 'father', displayName: '父', role: 'admin', capabilities: ['home.control'], allowedViews: ['home'] });
  await flush();
  assert(f.service.getSafeState().actor === null, 'stale old-account response restored actor');
  f.observe({ uid: 'new-uid' });
  await flush();
  assert(f.service.getSafeState().actor.memberUserId === 'second_son', 'new account was not resolved');
});

(async () => {
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      console.error(`FAIL ${item.name}: ${error.message}`);
      process.exitCode = 1;
    }
  }
  if (!process.exitCode) console.log(`PASS all ${tests.length} Firebase auth client tests`);
})();
