import favorites from './favorites.json' with { type: 'json' };
export const FAVORITES = Object.freeze(favorites);
export const BUS_POSITION_UI_ENABLED = false;
// Labels checked against official platform pages; never derive them from stop_id suffixes.
export const PLATFORMS = Object.freeze({ '184_1': '1番', '184_2': '2番', '362_1': '登05のりば', '434_2': '2番', '434_3': '3番', '434_4': '4番' });
export const LIMITS = Object.freeze({ pollSec: 30, rtCacheSec: 25,
  feedMaxAgeSec: 120, tripMaxAgeSec: 180, vehicleMaxAgeSec: 120,
  requestTimeoutMs: 20000, zipMaxBytes: 16 * 1024 * 1024, rtMaxBytes: 2 * 1024 * 1024,
  expandedMaxBytes: 160 * 1024 * 1024, arrivals: 3 });
