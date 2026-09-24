(function(root) {
  'use strict';

  // Phase 1 remains direct for Projects/Work. Phase 2 is an explicit,
  // session-scoped canary URL; the backend still enforces the configured
  // owner home/member boundary on every request.
  const phase2Canary = /(?:^|[?&])paluru_read_transport_phase2_canary=1(?:&|$)/
    .test(String(root.location && root.location.search || ''));
  const stableBaseUrl = 'https://paluru-read-transport-v2-jwnmkrlyha-an.a.run.app';
  const phase2CanaryBaseUrl = 'https://phase2-canary-20260925---paluru-read-transport-v2-jwnmkrlyha-an.a.run.app';
  root.PALURU_READ_TRANSPORT_V2_CONFIG = Object.freeze({
    mode: 'DIRECT_V2',
    baseUrl: phase2Canary ? phase2CanaryBaseUrl : stableBaseUrl,
    canaryCapability: '',
    routeModes: Object.freeze({
      projects: 'DIRECT_V2',
      work: 'DIRECT_V2',
      today: phase2Canary ? 'DIRECT_V2' : 'GAS',
      inbox: phase2Canary ? 'DIRECT_V2' : 'GAS'
    })
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
