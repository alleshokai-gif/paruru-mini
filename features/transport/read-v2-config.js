(function(root) {
  'use strict';

  // Phase 1 owner canary rollback. Direct Projects/Work passed the bounded
  // retry, but the full acceptance matrix hit a legacy GAS INBOX timeout.
  root.PALURU_READ_TRANSPORT_V2_CONFIG = Object.freeze({
    mode: 'GAS',
    baseUrl: '',
    canaryCapability: 'kaz.read.direct_v2.canary'
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
