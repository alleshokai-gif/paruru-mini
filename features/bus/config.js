// Production Cloud Run service; validation uses its separate IAM-protected service.
globalThis.PALURU_BUS_API_URL = 'https://paluru-bus-api-jwnmkrlyha-an.a.run.app/api/bus/arrivals';
globalThis.PALURU_BUS_HUB_UI_ENABLED = true;
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
