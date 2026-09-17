'use strict';

const { BrokerError } = require('./broker');

const SAFE_PROJECT = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
const SAFE_SECRET = /^[A-Za-z][A-Za-z0-9_-]{0,254}$/;
const SAFE_VERSION = /^(?:[1-9][0-9]*|latest)$/;

class GoogleSyntheticSecretStore {
  constructor({ client, projectId, secretId }) {
    if (!client || typeof client.accessSecretVersion !== 'function') {
      throw new TypeError('Secret Manager client is required');
    }
    if (typeof projectId !== 'string' || !SAFE_PROJECT.test(projectId)) {
      throw new TypeError('safe projectId is required');
    }
    if (typeof secretId !== 'string' || !SAFE_SECRET.test(secretId)) {
      throw new TypeError('safe secretId is required');
    }
    this.client = client;
    this.resourcePrefix = `projects/${projectId}/secrets/${secretId}/versions/`;
  }

  async access(versionAlias) {
    if (typeof versionAlias !== 'string' || !SAFE_VERSION.test(versionAlias)) {
      throw new BrokerError('INVALID_SECRET_VERSION_ALIAS', 400);
    }
    try {
      const [version] = await this.client.accessSecretVersion({
        name: `${this.resourcePrefix}${versionAlias}`,
      });
      const payload = version && version.payload && version.payload.data;
      if (!payload) throw new Error('missing payload');
      const value = Buffer.from(payload).toString('utf8');
      if (value.length === 0 || value.length > 4096) throw new Error('invalid payload');
      return value;
    } catch {
      throw new BrokerError('SYNTHETIC_SECRET_UNAVAILABLE', 503);
    }
  }
}

module.exports = { GoogleSyntheticSecretStore };
