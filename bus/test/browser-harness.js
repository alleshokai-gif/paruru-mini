// Test-only local harness. Production code/config/authentication never imports this file.
const originalFetch = window.fetch.bind(window);
let requests = 0;
window.fetch = function (url, options) {
  if (String(url).endsWith('/api/bus/arrivals')) {
    document.querySelector('#requestCount').textContent = `API取得 ${++requests}回`;
    const scenario = document.querySelector('#scenario').value;
    if (scenario !== 'live') return originalFetch(`/fixture/${scenario}`, options);
  }
  return originalFetch(url, options);
};
const busView = document.querySelector('[data-view="bus"]');
function active(value) {
  busView.hidden = !value; busView.classList.toggle('is-active', value);
  document.querySelector('#otherView').hidden = value;
  PALURUBus.setActive(value);
}
document.querySelector('#showBus').addEventListener('click', () => active(true));
document.querySelector('#leaveBus').addEventListener('click', () => active(false));
document.querySelector('#scenario').addEventListener('change', () => { active(false); active(true); });
document.addEventListener('DOMContentLoaded', () => active(true));
