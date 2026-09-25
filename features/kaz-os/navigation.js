/* Kaz-only PROJECTS and controlled-proposal INBOX navigation. Operational writes remain absent. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  let context = null, projectsApi = null, workApi = null, todayApi = null, inboxApi = null, inboxAnswerApi = null;
  let projectEpoch = 0, workEpoch = 0, todayEpoch = 0, inboxEpoch = 0, projectExpiry = null, workExpiry = null, todayExpiry = null, inboxExpiry = null;
  let targetViewHashChangePending = false;
  const allowed = () => context?.role === 'admin' && context.allowedViews?.includes('kaz-os');
  const isKazHash = () => /^#kaz-os(?:\/|$)/.test(location.hash);
  const active = () => byId('kazOsView')?.classList.contains('is-active');
  const readOnlyInbox = data => data?.mode === 'read_only_display'
    && data?.persistence?.status === 'disabled'
    && data?.writes?.notion === 0
    && data?.writes?.calendar === 0
    && data?.writes?.context === 0;
  const controlledInbox = data => data?.mode === 'controlled_proposal'
    && data?.persistence?.kind === 'paluru_spreadsheet_append_only'
    && data?.persistence?.status === 'enabled'
    && data?.writes?.notion === 0
    && data?.writes?.calendar === 0
    && data?.writes?.context === 0;

  function clear() {
    projectEpoch++;
    workEpoch++;
    todayEpoch++;
    inboxEpoch++;
    clearTimeout(projectExpiry);
    clearTimeout(workExpiry);
    clearTimeout(todayExpiry);
    clearTimeout(inboxExpiry);
    projectExpiry = null;
    workExpiry = null;
    todayExpiry = null;
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
    host.textContent = 'プロジェクトを確認中…';
    const current = () => requestEpoch === projectEpoch && allowed() && active() && !document.hidden;
    try {
      const data = await projectsApi();
      if (!current()) return;
      let projected = data;
      if (selection.id && workApi) {
        try {
          const work = await workApi();
          if (!current()) return;
          projected = {
            ...data,
            sources: { ...(data.sources || {}), tasks: work?.sources?.work_items || null },
            work_items: work?.work_items ?? null,
          };
        } catch (error) {
          if (!current()) return;
          const status = error?.code === 'KAZ_NOT_CONNECTED' ? 'not_connected' : 'failed';
          projected = {
            ...data,
            sources: { ...(data.sources || {}), tasks: { status, complete: false } },
            work_items: null,
          };
        }
      }
      globalThis.KazPersonalView.render(host, selection, projected);
      const until = Date.parse(data?.sources?.projects?.valid_until);
      if (Number.isFinite(until) && until > Date.now()) {
        projectExpiry = setTimeout(() => {
          if (current()) globalThis.KazPersonalView.render(host, selection, projected);
        }, Math.max(1, until - Date.now() + 1));
      }
    } catch (error) {
      if (!current()) return;
      const status = error?.code === 'KAZ_NOT_CONNECTED' ? 'not_connected' : 'failed';
      globalThis.KazPersonalView.render(host, selection, { sources: { projects: { status } }, projects: null });
    }
  }

  async function renderWork(selection) {
    const host = byId('kazPersonalContent');
    if (!host) return;
    if (!workApi || !active()) {
      globalThis.KazPersonalView.render(host, selection, null);
      return;
    }
    const requestEpoch = workEpoch;
    host.textContent = 'やることを確認中…';
    const current = () => requestEpoch === workEpoch && allowed() && active() && !document.hidden;
    try {
      const data = await workApi();
      if (!current()) return;
      globalThis.KazPersonalView.render(host, selection, data);
      const until = Date.parse(data?.sources?.work_items?.valid_until);
      if (Number.isFinite(until) && until > Date.now()) {
        workExpiry = setTimeout(() => {
          if (current()) globalThis.KazPersonalView.render(host, selection, data);
        }, Math.max(1, until - Date.now() + 1));
      }
    } catch (error) {
      if (!current()) return;
      const status = error?.code === 'KAZ_NOT_CONNECTED' ? 'not_connected' : 'failed';
      globalThis.KazPersonalView.render(host, selection, {
        origin: 'notion_official_api',
        mode: 'read_only',
        fixture_only: false,
        sources: { work_items: { status, complete: false } },
        work_items: null,
        writes: { notion: 0, calendar: 0, context: 0 },
      });
    }
  }

  async function renderToday(selection) {
    const host = byId('kazPersonalContent');
    if (!host) return;
    if (!todayApi || !active()) {
      globalThis.KazPersonalView.render(host, selection, null);
      return;
    }
    const requestEpoch = todayEpoch;
    host.textContent = '今日の予定を確認中…';
    const current = () => requestEpoch === todayEpoch && allowed() && active() && !document.hidden;
    try {
      const data = await todayApi();
      if (!current()) return;
      globalThis.KazPersonalView.render(host, selection, data);
      const workUntil = Date.parse(data?.sources?.work_items?.valid_until);
      const calendarUntil = Date.parse(data?.sources?.calendar?.valid_until);
      const until = [workUntil, calendarUntil].filter(Number.isFinite).sort((a,b)=>a-b)[0];
      if (Number.isFinite(until) && until > Date.now()) {
        todayExpiry = setTimeout(() => {
          if (current()) globalThis.KazPersonalView.render(host, selection, data);
        }, Math.max(1, until - Date.now() + 1));
      }
    } catch (error) {
      if (!current()) return;
      const status = error?.code === 'KAZ_NOT_CONNECTED' ? 'not_connected' : 'failed';
      globalThis.KazPersonalView.render(host, selection, {
        schema_version: 'kaz-today-plan-v1',
        origin: 'real_operational_sources',
        mode: 'read_only',
        fixture_only: false,
        sources: { work_items: { status, complete: false } },
        today: null,
        writes: { notion: 0, calendar: 0, context: 0 },
      });
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
    host.textContent = '確認待ちを確認中…';
    const current = () => requestEpoch === inboxEpoch && allowed() && active() && !document.hidden;
    try {
      const data = await inboxApi();
      if (!current()) return;
      if (!readOnlyInbox(data) && !controlledInbox(data)) throw Object.assign(new Error('KAZ_READ_ONLY'), { code: 'KAZ_READ_ONLY' });
      const answerApi = controlledInbox(data) && inboxAnswerApi ? async answer => {
        try {
          const result = await inboxAnswerApi(answer);
          if (!result?.inbox) throw Object.assign(new Error('KAZ_PERSISTENCE_FAILED'), { code: 'KAZ_PERSISTENCE_FAILED' });
          return result;
        } catch (error) {
          if (error?.code !== 'HOME_CONTROL_UNAVAILABLE') throw error;
          const refreshed = await inboxApi();
          if (!readOnlyInbox(refreshed) && !controlledInbox(refreshed)) throw error;
          const confirmed = Array.isArray(refreshed?.persistence?.confirmed_answers)
            && refreshed.persistence.confirmed_answers.some(item =>
              item?.decision_id === answer?.decision_id
              && item?.question_revision === answer?.question_revision
              && item?.persistence_status === 'DURABLE_PERSISTED');
          const diagnostics = globalThis.PALURUTransportDiagnostics;
          if (!confirmed) {
            diagnostics?.record(error?.transportDiagnosticContext, {
              attempt: 1,
              elapsedMs: error?.transportDiagnosticElapsedMs,
              classification: diagnostics.classifyError(error),
              httpStatus: Number.isFinite(error?.httpStatus) ? error.httpStatus : null,
              backendStage: 'ANSWER_READBACK_UNCONFIRMED',
              outcome: 'unresolved',
              errorCode: error?.code || null,
            });
            throw error;
          }
          diagnostics?.record(error?.transportDiagnosticContext, {
            attempt: 1,
            elapsedMs: error?.transportDiagnosticElapsedMs,
            classification: diagnostics.classifyError(error),
            httpStatus: Number.isFinite(error?.httpStatus) ? error.httpStatus : null,
            backendStage: 'ANSWER_READBACK_CONFIRMED',
            outcome: 'reconciled',
            errorCode: error?.code || null,
          });
          refreshed.feedback = {
            ...(refreshed.feedback || {}),
            message: '✓ 保存済みを再確認したで。Operational Sourceはまだ変更してへん'
          };
          return { inbox: refreshed, reconciled: true };
        }
      } : null;
      globalThis.KazPersonalView.render(host, selection, data, Date.now(), { answerApi });
      const until = Date.parse(data?.sources?.inbox?.valid_until);
      if (Number.isFinite(until) && until > Date.now()) {
        inboxExpiry = setTimeout(() => {
          if (current()) globalThis.KazPersonalView.render(host, selection, data, Date.now(), { answerApi });
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

  async function render() {
    if (!allowed()) {
      clear();
      return;
    }
    clear();
    const selection = globalThis.KazPersonalView.route(location.hash);
    const pageLabel = { today: '今日の予定', work: 'やること', projects: 'プロジェクト', inbox: '確認待ち' }[selection.page] || 'やること・確認';
    byId('kazOsView')?.setAttribute('aria-label', pageLabel);
    document.querySelectorAll('#kazOsNav a').forEach(a => {
      if (a.dataset.kazPage === selection.page) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-kaz-page-launch]').forEach(item => {
      if (item.dataset.kazPage === selection.page) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    if (selection.page === 'today') await renderToday(selection);
    else if (selection.page === 'inbox') await renderInbox(selection);
    else if (selection.page === 'work') await renderWork(selection);
    else await renderProjects(selection);
  }

  function requestView() {
    if (allowed()) document.dispatchEvent(new CustomEvent('paruru:view-request', { detail: { viewName: 'kaz-os' } }));
  }

  document.addEventListener('paruru:authenticated', event => {
    clear();
    context = event.detail?.context || null;
    projectsApi = event.detail?.kazOsProjectsApi || null;
    workApi = event.detail?.kazOsWorkApi || null;
    todayApi = event.detail?.kazOsTodayApi || null;
    inboxApi = event.detail?.kazOsInboxApi || null;
    inboxAnswerApi = event.detail?.kazOsInboxAnswerApi || null;
    const entry = byId('kazOsEntry');
    if (entry) entry.hidden = !allowed();
    const status = byId('kazOsEntryStatus');
    if (status) status.textContent = '今日の予定・やること・確認待ち';
    if (allowed() && active()) void render();
  });

  document.addEventListener('kaz-os:locked', () => {
    context = null;
    projectsApi = null;
    workApi = null;
    todayApi = null;
    inboxApi = null;
    inboxAnswerApi = null;
    clear();
    const entry = byId('kazOsEntry');
    if (entry) entry.hidden = true;
  });
  document.addEventListener('kaz-os:opened', event => {
    const initialRead = render();
    if (event?.detail && typeof event.detail.waitUntil === 'function') event.detail.waitUntil(initialRead);
  });

  document.querySelectorAll('[data-target-view="kaz-os"]').forEach(button => button.addEventListener('click', () => {
    if (!allowed()) return;
    if (location.hash !== '#kaz-os/today') {
      targetViewHashChangePending = true;
      location.hash = '#kaz-os/today';
    }
  }, true));
  window.addEventListener('hashchange', () => {
    if (isKazHash()) {
      const openedByTargetViewRequest = targetViewHashChangePending && active();
      targetViewHashChangePending = false;
      if (!openedByTargetViewRequest) requestView();
      if (allowed()) window.scrollTo(0, 0);
    } else {
      targetViewHashChangePending = false;
      clear();
    }
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
