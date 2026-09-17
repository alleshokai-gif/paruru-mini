'use strict';

const crypto = require('node:crypto');

const GOOGLE_ISSUERS = new Set([
  'accounts.google.com',
  'https://accounts.google.com',
]);

class AuthError extends Error {
  constructor(code, status = 403) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

function decodeBase64UrlJson(value) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new AuthError('TOKEN_MALFORMED', 401);
  }
}

function readBearerToken(authorization) {
  if (typeof authorization !== 'string') {
    throw new AuthError('AUTH_REQUIRED', 401);
  }
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);
  if (!match || match[1].length > 16384) {
    throw new AuthError('TOKEN_MALFORMED', 401);
  }
  return match[1];
}

class GoogleJwksProvider {
  constructor({ fetchImpl = globalThis.fetch, cacheMs = 60 * 60 * 1000 } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('fetch implementation is required');
    }
    this.fetchImpl = fetchImpl;
    this.cacheMs = cacheMs;
    this.cachedAt = 0;
    this.keys = new Map();
  }

  async getKey(kid) {
    if (typeof kid !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(kid)) {
      throw new AuthError('TOKEN_MALFORMED', 401);
    }
    const now = Date.now();
    if (!this.keys.has(kid) || now - this.cachedAt >= this.cacheMs) {
      await this.refresh();
    }
    const key = this.keys.get(kid);
    if (!key) {
      throw new AuthError('TOKEN_SIGNATURE_INVALID');
    }
    return key;
  }

  async refresh() {
    let response;
    try {
      response = await this.fetchImpl('https://www.googleapis.com/oauth2/v3/certs', {
        headers: { accept: 'application/json' },
      });
    } catch {
      throw new AuthError('OIDC_KEYSET_UNAVAILABLE', 503);
    }
    if (!response.ok) {
      throw new AuthError('OIDC_KEYSET_UNAVAILABLE', 503);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new AuthError('OIDC_KEYSET_UNAVAILABLE', 503);
    }
    const next = new Map();
    for (const jwk of Array.isArray(body.keys) ? body.keys : []) {
      if (jwk && typeof jwk.kid === 'string' && jwk.kty === 'RSA') {
        next.set(jwk.kid, jwk);
      }
    }
    if (next.size === 0) {
      throw new AuthError('OIDC_KEYSET_UNAVAILABLE', 503);
    }
    this.keys = next;
    this.cachedAt = Date.now();
  }
}

class OidcVerifier {
  constructor({
    audience,
    ownerSubjectSha256,
    keyProvider = new GoogleJwksProvider(),
    now = () => Date.now(),
    clockSkewSeconds = 30,
  }) {
    if (typeof audience !== 'string' || audience.length === 0) {
      throw new TypeError('audience is required');
    }
    if (typeof ownerSubjectSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ownerSubjectSha256)) {
      throw new TypeError('ownerSubjectSha256 is required');
    }
    this.audience = audience;
    this.ownerSubjectSha256 = ownerSubjectSha256;
    this.keyProvider = keyProvider;
    this.now = now;
    this.clockSkewSeconds = clockSkewSeconds;
  }

  async verifyAuthorization(authorization) {
    const token = readBearerToken(authorization);
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
      throw new AuthError('TOKEN_MALFORMED', 401);
    }
    const header = decodeBase64UrlJson(parts[0]);
    const claims = decodeBase64UrlJson(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
      throw new AuthError('TOKEN_ALGORITHM_INVALID');
    }
    const jwk = await this.keyProvider.getKey(header.kid);
    let validSignature = false;
    try {
      const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      validSignature = crypto.verify(
        'RSA-SHA256',
        Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'),
        publicKey,
        Buffer.from(parts[2], 'base64url'),
      );
    } catch {
      validSignature = false;
    }
    if (!validSignature) {
      throw new AuthError('TOKEN_SIGNATURE_INVALID');
    }

    const nowSeconds = Math.floor(this.now() / 1000);
    if (!GOOGLE_ISSUERS.has(claims.iss)) {
      throw new AuthError('TOKEN_ISSUER_INVALID');
    }
    if (typeof claims.exp !== 'number' || claims.exp + this.clockSkewSeconds < nowSeconds) {
      throw new AuthError('TOKEN_EXPIRED');
    }
    if (typeof claims.iat !== 'number' || claims.iat - this.clockSkewSeconds > nowSeconds) {
      throw new AuthError('TOKEN_TIME_INVALID');
    }
    if (typeof claims.nbf === 'number' && claims.nbf - this.clockSkewSeconds > nowSeconds) {
      throw new AuthError('TOKEN_TIME_INVALID');
    }
    if (typeof claims.aud !== 'string' || claims.aud !== this.audience) {
      throw new AuthError('TOKEN_AUDIENCE_INVALID');
    }
    const subjectDigest = typeof claims.sub === 'string'
      ? crypto.createHash('sha256').update(claims.sub, 'utf8').digest()
      : Buffer.alloc(32);
    const expectedDigest = Buffer.from(this.ownerSubjectSha256, 'hex');
    if (typeof claims.sub !== 'string' || !crypto.timingSafeEqual(subjectDigest, expectedDigest)) {
      throw new AuthError('TOKEN_OWNER_INVALID');
    }

    // Raw Google identity claims are deliberately discarded at this boundary.
    return Object.freeze({ principalAlias: 'owner_binding' });
  }
}

module.exports = {
  AuthError,
  GoogleJwksProvider,
  OidcVerifier,
};
