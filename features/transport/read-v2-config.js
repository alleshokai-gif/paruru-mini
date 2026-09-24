(function(root) {
  'use strict';

  // Phase 1 owner canary. Server-side authorization still validates the exact
  // owner/admin identity; this PWA flag only selects the direct read transport.
  root.PALURU_READ_TRANSPORT_V2_CONFIG = Object.freeze({
    mode: 'DIRECT_V2',
    baseUrl: 'https://paluru-read-transport-v2-jwnmkrlyha-an.a.run.app',
    canaryCapability: 'home.control'
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
