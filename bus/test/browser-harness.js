// Test-only local harness. Production code/config/authentication never imports this file.
const originalFetch = window.fetch.bind(window);
let requests = 0;
window.fetch = function (url, options) {
  if (String(url).endsWith('/api/bus/arrivals') || String(url).includes('/api/bus/hub?')
    || String(url).includes('/api/bus/journey?')) {
    document.querySelector('#requestCount').textContent = `API取得 ${++requests}回`;
    const scenario = document.querySelector('#scenario').value;
    if (String(url).endsWith('/api/bus/arrivals') && scenario !== 'live') return originalFetch(`/fixture/${scenario}`, options);
    if (String(url).includes('/api/bus/journey?') && scenario === 'fixture') return originalFetch('/fixture/journey', options);
  }
  return originalFetch(url, options);
};
const busView = document.querySelector('[data-view="bus"]');
function active(value) {
  busView.hidden = !value; busView.classList.toggle('is-active', value);
  document.querySelector('#otherView').hidden = value;
  PALURUBus.setActive(value);
  PALURUBusHub?.setActive(value);
  PALURUBusJourney?.setActive(value);
}
document.querySelector('#showBus').addEventListener('click', () => active(true));
document.querySelector('#leaveBus').addEventListener('click', () => active(false));
document.querySelector('#scenario').addEventListener('change', () => { active(false); active(true); });
document.addEventListener('DOMContentLoaded', () => active(true));
