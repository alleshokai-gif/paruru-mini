const HOME_IDENTITIES_SHEET_NAME = 'Home_Identities';
const HOME_IDENTITIES_HEADERS = ['homeId', 'memberUserId', 'provider', 'providerSubject', 'status', 'createdAt', 'updatedAt'];
const HOME_IDENTITY_STATUS = Object.freeze({ active: true, disabled: true });

function ensureHomeIdentitiesSheet_() {
  return ensureMembershipSheet_(SpreadsheetApp.getActiveSpreadsheet(), HOME_IDENTITIES_SHEET_NAME, HOME_IDENTITIES_HEADERS);
}

function resolveHomeIdentity_(provider, providerSubject) {
  const normalizedProvider = String(provider || '').trim();
  const normalizedSubject = String(providerSubject || '').trim();
  if (!normalizedProvider || !normalizedSubject) throw homeIdentityError_('IDENTITY_NOT_MAPPED');
  const sheet = getRequiredHomeMembershipSheet_(HOME_IDENTITIES_SHEET_NAME, HOME_IDENTITIES_HEADERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const map = headers.reduce(function(out, header, index) { out[header] = index; return out; }, {});
  const matches = values.slice(1).filter(function(row) {
    return String(row[map.provider] || '') === normalizedProvider && String(row[map.providerSubject] || '') === normalizedSubject;
  });
  if (matches.length === 0) throw homeIdentityError_('IDENTITY_NOT_MAPPED');
  if (matches.length !== 1) throw homeIdentityError_('IDENTITY_MAPPING_CONFLICT');
  const row = matches[0];
  const status = String(row[map.status] || '');
  if (!HOME_IDENTITY_STATUS[status] || status !== 'active') throw homeIdentityError_('IDENTITY_DISABLED');
  const identity = {
    homeId: String(row[map.homeId] || '').trim(),
    memberUserId: String(row[map.memberUserId] || '').trim(),
    provider: normalizedProvider,
    providerSubject: normalizedSubject,
    status: status,
  };
  if (!identity.homeId || !identity.memberUserId) throw homeIdentityError_('IDENTITY_MAPPING_CONFLICT');
  return identity;
}

function homeIdentityError_(code) {
  const error = new Error(String(code || 'IDENTITY_ERROR'));
  error.code = String(code || 'IDENTITY_ERROR');
  return error;
}

