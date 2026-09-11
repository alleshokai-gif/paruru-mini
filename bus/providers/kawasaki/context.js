import { PROVIDER_ID, REALTIME_SCHEMA_VERSION, resolvePlatform } from './config.js';
import { ATTRIBUTION } from './attribution.js';
import { createPositionStaticResolver } from './position-reference.js';

export function createKawasakiContext({ positionStatic = null } = {}) {
  return Object.freeze({ id: PROVIDER_ID, attribution: ATTRIBUTION, platformResolver: resolvePlatform,
    realtimeSchemaVersion: REALTIME_SCHEMA_VERSION, resolvePositionStatic: createPositionStaticResolver(positionStatic) });
}
export const KAWASAKI_CONTEXT = createKawasakiContext();
