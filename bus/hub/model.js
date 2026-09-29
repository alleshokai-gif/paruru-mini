import { POSITION_POLICY } from '../position/policy.js';

const REALTIME_STATES = new Set(['realtime', 'stale', 'static_only', 'static', 'static_fallback', 'realtime_stale', 'fetch_error', 'unknown']);
const DEPARTURE_STATES = new Set(['scheduled', 'realtime', 'departure_pending', 'departure_overdue',
  'departure_uncertain', 'departed', 'cancelled', 'unknown']);
const ACTIONABILITY = new Set(['catchable', 'uncertain', 'do_not_recommend']);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const finite = (value) => Number.isFinite(value);
const nullableTime = (value) => value == null || finite(value) && value >= 0;
const fail = (code) => { throw new Error(code); };

function normalizeStop(value) {
  if (!text(value?.id) || !text(value?.name)) fail('BUS_HUB_STOP_INVALID');
  return { id: value.id, name: value.name };
}

function normalizePosition(value, generatedAt) {
  if (!value || typeof value.supported !== 'boolean') fail('BUS_HUB_POSITION_INVALID');
  if (!value.supported) return { supported: false, state: null, stopsAway: null,
    previousStop: null, nextStop: null, confidence: null };
  if (value.shadowReady === true) {
    if (!['between_stops', 'approaching', 'at_stop', 'departed'].includes(value.state)
      || !Number.isInteger(value.stopsAway) || value.stopsAway < 0
      || value.previousStop != null && !text(value.previousStop)
      || !text(value.nextStop) || !finite(value.observedAt)
      || value.confidence != null) fail('BUS_HUB_POSITION_INVALID');
    if (generatedAt - value.observedAt > POSITION_POLICY.maxAgeSec
      || value.observedAt - generatedAt > POSITION_POLICY.futureSec)
      return { supported: false, state: null, stopsAway: null,
        previousStop: null, nextStop: null, confidence: null };
    return { supported: true, shadowReady: true, state: value.state,
      stopsAway: value.stopsAway, previousStop: value.previousStop ?? null,
      nextStop: value.nextStop, observedAt: value.observedAt };
  }
  const confidence = value.confidence;
  if (!text(value.state) || !Number.isInteger(value.stopsAway) || value.stopsAway < 0
    || !text(value.previousStop) && value.previousStop != null
    || !text(value.nextStop) && value.nextStop != null
    || !finite(confidence) || confidence < 0 || confidence > 1) fail('BUS_HUB_POSITION_INVALID');
  return { supported: true, state: value.state, stopsAway: value.stopsAway,
    previousStop: value.previousStop ?? null, nextStop: value.nextStop ?? null, confidence };
}

function normalizeOfficialApproach(value, arrival, generatedAt) {
  if (value == null) return null;
  if (arrival.provider !== 'tokyu' || arrival.realtimeState !== 'static_only'
    || value.matchedTripId !== null || value.uniqueNext !== true
    || value.routeLabel !== arrival.routeLabel || value.destination !== arrival.destination
    || value.boardingStopId !== arrival.originStop?.id
    || !Number.isInteger(value.waitMinutes) || value.waitMinutes < 0 || value.waitMinutes > 60
    || !Number.isInteger(value.stopsAwayMin) || !Number.isInteger(value.stopsAwayMax)
    || value.stopsAwayMin < 0 || value.stopsAwayMax > 6 || value.stopsAwayMin > value.stopsAwayMax
    || !finite(value.retrievedAt) || generatedAt - value.retrievedAt > 90
    || value.retrievedAt - generatedAt > 5) return null;
  return { matchedTripId: null, uniqueNext: true, routeLabel: value.routeLabel,
    destination: value.destination, boardingStopId: value.boardingStopId,
    waitMinutes: value.waitMinutes, stopsAwayMin: value.stopsAwayMin,
    stopsAwayMax: value.stopsAwayMax, retrievedAt: value.retrievedAt };
}

export function normalizeHubArrival(value, generatedAt, { etaConsistencySec = 90 } = {}) {
  if (!finite(generatedAt) || generatedAt < 0 || !finite(etaConsistencySec) || etaConsistencySec < 0)
    fail('BUS_HUB_TIME_INVALID');
  for (const field of ['id', 'sourceId', 'provider', 'routeId', 'routeLabel', 'destination'])
    if (!text(value?.[field])) fail('BUS_HUB_ARRIVAL_INVALID');
  if (!finite(value.scheduledDeparture) || value.scheduledDeparture < 0
    || !nullableTime(value.estimatedDeparture) || !nullableTime(value.effectiveDeparture)
    || value.etaMinutes != null && (!finite(value.etaMinutes) || value.etaMinutes < 0)
    || value.delayMinutes != null && !finite(value.delayMinutes)
    || value.platform != null && !text(value.platform)
    || !REALTIME_STATES.has(value.realtimeState)
    || !DEPARTURE_STATES.has(value.departureState)
    || value.actionability != null && !ACTIONABILITY.has(value.actionability)
    || value.isOrigin != null && typeof value.isOrigin !== 'boolean'
    || value.areaBadge != null && !text(value.areaBadge)
    || value.confidence != null && (!finite(value.confidence) || value.confidence < 0 || value.confidence > 1))
    fail('BUS_HUB_ARRIVAL_INVALID');
  if (value.etaMinutes != null && value.estimatedDeparture != null
    && Math.abs(value.estimatedDeparture - (generatedAt + value.etaMinutes * 60)) > etaConsistencySec)
    fail('BUS_HUB_ETA_CONTRADICTION');
  const officialApproach = normalizeOfficialApproach(value.officialApproach, value, generatedAt);
  return {
    id: value.id, sourceId: value.sourceId, provider: value.provider,
    routeId: value.routeId, routeLabel: value.routeLabel, destination: value.destination,
    isOrigin: value.isOrigin === true,
    areaBadge: value.areaBadge ?? null,
    originStop: normalizeStop(value.originStop), targetStop: normalizeStop(value.targetStop),
    scheduledDeparture: value.scheduledDeparture,
    estimatedDeparture: value.estimatedDeparture ?? null,
    effectiveDeparture: value.effectiveDeparture ?? null,
    etaMinutes: value.etaMinutes ?? null,
    delayMinutes: value.delayMinutes ?? null,
    platform: value.platform ?? null,
    realtimeState: value.realtimeState,
    departureState: value.departureState,
    actionability: value.actionability ?? null,
    confidence: value.confidence ?? null,
    position: normalizePosition(value.position, generatedAt),
    ...(officialApproach ? { officialApproach } : {})
  };
}
