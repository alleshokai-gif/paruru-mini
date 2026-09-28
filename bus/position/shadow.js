import { POSITION_POLICY } from './policy.js';

const waiting = () => Object.freeze({ supported: false, state: null, previousStop: null,
  nextStop: null, stopsAway: null, confidence: null, shadowReady: false });

// Family Shadow presentation gate. Callers expose only stop-level fields, never raw coordinates.
export function shadowPosition(engineResult, artifact) {
  if (artifact?.approvedForShadow !== true || artifact.approvedForPublic !== false
    || artifact.geometryReady !== false || engineResult?.supported !== true
    || !Number.isFinite(engineResult.confidence) || engineResult.confidence < POSITION_POLICY.threshold
    || !String(engineResult.method || '').startsWith('gps_')
    || (engineResult.conflicts || []).length || !['between_stops', 'approaching', 'at_stop', 'departed'].includes(engineResult.state)
    || !engineResult.nextStop?.name || !Number.isSafeInteger(engineResult.stopsAway)
    || engineResult.stopsAway < 0) return waiting();
  return Object.freeze({ supported: true, state: engineResult.state,
    previousStop: engineResult.previousStop?.name ?? null, nextStop: engineResult.nextStop.name,
    stopsAway: engineResult.stopsAway, confidence: engineResult.confidence, shadowReady: true });
}
