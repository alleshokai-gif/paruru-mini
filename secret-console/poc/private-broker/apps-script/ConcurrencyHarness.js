'use strict';

/**
 * Live-acceptance-only probe. Sends exactly two lease requests in parallel,
 * verifies that both observe the same Firestore lease, then completes the
 * normal staged apply/ACK path with the existing transport implementation.
 */
function pocConcurrentLeaseProbe() {
  return pocConcurrentLeaseProbe_();
}

function pocConcurrentLeaseProbe_() {
  var startedAt = Date.now();
  return pocLogObservedResult_('concurrent_lease_probe', startedAt, function () {
    var properties = PropertiesService.getScriptProperties();
    var brokerUrl = properties.getProperty(POC_BROKER_KEYS_.BROKER_URL);
    if (!brokerUrl || !/^https:\/\/[A-Za-z0-9.-]+\/?$/.test(brokerUrl)) {
      throw new Error('POC_CONFIGURATION_INVALID');
    }
    brokerUrl = brokerUrl.replace(/\/$/, '');

    var identityToken = ScriptApp.getIdentityToken();
    if (!identityToken) throw new Error('POC_IDENTITY_TOKEN_UNAVAILABLE');

    var pollResponse = UrlFetchApp.fetch(brokerUrl + '/v1/operations/poll', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + identityToken },
      payload: '{}',
      muteHttpExceptions: true
    });
    var polled = pocConcurrentParseResponse_(pollResponse);
    var operationAlias = pocRequireAlias_(
      polled && polled.operation && polled.operation.operation_alias,
      'OPERATION_ALIAS_INVALID'
    );

    var leaseRequest = {
      url: brokerUrl + '/v1/operations/lease',
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + identityToken },
      payload: JSON.stringify({ operation_alias: operationAlias }),
      muteHttpExceptions: true
    };
    var leaseResponses = UrlFetchApp.fetchAll([leaseRequest, leaseRequest]);
    if (!leaseResponses || leaseResponses.length !== 2) {
      throw new Error('POC_CONCURRENT_LEASE_COUNT_INVALID');
    }

    var leaseAliases = leaseResponses.map(function (response) {
      var parsed = pocConcurrentParseResponse_(response);
      return pocRequireAlias_(
        parsed && parsed.operation && parsed.operation.lease_alias,
        'LEASE_ALIAS_INVALID'
      );
    });
    if (!pocEqual_(leaseAliases[0], leaseAliases[1])) {
      throw new Error('POC_CONCURRENT_LEASE_DIVERGED');
    }

    var applied = pocPrivateBrokerTickWithDeps_(pocAcceptanceDeps_({}));
    if (!applied || applied.success !== true ||
        applied.code !== 'APPLIED_ACKNOWLEDGED' ||
        applied.operation_alias !== operationAlias) {
      throw new Error('POC_CONCURRENT_APPLY_INVALID');
    }
    return {
      success: true,
      code: 'CONCURRENT_LEASE_APPLIED',
      operation_alias: operationAlias
    };
  });
}

function pocConcurrentParseResponse_(response) {
  var status = response.getResponseCode();
  var parsed;
  try {
    parsed = JSON.parse(response.getContentText());
  } catch (ignored) {
    throw new Error('POC_BROKER_RESPONSE_INVALID');
  }
  if (status < 200 || status >= 300) {
    var safeCode = parsed && parsed.error && parsed.error.code;
    throw new Error(/^[-A-Z0-9_]{1,64}$/.test(safeCode || '')
      ? safeCode
      : 'POC_BROKER_REQUEST_FAILED');
  }
  return parsed;
}
