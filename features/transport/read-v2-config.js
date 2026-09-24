(function(root) {
  'use strict';

  // Phase 1 owner canary rollback. Direct reads failed closed at the backend
  // authentication boundary; GAS is selected explicitly for subsequent reads.
  root.PALURU_READ_TRANSPORT_V2_CONFIG = Object.freeze({
    mode: 'GAS',
    baseUrl: '',
    canaryCapability: 'kaz.read.direct_v2.canary'
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
