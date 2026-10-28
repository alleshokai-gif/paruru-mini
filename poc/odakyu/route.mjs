import { clock, minutes } from './core.mjs';
import { planNavigation } from './navigation.mjs';
import { renderRouteMap } from './mobile-route.mjs';
const $ = id => document.getElementById(id);
const destinations = ['Noborito', 'MukogaokaYuen'];
let model, selectedId = null, now = minutes($('time').value), pool = [];
function render() {
  if (!model) return;
  const selected = pool.find(t => t.id === selectedId);
  const plans = selected ? destinations.map(destination => ({ destination, ...planNavigation(pool, selected.id, destination, now) })) : [];
  renderRouteMap({ root:$('rail'), model, pool, selected, now, plans,
    onSelect:id => { selectedId = id; render(); } });
}
function showError(error) {
  model = undefined; pool = []; $('rail').replaceChildren(); $('error').hidden = false;
  $('error').textContent = '読込失敗'; console.error(error.message);
}
window.addEventListener('resize', render);
for (const [id, delta] of [['back', -1], ['next', 1]]) $(id).onclick = () => {
  now = Math.max(0, Math.min(1439, now + delta)); $('time').value = clock(now); render();
};
$('time').onchange = () => {
  try {
    const value = minutes($('time').value);
    if (!Number.isInteger(value) || value < 0 || value > 1439) throw Error('TIME_INVALID');
    now = value; $('error').hidden = true; render();
  } catch { $('rail').replaceChildren(); $('error').hidden = false; $('error').textContent = '時刻未入力'; }
};
try {
  const response = await fetch('/api/model?dataset=real', { cache:'no-store' });
  if (!response.ok) throw Error(`HTTP_${response.status}`);
  model = await response.json();
  if (model.dataset?.kind !== 'real' || !Array.isArray(model.trips) || !model.trips.length) throw Error('REAL_DATA_REQUIRED');
  pool = model.trips.filter(t => t.calendar === 'Weekday');
  const caption = document.querySelector('h1 span');
  caption.textContent = '配線略図・保存定刻'; caption.title = [...new Set(pool.map(t => t.sourceServiceDate))].join('・');
  render();
} catch (error) { showError(error); }
