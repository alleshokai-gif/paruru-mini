/* Snapshot-to-existing-component DTO boundary. No planning or source access. */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.KazV3ComponentData = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const source = (old, current) => ({ ...old, snapshot_status: current?.status || 'failed' });

  function dashboard(snapshot, page) {
    if (snapshot?.schema_version !== 'kaz-os-dashboard-v3'
        || !snapshot.component_data || !['today', 'work', 'projects', 'capa'].includes(page)
        || !snapshot.component_data[page]) throw Error('KAZ_V3_COMPONENT_DATA_UNAVAILABLE');
    let view = snapshot.component_data[page];
    const sources = { ...view.sources };
    if (page === 'today') {
      view = {
        ...view,
        schema_version: 'kaz-os-dashboard-v3-component',
        today: {
          ...view.today,
          kaz_free_windows: snapshot.today.kaz_free_windows,
          confirmations: snapshot.today.confirmations || [],
          company_free_windows: [],
          calendar_free_windows: snapshot.today.personal_free_windows,
        },
      };
      sources.work_items = source(sources.work_items, snapshot.sources?.today);
      sources.calendar = source(sources.calendar, snapshot.sources?.calendar);
      sources.work_busy = source(sources.work_busy, snapshot.sources?.work_busy);
    } else if (page === 'work') {
      sources.work_items = source(sources.work_items, snapshot.sources?.work);
    } else if (page === 'capa') {
      sources.capa = source(sources.capa, snapshot.sources?.capa);
    } else {
      sources.projects = source(sources.projects, snapshot.sources?.projects);
      sources.tasks = source(sources.tasks, snapshot.sources?.work);
    }
    return { ...view, sources };
  }

  function inbox(snapshot) {
    if (snapshot?.schema_version !== 'kaz-os-inbox-v3' || !snapshot.component_data)
      throw Error('KAZ_V3_COMPONENT_DATA_UNAVAILABLE');
    const view = snapshot.component_data;
    return { ...view, sources: {
      ...view.sources,
      inbox: source(view.sources?.inbox, snapshot.sources?.inbox),
      projects: source(view.sources?.projects, snapshot.sources?.projects),
      tasks: source(view.sources?.tasks, snapshot.sources?.work),
      calendar: source(view.sources?.calendar, snapshot.sources?.calendar),
    } };
  }

  return Object.freeze({ dashboard, inbox });
});
