// Production Cloud Run service; validation uses its separate IAM-protected service.
globalThis.PALURU_BUS_API_URL = 'https://paluru-bus-api-jwnmkrlyha-an.a.run.app/api/bus/arrivals';
globalThis.PALURU_BUS_HUB_UI_ENABLED = true;
globalThis.PALURU_BUS_POSITION_SHADOW_ENABLED = true;
globalThis.PALURU_BUS_HOME_ROUTE_ENABLED = true;
globalThis.PALURU_BUS_HOME_ROUTE_SOURCE = Object.freeze({
  async getTrainChoices(journeyId, page = 0) {
    const url = new URL(globalThis.PALURU_BUS_API_URL);
    url.pathname = '/api/bus/trains';
    url.search = new URLSearchParams({ journeyId, page: String(page) });
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw Error('BUS_TRAIN_CHOICES_UNAVAILABLE');
    return response.json();
  },
  async evaluate({ journeyId, trainId, page = 0 }) {
    const url = new URL(globalThis.PALURU_BUS_API_URL);
    url.pathname = '/api/bus/home-route';
    url.search = new URLSearchParams({ journeyId, trainId, page: String(page) });
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw Error('BUS_HOME_ROUTE_UNAVAILABLE');
    return response.json();
  },
  async evaluateCommute(mode) {
    const url = new URL(globalThis.PALURU_BUS_API_URL);
    url.pathname = '/api/bus/commute-route';
    url.search = new URLSearchParams({ mode });
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw Error('BUS_COMMUTE_ROUTE_UNAVAILABLE');
    return response.json();
  }
});
globalThis.PALURU_BUS_LEGACY_UI_ENABLED = false;
globalThis.PALURU_BUS_JOURNEY_UI_ENABLED = true;
globalThis.PALURU_BUS_JOURNEYS = Object.freeze([
  Object.freeze({ id: 'noborito-mukougaoka', label: '登戸・遊園' })
]);
globalThis.PALURU_BUS_HUBS = Object.freeze([
  Object.freeze({ id: 'kibukihoncho', label: '神木本町', selectorLabel: '神木本町' }),
  Object.freeze({ id: 'mizonokuchi-minamiguchi', label: '溝の口駅南口', selectorLabel: '溝の口' }),
  Object.freeze({ id: 'tachikawa-ekikitaguchi', label: '立川駅北口', selectorLabel: '立川駅' }),
  Object.freeze({ id: 'showa-daiichi-gakuen', label: '昭和第一学園', selectorLabel: '学校' }),
  Object.freeze({ id: 'noborito-mukougaoka', label: '登戸・遊園', selectorLabel: '登戸・遊園', kind: 'journey' })
]);
