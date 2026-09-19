const FIREBASE_AUTH_POC_PROJECT_ID_PROPERTY = 'PALURU_FIREBASE_POC_PROJECT_ID';
const FIREBASE_AUTH_POC_WEB_API_KEY_PROPERTY = 'PALURU_FIREBASE_POC_WEB_API_KEY';
const FIREBASE_AUTH_TOKEN_MAX_LENGTH = 8192;
const FIREBASE_AUTH_CLOCK_SKEW_SECONDS = 60;

function verifyFirebaseIdToken_(idToken, overrides) {
  const deps = getFirebaseAuthVerifierDependencies_(overrides);
  const config = deps.config || getFirebaseAuthVerifierConfig_();
  const token = String(idToken || '').trim();
  if (!token || token.length > FIREBASE_AUTH_TOKEN_MAX_LENGTH) throw firebaseAuthError_('AUTH_TOKEN_INVALID');
  const claims = decodeFirebaseJwtPayload_(token);
  validateFirebaseClaimsBeforeLookup_(claims, config, deps.nowSeconds());
  const account = deps.lookupAccount(token, config);
  validateFirebaseAccount_(account, claims);
  return Object.freeze({
    provider: 'firebase:' + config.projectId,
    providerSubject: String(account.localId),
    authTime: Number(claims.auth_time),
    issuedAt: Number(claims.iat),
    expiresAt: Number(claims.exp),
    signInProvider: 'google.com',
  });
}

function getFirebaseAuthVerifierConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const projectId = String(properties.getProperty(FIREBASE_AUTH_POC_PROJECT_ID_PROPERTY) || '').trim();
  const webApiKey = String(properties.getProperty(FIREBASE_AUTH_POC_WEB_API_KEY_PROPERTY) || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId) || !webApiKey || webApiKey.length > 512) {
    throw firebaseAuthError_('AUTH_CONFIGURATION_ERROR');
  }
  return { projectId: projectId, webApiKey: webApiKey };
}

function validateFirebaseClaimsBeforeLookup_(claims, config, nowSeconds) {
  const expectedIssuer = 'https://securetoken.google.com/' + config.projectId;
  if (String(claims.iss || '') !== expectedIssuer || String(claims.aud || '') !== config.projectId) {
    throw firebaseAuthError_('AUTH_PROJECT_MISMATCH');
  }
  const subject = String(claims.sub || '');
  const userId = String(claims.user_id || subject);
  if (!subject || subject.length > 128 || subject !== userId) throw firebaseAuthError_('AUTH_UID_MISMATCH');
  const exp = Number(claims.exp);
  const issuedAt = Number(claims.iat);
  const authTime = Number(claims.auth_time);
  if (!Number.isFinite(exp) || exp <= nowSeconds - FIREBASE_AUTH_CLOCK_SKEW_SECONDS) throw firebaseAuthError_('AUTH_TOKEN_EXPIRED');
  if (!Number.isFinite(issuedAt) || issuedAt > nowSeconds + FIREBASE_AUTH_CLOCK_SKEW_SECONDS) throw firebaseAuthError_('AUTH_TOKEN_INVALID');
  if (!Number.isFinite(authTime) || authTime > nowSeconds + FIREBASE_AUTH_CLOCK_SKEW_SECONDS) throw firebaseAuthError_('AUTH_TOKEN_INVALID');
  const signInProvider = String(claims.firebase && claims.firebase.sign_in_provider || '');
  if (signInProvider !== 'google.com') throw firebaseAuthError_('AUTH_PROVIDER_NOT_ALLOWED');
}

function validateFirebaseAccount_(account, claims) {
  if (!account || typeof account !== 'object' || !account.localId) throw firebaseAuthError_('AUTH_TOKEN_INVALID');
  if (account.disabled === true) throw firebaseAuthError_('AUTH_USER_DISABLED');
  if (String(account.localId) !== String(claims.sub || '')) throw firebaseAuthError_('AUTH_UID_MISMATCH');
  const validSince = Number(account.validSince || 0);
  if (Number.isFinite(validSince) && validSince > 0 && Number(claims.auth_time) < validSince) {
    throw firebaseAuthError_('AUTH_SESSION_REVOKED');
  }
  const providers = Array.isArray(account.providerUserInfo) ? account.providerUserInfo : [];
  if (!providers.some(function(provider) { return String(provider && provider.providerId || '') === 'google.com'; })) {
    throw firebaseAuthError_('AUTH_PROVIDER_NOT_ALLOWED');
  }
}

function lookupFirebaseAccount_(idToken, config) {
  let response;
  try {
    response = UrlFetchApp.fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(config.webApiKey),
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ idToken: idToken }),
        muteHttpExceptions: true,
      }
    );
  } catch (error) {
    throw firebaseAuthError_('AUTH_VERIFIER_UNAVAILABLE');
  }
  const responseCode = Number(response.getResponseCode());
  if (responseCode === 408 || responseCode === 429 || responseCode >= 500) throw firebaseAuthError_('AUTH_VERIFIER_UNAVAILABLE');
  if (responseCode !== 200) throw firebaseAuthError_('AUTH_TOKEN_INVALID');
  let payload;
  try { payload = JSON.parse(response.getContentText()); } catch (error) { throw firebaseAuthError_('AUTH_VERIFIER_UNAVAILABLE'); }
  if (!payload || !Array.isArray(payload.users) || payload.users.length !== 1) throw firebaseAuthError_('AUTH_TOKEN_INVALID');
  return payload.users[0];
}

function decodeFirebaseJwtPayload_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || !parts.every(function(part) { return /^[A-Za-z0-9_-]+$/.test(part); })) {
    throw firebaseAuthError_('AUTH_TOKEN_INVALID');
  }
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const text = Utilities.newBlob(Utilities.base64Decode(padded)).getDataAsString('UTF-8');
    const claims = JSON.parse(text);
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw new Error('invalid');
    return claims;
  } catch (error) {
    throw firebaseAuthError_('AUTH_TOKEN_INVALID');
  }
}

function getFirebaseAuthVerifierDependencies_(overrides) {
  const input = overrides || {};
  return {
    config: input.config || null,
    nowSeconds: typeof input.nowSeconds === 'function' ? input.nowSeconds : function() { return Math.floor(Date.now() / 1000); },
    lookupAccount: typeof input.lookupAccount === 'function' ? input.lookupAccount : lookupFirebaseAccount_,
  };
}

function firebaseAuthError_(code) {
  const error = new Error(String(code || 'AUTH_TOKEN_INVALID'));
  error.code = String(code || 'AUTH_TOKEN_INVALID');
  return error;
}
