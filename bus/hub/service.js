import { aggregateHub } from './aggregator.js';

const fail = (code) => { throw new Error(code); };
const safeFailure = (value) => ({ provider: value, error: { code: 'SOURCE_UNAVAILABLE' } });

export function createHubService({ hub, kawasakiService, normalizeKawasaki, tokyuProvider,
  now = () => Date.now() / 1000 } = {}) {
  if (!hub?.id || typeof kawasakiService?.getArrivals !== 'function' || typeof normalizeKawasaki !== 'function'
    || typeof tokyuProvider?.getArrivals !== 'function') fail('BUS_HUB_SERVICE_INVALID');
  return {
    async getHub(id) {
      if (id !== hub.id) fail('BUS_HUB_NOT_FOUND');
      const generatedAt = now();
      const [kawasaki, tokyu] = await Promise.allSettled([
        kawasakiService.getArrivals().then((value) => normalizeKawasaki(value)),
        tokyuProvider.getArrivals()
      ]);
      const providerResults = [
        kawasaki.status === 'fulfilled' ? kawasaki.value : safeFailure('kawasaki'),
        tokyu.status === 'fulfilled' ? tokyu.value : safeFailure('tokyu')
      ];
      const aggregated = aggregateHub({ hub, generatedAt, providerResults });
      const attributions = providerResults.filter((value) => value.attribution).map(({ provider, attribution }) => ({
        provider, providerName: attribution.provider, distributor: attribution.distributor, url: attribution.url
      }));
      return { success: true, ...aggregated, attributions };
    }
  };
}
