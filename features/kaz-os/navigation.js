/* Kaz OS subviews share the authenticated outer view. Only PROJECTS reads its catalog. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  let context = null, projectsApi = null, inboxApi = null, answerApi = null, projectEpoch = 0, inboxEpoch = 0, projectExpiry = null;
  const allowed = () => context?.role === 'admin' && context.allowedViews?.includes('kaz-os');
  const isKazHash = () => /^#kaz-os(?:\/|$)/.test(location.hash);
  const active = () => byId('kazOsView')?.classList.contains('is-active');
  function clear() { projectEpoch++; inboxEpoch++; clearTimeout(projectExpiry); globalThis.KazInboxView?.dispose(byId('kazPersonalContent')); globalThis.KazTodayView?.dispose(byId('kazPersonalContent')); byId('kazPersonalContent')?.replaceChildren(); }
  async function renderProjects(selection) {
    if (!projectsApi || !active()) { globalThis.KazPersonalView.render(byId('kazPersonalContent'), selection, null); return; }
    const requestEpoch = projectEpoch;
    const host = byId('kazPersonalContent');
    host.textContent = 'Projectsを確認中…';
    const current = () => requestEpoch === projectEpoch && allowed() && active() && !document.hidden;
    try {
      const data = await projectsApi();
      if (!current()) return;
      globalThis.KazPersonalView.render(host, selection, data);
      const until = Date.parse(data?.sources?.projects?.valid_until);
      if (Number.isFinite(until) && until > Date.now()) projectExpiry = setTimeout(() => {
        if (current()) globalThis.KazPersonalView.render(host, selection, data);
      }, Math.max(1, until - Date.now() + 1));
    } catch (error) {
      if (!current()) return;
      const status = error?.code === 'KAZ_NOT_CONNECTED' ? 'not_connected' : 'failed';
      globalThis.KazPersonalView.render(host, selection, {sources:{projects:{status}},projects:null});
    }
  }
  async function renderInbox(selection) {
    if (!inboxApi || !active()) { globalThis.KazPersonalView.render(byId('kazPersonalContent'), selection, null); return; }
    const requestEpoch = inboxEpoch;
    const host = byId('kazPersonalContent');
    host.textContent = 'Secretary Questionsを確認中…';
    const current = () => requestEpoch === inboxEpoch && allowed() && active() && !document.hidden;
    try {
      const data = await inboxApi();
      if (!current()) return;
      const persist = answerApi ? async answer => {
        if (!current()) throw Error('画面を再取得してください');
        const result = await answerApi(answer);
        if (!current()) throw Error('画面を再取得してください');
        return result;
      } : null;
      globalThis.KazPersonalView.render(host, selection, data, Date.now(), { answerApi: persist });
    } catch (error) {
      if (!current()) return;
      const status = error?.code === 'KAZ_NOT_CONNECTED' ? 'not_connected' : 'failed';
      globalThis.KazPersonalView.render(host, selection, {origin:'real_operational_sources',fixture_only:false,sources:{inbox:{status}},inbox_items:null});
    }
  }
  function render() {
    if (!allowed()) { clear(); return; }
    clear();
    const selection = globalThis.KazPersonalView.route(location.hash);
    const diagnostics = selection.page === 'diagnostics';
    byId('kazOsTitle').textContent = diagnostics ? 'Diagnostics' : 'Kaz OS';
    byId('kazOsNav').hidden = diagnostics;
    byId('kazOsRefresh').hidden = !diagnostics;
    byId('kazPersonalContent').hidden = diagnostics;
    byId('kazOsContent').hidden = !diagnostics;
    byId('kazOsView').setAttribute('aria-label', diagnostics ? 'Kaz OS Diagnostics' : `Kaz OS ${selection.page.toUpperCase()}`);
    document.querySelectorAll('#kazOsNav a').forEach(a => {
      if (a.dataset.kazPage === selection.page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (diagnostics) { clear(); document.dispatchEvent(new CustomEvent('kaz-os:diagnostics-opened')); }
    else {
      document.dispatchEvent(new CustomEvent('kaz-os:diagnostics-closed'));
      if (selection.page === 'projects') void renderProjects(selection);
      else if (selection.page === 'inbox') void renderInbox(selection);
      // TODAY retains its unconnected input; Project/Inbox payloads never feed it.
      else globalThis.KazPersonalView.render(byId('kazPersonalContent'), selection, null);
    }
  }
  function requestView() {
    if (allowed()) document.dispatchEvent(new CustomEvent('paruru:view-request', { detail: { viewName: 'kaz-os' } }));
  }
  document.addEventListener('paruru:authenticated', event => {
    clear(); context = event.detail?.context || null; projectsApi = event.detail?.kazOsProjectsApi || null; inboxApi = event.detail?.kazOsInboxApi || null; answerApi = event.detail?.kazOsInboxAnswerApi || null;
    byId('kazOsEntry').hidden = !allowed();
    byId('kazOsDiagnosticsEntry').hidden = !allowed();
    byId('kazOsEntryStatus').textContent = '今日・Project・自分の判断';
    if (allowed()) render();
  });
  document.addEventListener('kaz-os:locked', () => {
    context = null; projectsApi = null; inboxApi = null; answerApi = null; clear(); byId('kazOsEntry').hidden = true; byId('kazOsDiagnosticsEntry').hidden = true;
  });
  document.addEventListener('kaz-os:opened', render);
  document.querySelectorAll('[data-target-view="kaz-os"]').forEach(button => button.addEventListener('click', () => {
    if (!allowed()) return;
    const target = '#kaz-os/' + (button.dataset.kazPage || 'today');
    if (location.hash !== target) location.hash = target;
  }, true));
  window.addEventListener('hashchange', () => { if (isKazHash()) { requestView(); if (allowed()) window.scrollTo(0, 0); } else clear(); });
  document.querySelectorAll('[data-target-view]').forEach(button => button.addEventListener('click', () => { if (button.dataset.targetView !== 'kaz-os') clear(); }));
  window.addEventListener('pagehide', clear);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); else if (allowed() && active()) render(); });
})();
