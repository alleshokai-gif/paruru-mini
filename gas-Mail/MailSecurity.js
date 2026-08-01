function getMailDryRunSettings_() {
  const properties = PropertiesService.getScriptProperties();
  return {
    lookbackHours: mailReadBoundedInteger_(properties.getProperty(MAIL_DRY_RUN_PROPERTY_KEYS.lookbackHours), MAIL_DRY_RUN_DEFAULTS.lookbackHours, MAIL_DRY_RUN_LIMITS.lookbackHours),
    searchLimit: mailReadBoundedInteger_(properties.getProperty(MAIL_DRY_RUN_PROPERTY_KEYS.searchLimit), MAIL_DRY_RUN_DEFAULTS.searchLimit, MAIL_DRY_RUN_LIMITS.searchLimit),
    batchSize: mailReadBoundedInteger_(properties.getProperty(MAIL_DRY_RUN_PROPERTY_KEYS.batchSize), MAIL_DRY_RUN_DEFAULTS.batchSize, MAIL_DRY_RUN_LIMITS.batchSize),
    diagnostic: mailReadBoolean_(properties.getProperty(MAIL_DRY_RUN_PROPERTY_KEYS.diagnostic), MAIL_DRY_RUN_DEFAULTS.diagnostic),
  };
}

function mailReadBoundedInteger_(rawValue, defaultValue, limits) {
  const text = String(rawValue === undefined || rawValue === null ? '' : rawValue).trim();
  if (!/^\d+$/.test(text)) return defaultValue;
  const value = Number(text);
  return Number.isInteger(value) && value >= limits.min && value <= limits.max ? value : defaultValue;
}

function mailReadBoolean_(rawValue, defaultValue) {
  if (rawValue === true || String(rawValue || '').trim().toLowerCase() === 'true') return true;
  if (rawValue === false || String(rawValue || '').trim().toLowerCase() === 'false') return false;
  return defaultValue;
}

function mailSafeErrorCode_(error, fallbackCode) {
  const code = error && typeof error.code === 'string' ? error.code : '';
  return /^[A-Z_]+$/.test(code) ? code : fallbackCode;
}

function mailMessageIdHash_(messageId) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'mail-dry-run:' + String(messageId || ''),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64Encode(digest).replace(/[+/=]/g, '').slice(0, 24);
}

function mailSenderDomain_(from) {
  const match = String(from || '').match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  return match ? String(match[1]).toLowerCase() : '';
}

function mailDateToIso_(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function mailNowIso_() {
  return mailDateToIso_(new Date());
}

function mailTruncate_(value, maxLength) {
  return String(value || '').slice(0, maxLength);
}

function mailSubjectPreview_(subject) {
  const normalized = String(subject || '').replace(/\s+/g, ' ').trim();
  return normalized.length > MAIL_DRY_RUN_LIMITS.subjectPreviewMaxLength
    ? normalized.slice(0, MAIL_DRY_RUN_LIMITS.subjectPreviewMaxLength - 1) + '…'
    : normalized;
}
