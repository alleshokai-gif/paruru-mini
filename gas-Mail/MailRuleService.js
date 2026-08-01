function classifyMailMetadata_(metadata) {
  const normalized = normalizeMailMetadata_(metadata);
  const matchedRules = MAIL_FIXED_RULES_.filter(function(rule) {
    return rule.matches(normalized);
  });
  const selectedRule = selectMailRule_(matchedRules);

  if (!selectedRule) return cloneMailClassification_(MAIL_CLASSIFICATION_DEFAULT);

  return makeMailClassification_(selectedRule.result, selectedRule.id);
}

function normalizeMailMetadata_(metadata) {
  const source = metadata && typeof metadata === 'object' ? metadata : {};
  return {
    from: normalizeMailText_(source.from),
    senderDomain: normalizeMailText_(source.senderDomain),
    subject: normalizeMailText_(source.subject),
    snippet: normalizeMailText_(source.snippet),
    hasAttachment: source.hasAttachment === true,
  };
}

function normalizeMailText_(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function mailSearchText_(metadata) {
  return [metadata.from, metadata.senderDomain, metadata.subject, metadata.snippet].join('\n');
}

function containsMailText_(text, patterns) {
  return patterns.some(function(pattern) { return text.indexOf(pattern) >= 0; });
}

function selectMailRule_(rules) {
  if (!rules.length) return null;
  return rules.slice().sort(function(left, right) {
    if (right.priority !== left.priority) return right.priority - left.priority;
    return left.order - right.order;
  })[0];
}

function mailRulePriority_(ruleId) {
  const policy = MAIL_RULE_PRIORITY_POLICY.filter(function(item) { return item.ruleId === ruleId; })[0];
  return policy ? policy.priority : -1;
}

function makeMailClassification_(result, ruleId) {
  const candidate = {
    category: result.category,
    importance: result.importance,
    actionRequired: result.actionRequired === true,
    actionType: result.actionType,
    archiveRecommended: result.archiveRecommended === true,
    reasonCodes: Array.isArray(result.reasonCodes) ? result.reasonCodes.slice() : [],
    matchedRuleId: ruleId || null,
  };
  return isAllowedMailClassification_(candidate)
    ? candidate
    : cloneMailClassification_(MAIL_CLASSIFICATION_DEFAULT);
}

function cloneMailClassification_(classification) {
  return {
    category: classification.category,
    importance: classification.importance,
    actionRequired: classification.actionRequired === true,
    actionType: classification.actionType,
    archiveRecommended: classification.archiveRecommended === true,
    reasonCodes: Array.isArray(classification.reasonCodes) ? classification.reasonCodes.slice() : [],
    matchedRuleId: classification.matchedRuleId || null,
  };
}

function isAllowedMailClassification_(classification) {
  return MAIL_ALLOWED_CLASSIFICATION_VALUES.category.indexOf(classification.category) >= 0 &&
    MAIL_ALLOWED_CLASSIFICATION_VALUES.importance.indexOf(classification.importance) >= 0 &&
    MAIL_ALLOWED_CLASSIFICATION_VALUES.actionType.indexOf(classification.actionType) >= 0 &&
    typeof classification.actionRequired === 'boolean' &&
    typeof classification.archiveRecommended === 'boolean' &&
    Array.isArray(classification.reasonCodes) && classification.reasonCodes.every(function(code) { return typeof code === 'string'; }) &&
    (typeof classification.matchedRuleId === 'string' || classification.matchedRuleId === null);
}

const MAIL_FIXED_RULES_ = Object.freeze([
  Object.freeze({
    id: 'payment_deadline', priority: mailRulePriority_('payment_deadline'), order: 0,
    matches: function(metadata) {
      return containsMailText_(mailSearchText_(metadata), ['支払期限', 'お支払い期限']);
    },
    result: Object.freeze({
      category: MAIL_CATEGORY.finance, importance: MAIL_IMPORTANCE.high,
      actionRequired: true, actionType: MAIL_ACTION_TYPE.payment,
      archiveRecommended: false, reasonCodes: Object.freeze(['payment_deadline']),
    }),
  }),
  Object.freeze({
    id: 'submission_deadline', priority: mailRulePriority_('submission_deadline'), order: 1,
    matches: function(metadata) {
      return containsMailText_(mailSearchText_(metadata), ['回答期限', '提出期限']);
    },
    result: Object.freeze({
      category: MAIL_CATEGORY.unknown, importance: MAIL_IMPORTANCE.high,
      actionRequired: true, actionType: MAIL_ACTION_TYPE.submission,
      archiveRecommended: false, reasonCodes: Object.freeze(['submission_deadline']),
    }),
  }),
  Object.freeze({
    id: 'confirmation_request', priority: mailRulePriority_('confirmation_request'), order: 2,
    matches: function(metadata) {
      return containsMailText_(mailSearchText_(metadata), ['要確認', 'ご確認ください']);
    },
    result: Object.freeze({
      category: MAIL_CATEGORY.unknown, importance: MAIL_IMPORTANCE.medium,
      actionRequired: true, actionType: MAIL_ACTION_TYPE.confirmation,
      archiveRecommended: false, reasonCodes: Object.freeze(['confirmation_request']),
    }),
  }),
  Object.freeze({
    id: 'newsletter', priority: mailRulePriority_('newsletter'), order: 3,
    matches: function(metadata) {
      return containsMailText_(mailSearchText_(metadata), ['unsubscribe', '配信停止', 'メールマガジン', 'メルマガ', 'ニュースレター']);
    },
    result: Object.freeze({
      category: MAIL_CATEGORY.newsletter, importance: MAIL_IMPORTANCE.low,
      actionRequired: false, actionType: MAIL_ACTION_TYPE.none,
      archiveRecommended: true, reasonCodes: Object.freeze(['newsletter_indicator']),
    }),
  }),
  Object.freeze({
    id: 'promotion', priority: mailRulePriority_('promotion'), order: 4,
    matches: function(metadata) {
      return containsMailText_(mailSearchText_(metadata), ['広告', 'キャンペーン', 'セール', 'クーポン', 'promotion']);
    },
    result: Object.freeze({
      category: MAIL_CATEGORY.promotion, importance: MAIL_IMPORTANCE.low,
      actionRequired: false, actionType: MAIL_ACTION_TYPE.none,
      archiveRecommended: true, reasonCodes: Object.freeze(['promotion_indicator']),
    }),
  }),
]);
