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
      // TODAY freshness and Work source health are independent dimensions.
      // The old mapping marked Work STALE when only the TODAY projection was stale.
      sources.work_items = source(sources.work_items, snapshot.sources?.work);
      sources.today = source(sources.work_items, snapshot.sources?.today);
      sources.calendar = source(sources.calendar, snapshot.sources?.calendar);
      sources.work_busy = {
        ...source(sources.work_busy, snapshot.sources?.work_busy),
        snapshot_valid_until: snapshot.sources?.work_busy?.valid_until || null,
      };
      // Display-only, already authorized material. Historical Work is NOT a
      // time-valid plan and must never feed NOW/NEXT/available-window rendering.
      const workStatus = snapshot.sources?.work?.status;
      const savedWork = snapshot.component_data?.work?.work_items;
      const projectStatus = snapshot.sources?.projects?.status;
      const savedProjects = snapshot.component_data?.projects?.projects;
      view = {
        ...view,
        v3_snapshot: {
          status: snapshot.status || 'UNKNOWN',
          generated_at: snapshot.generated_at || null,
        },
        last_known_work: {
          status: workStatus || 'failed',
          generated_at: snapshot.sources?.work?.updated_at || null,
          total: Array.isArray(savedWork) && ['current', 'stale'].includes(workStatus) ? savedWork.length : null,
          items: Array.isArray(savedWork) && ['current', 'stale'].includes(workStatus)
            ? savedWork.slice(0, 5).map(w => ({
                id: w.id, title: w.title, work_id: w.work_id,
                state: w.state, project_name: w.project_name,
              }))
            : [],
        },
        last_known_projects: {
          status: projectStatus || 'failed',
          generated_at: snapshot.sources?.projects?.updated_at || null,
          total: Array.isArray(savedProjects) && ['current', 'stale'].includes(projectStatus)
            ? savedProjects.length : null,
          items: Array.isArray(savedProjects) && ['current', 'stale'].includes(projectStatus)
            ? savedProjects.slice(0, 5).map(p => ({ id: p.id, title: p.title, status: p.status }))
            : [],
        },
      };
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
