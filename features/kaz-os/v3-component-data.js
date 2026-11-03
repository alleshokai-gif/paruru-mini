/* Snapshot-to-existing-component DTO boundary. No planning or source access. */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.KazV3ComponentData = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const source = (old, current) => ({ ...old, snapshot_status: current?.status || 'failed' });

  function dashboard(snapshot, page, observedAt) {
    if (snapshot?.schema_version !== 'kaz-os-dashboard-v3'
        || !snapshot.component_data || !['today', 'work', 'projects', 'capa'].includes(page)
        || !snapshot.component_data[page]) throw Error('KAZ_V3_COMPONENT_DATA_UNAVAILABLE');
    let view = snapshot.component_data[page];
    const sources = { ...view.sources };
    if (page === 'today') {
      if (!Number.isFinite(observedAt)) {
        observedAt = Date.parse(snapshot.generated_at);
        if (!Number.isFinite(observedAt)) observedAt = Date.now();
      }
      const scheduled = Array.isArray(snapshot.today?.scheduled) ? snapshot.today.scheduled : [];
      const timedSchedule = scheduled.filter(item => Number.isFinite(Date.parse(item?.plan_start))
        && Number.isFinite(Date.parse(item?.plan_end))
        && Date.parse(item.plan_start) < Date.parse(item.plan_end));
      const active = timedSchedule.filter(item => Date.parse(item.plan_start) <= observedAt
        && observedAt < Date.parse(item.plan_end))
        .sort((a, b) => Date.parse(a.plan_start) - Date.parse(b.plan_start));
      const upcoming = timedSchedule.filter(item => Date.parse(item.plan_start) > observedAt)
        .sort((a, b) => Date.parse(a.plan_start) - Date.parse(b.plan_start)).slice(0, 2);
      const now = timedSchedule.length
        ? { kind: active.length ? 'single' : 'none', items: active.length ? [active[0]] : [],
          basis: ['snapshot_schedule', 'current_time'] }
        : view.today.now;
      const next = timedSchedule.length
        ? { kind: upcoming.length === 0 ? 'none' : upcoming.length === 1 ? 'single' : 'multiple',
          items: upcoming, basis: ['snapshot_schedule', 'future_by_start', 'maximum_two'] }
        : view.today.next;
      view = {
        ...view,
        schema_version: 'kaz-os-dashboard-v3-component',
        today: {
          ...view.today,
          now,
          next,
          kaz_free_windows: snapshot.today.kaz_free_windows,
          confirmations: snapshot.today.confirmations || [],
          unassigned: snapshot.today.unassigned || [],
          company_free_windows: snapshot.today.company_free_windows,
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
        snapshot_updated_at: snapshot.sources?.work_busy?.updated_at || null,
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
      sources.projects = source(sources.projects, snapshot.sources?.projects);
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
