/* Kaz-only PROJECTS and read-only INBOX navigation. No TODAY, diagnostics or write transport. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  let context = null, projectsApi = null, inboxApi = null;
  let projectEpoch = 0, inboxEpoch = 0, projectExpiry = null, inboxExpiry = null;
  const allowed = () => context?.role === 'admin' && context.allowedViews?.includes('kaz-os');
  const isKazHash = () => /^#kaz-os(?:\/|$)/.test(location.hash);
  const active = () => byId('kazOsView')?.classList.contains('is-active');
  const readOnlyInbox = data => data?.mode === 'read_only_display'
    && data?.persistence?.status === 'disabled'
    && data?.writes?.notion === 0
    && data?.writes?.calendar === 0
    && data?.writes?.context === 0;

  function clear() {
    projectEpoch++;
    inboxEpoch++;
    clearTimeout(projectExpiry);
    clearTimeout(inboxExpiry);
    projectExpiry = null;
    inboxExpiry = null;
    globalThis.KazInboxView?.dispose(byId('kazPersonalContent'));
    byId('kazPersonalContent')?.replaceChildren();
  }

  async function renderProjects(selection) {
    const host = byId('kazPersonalContent');
    if (!host) return;
    if (!projectsApi || !active()) {
      globalThis.KazPersonalView.render(host, selection, null);
      return;
    }
    const requestEpoch = projectEpoch;
    host.textContent = 'Projectsを確認中…';
    const current = () => requestEpoch === projectEpoch && allowed() && active() && !document.hidden;
    try {
      const data = await projectsApi();
      if (!current()) return;
      globalThis.KazPersonalView.render(host, selection, data);
      const until = Date.parse(data?.sources?.projects?.valid_until);
      if (Number.isFinite(until) && until > Date.now()) {
        projectExpiry = setTimeout(() => {
          if (current()) globalThis.KazPersonalView.render(host, selection, data);
        }, Math.max(1, until - Date.now() + 1));
      }
    } catch (error) {
      if (!current()) return;
      const status = error?.code === 'KAZ_NOT_CONNECTED' ? 'not_connected' : 'failed';
      globalThis.KazPersonalView.render(host, selection, { sources: { projects: { status } }, projects: null });
    }
  }

  async function renderInbox(selection) {
    const host = byId('kazPersonalContent');
    if (!host) return;
    if (!inboxApi || !active()) {
      globalThis.KazPersonalView.render(host, selection, null);
      return;
    }
    const requestEpoch = inboxEpoch;
    host.textContent = 'Secretary Questionsを確認中…';
    const current = () => requestEpoch === inboxEpoch && allowed() && active() && !document.hidden;
    try {
      const data = await inboxApi();
      if (!current()) return;
      if (!readOnlyInbox(data)) throw Object.assign(new Error('KAZ_READ_ONLY'), { code: 'KAZ_READ_ONLY' });
      globalThis.KazPersonalView.render(host, selection, data, Date.now(), { answerApi: null });
      const until = Date.parse(data?.sources?.inbox?.valid_until);
      if (Number.isFinite(until) && until > Date.now()) {
        inboxExpiry = setTimeout(() => {
          if (current()) globalThis.KazPersonalView.render(host, selection, data, Date.now(), { answerApi: null });
        }, Math.max(1, until - Date.now() + 1));
      }
    } catch (error) {
      if (!current()) return;
      const status = error?.code === 'KAZ_NOT_CONNECTED' ? 'not_connected' : 'failed';
      globalThis.KazPersonalView.render(host, selection, {
        origin: 'real_operational_sources',
        fixture_only: false,
        sources: { inbox: { status } },
        inbox_items: null,
      });
    }
  }

  function render() {
    if (!allowed()) {
      clear();
      return;
    }
    clear();
    const selection = globalThis.KazPersonalView.route(location.hash);
    byId('kazOsView')?.setAttribute('aria-label', `Kaz OS ${selection.page.toUpperCase()}`);
    document.querySelectorAll('#kazOsNav a').forEach(a => {
      if (a.dataset.kazPage === selection.page) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (selection.page === 'inbox') void renderInbox(selection);
    else void renderProjects(selection);
  }

  function requestView() {
    if (allowed()) document.dispatchEvent(new CustomEvent('paruru:view-request', { detail: { viewName: 'kaz-os' } }));
  }

  document.addEventListener('paruru:authenticated', event => {
    clear();
    context = event.detail?.context || null;
    projectsApi = event.detail?.kazOsProjectsApi || null;
    inboxApi = event.detail?.kazOsInboxApi || null;
    const entry = byId('kazOsEntry');
    if (entry) entry.hidden = !allowed();
    const status = byId('kazOsEntryStatus');
    if (status) status.textContent = 'Projects・Secretary Questions・READ-ONLY';
    if (allowed() && active()) render();
  });

  document.addEventListener('kaz-os:locked', () => {
    context = null;
    projectsApi = null;
    inboxApi = null;
    clear();
    const entry = byId('kazOsEntry');
    if (entry) entry.hidden = true;
  });
  document.addEventListener('kaz-os:opened', render);

  document.querySelectorAll('[data-target-view="kaz-os"]').forEach(button => button.addEventListener('click', () => {
    if (!allowed()) return;
    if (location.hash !== '#kaz-os/projects') location.hash = '#kaz-os/projects';
  }, true));
  window.addEventListener('hashchange', () => {
    if (isKazHash()) {
      requestView();
      if (allowed()) window.scrollTo(0, 0);
    } else clear();
  });
  document.querySelectorAll('[data-target-view]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.targetView !== 'kaz-os') clear();
  }));
  window.addEventListener('pagehide', clear);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear();
    else if (allowed() && active()) render();
  });
})();
