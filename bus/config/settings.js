import favorites from './favorites.json' with { type: 'json' };
export const FAVORITES = Object.freeze(favorites);
// Compatibility facade for P0 build/research callers; Core imports policy.js directly.
export { BUS_POSITION_UI_ENABLED, LIMITS } from './policy.js';
