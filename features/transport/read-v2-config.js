(function(root) {
  'use strict';

  // Phase 1 owner canary. The existing server-owned admin + home.control
  // boundary selects the single Kaz owner without committing a member ID.
  // GAS remains the explicit rollback mode; DIRECT_V2 never silently falls
  // back within a request.
  root.PALURU_READ_TRANSPORT_V2_CONFIG = Object.freeze({
    mode: 'DIRECT_V2',
    baseUrl: 'https://paluru-read-transport-v2-jwnmkrlyha-an.a.run.app',
    canaryCapability: 'home.control'
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
