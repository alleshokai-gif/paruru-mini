(function(root) {
  'use strict';

  // Phase 1 production read selection. Existing PWA and server-side Kaz admin
  // authorization still apply; an empty cohort capability removes only the
  // owner-canary transport gate.
  root.PALURU_READ_TRANSPORT_V2_CONFIG = Object.freeze({
    mode: 'DIRECT_V2',
    baseUrl: 'https://paluru-read-transport-v2-jwnmkrlyha-an.a.run.app',
    canaryCapability: ''
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
