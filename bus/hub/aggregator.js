import { normalizeHubArrival } from './model.js';
import { rankHubArrivals } from './ranking.js';

const text = (value) => typeof value === 'string' && value.trim().length > 0;
const fail = (code) => { throw new Error(code); };
const metadataTime = (value) => Number.isFinite(value) && value >= 0 ? value : null;

function validateHub(hub) {
  if (!text(hub?.id) || !text(hub?.label) || !Array.isArray(hub.decisionGroups) || !hub.decisionGroups.length
    || !Array.isArray(hub.sources)) fail('BUS_HUB_CONFIG_INVALID');
  const decisionGroups = new Map();
  for (const group of hub.decisionGroups) {
    if (!text(group?.id) || group.hubId !== hub.id || !text(group?.label) || decisionGroups.has(group.id)
      || !Array.isArray(group.destinations) || !group.destinations.length || group.destinations.some((value) => !text(value))
      || !Array.isArray(group.providers) || !group.providers.length || group.providers.some((value) => !text(value))
      || !Number.isInteger(group.displayLimit) || group.displayLimit < 1 || group.displayLimit > 10)
      fail('BUS_HUB_CONFIG_INVALID');
    decisionGroups.set(group.id, group);
  }
  const sourceKeys = new Set();
  for (const source of hub.sources) {
    const key = `${source?.provider}|${source?.sourceId}`;
    const group = decisionGroups.get(source?.decisionGroupId);
    if (!text(source?.provider) || !text(source?.sourceId) || !group || !group.providers.includes(source.provider)
      || source.walkMinutes != null && (!Number.isFinite(source.walkMinutes) || source.walkMinutes < 0)
      || sourceKeys.has(key)) fail('BUS_HUB_CONFIG_INVALID');
    sourceKeys.add(key);
  }
  return { decisionGroups, sourceKeys };
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
        collected.push({ ...arrival, decisionGroupId: binding.decisionGroupId, walkMinutes: binding.walkMinutes });
      } catch { invalidCount++; }
    }
    providers.push({ provider, state: invalidCount ? 'partial' : 'available',
      code: invalidCount ? 'ARRIVAL_INVALID' : null, invalidCount,
      retrievedAt: metadataTime(result.retrievedAt), sourceUpdatedAt: metadataTime(result.sourceUpdatedAt) });
  }
  const decisionGroups = hub.decisionGroups.map((group) => {
    const arrivals = rankHubArrivals(collected.filter((arrival) => arrival.decisionGroupId === group.id),
      generatedAt, rankingOptions).slice(0, group.displayLimit);
    return { id: group.id, hubId: hub.id, label: group.label,
      destinations: [...group.destinations], providers: [...group.providers],
      recommendedArrivalId: arrivals.find((arrival) => arrival.recommendable)?.id ?? null, arrivals };
  });
  return { hubId: hub.id, hubLabel: hub.label, generatedAt, providers,
    arrivals: decisionGroups.flatMap((group) => group.arrivals), decisionGroups,
    groups: decisionGroups };
}
