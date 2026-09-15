// This is the sole source of truth for the fixed family roster.  It does not
// create Spreadsheet rows; an active Home_Members row is still required.
const HOME_MEMBER_POLICY = Object.freeze({
  father: Object.freeze({ memberUserId: 'father', displayName: '父', calendarSuffix: '（父）' }),
  mother: Object.freeze({ memberUserId: 'mother', displayName: '母', calendarSuffix: '（母）' }),
  eldest_son: Object.freeze({ memberUserId: 'eldest_son', displayName: '長男', calendarSuffix: '（理）' }),
  eldest_daughter: Object.freeze({ memberUserId: 'eldest_daughter', displayName: '長女', calendarSuffix: '（は）' }),
  second_son: Object.freeze({ memberUserId: 'second_son', displayName: '次男', calendarSuffix: '（ふ）' }),
  youngest_daughter: Object.freeze({ memberUserId: 'youngest_daughter', displayName: '次女', calendarSuffix: '（り）' }),
});

// Read-only compatibility for partial approval records written before the
// identity-only contract. This map is never used to assign a role.
const LEGACY_HOME_MEMBER_APPROVAL_TEMPLATES = Object.freeze({
  father_add_device: 'father',
  eldest_daughter_initial: 'eldest_daughter',
  second_son_initial: 'second_son',
});

// Fixed character-to-member forms of address.  Unlisted combinations are
// deliberately addressless so new members never inherit an unintended name.
const HOME_MEMBER_ADDRESS_POLICY = Object.freeze({
  paruru: Object.freeze({ father: '兄弟', second_son: 'ふうが' }),
  nurseOkan: Object.freeze({ father: 'お父さん', second_son: 'ふうちゃん' }),
});

function findHomeMemberPolicy_(memberUserId) {
  return HOME_MEMBER_POLICY[String(memberUserId || '').trim()] || null;
}

function getHomeMemberPolicy_(memberUserId) {
  const policy = findHomeMemberPolicy_(memberUserId);
  if (policy) return policy;
  const error = new Error('UNKNOWN_HOME_MEMBER');
  error.code = 'UNKNOWN_HOME_MEMBER';
  throw error;
}

function getHomeMemberAddress_(characterId, memberUserId) {
  const characterPolicy = HOME_MEMBER_ADDRESS_POLICY[String(characterId || '').trim()];
  return characterPolicy ? String(characterPolicy[String(memberUserId || '').trim()] || '') : '';
}

function getHomeMemberAddressTerms_(memberUserId) {
  return Object.keys(HOME_MEMBER_ADDRESS_POLICY).reduce(function(terms, characterId) {
    terms[characterId] = getHomeMemberAddress_(characterId, memberUserId);
    return terms;
  }, {});
}

function prependHomeMemberAddress_(characterId, memberUserId, text) {
  const address = getHomeMemberAddress_(characterId, memberUserId);
  const body = String(text || '');
  return address ? address + '、' + body : body;
}

function isHomeMemberPolicyMatch_(member) {
  const policy = member && findHomeMemberPolicy_(member.memberUserId);
  return Boolean(policy && String(member.displayName || '') === policy.displayName);
}

function getRegistrationMemberIdentity_(memberUserId, displayName) {
  const policy = findHomeMemberPolicy_(memberUserId);
  if (!policy || String(displayName || '') !== policy.displayName) {
    const error = new Error('INVALID_MEMBER_IDENTITY');
    error.code = 'INVALID_MEMBER_IDENTITY';
    throw error;
  }
  return { memberUserId: policy.memberUserId, displayName: policy.displayName };
}

function getHomeMemberPolicyByApprovalTemplate_(templateName) {
  const normalizedTemplateName = String(templateName || '').trim();
  return findHomeMemberPolicy_(LEGACY_HOME_MEMBER_APPROVAL_TEMPLATES[normalizedTemplateName]);
}

function isHomeMemberApprovalTemplate_(templateName) {
  return Boolean(getHomeMemberPolicyByApprovalTemplate_(templateName));
}

function getKnownHomeMemberCalendarSuffixes_() {
  return Object.keys(HOME_MEMBER_POLICY).map(function(memberUserId) {
    return HOME_MEMBER_POLICY[memberUserId].calendarSuffix;
  });
}
