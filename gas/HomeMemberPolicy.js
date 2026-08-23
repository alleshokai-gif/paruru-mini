const HOME_MEMBER_REGISTRATION_MODES = Object.freeze({
  EXISTING_MEMBER_ONLY: 'existing_member_only',
  INITIAL_MEMBER_ONLY: 'initial_member_only',
  INITIAL_OR_EXISTING_MEMBER: 'initial_or_existing_member',
  NOT_ALLOWED: 'not_allowed',
});

// This is the sole source of truth for the fixed family roster.  It does not
// create Spreadsheet rows; an active Home_Members row is still required.
const HOME_MEMBER_POLICY = Object.freeze({
  father: Object.freeze({ memberUserId: 'father', displayName: '父', role: 'admin', calendarSuffix: '（父）', registrationMode: HOME_MEMBER_REGISTRATION_MODES.EXISTING_MEMBER_ONLY, approvalTemplateId: 'father_add_device' }),
  mother: Object.freeze({ memberUserId: 'mother', displayName: '母', role: 'guardian', calendarSuffix: '（母）', registrationMode: HOME_MEMBER_REGISTRATION_MODES.NOT_ALLOWED, approvalTemplateId: '' }),
  eldest_son: Object.freeze({ memberUserId: 'eldest_son', displayName: '長男', role: 'self_record', calendarSuffix: '（理）', registrationMode: HOME_MEMBER_REGISTRATION_MODES.NOT_ALLOWED, approvalTemplateId: '' }),
  eldest_daughter: Object.freeze({ memberUserId: 'eldest_daughter', displayName: '長女', role: 'self_record', calendarSuffix: '（は）', registrationMode: HOME_MEMBER_REGISTRATION_MODES.NOT_ALLOWED, approvalTemplateId: '' }),
  second_son: Object.freeze({ memberUserId: 'second_son', displayName: '次男', role: 'self_record', calendarSuffix: '（ふ）', registrationMode: HOME_MEMBER_REGISTRATION_MODES.INITIAL_OR_EXISTING_MEMBER, approvalTemplateId: 'second_son_initial' }),
  youngest_daughter: Object.freeze({ memberUserId: 'youngest_daughter', displayName: '次女', role: 'self_record', calendarSuffix: '（り）', registrationMode: HOME_MEMBER_REGISTRATION_MODES.NOT_ALLOWED, approvalTemplateId: '' }),
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
  return Boolean(policy && String(member.displayName || '') === policy.displayName && String(member.role || '') === policy.role);
}

function getHomeMemberPolicyByApprovalTemplate_(templateName) {
  const normalizedTemplateName = String(templateName || '').trim();
  return Object.keys(HOME_MEMBER_POLICY).map(function(memberUserId) {
    return HOME_MEMBER_POLICY[memberUserId];
  }).filter(function(policy) {
    return policy.approvalTemplateId === normalizedTemplateName && policy.registrationMode !== HOME_MEMBER_REGISTRATION_MODES.NOT_ALLOWED;
  })[0] || null;
}

function isHomeMemberApprovalTemplate_(templateName) {
  return Boolean(getHomeMemberPolicyByApprovalTemplate_(templateName));
}

function getKnownHomeMemberCalendarSuffixes_() {
  return Object.keys(HOME_MEMBER_POLICY).map(function(memberUserId) {
    return HOME_MEMBER_POLICY[memberUserId].calendarSuffix;
  });
}
