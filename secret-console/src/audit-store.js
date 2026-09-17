'use strict';

const { ConsoleError } = require('./errors');
const { toTokyoIso } = require('./time');

const ALLOWED_FIELDS = new Set([
  'event_id', 'event', 'credential_id', 'rotation_id', 'actor_type',
  'result', 'safe_code', 'previous_state', 'next_state', 'timestamp'
]);

class SyntheticAuditStore {
  constructor(clock = () => new Date()) {
    this.clock = clock;
    this.events = [];
    this.failurePending = false;
    this.sequence = 0;
  }

  failNextWrite() {
    this.failurePending = true;
  }

  append(event) {
    if (this.failurePending) {
      this.failurePending = false;
      throw new ConsoleError('AUDIT_PERSISTENCE_FAILED', 503);
    }
    for (const key of Object.keys(event)) {
      if (!ALLOWED_FIELDS.has(key)) throw new ConsoleError('AUDIT_PERSISTENCE_FAILED', 503);
    }
    this.sequence += 1;
    const stored = Object.freeze({
      event_id: `evt_${String(this.sequence).padStart(4, '0')}`,
      actor_type: 'human',
      result: 'success',
      safe_code: 'OK',
      timestamp: toTokyoIso(this.clock()),
      ...event
    });
    this.events.push(stored);
    return { ...stored };
  }

  listForRotation(rotationId) {
    return this.events
      .filter((event) => event.rotation_id === rotationId)
      .map((event) => ({ ...event }));
  }

  listAll() {
    return this.events.map((event) => ({ ...event }));
  }
}

module.exports = { SyntheticAuditStore, ALLOWED_FIELDS };
