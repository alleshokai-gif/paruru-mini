const PALURU_USERS_SHEET_NAME = 'PALURU_Users';
const PALURU_USERS_HEADERS = ['userAccountId', 'provider', 'providerSubject', 'displayName', 'status', 'createdAt', 'updatedAt'];
const PALURU_USER_STATUS = Object.freeze({ pending_link: true, linked: true, disabled: true });

function ensurePaluruUsersSheet_() {
  return ensureMembershipSheet_(SpreadsheetApp.getActiveSpreadsheet(), PALURU_USERS_SHEET_NAME, PALURU_USERS_HEADERS);
}

function authSessionResolve_(body, transportTrace, overrides) {
  try {
    const context = getFirebaseMembershipContext_(body, overrides);
    recordAuthTransport_(transportTrace, 'AUTH_SESSION_COMPLETE', { outcome: 'success' });
    return json_({ success: true, data: context, message: 'authenticated actor resolved' });
  } catch (error) {
    invalidateFirebaseAuthenticatedActorReadCache_(body, overrides);
    const code = normalizeAuthRegistrationErrorCode_(error && error.code);
    if (code !== 'IDENTITY_NOT_MAPPED') {
      recordAuthTransport_(transportTrace, 'AUTH_SESSION_REJECTED', {
        classification: 'business', outcome: 'unresolved', errorCode: code
      });
      return json_({ success: false, data: {}, error: { code: code }, message: code });
    }
    try {
      const verified = verifyFirebaseIdToken_(body && body.auth && body.auth.idToken, overrides && overrides.verifier);
      const account = getPaluruUserByIdentity_(verified.provider, verified.providerSubject);
      const nextCode = account && account.status === 'pending_link' ? 'MEMBER_LINK_PENDING' : 'REGISTRATION_REQUIRED';
      recordAuthTransport_(transportTrace, 'AUTH_SESSION_REJECTED', {
        classification: 'business', outcome: 'unresolved', errorCode: nextCode
      });
      return json_({ success: false, data: {}, error: { code: nextCode }, message: nextCode });
    } catch (lookupError) {
      const lookupCode = normalizeAuthRegistrationErrorCode_(lookupError && lookupError.code);
      recordAuthTransport_(transportTrace, 'AUTH_SESSION_REJECTED', {
        classification: 'business', outcome: 'unresolved', errorCode: lookupCode
      });
      return json_({ success: false, data: {}, error: { code: lookupCode }, message: lookupCode });
    }
  }
}

function authSessionInvalidate_(body, overrides) {
  try {
    resolveFirebaseAuthenticatedActor_(body || {}, overrides);
    invalidateFirebaseAuthenticatedActorReadCache_(body, overrides);
    return json_({ success: true, data: {}, message: 'authenticated read cache invalidated' });
  } catch (error) {
    const code = normalizeAuthRegistrationErrorCode_(error && error.code);
    invalidateFirebaseAuthenticatedActorReadCache_(body, overrides);
    return json_({ success: false, data: {}, error: { code: code }, message: code });
  }
}

function recordAuthTransport_(trace, stage, values) {
  if (typeof recordMiniTransportTrace_ === 'function') recordMiniTransportTrace_(trace, stage, values);
}

function registerPaluruUser_(body) {
  const input = body || {};
  const displayName = sanitizePaluruRegistrationDisplayName_(input.displayName);
  const auth = input.auth && typeof input.auth === 'object' ? input.auth : {};
  if (String(auth.provider || '') !== 'firebase') throw paluruUserError_('AUTH_PROVIDER_NOT_ALLOWED');
  const verified = verifyFirebaseIdToken_(auth.idToken);

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    try {
      resolveHomeIdentity_(verified.provider, verified.providerSubject);
      throw paluruUserError_('ALREADY_LINKED');
    } catch (error) {
      const code = String(error && error.code || '');
      if (code !== 'IDENTITY_NOT_MAPPED') throw error;
    }

    const existing = getPaluruUserByIdentity_(verified.provider, verified.providerSubject);
    if (existing) {
      if (existing.status === 'disabled') throw paluruUserError_('USER_ACCOUNT_DISABLED');
      return {
        status: existing.status,
        displayName: existing.displayName,
      };
    }

    const sheet = ensurePaluruUsersSheet_();
    const now = nowTokyoString_();
    const userAccountId = 'usr_' + String(Utilities.getUuid()).replace(/-/g, '');
    sheet.appendRow([
      userAccountId,
      verified.provider,
      verified.providerSubject,
      displayName,
      'pending_link',
      now,
      now,
    ]);
    return { status: 'pending_link', displayName: displayName };
  } finally {
    lock.releaseLock();
  }
}

function listPendingPaluruUserLinks_(body) {
  const actor = resolveFirebaseAuthenticatedActor_(body || {});
  if (actor.role !== 'admin') throw paluruUserError_('FORBIDDEN');

  const userSheet = ensurePaluruUsersSheet_();
  const userRows = readRowsByHeaders_(userSheet, PALURU_USERS_HEADERS).filter(function(row) {
    return row.status === 'pending_link';
  });

  const memberSheet = getRequiredHomeMembershipSheet_(HOME_MEMBERS_SHEET_NAME, HOME_MEMBERS_HEADERS);
  const members = readRowsByHeaders_(memberSheet, HOME_MEMBERS_HEADERS).filter(function(row) {
    return row.homeId === actor.homeId
      && row.status === 'active'
      && !hasActiveHomeIdentityForMember_(actor.homeId, row.memberUserId);
  });

  return {
    users: userRows.map(function(row) {
      return {
        userAccountId: row.userAccountId,
        displayName: row.displayName,
        createdAt: row.createdAt,
      };
    }),
    members: members.map(function(row) {
      return {
        memberUserId: row.memberUserId,
        displayName: row.displayName,
      };
    }),
  };
}

function linkPaluruUserToMember_(body) {
  const input = body || {};
  const actor = resolveFirebaseAuthenticatedActor_(input);
  if (actor.role !== 'admin') throw paluruUserError_('FORBIDDEN');
  const userAccountId = String(input.userAccountId || '').trim();
  const memberUserId = String(input.targetMemberUserId || '').trim();
  if (!userAccountId || !memberUserId) throw paluruUserError_('INVALID_INPUT');

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const accountState = getPaluruUserRowStateById_(userAccountId);
    if (!accountState || (accountState.row.status !== 'pending_link' && accountState.row.status !== 'linked')) {
      throw paluruUserError_('REGISTRATION_NOT_PENDING');
    }

    const member = getHomeMember_(actor.homeId, memberUserId);
    if (!member || member.status !== 'active') throw paluruUserError_('MEMBERSHIP_NOT_FOUND');

    const existingIdentity = getHomeIdentityMatchCount_(accountState.row.provider, accountState.row.providerSubject);
    if (existingIdentity > 1) throw paluruUserError_('IDENTITY_MAPPING_CONFLICT');
    if (existingIdentity === 1) {
      const identity = resolveHomeIdentity_(accountState.row.provider, accountState.row.providerSubject);
      if (identity.homeId !== actor.homeId || identity.memberUserId !== memberUserId) {
        throw paluruUserError_('IDENTITY_MAPPING_CONFLICT');
      }
      const now = nowTokyoString_();
      const updated = accountState.values.slice();
      updated[accountState.headerMap.status] = 'linked';
      updated[accountState.headerMap.updatedAt] = now;
      accountState.sheet.getRange(accountState.rowNumber, 1, 1, accountState.headers.length).setValues([updated]);
      return { status: 'linked', memberUserId: memberUserId, displayName: member.displayName };
    }
    if (hasActiveHomeIdentityForMember_(actor.homeId, memberUserId)) throw paluruUserError_('MEMBER_ALREADY_LINKED');

    const identitySheet = getRequiredHomeMembershipSheet_(HOME_IDENTITIES_SHEET_NAME, HOME_IDENTITIES_HEADERS);
    const now = nowTokyoString_();
    identitySheet.appendRow([
      actor.homeId,
      memberUserId,
      accountState.row.provider,
      accountState.row.providerSubject,
      'active',
      now,
      now,
    ]);

    const identity = resolveHomeIdentity_(accountState.row.provider, accountState.row.providerSubject);
    if (identity.homeId !== actor.homeId || identity.memberUserId !== memberUserId) {
      throw paluruUserError_('IDENTITY_MAPPING_CONFLICT');
    }

    const updated = accountState.values.slice();
    updated[accountState.headerMap.status] = 'linked';
    updated[accountState.headerMap.updatedAt] = now;
    accountState.sheet.getRange(accountState.rowNumber, 1, 1, accountState.headers.length).setValues([updated]);

    return {
      status: 'linked',
      memberUserId: memberUserId,
      displayName: member.displayName,
    };
  } finally {
    lock.releaseLock();
  }
}

function getPaluruUserByIdentity_(provider, providerSubject) {
  const normalizedProvider = String(provider || '').trim();
  const normalizedSubject = String(providerSubject || '').trim();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PALURU_USERS_SHEET_NAME);
  if (!sheet) return null;
  const rows = readRowsByHeaders_(sheet, PALURU_USERS_HEADERS).filter(function(row) {
    return row.provider === normalizedProvider && row.providerSubject === normalizedSubject;
  });
  if (rows.length > 1) throw paluruUserError_('USER_ACCOUNT_CONFLICT');
  return rows[0] || null;
}

function getPaluruUserRowStateById_(userAccountId) {
  const sheet = getRequiredHomeMembershipSheet_(PALURU_USERS_SHEET_NAME, PALURU_USERS_HEADERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const headerMap = headers.reduce(function(out, header, index) { out[header] = index; return out; }, {});
  const matches = [];
  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][headerMap.userAccountId] || '') === userAccountId) matches.push(index);
  }
  if (matches.length !== 1) return null;
  const rowIndex = matches[0];
  const rowValues = values[rowIndex].slice();
  const row = {};
  headers.forEach(function(header, index) { row[header] = String(rowValues[index] == null ? '' : rowValues[index]); });
  return {
    sheet: sheet,
    headers: headers,
    headerMap: headerMap,
    rowNumber: rowIndex + 1,
    values: rowValues,
    row: row,
  };
}

function hasActiveHomeIdentityForMember_(homeId, memberUserId) {
  const sheet = getRequiredHomeMembershipSheet_(HOME_IDENTITIES_SHEET_NAME, HOME_IDENTITIES_HEADERS);
  const rows = readRowsByHeaders_(sheet, HOME_IDENTITIES_HEADERS);
  return rows.some(function(row) {
    return row.homeId === String(homeId)
      && row.memberUserId === String(memberUserId)
      && row.status === 'active';
  });
}

function getHomeIdentityMatchCount_(provider, providerSubject) {
  const sheet = getRequiredHomeMembershipSheet_(HOME_IDENTITIES_SHEET_NAME, HOME_IDENTITIES_HEADERS);
  return readRowsByHeaders_(sheet, HOME_IDENTITIES_HEADERS).filter(function(row) {
    return row.provider === String(provider) && row.providerSubject === String(providerSubject);
  }).length;
}

function readRowsByHeaders_(sheet, expectedHeaders) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  const headers = values[0].map(String);
  if (headers.length !== expectedHeaders.length || !expectedHeaders.every(function(header, index) { return headers[index] === header; })) {
    throw paluruUserError_('SCHEMA_MISMATCH');
  }
  return values.slice(1).filter(function(row) {
    return row.some(function(value) { return String(value == null ? '' : value).trim() !== ''; });
  }).map(function(row) {
    const out = {};
    headers.forEach(function(header, index) { out[header] = String(row[index] == null ? '' : row[index]); });
    return out;
  });
}

function sanitizePaluruRegistrationDisplayName_(value) {
  const displayName = String(value || '').trim().replace(/\s+/g, ' ');
  if (!displayName || displayName.length > 40) throw paluruUserError_('INVALID_DISPLAY_NAME');
  return displayName;
}

function normalizeAuthRegistrationErrorCode_(code) {
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
    REGISTRATION_REQUIRED: true,
    MEMBER_LINK_PENDING: true,
    USER_ACCOUNT_DISABLED: true,
    USER_ACCOUNT_CONFLICT: true,
    INVALID_DISPLAY_NAME: true,
    ALREADY_LINKED: true,
    MEMBER_ALREADY_LINKED: true,
    REGISTRATION_NOT_PENDING: true,
    INVALID_INPUT: true,
    SCHEMA_MISMATCH: true,
  });
  const normalized = String(code || 'AUTHENTICATION_FAILED');
  return allowed[normalized] ? normalized : 'AUTHENTICATION_FAILED';
}

function paluruUserError_(code) {
  const error = new Error(String(code || 'PALURU_USER_ERROR'));
  error.code = String(code || 'PALURU_USER_ERROR');
  return error;
}
