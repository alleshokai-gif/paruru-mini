const MAIL_CATEGORY = Object.freeze({
  personal: 'personal',
  familySchool: 'family_school',
  finance: 'finance',
  purchase: 'purchase',
  medical: 'medical',
  serviceNotice: 'service_notice',
  newsletter: 'newsletter',
  promotion: 'promotion',
  unknown: 'unknown',
});

const MAIL_IMPORTANCE = Object.freeze({ high: 'high', medium: 'medium', low: 'low' });

const MAIL_ACTION_TYPE = Object.freeze({
  reply: 'reply',
  payment: 'payment',
  submission: 'submission',
  reservation: 'reservation',
  confirmation: 'confirmation',
  none: 'none',
});

const MAIL_METADATA_INPUT_FIELDS = Object.freeze([
  'from', 'senderDomain', 'subject', 'snippet', 'hasAttachment',
]);

const MAIL_CLASSIFICATION_OUTPUT_FIELDS = Object.freeze([
  'category', 'importance', 'actionRequired', 'actionType',
  'archiveRecommended', 'reasonCodes', 'matchedRuleId',
]);

const MAIL_CLASSIFICATION_DEFAULT = Object.freeze({
  category: MAIL_CATEGORY.unknown,
  importance: MAIL_IMPORTANCE.medium,
  actionRequired: false,
  actionType: MAIL_ACTION_TYPE.none,
  archiveRecommended: false,
  reasonCodes: Object.freeze([]),
  matchedRuleId: null,
});

// A single highest-priority rule determines the Phase 0 result. Larger wins;
// the listed rule id is the deterministic tie-breaker order.
const MAIL_RULE_PRIORITY_POLICY = Object.freeze([
  Object.freeze({ ruleId: 'payment_deadline', priority: 100 }),
  Object.freeze({ ruleId: 'submission_deadline', priority: 90 }),
  Object.freeze({ ruleId: 'confirmation_request', priority: 80 }),
  Object.freeze({ ruleId: 'newsletter', priority: 20 }),
  Object.freeze({ ruleId: 'promotion', priority: 10 }),
]);

const MAIL_ALLOWED_CLASSIFICATION_VALUES = Object.freeze({
  category: Object.freeze(Object.keys(MAIL_CATEGORY).map(function(key) { return MAIL_CATEGORY[key]; })),
  importance: Object.freeze(Object.keys(MAIL_IMPORTANCE).map(function(key) { return MAIL_IMPORTANCE[key]; })),
  actionType: Object.freeze(Object.keys(MAIL_ACTION_TYPE).map(function(key) { return MAIL_ACTION_TYPE[key]; })),
});

const MAIL_DRY_RUN_PROPERTY_KEYS = Object.freeze({
  lookbackHours: 'MAIL_LOOKBACK_HOURS',
  searchLimit: 'MAIL_SEARCH_LIMIT',
  batchSize: 'MAIL_BATCH_SIZE',
  diagnostic: 'MAIL_DRY_RUN_DIAGNOSTIC',
});

const MAIL_DRY_RUN_DEFAULTS = Object.freeze({
  lookbackHours: 24,
  searchLimit: 100,
  batchSize: 50,
  diagnostic: false,
});

const MAIL_DRY_RUN_LIMITS = Object.freeze({
  lookbackHours: Object.freeze({ min: 1, max: 168 }),
  searchLimit: Object.freeze({ min: 1, max: 500 }),
  batchSize: Object.freeze({ min: 1, max: 100 }),
  diagnosticMaxItems: 20,
  snippetMaxLength: 500,
  subjectPreviewMaxLength: 30,
});
