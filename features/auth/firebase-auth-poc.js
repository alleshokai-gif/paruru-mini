import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getIdToken,
  initializeAuth,
  onIdTokenChanged,
  signInWithCredential,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

const status = document.querySelector('#authPocStatus');
const actor = document.querySelector('#authPocActor');
const googleButton = document.querySelector('#authPocGoogleButton');
const logoutButton = document.querySelector('#authPocLogout');
const switchButton = document.querySelector('#authPocSwitch');
const refreshButton = document.querySelector('#authPocRefresh');

start().catch((error) => showState({ state: 'error', safeCode: safeCode(error), actor: null }));

async function start() {
  const config = await loadLocalConfig();
  await loadGis();
  const service = globalThis.PALURUFirebaseAuth.create({
    firebase: {
      initializeApp,
      initializeAuth,
      browserLocalPersistence,
      GoogleAuthProvider,
      signInWithCredential,
      onIdTokenChanged,
      getIdToken,
      signOut,
    },
    gis: google.accounts.id,
    firebaseConfig: config.firebase,
    googleClientId: config.googleClientId,
    resolveActor: (auth) => resolveActor(config.gasWebAppUrl, auth),
    onState: showState,
  });
  logoutButton.addEventListener('click', () => service.logout().catch(showError));
  switchButton.addEventListener('click', () => service.beginAccountSwitch().catch(showError));
  refreshButton.addEventListener('click', async () => {
    await service.getAuthEnvelope(true);
    status.textContent = 'Firebase ID tokenを更新しました。token値は表示しません。';
  });
  await service.initialize();
  service.renderGoogleButton(googleButton);
}

async function loadLocalConfig() {
  const url = new URL('./firebase-auth-poc-config.local.json', import.meta.url);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw codedError('AUTH_POC_CONFIG_MISSING');
  const config = await response.json();
  if (!config || !config.firebase || !config.googleClientId || !config.gasWebAppUrl) throw codedError('AUTH_POC_CONFIG_INVALID');
  return config;
}

function loadGis() {
  if (globalThis.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(codedError('GIS_LOAD_FAILED'));
    document.head.appendChild(script);
  });
}

async function resolveActor(url, auth) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'authPocResolve',
      auth,
      memberUserId: 'spoofed-client-member',
      role: 'admin',
      capabilities: ['home.control'],
    }),
  });
  const payload = await response.json();
  if (!response.ok || payload?.success !== true) throw codedError(payload?.error?.code || 'AUTH_POC_RESOLVE_FAILED');
  return payload.data?.actor || null;
}

function showState(value) {
  const state = String(value?.state || 'error');
  const messages = {
    booting: 'Firebase sessionを確認中…',
    signed_out: 'Googleで続けてください。',
    resolving: 'Firebase UIDをHome_Identitiesへ照合中…',
    active: 'AuthenticatedActorをserver-sideで解決しました。',
    error: `認証を完了できませんでした: ${String(value?.safeCode || 'AUTH_UNAVAILABLE')}`,
  };
  status.textContent = messages[state] || messages.error;
  actor.textContent = value?.actor ? JSON.stringify(value.actor, null, 2) : '';
  logoutButton.disabled = state !== 'active';
  switchButton.disabled = state !== 'active';
  refreshButton.disabled = state !== 'active';
}

function showError(error) {
  showState({ state: 'error', safeCode: safeCode(error), actor: null });
}

function safeCode(error) {
  return String(error?.code || 'AUTH_UNAVAILABLE').replace(/[^A-Z0-9_]/g, '').slice(0, 80) || 'AUTH_UNAVAILABLE';
}

function codedError(code) {
  const error = new Error(String(code));
  error.code = String(code);
  return error;
}
