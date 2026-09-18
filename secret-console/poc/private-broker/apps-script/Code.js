'use strict';

var POC_BROKER_KEYS_ = Object.freeze({
  BROKER_URL: 'POC_PRIVATE_BROKER_URL',
  ACTIVE_SLOT: 'POC_SYNTHETIC_ACTIVE_SLOT',
  SLOT_A: 'POC_SYNTHETIC_SLOT_A',
  SLOT_B: 'POC_SYNTHETIC_SLOT_B',
  APPLY_OPERATION: 'POC_APPLY_OPERATION_ALIAS',
  APPLY_LEASE: 'POC_APPLY_LEASE_ALIAS',
  APPLY_TARGET: 'POC_APPLY_TARGET_SLOT',
  APPLY_STATE: 'POC_APPLY_STATE',
  LAST_APPLIED: 'POC_LAST_APPLIED_OPERATION_ALIAS'
});

function pocPrivateBrokerTick_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    return { success: false, code: 'TRIGGER_BUSY' };
  }
  try {
    var properties = PropertiesService.getScriptProperties();
    var brokerUrl = properties.getProperty(POC_BROKER_KEYS_.BROKER_URL);
    if (!brokerUrl || !/^https:\/\/[A-Za-z0-9.-]+\/?$/.test(brokerUrl)) {
      throw new Error('POC_CONFIGURATION_INVALID');
    }
    brokerUrl = brokerUrl.replace(/\/$/, '');
    var identityToken = ScriptApp.getIdentityToken();
    if (!identityToken) throw new Error('POC_IDENTITY_TOKEN_UNAVAILABLE');

    return pocPrivateBrokerTickWithDeps_({
      get: function (key) { return properties.getProperty(key); },
      setMany: function (values) { properties.setProperties(values, false); },
      deleteMany: function (keys) {
        keys.forEach(function (key) { properties.deleteProperty(key); });
      },
      request: function (path, body) {
        var response = UrlFetchApp.fetch(brokerUrl + path, {
          method: 'post',
          contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + identityToken },
          payload: JSON.stringify(body || {}),
          muteHttpExceptions: true
        });
        var status = response.getResponseCode();
        var parsed;
        try {
          parsed = JSON.parse(response.getContentText());
        } catch (ignored) {
          throw new Error('POC_BROKER_RESPONSE_INVALID');
        }
        if (status < 200 || status >= 300) {
          var safeCode = parsed && parsed.error && parsed.error.code;
          throw new Error(/^[-A-Z0-9_]{1,64}$/.test(safeCode || '') ? safeCode : 'POC_BROKER_REQUEST_FAILED');
        }
        return parsed;
      }
    });
  } catch (error) {
    throw new Error(pocSafeErrorCode_(error));
  } finally {
    lock.releaseLock();
  }
}

function pocIdentityBindingMetadata_() {
  var identityToken = ScriptApp.getIdentityToken();
  if (!identityToken) throw new Error('POC_IDENTITY_TOKEN_UNAVAILABLE');
  var parts = identityToken.split('.');
  if (parts.length !== 3) throw new Error('POC_IDENTITY_TOKEN_INVALID');
  var claims;
  try {
    claims = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString());
  } catch (ignored) {
    throw new Error('POC_IDENTITY_TOKEN_INVALID');
  }
  if (typeof claims.aud !== 'string' || typeof claims.sub !== 'string') {
    throw new Error('POC_IDENTITY_CLAIMS_INVALID');
  }
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    claims.sub,
    Utilities.Charset.UTF_8
  ).map(function (value) {
    return ('0' + ((value + 256) % 256).toString(16)).slice(-2);
  }).join('');
  return {
    audience: claims.aud,
    owner_subject_sha256: digest,
    issuer_valid: claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com',
    has_exp: typeof claims.exp === 'number',
    has_iat: typeof claims.iat === 'number',
    has_nbf: typeof claims.nbf === 'number'
  };
}

function pocPrivateBrokerTickWithDeps_(deps) {
  var polled = deps.request('/v1/operations/poll', {});
  var operation = polled && polled.operation;
  if (!operation) return { success: true, code: 'NO_OPERATION' };
  var operationAlias = pocRequireAlias_(operation.operation_alias, 'OPERATION_ALIAS_INVALID');

  if (deps.get(POC_BROKER_KEYS_.LAST_APPLIED) === operationAlias) {
    var appliedLeaseAlias = pocRequireAlias_(
      deps.get(POC_BROKER_KEYS_.APPLY_LEASE),
      'APPLY_LEASE_INVALID'
    );
    deps.request('/v1/operations/ack', {
      operation_alias: operationAlias,
      lease_alias: appliedLeaseAlias
    });
    pocClearApplyMarker_(deps);
    return { success: true, code: 'ACK_RECONCILED', operation_alias: operationAlias };
  }

  var leased = deps.request('/v1/operations/lease', { operation_alias: operationAlias });
  var lease = leased && leased.operation;
  var leaseAlias = pocRequireAlias_(lease && lease.lease_alias, 'LEASE_ALIAS_INVALID');

  var markedOperation = deps.get(POC_BROKER_KEYS_.APPLY_OPERATION);
  var markedState = deps.get(POC_BROKER_KEYS_.APPLY_STATE);
  var targetSlot;
  if (markedOperation === operationAlias) {
    targetSlot = deps.get(POC_BROKER_KEYS_.APPLY_TARGET);
    if (targetSlot !== 'A' && targetSlot !== 'B') throw new Error('APPLY_MARKER_INVALID');
  } else {
    var activeSlot = deps.get(POC_BROKER_KEYS_.ACTIVE_SLOT) === 'B' ? 'B' : 'A';
    targetSlot = activeSlot === 'A' ? 'B' : 'A';
    deps.setMany(pocObject_(
      POC_BROKER_KEYS_.APPLY_OPERATION, operationAlias,
      POC_BROKER_KEYS_.APPLY_LEASE, leaseAlias,
      POC_BROKER_KEYS_.APPLY_TARGET, targetSlot,
      POC_BROKER_KEYS_.APPLY_STATE, 'APPLYING'
    ));
    markedState = 'APPLYING';
  }

  var slotKey = targetSlot === 'A' ? POC_BROKER_KEYS_.SLOT_A : POC_BROKER_KEYS_.SLOT_B;
  if (markedState !== 'SLOT_WRITTEN') {
    var redeemed = deps.request('/v1/operations/redeem', {
      operation_alias: operationAlias,
      lease_alias: leaseAlias
    });
    var payload = redeemed && redeemed.synthetic_payload;
    if (typeof payload !== 'string' || payload.length === 0 || payload.length > 4096) {
      throw new Error('SYNTHETIC_PAYLOAD_INVALID');
    }
    pocRunHook_(deps, 'afterRedeem');
    if (!pocEqual_(deps.get(slotKey), payload)) {
      deps.setMany(pocObject_(slotKey, payload));
    }
    deps.setMany(pocObject_(POC_BROKER_KEYS_.APPLY_STATE, 'SLOT_WRITTEN'));
  }
  pocRunHook_(deps, 'afterSlotWrite');

  deps.setMany(pocObject_(POC_BROKER_KEYS_.ACTIVE_SLOT, targetSlot));
  pocRunHook_(deps, 'afterActivate');

  deps.setMany(pocObject_(
    POC_BROKER_KEYS_.APPLY_STATE, 'APPLIED',
    POC_BROKER_KEYS_.APPLY_LEASE, leaseAlias,
    POC_BROKER_KEYS_.LAST_APPLIED, operationAlias
  ));
  pocRunHook_(deps, 'beforeAck');

  deps.request('/v1/operations/ack', {
    operation_alias: operationAlias,
    lease_alias: leaseAlias
  });
  pocClearApplyMarker_(deps);
  return { success: true, code: 'APPLIED_ACKNOWLEDGED', operation_alias: operationAlias };
}

function pocObject_() {
  var result = {};
  for (var index = 0; index < arguments.length; index += 2) {
    result[arguments[index]] = arguments[index + 1];
  }
  return result;
}

function pocClearApplyMarker_(deps) {
  deps.deleteMany([
    POC_BROKER_KEYS_.APPLY_OPERATION,
    POC_BROKER_KEYS_.APPLY_LEASE,
    POC_BROKER_KEYS_.APPLY_TARGET,
    POC_BROKER_KEYS_.APPLY_STATE
  ]);
}

function pocRequireAlias_(value, code) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(code);
  }
  return value;
}

function pocEqual_(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  var difference = 0;
  for (var index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function pocRunHook_(deps, name) {
  if (deps.hooks && typeof deps.hooks[name] === 'function') deps.hooks[name]();
}

function pocSafeErrorCode_(error) {
  var message = error && error.message;
  return /^[-A-Z0-9_]{1,64}$/.test(message || '') ? message : 'POC_TRIGGER_FAILED';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    POC_BROKER_KEYS_: POC_BROKER_KEYS_,
    pocIdentityBindingMetadata_: pocIdentityBindingMetadata_,
    pocPrivateBrokerTick_: pocPrivateBrokerTick_,
    pocPrivateBrokerTickWithDeps_: pocPrivateBrokerTickWithDeps_
  };
}
