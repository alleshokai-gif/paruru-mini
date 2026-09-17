'use strict';

const { ConsoleError } = require('./errors');

const ALLOWED_STATUS = new Set(['configured', 'missing']);
const ALLOWED_CONNECTIVITY = new Set(['OK', 'FAILED', 'NOT_TESTED']);
const FORBIDDEN_FIELDS = new Set([
  'value', 'secret', 'token', 'password', 'hash', 'fingerprint',
  'prefix', 'suffix', 'property_name', 'resource_name', 'endpoint'
]);

const RECORDS = [
  {
    credential_id: 'synthetic_kaz_os_read',
    display_name: 'Kaz OS Read',
    class: 'service_auth',
    status: 'configured',
    enabled: true,
    backend: 'synthetic',
    consumers: [
      { id: 'progress', label: 'Progress' },
      { id: 'projects', label: 'Projects' },
      { id: 'inbox', label: 'Inbox' }
    ],
    connectivity: 'OK',
    last_rotated: '2026-09-17'
  },
  {
    credential_id: 'synthetic_openai',
    display_name: 'OpenAI',
    class: 'external_provider',
    status: 'configured',
    enabled: true,
    backend: 'synthetic',
    consumers: [{ id: 'assistant', label: 'Assistant' }],
    connectivity: 'OK',
    last_rotated: '2026-09-17'
  },
  {
    credential_id: 'synthetic_family_inbox',
    display_name: 'Family Inbox',
    class: 'service_auth',
    status: 'missing',
    enabled: false,
    backend: 'synthetic',
    consumers: [{ id: 'review', label: 'Review' }],
    connectivity: 'NOT_TESTED',
    last_rotated: null
  },
  {
    credential_id: 'synthetic_health',
    display_name: 'Health',
    class: 'service_auth',
    status: 'configured',
    enabled: true,
    backend: 'synthetic',
    consumers: [{ id: 'daily', label: 'Daily' }],
    connectivity: 'FAILED',
    last_rotated: '2026-09-17'
  }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new ConsoleError('REQUEST_INVALID');
  }
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_FIELDS.has(key)) throw new ConsoleError('REQUEST_INVALID');
  }
  if (!/^synthetic_[a-z0-9_]{3,48}$/.test(record.credential_id)) {
    throw new ConsoleError('REQUEST_INVALID');
  }
  if (record.backend !== 'synthetic' || !ALLOWED_STATUS.has(record.status)) {
    throw new ConsoleError('REQUEST_INVALID');
  }
  if (!ALLOWED_CONNECTIVITY.has(record.connectivity) || typeof record.enabled !== 'boolean') {
    throw new ConsoleError('REQUEST_INVALID');
  }
  if (!Array.isArray(record.consumers) || record.consumers.length < 1 || record.consumers.length > 8) {
    throw new ConsoleError('REQUEST_INVALID');
  }
  for (const consumer of record.consumers) {
    if (!consumer || !/^[a-z][a-z0-9_-]{1,31}$/.test(consumer.id) || typeof consumer.label !== 'string') {
      throw new ConsoleError('REQUEST_INVALID');
    }
  }
  return true;
}

class SyntheticRegistry {
  constructor(records = RECORDS) {
    records.forEach(validateRecord);
    this.records = new Map(records.map((record) => [record.credential_id, clone(record)]));
  }

  list() {
    return Array.from(this.records.values()).map((record) => this.toSummary(record));
  }

  get(credentialId) {
    const record = this.records.get(credentialId);
    if (!record) throw new ConsoleError('NOT_FOUND', 404);
    return clone(record);
  }

  toSummary(record) {
    return {
      credential_id: record.credential_id,
      display_name: record.display_name,
      class: record.class,
      status: record.status,
      enabled: record.enabled,
      backend: 'Synthetic',
      consumer_count: record.consumers.length,
      connectivity: record.connectivity,
      last_rotated: record.last_rotated
    };
  }

  toDetail(record) {
    return {
      ...this.toSummary(record),
      consumers: record.consumers.map((consumer) => ({ ...consumer }))
    };
  }
}

module.exports = { SyntheticRegistry, RECORDS, validateRecord };
