const finite = (value) => Number.isFinite(value);

function rankingTime(arrival, generatedAt) {
  if (finite(arrival.effectiveDeparture)) return { time: arrival.effectiveDeparture, basis: 'effective_departure' };
  if (finite(arrival.etaMinutes)) return { time: generatedAt + arrival.etaMinutes * 60, basis: 'eta' };
  if (finite(arrival.estimatedDeparture)) return { time: arrival.estimatedDeparture, basis: 'estimated_departure' };
  return { time: arrival.scheduledDeparture, basis: 'scheduled_departure' };
}

function tier(arrival, lowConfidenceThreshold) {
  if (['cancelled', 'departed'].includes(arrival.departureState)) return { excluded: true, value: 4, quality: 'excluded' };
  if (arrival.departureState === 'departure_uncertain' || arrival.departureState === 'unknown'
    || arrival.actionability === 'do_not_recommend') return { excluded: false, value: 3, quality: 'unsafe' };
  if (arrival.realtimeState === 'static_only' || arrival.realtimeState === 'static')
    return { excluded: false, value: 2, quality: 'static_only' };
  if (['stale', 'static_fallback', 'realtime_stale', 'fetch_error'].includes(arrival.realtimeState)
    || finite(arrival.confidence) && arrival.confidence < lowConfidenceThreshold)
    return { excluded: false, value: 1, quality: 'degraded' };
  return { excluded: false, value: 0, quality: 'realtime' };
}

function sortingRisk(arrival) {
  if (arrival.recommendationTier >= 3) return 2;
  if (arrival.recommendationTier === 1) return 1;
  return 0;
}

export function rankHubArrivals(arrivals, generatedAt, { lowConfidenceThreshold = 0.5 } = {}) {
  if (!Array.isArray(arrivals) || !finite(generatedAt) || !finite(lowConfidenceThreshold)
    || lowConfidenceThreshold < 0 || lowConfidenceThreshold > 1) throw new Error('BUS_HUB_RANK_INPUT_INVALID');
  return arrivals.map((arrival) => {
    const recommendation = tier(arrival, lowConfidenceThreshold);
    const timing = rankingTime(arrival, generatedAt);
    return { ...arrival, rankingBasis: timing.basis, rankingTime: timing.time,
      recommendationTier: recommendation.value, recommendationQuality: recommendation.quality,
      recommendable: !recommendation.excluded && recommendation.value < 3 };
  }).filter((arrival) => !['cancelled', 'departed'].includes(arrival.departureState))
    .sort((a, b) => sortingRisk(a) - sortingRisk(b)
      || a.rankingTime - b.rankingTime
      || a.recommendationTier - b.recommendationTier
      || a.scheduledDeparture - b.scheduledDeparture
      || a.provider.localeCompare(b.provider)
      || a.id.localeCompare(b.id));
}
