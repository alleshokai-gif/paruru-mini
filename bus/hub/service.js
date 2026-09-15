import { aggregateHub } from './aggregator.js';

const fail = (code) => { throw new Error(code); };
const safeFailure = (value) => ({ provider: value, error: { code: 'SOURCE_UNAVAILABLE' } });

export function createHubService({ hubs, providerLoaders, now = () => Date.now() / 1000 } = {}) {
  if (!Array.isArray(hubs) || !hubs.length || !providerLoaders || typeof providerLoaders !== 'object')
    fail('BUS_HUB_SERVICE_INVALID');
  const hubMap = new Map();
  for (const hub of hubs) {
    if (!hub?.id || hubMap.has(hub.id)) fail('BUS_HUB_SERVICE_INVALID');
    hubMap.set(hub.id, hub);
  }
  return {
    hasHub(id) { return hubMap.has(id); },
    async getHub(id) {
      const hub = hubMap.get(id);
      if (!hub) fail('BUS_HUB_NOT_FOUND');
      const generatedAt = now();
      const providers = [...new Set(hub.sources.map((source) => source.provider))];
      const results = await Promise.allSettled(providers.map(async (provider) => {
        const load = providerLoaders[provider];
        if (typeof load !== 'function') fail('BUS_HUB_PROVIDER_UNAVAILABLE');
        return load();
      }));
      const providerResults = results.map((result, index) => result.status === 'fulfilled'
        ? result.value : safeFailure(providers[index]));
      const aggregated = aggregateHub({ hub, generatedAt, providerResults });
      const attributions = providerResults.filter((value) => value.attribution).map(({ provider, attribution }) => ({
        provider, providerName: attribution.provider, distributor: attribution.distributor, url: attribution.url
      }));
      return { success: true, ...aggregated, attributions };
    }
  };
}
