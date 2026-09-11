// Provider-neutral P0 behavior. Position release remains a separate acceptance gate.
export const BUS_POSITION_UI_ENABLED = false;
export const LIMITS = Object.freeze({ pollSec: 30, rtCacheSec: 25,
  feedMaxAgeSec: 120, tripMaxAgeSec: 180, vehicleMaxAgeSec: 120,
  requestTimeoutMs: 20000, zipMaxBytes: 16 * 1024 * 1024, rtMaxBytes: 2 * 1024 * 1024,
  expandedMaxBytes: 160 * 1024 * 1024, arrivals: 3 });
