function resolveFirebaseAuthenticatedActor_(body, overrides) {
  const input = body || {};
  const auth = input.auth && typeof input.auth === 'object' ? input.auth : {};
  if (String(auth.provider || '') !== 'firebase') throw firebaseAuthError_('AUTH_PROVIDER_NOT_ALLOWED');
  const verified = verifyFirebaseIdToken_(auth.idToken, overrides && overrides.verifier);
  const identity = (overrides && typeof overrides.resolveIdentity === 'function')
    ? overrides.resolveIdentity(verified.provider, verified.providerSubject)
    : resolveHomeIdentity_(verified.provider, verified.providerSubject);
  const member = (overrides && typeof overrides.getMember === 'function')
    ? overrides.getMember(identity.homeId, identity.memberUserId)
    : getHomeMember_(identity.homeId, identity.memberUserId);
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
  return Object.freeze(actor);
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

function getFirebaseMembershipContext_(body, overrides) {
  const actor = resolveFirebaseAuthenticatedActor_(body, overrides);
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
