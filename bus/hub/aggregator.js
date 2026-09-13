import { normalizeHubArrival } from './model.js';
import { rankHubArrivals } from './ranking.js';

const text = (value) => typeof value === 'string' && value.trim().length > 0;
const fail = (code) => { throw new Error(code); };
const metadataTime = (value) => Number.isFinite(value) && value >= 0 ? value : null;

function validateHub(hub) {
  if (!text(hub?.id) || !text(hub?.label) || !Array.isArray(hub.purposes) || !hub.purposes.length
    || !Array.isArray(hub.sources)) fail('BUS_HUB_CONFIG_INVALID');
  const purposeIds = new Set();
  for (const purpose of hub.purposes) {
    if (!text(purpose?.id) || !text(purpose?.label) || purposeIds.has(purpose.id)) fail('BUS_HUB_CONFIG_INVALID');
    purposeIds.add(purpose.id);
  }
  const sourceKeys = new Set();
  for (const source of hub.sources) {
    const key = `${source?.provider}|${source?.sourceId}`;
    if (!text(source?.provider) || !text(source?.sourceId) || !purposeIds.has(source?.purposeId)
      || source.walkMinutes != null && (!Number.isFinite(source.walkMinutes) || source.walkMinutes < 0)
      || sourceKeys.has(key)) fail('BUS_HUB_CONFIG_INVALID');
    sourceKeys.add(key);
  }
  return { purposeIds, sourceKeys };
}

function errorCode(value, fallback) {
  return text(value?.code) ? value.code : fallback;
}

export function aggregateHub({ hub, generatedAt, providerResults, rankingOptions } = {}) {
  validateHub(hub);
  if (!Number.isFinite(generatedAt) || generatedAt < 0 || !Array.isArray(providerResults))
    fail('BUS_HUB_INPUT_INVALID');
  const bindings = new Map(hub.sources.map((source) => [`${source.provider}|${source.sourceId}`, source]));
  const expectedProviders = [...new Set(hub.sources.map((source) => source.provider))];
  const results = new Map();
  for (const result of providerResults) {
    if (!text(result?.provider) || results.has(result.provider)) fail('BUS_HUB_PROVIDER_RESULT_INVALID');
    results.set(result.provider, result);
  }
  const providers = [], collected = [];
  for (const provider of expectedProviders) {
    const result = results.get(provider);
    if (!result) {
      providers.push({ provider, state: 'unavailable', code: 'RESULT_MISSING', invalidCount: 0 });
      continue;
    }
    if (result.error) {
      providers.push({ provider, state: 'unavailable', code: errorCode(result.error, 'SOURCE_UNAVAILABLE'), invalidCount: 0 });
      continue;
    }
    if (!Array.isArray(result.arrivals)) {
      providers.push({ provider, state: 'invalid', code: 'RESULT_INVALID', invalidCount: 0 });
      continue;
    }
    let invalidCount = 0;
    for (const candidate of result.arrivals) {
      try {
        const arrival = normalizeHubArrival(candidate, generatedAt);
        if (arrival.provider !== provider) throw new Error('BUS_HUB_PROVIDER_MISMATCH');
        const binding = bindings.get(`${arrival.provider}|${arrival.sourceId}`);
        if (!binding) continue;
        collected.push({ ...arrival, purposeId: binding.purposeId, walkMinutes: binding.walkMinutes });
      } catch { invalidCount++; }
    }
    providers.push({ provider, state: invalidCount ? 'partial' : 'available',
      code: invalidCount ? 'ARRIVAL_INVALID' : null, invalidCount,
      retrievedAt: metadataTime(result.retrievedAt), sourceUpdatedAt: metadataTime(result.sourceUpdatedAt) });
  }
  const groups = hub.purposes.map((purpose) => {
    const arrivals = rankHubArrivals(collected.filter((arrival) => arrival.purposeId === purpose.id), generatedAt, rankingOptions);
    return { id: purpose.id, label: purpose.label,
      recommendedArrivalId: arrivals.find((arrival) => arrival.recommendable)?.id ?? null, arrivals };
  });
  return { hubId: hub.id, generatedAt, providers, arrivals: groups.flatMap((group) => group.arrivals), groups };
}
