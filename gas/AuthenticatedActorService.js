const FIREBASE_READ_ACTOR_CACHE_TTL_SECONDS = 8;
const FIREBASE_READ_ACTOR_CACHE_PREFIX = 'firebase-read-actor-v1:';

function resolveFirebaseAuthenticatedActor_(body, overrides, transportTrace) {
  const input = body || {};
  const auth = input.auth && typeof input.auth === 'object' ? input.auth : {};
  if (String(auth.provider || '') !== 'firebase') throw firebaseAuthError_('AUTH_PROVIDER_NOT_ALLOWED');
  recordAuthenticatedActorStage_(transportTrace, 'FIREBASE_VERIFY_START', { outcome: 'progress' });
  let verified;
  try {
    verified = verifyFirebaseIdToken_(auth.idToken, overrides && overrides.verifier);
    recordAuthenticatedActorStage_(transportTrace, 'FIREBASE_VERIFY_END', { outcome: 'progress' });
  } catch (error) {
    recordAuthenticatedActorStage_(transportTrace, 'FIREBASE_VERIFY_END', {
      classification: 'business', outcome: 'unresolved', errorCode: error && error.code
    });
    throw error;
  }
  // USER_ACCOUNT_SHEET measures the persisted Home_Identities account mapping.
  // Only timing metadata is logged; provider subjects and row values never are.
  recordAuthenticatedActorStage_(transportTrace, 'USER_ACCOUNT_SHEET_START', { outcome: 'progress' });
  let identity;
  try {
    identity = (overrides && typeof overrides.resolveIdentity === 'function')
      ? overrides.resolveIdentity(verified.provider, verified.providerSubject)
      : resolveHomeIdentity_(verified.provider, verified.providerSubject);
    recordAuthenticatedActorStage_(transportTrace, 'USER_ACCOUNT_SHEET_END', { outcome: 'progress' });
  } catch (error) {
    recordAuthenticatedActorStage_(transportTrace, 'USER_ACCOUNT_SHEET_END', {
      classification: 'business', outcome: 'unresolved', errorCode: error && error.code
    });
    throw error;
  }
  recordAuthenticatedActorStage_(transportTrace, 'MEMBERSHIP_SHEET_START', { outcome: 'progress' });
  let member;
  try {
    member = (overrides && typeof overrides.getMember === 'function')
      ? overrides.getMember(identity.homeId, identity.memberUserId)
      : getHomeMember_(identity.homeId, identity.memberUserId);
    recordAuthenticatedActorStage_(transportTrace, 'MEMBERSHIP_SHEET_END', { outcome: 'progress' });
  } catch (error) {
    recordAuthenticatedActorStage_(transportTrace, 'MEMBERSHIP_SHEET_END', {
      classification: 'business', outcome: 'unresolved', errorCode: error && error.code
    });
    throw error;
  }
  if (!member || member.status !== 'active' || !isHomeMemberPolicyMatch_(member) || !isHomeMemberAccessRole_(member.role)) {
    throw homeMembershipError_('MEMBERSHIP_NOT_FOUND');
  }
  const actor = {
    homeId: member.homeId,
    memberUserId: member.memberUserId,
    displayName: member.displayName,
    role: member.role,
    capabilities: getEffectiveMemberCapabilities_(member.memberUserId, member.role),
    allowedViews: getEffectiveMemberAllowedViews_(member.memberUserId, member.role),
    authBindingKey: firebaseAuthBindingKey_(verified.provider, verified.providerSubject),
    authTime: verified.authTime,
  };
  recordAuthenticatedActorStage_(transportTrace, 'ACTOR_RESOLVE_END', { outcome: 'progress' });
  return Object.freeze(actor);
}

function recordAuthenticatedActorStage_(trace, stage, values) {
  if (typeof recordMiniTransportTrace_ === 'function') recordMiniTransportTrace_(trace, stage, values);
}

function resolveFirebaseAuthenticatedActorForRead_(body, overrides) {
  const input = body || {};
  const auth = input.auth && typeof input.auth === 'object' ? input.auth : {};
  if (String(auth.provider || '') !== 'firebase') throw firebaseAuthError_('AUTH_PROVIDER_NOT_ALLOWED');
  const token = String(auth.idToken || '').trim();
  if (!token || token.length > FIREBASE_AUTH_TOKEN_MAX_LENGTH) throw firebaseAuthError_('AUTH_TOKEN_INVALID');
  const claims = decodeFirebaseJwtPayload_(token);
  const nowSeconds = readActorCacheNowSeconds_(overrides);
  const tokenExpiresAt = Number(claims.exp);
  if (!Number.isFinite(tokenExpiresAt) || tokenExpiresAt <= nowSeconds) throw firebaseAuthError_('AUTH_TOKEN_EXPIRED');
  const cache = getFirebaseReadActorCache_(overrides);
  const key = firebaseReadActorCacheKey_(token);
  const cached = readFirebaseActorCacheEntry_(cache, key, nowSeconds, tokenExpiresAt);
  if (cached) return cached;

  const actor = resolveFirebaseAuthenticatedActor_(input, overrides);
  const expiresAt = Math.min(nowSeconds + FIREBASE_READ_ACTOR_CACHE_TTL_SECONDS, tokenExpiresAt);
  writeFirebaseActorCacheEntry_(cache, key, actor, expiresAt, nowSeconds);
  return actor;
}

function invalidateFirebaseAuthenticatedActorReadCache_(body, overrides) {
  const input = body || {};
  const auth = input.auth && typeof input.auth === 'object' ? input.auth : {};
  const token = String(auth.idToken || '').trim();
  if (String(auth.provider || '') !== 'firebase' || !token || token.length > FIREBASE_AUTH_TOKEN_MAX_LENGTH) return false;
  const cache = getFirebaseReadActorCache_(overrides);
  if (!cache || typeof cache.remove !== 'function') return false;
  try {
    cache.remove(firebaseReadActorCacheKey_(token));
    return true;
  } catch (_) {
    return false;
  }
}

function getFirebaseReadActorCache_(overrides) {
  if (overrides && overrides.cache) return overrides.cache;
  try {
    return typeof CacheService !== 'undefined' && CacheService.getScriptCache
      ? CacheService.getScriptCache()
      : null;
  } catch (_) {
    return null;
  }
}

function readActorCacheNowSeconds_(overrides) {
  return overrides && typeof overrides.nowSeconds === 'function'
    ? Number(overrides.nowSeconds())
    : Math.floor(Date.now() / 1000);
}

function firebaseReadActorCacheKey_(token) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(token || ''),
    Utilities.Charset.UTF_8
  );
  const fingerprint = bytes.map(function(value) { return ('0' + ((value + 256) % 256).toString(16)).slice(-2); }).join('');
  return FIREBASE_READ_ACTOR_CACHE_PREFIX + fingerprint;
}

function readFirebaseActorCacheEntry_(cache, key, nowSeconds, tokenExpiresAt) {
  if (!cache || typeof cache.get !== 'function') return null;
  try {
    const raw = cache.get(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    const actor = entry && entry.actor;
    const expiresAt = Number(entry && entry.expiresAt);
    if (!actor || !Number.isFinite(expiresAt) || expiresAt <= nowSeconds || tokenExpiresAt <= nowSeconds
        || !actor.homeId || !actor.memberUserId || !actor.authBindingKey
        || !Array.isArray(actor.capabilities) || !Array.isArray(actor.allowedViews)) {
      if (typeof cache.remove === 'function') cache.remove(key);
      return null;
    }
    return Object.freeze({
      homeId: String(actor.homeId),
      memberUserId: String(actor.memberUserId),
      displayName: String(actor.displayName || ''),
      role: String(actor.role || ''),
      capabilities: actor.capabilities.map(String),
      allowedViews: actor.allowedViews.map(String),
      authBindingKey: String(actor.authBindingKey),
      authTime: Number(actor.authTime),
    });
  } catch (_) {
    return null;
  }
}

function writeFirebaseActorCacheEntry_(cache, key, actor, expiresAt, nowSeconds) {
  if (!cache || typeof cache.put !== 'function' || expiresAt <= nowSeconds) return;
  const ttl = Math.max(1, Math.min(FIREBASE_READ_ACTOR_CACHE_TTL_SECONDS, Math.floor(expiresAt - nowSeconds)));
  try {
    cache.put(key, JSON.stringify({ actor: actor, expiresAt: expiresAt }), ttl);
  } catch (_) {
    // Cache failure must fall back to the freshly verified actor, never to an auth bypass.
  }
}

function authPocResolve_(body, overrides) {
  try {
    const actor = resolveFirebaseAuthenticatedActor_(body, overrides);
    authorizeCapability_(actor, 'home.read');
    return {
      success: true,
      data: {
        actor: {
          memberUserId: actor.memberUserId,
          displayName: actor.displayName,
          role: actor.role,
          capabilities: actor.capabilities.slice(),
          allowedViews: actor.allowedViews.slice(),
          canHomeControl: hasRoleCapability_(actor, 'home.control'),
        },
        authentication: {
          provider: 'firebase',
          deviceIdUsed: false,
          pairingTokenUsed: false,
          deviceMembershipsUsed: false,
        },
      },
      message: 'authenticated actor resolved',
    };
  } catch (error) {
    const code = normalizeAuthPocErrorCode_(error && error.code);
    return { success: false, data: {}, error: { code: code }, message: code };
  }
}

function firebaseAuthBindingKey_(provider, providerSubject) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(provider || '') + '\n' + String(providerSubject || ''),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(value) { return ('0' + ((value + 256) % 256).toString(16)).slice(-2); }).join('');
}

function normalizeAuthPocErrorCode_(code) {
  const allowed = Object.freeze({
    AUTH_CONFIGURATION_ERROR: true,
    AUTH_TOKEN_INVALID: true,
    AUTH_TOKEN_EXPIRED: true,
    AUTH_PROJECT_MISMATCH: true,
    AUTH_UID_MISMATCH: true,
    AUTH_PROVIDER_NOT_ALLOWED: true,
    AUTH_USER_DISABLED: true,
    AUTH_SESSION_REVOKED: true,
    AUTH_VERIFIER_UNAVAILABLE: true,
    IDENTITY_NOT_MAPPED: true,
    IDENTITY_MAPPING_CONFLICT: true,
    IDENTITY_DISABLED: true,
    MEMBERSHIP_NOT_FOUND: true,
    FORBIDDEN: true,
  });
  const normalized = String(code || 'AUTHENTICATION_FAILED');
  return allowed[normalized] ? normalized : 'AUTHENTICATION_FAILED';
}

function getFirebaseMembershipContext_(body, overrides, transportTrace) {
  const actor = resolveFirebaseAuthenticatedActor_(body, overrides, transportTrace);
  authorizeCapability_(actor, 'home.read');
  const policy = getHomeMemberPolicy_(actor.memberUserId);
  return {
    memberUserId: actor.memberUserId,
    displayName: actor.displayName,
    role: actor.role,
    calendarSuffix: policy.calendarSuffix,
    addressTerms: getHomeMemberAddressTerms_(actor.memberUserId),
    capabilities: actor.capabilities.slice(),
    allowedViews: actor.allowedViews.slice(),
    canHomeControl: hasRoleCapability_(actor, 'home.control'),
  };
}
