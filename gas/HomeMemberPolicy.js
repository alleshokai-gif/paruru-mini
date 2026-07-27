const HOME_MEMBER_REGISTRATION_MODES = Object.freeze({
  EXISTING_MEMBER_ONLY: 'existing_member_only',
  INITIAL_MEMBER_ONLY: 'initial_member_only',
  NOT_ALLOWED: 'not_allowed',
});

// This is the sole source of truth for the fixed family roster.  It does not
// create Spreadsheet rows; an active Home_Members row is still required.
const HOME_MEMBER_POLICY = Object.freeze({
  father: Object.freeze({ memberUserId: 'father', displayName: '父', role: 'admin', calendarSuffix: '（父）', registrationMode: HOME_MEMBER_REGISTRATION_MODES.EXISTING_MEMBER_ONLY, approvalTemplateId: 'father_add_device' }),
  mother: Object.freeze({ memberUserId: 'mother', displayName: '母', role: 'guardian', calendarSuffix: '（母）', registrationMode: HOME_MEMBER_REGISTRATION_MODES.NOT_ALLOWED, approvalTemplateId: '' }),
  eldest_son: Object.freeze({ memberUserId: 'eldest_son', displayName: '長男', role: 'self_record', calendarSuffix: '（理）', registrationMode: HOME_MEMBER_REGISTRATION_MODES.NOT_ALLOWED, approvalTemplateId: '' }),
  eldest_daughter: Object.freeze({ memberUserId: 'eldest_daughter', displayName: '長女', role: 'self_record', calendarSuffix: '（は）', registrationMode: HOME_MEMBER_REGISTRATION_MODES.NOT_ALLOWED, approvalTemplateId: '' }),
  second_son: Object.freeze({ memberUserId: 'second_son', displayName: '次男', role: 'self_record', calendarSuffix: '（ふ）', registrationMode: HOME_MEMBER_REGISTRATION_MODES.INITIAL_MEMBER_ONLY, approvalTemplateId: 'second_son_initial' }),
  youngest_daughter: Object.freeze({ memberUserId: 'youngest_daughter', displayName: '次女', role: 'self_record', calendarSuffix: '（り）', registrationMode: HOME_MEMBER_REGISTRATION_MODES.NOT_ALLOWED, approvalTemplateId: '' }),
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
