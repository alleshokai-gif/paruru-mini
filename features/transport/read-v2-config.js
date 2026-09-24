(function(root) {
  'use strict';

  // Phase 1 ships disabled. Production cohort selection and endpoint activation
  // are a separate cutover step. GAS remains available only as the explicit
  // rollback mode; DIRECT_V2 never silently falls back within a request.
  root.PALURU_READ_TRANSPORT_V2_CONFIG = Object.freeze({
    mode: 'GAS',
    baseUrl: ''
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
