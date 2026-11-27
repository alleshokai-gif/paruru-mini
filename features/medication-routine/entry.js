(function () {
  'use strict';
  let view = null;
  function clear() { if (view) view.clear(); view = null; }
  document.addEventListener('medication-routine:locked', clear);
  document.addEventListener('paruru:authenticated', function (event) {
    clear();
    const detail = event.detail || {}, context = detail.context || {};
    const caps = Array.isArray(context.capabilities) ? context.capabilities : [];
    if (typeof detail.healthApi !== 'function' || !context.memberUserId ||
        !caps.some(function (cap) { return cap === 'health.self.read' || cap === 'health.supervision.read'; })) return;
    if (!window.PALURUMedicationRoutine) return;
    view = window.PALURUMedicationRoutine.mount({
      homeMount: document.getElementById('homeMedicationRoutineMount'),
      panelMount: document.getElementById('medicationRoutineMount'),
      api: detail.healthApi, context: context
    });
  });
  document.addEventListener('visibilitychange', function () {
    if (view && document.visibilityState === 'visible') view.refresh();
  });
  document.addEventListener('nurse-okan:opened', function () { if (view) view.refresh(); });
}());
