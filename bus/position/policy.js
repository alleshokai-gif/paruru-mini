// Uncalibrated research thresholds. A score is not a probability of correctness.
export const POSITION_POLICY = Object.freeze({ maxAgeSec: 120, futureSec: 5, routeMeters: 40,
  stopRouteMeters: 60, candidateSlackMeters: 10, ambiguityMeters: 40, jitterMeters: 15,
  minProgressMeters: 15, maxSpeedMps: 22, jumpAllowanceMeters: 20, minSamples: 3,
  minSpanSec: 20, historySec: 180, maxPoints: 6, maxTrips: 256,
  nearStopMeters: 35, atStopMeters: 15, dwellSpreadMeters: 8, threshold: 0.85 });
