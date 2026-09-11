import favorites from './favorites.json' with { type: 'json' };

// P0 composition only. Preserve the original artifact/config hash and display metadata.
export const P0_QUERIES = Object.freeze(favorites.map(f => Object.freeze({ ...f,
  type: 'favorite', label: `${f.from} → ${f.to}`,
  fromStopIds: Object.freeze([...f.fromStopIds]), toStopIds: Object.freeze([...f.toStopIds]),
  routeIds: Object.freeze([...f.routeIds]) })));
