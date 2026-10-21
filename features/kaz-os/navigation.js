/* Kaz-only PROJECTS and controlled-proposal INBOX navigation. Operational writes remain absent. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  let context = null, projectsApi = null, workApi = null, capaApi = null, todayApi = null, inboxApi = null, contextApi = null, inboxAnswerApi = null, aiEngineApi = null, aiObservationApi = null;
  let v3DashboardApi = null, v3InboxApi = null, previewEpoch = 0;
  let projectEpoch = 0, workEpoch = 0, capaEpoch = 0, todayEpoch = 0, inboxEpoch = 0, contextEpoch = 0, projectExpiry = null, workExpiry = null, capaExpiry = null, todayExpiry = null, inboxExpiry = null;
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

  const aiFeaturesByPage = Object.freeze({
    today: ['daily_planner', 'check_in', 'night_review'],
    work: ['check_in', 'night_review'],
    projects: ['daily_planner'],
    capa: ['capa'],
    context: ['gardener', 'feedback'],
    inbox: ['gardener', 'feedback'],
  });
  const aiFeatureLabels = Object.freeze({
    daily_planner: 'Daily Planner', check_in: 'Check-in',
    night_review: 'Night Review', gardener: 'Gardener',
    feedback: 'Feedback', capa: 'CAPA',
  });
  const aiJudgmentLabels = Object.freeze({
    FOCUS_REVIEW: '今日の集中対象を確認', BLOCKER_REVIEW: '障害を確認',
    REPLAN_REVIEW: '再計画を確認', PROGRESS_REVIEW: '進捗を確認',
    CARRY_FORWARD_REVIEW: '翌日への繰越を確認', LESSON_REVIEW: '振り返りを確認',
    DUPLICATE_REVIEW: '重複候補を確認', CONFLICT_REVIEW: '文脈の衝突を確認',
    CONTEXT_GAP_REVIEW: 'Contextの不足を確認', WORKFLOW_REVIEW: '手順の改善を確認',
    RECURRENCE_REVIEW: '再発傾向を確認', EFFECTIVENESS_REVIEW: '対策の効果を確認',
    NO_ADVICE: '追加提案なし', NEEDS_INPUT: '本人入力待ち',
  });

  async function appendAiJudgments(host, page, current) {
    if (!aiEngineApi || !aiFeaturesByPage[page] || !current()) return;
    const section = document.createElement('section');
    section.className = 'kp-card';
    const heading = document.createElement('h2');
    heading.textContent = 'AI提案（確認用）';
    section.appendChild(heading);
    const note = document.createElement('p');
    note.textContent = 'AIの判断は候補です。予定・Contextの確定は行いません。';
    section.appendChild(note);
    try {
      const view = await aiEngineApi();
      if (!current()) return;
      const wanted = new Set(aiFeaturesByPage[page]);
      const rows = view.judgments.filter(row => wanted.has(row.feature));
      if (!rows.length) {
        const empty = document.createElement('p');
        empty.textContent = 'この範囲のAI判断は未生成です。';
        section.appendChild(empty);
      }
      for (const row of rows) {
        const item = document.createElement('p');
        item.textContent = `${aiFeatureLabels[row.feature]}: ${aiJudgmentLabels[row.judgment]}（${row.status === 'review_pending' ? '人の確認待ち・根拠照合済み' : '判断なし'}）`;
        section.appendChild(item);
      }
    } catch (_) {
      if (!current()) return;
      const unavailable = document.createElement('p');
      unavailable.textContent = 'AI提案を読み取れません。既存の予定・作業表示は継続します。';
      section.appendChild(unavailable);
    }
    if (current()) host.appendChild(section);
  }

  function appendAiObservationForm(host, snapshot, current) {
    if (!aiObservationApi || !aiEngineApi || !current()
        || snapshot?.status !== 'CURRENT'
        || ['projects', 'work', 'today', 'calendar'].some(key => snapshot.sources?.[key]?.status !== 'current')) return;
    const work = (snapshot.work || []).filter(item => item && typeof item.id === 'string'
      && !['DONE', 'CANCELLED'].includes(item.state)).slice(0, 30);
    if (!work.length) return;
    const section = document.createElement('section');
    section.className = 'kp-card kai-observation';
    const title = document.createElement('h2'); title.textContent = '本人の観測からAI判断';
    const guidance = document.createElement('p');
    guidance.textContent = 'Check-inまたはNight Reviewの実際の観測を入力してください。送信時だけAIを起動します。';
    const form = document.createElement('form');
    const field = (caption, control) => {
      const label = document.createElement('label'); label.className = 'kai-observation-field';
      const name = document.createElement('span'); name.textContent = caption;
      label.append(name, control); form.appendChild(label); return control;
    };
    const feature = document.createElement('select');
    for (const [value, text] of [['', '選択してください'], ['check_in', 'Check-in'],
                                  ['night_review', 'Night Review']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text;
      feature.appendChild(option);
    }
    feature.required = true; field('評価の種類', feature);
    const workSelect = document.createElement('select');
    const blank = document.createElement('option'); blank.value = ''; blank.textContent = '対象Workを選択';
    workSelect.appendChild(blank);
    for (const item of work) {
      const option = document.createElement('option'); option.value = item.id;
      option.textContent = item.title || '名称未設定のWork'; workSelect.appendChild(option);
    }
    workSelect.required = true; field('対象Work', workSelect);
    const time = document.createElement('input'); time.type = 'datetime-local'; time.required = true;
    time.value = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
    field('観測日時（JST）', time);
    const note = document.createElement('textarea'); note.required = true; note.maxLength = 400;
    note.rows = 3; field('本人が確認した事実（400字以内）', note);
    const button = document.createElement('button'); button.type = 'submit';
    button.className = 'kp-button'; button.textContent = '観測を保存してAI判断';
    const status = document.createElement('p'); status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    form.append(button, status);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (button.disabled || !current() || !form.reportValidity()) return;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time.value)) return;
      button.disabled = true;
      status.textContent = '保存とAI起動を確認中…';
      const selectedFeature = feature.value;
      const submittedAt = Date.now();
      try {
        const receipt = await aiObservationApi({ feature: selectedFeature,
          work_id: workSelect.value, observed_at: `${time.value}:00+09:00`, note: note.value });
        if (!current()) return;
        if (receipt.status === 'execution_unknown') {
          status.textContent = '観測は保存されました。AI起動の結果は不明です。再送信せず確認してください。';
          return;
        }
        status.textContent = '観測を保存しました。AI判断を確認中…';
        for (let attempt = 0; attempt < 8 && current(); attempt++) {
          await new Promise(resolve => setTimeout(resolve, 2500));
          try {
            const view = await aiEngineApi();
            const judgment = view.judgments.find(row => row.feature === selectedFeature
              && Date.parse(row.as_of) >= submittedAt - 1000);
            if (judgment) {
              status.textContent = `${aiFeatureLabels[selectedFeature]}: ${aiJudgmentLabels[judgment.judgment]}（Shadow読取済み・人の確認待ち）`;
              return;
            }
          } catch (_) { /* Keep the saved submission pending; never resubmit it. */ }
        }
        if (current()) status.textContent = '観測は保存済みです。AI判断は処理中または未確定です。再送信せず後で確認してください。';
      } catch (_) {
        if (current()) status.textContent = '保存またはAI起動の結果が不明です。再送信せず確認してください。';
      }
    });
    section.append(title, guidance, form); host.appendChild(section);
  }


  function configureKazNav(previewMode, page) {
    document.querySelectorAll('#kazOsNav a').forEach(a => {
      const key = a.dataset.kazPage;
      if (key === 'inbox') {
        a.hidden = true;
        a.removeAttribute('aria-current');
        return;
      }
      a.hidden = false;
      a.href = previewMode ? (key === 'today' ? '#kaz-os/v3' : `#kaz-os/v3/${key}`) : `#kaz-os/${key}`;
      if (key === page) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function clear() {
    projectEpoch++;
    workEpoch++;
    capaEpoch++;
    todayEpoch++;
    inboxEpoch++;
    contextEpoch++;
    previewEpoch++;
    clearTimeout(projectExpiry);
    clearTimeout(workExpiry);
    clearTimeout(capaExpiry);
    clearTimeout(todayExpiry);
    clearTimeout(inboxExpiry);
    projectExpiry = null;
    workExpiry = null;
    capaExpiry = null;
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

  async function renderCapa(selection) {
    const host = byId('kazPersonalContent');
    if (!host) return;
    if (!capaApi || !active()) {
      globalThis.KazPersonalView.render(host, selection, null);
      return;
    }
    const requestEpoch = capaEpoch;
    host.textContent = 'CAPAを確認中…';
    const current = () => requestEpoch === capaEpoch && allowed() && active() && !document.hidden;
    try {
      const data = await capaApi();
      if (!current()) return;
      globalThis.KazPersonalView.render(host, selection, data);
      const until = Date.parse(data?.sources?.capa?.valid_until);
      if (Number.isFinite(until) && until > Date.now()) {
        capaExpiry = setTimeout(() => {
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
        sources: { capa: { status, complete: false } },
        capa_items: null,
        writes: { notion: 0, calendar: 0, context: 0 },
      });
    }
  }

  async function renderContext(selection) {
    const host = byId('kazPersonalContent');
    if (!host) return;
    if (!contextApi || !active()) {
      globalThis.KazPersonalView.render(host, selection, null);
      return;
    }
    const requestEpoch = contextEpoch;
    host.textContent = 'Contextを確認中…';
    const current = () => requestEpoch === contextEpoch && allowed() && active() && !document.hidden;
    try {
      const data = await contextApi();
      if (!current()) return;
      globalThis.KazPersonalView.render(host, selection, data);
    } catch (error) {
      if (!current()) return;
      const status = error?.code === 'KAZ_NOT_CONNECTED' ? 'not_connected' : 'failed';
      globalThis.KazPersonalView.render(host, selection, {
        schema_version: 'kaz-context-observatory-v1',
        mode: 'read_only',
        sources: { context_observatory: { status } },
        totals: null,
        by_topic: [],
        by_route: [],
        recent: [],
        attention: null,
        writes: { raw: 0, intermediate: 0, canonical: 0, notion: 0, calendar: 0 },
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
      const refreshPlanningToday = async (answer, inbox) => {
        const preference = answer?.selected_option?.preference;
        if (!['today','this_week','later'].includes(preference)) return;
        const feedback = inbox?.feedback && typeof inbox.feedback.message === 'string' ? inbox.feedback : null;
        try {
          const today = await todayApi();
          if (today?.schema_version !== 'kaz-today-plan-v2' || !today.today) throw Error('TODAY_REFRESH_FAILED');
          if (feedback) feedback.message += ' · TODAY再計算済み';
        } catch (_) {
          if (feedback) feedback.message += ' · TODAY再計算は未確認。TODAYを開いて確認してな。';
        }
      };
      const answerApi = controlledInbox(data) && inboxAnswerApi ? async answer => {
        try {
          const result = await inboxAnswerApi(answer);
          if (!result?.inbox) throw Object.assign(new Error('KAZ_PERSISTENCE_FAILED'), { code: 'KAZ_PERSISTENCE_FAILED' });
          clearTimeout(inboxExpiry);
          inboxExpiry = null;
          await refreshPlanningToday(answer, result.inbox);
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
          clearTimeout(inboxExpiry);
          inboxExpiry = null;
          await refreshPlanningToday(answer, refreshed);
          return { inbox: refreshed, reconciled: true };
        }
      } : null;
      globalThis.KazPersonalView.render(host, selection, data, Date.now(), { answerApi, projectsApi });
      const until = Date.parse(data?.sources?.inbox?.valid_until);
      if (Number.isFinite(until) && until > Date.now()) {
        inboxExpiry = setTimeout(() => {
          if (current()) globalThis.KazPersonalView.render(host, selection, data, Date.now(), { answerApi, projectsApi });
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
    const preview = globalThis.PALURU_KAZ_OS_V3_PREVIEW_ENABLED
      && /^#kaz-os\/v3(?:\/(today|work|projects|capa|context)(?:\/([^/]+))?)?$/.exec(location.hash);
    const cutover = /^#kaz-os\/(today|work|projects|capa|context)(?:\/([^/]+))?$/.exec(location.hash);
    if (preview || cutover) {
      const legacyNav = byId('kazOsNav');
      if (legacyNav) legacyNav.hidden = false;
      const selection = { page: preview ? (preview[1] || 'today') : cutover[1], id: null };
      configureKazNav(Boolean(preview), selection.page);
      try { if ((preview || cutover)[2]) selection.id = decodeURIComponent((preview || cutover)[2]); } catch { /* Invalid ID is not selected. */ }
      const requestEpoch = previewEpoch;
      const current = () => requestEpoch === previewEpoch && allowed() && active() && !document.hidden;
      const pageLabel = { today: '今日の予定', work: 'やること', projects: 'プロジェクト', capa: 'CAPA', context: 'Context Observatory', inbox: '確認待ち' }[selection.page];
      byId('kazOsView')?.setAttribute('aria-label', pageLabel);
      const host = byId('kazPersonalContent');
      if (!host) return;
      host.textContent = `${pageLabel}を確認中…`;
      try {
        if (selection.page === 'context') {
          const data = await contextApi();
          if (!current()) return;
          globalThis.KazPersonalView.render(host, selection, data);
          await appendAiJudgments(host, selection.page, current);
          return;
        }
        const snapshot = await (selection.page === 'inbox' ? v3InboxApi() : v3DashboardApi());
        if (!current()) return;
        const data = selection.page === 'inbox'
          ? globalThis.KazV3ComponentData.inbox(snapshot)
          : globalThis.KazV3ComponentData.dashboard(snapshot, selection.page);
        const options = selection.page === 'inbox' ? {
          answerApi: controlledInbox(data) ? inboxAnswerApi : null,
          projectsApi: async () => globalThis.KazV3ComponentData.dashboard(await v3DashboardApi(), 'projects'),
        } : selection.page === 'today' ? {
          answerApi: typeof inboxAnswerApi === 'function' ? inboxAnswerApi : null,
        } : {};
        globalThis.KazPersonalView.render(host, selection, data, Date.now(), options);
        await appendAiJudgments(host, selection.page, current);
        if (['today', 'work'].includes(selection.page)) appendAiObservationForm(host, snapshot, current);
      } catch (_) {
        if (!current()) return;
        const sourceName = { today: 'work_items', work: 'work_items', projects: 'projects', capa: 'capa', inbox: 'inbox' }[selection.page];
        globalThis.KazPersonalView.render(host, selection, { sources: { [sourceName]: { status: 'failed' } } });
      }
      return;
    }
    const legacyNav = byId('kazOsNav');
    if (legacyNav) legacyNav.hidden = false;
    const selection = globalThis.KazPersonalView.route(location.hash);
    configureKazNav(false, selection.page);
    const pageLabel = { today: '今日の予定', work: 'やること', projects: 'プロジェクト', capa: 'CAPA', context: 'Context Observatory', inbox: '確認待ち' }[selection.page] || 'やること・確認';
    byId('kazOsView')?.setAttribute('aria-label', pageLabel);
    document.querySelectorAll('[data-kaz-page-launch]').forEach(item => {
      if (item.dataset.kazPage === selection.page) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    if (selection.page === 'today') await renderToday(selection);
    else if (selection.page === 'inbox') await renderInbox(selection);
    else if (selection.page === 'work') await renderWork(selection);
    else if (selection.page === 'capa') await renderCapa(selection);
    else if (selection.page === 'context') await renderContext(selection);
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
    capaApi = event.detail?.kazOsCapaApi || null;
    todayApi = event.detail?.kazOsTodayApi || null;
    inboxApi = event.detail?.kazOsInboxApi || null;
    contextApi = event.detail?.kazOsContextApi || null;
    aiEngineApi = event.detail?.kazOsAiEngineApi || null;
    aiObservationApi = event.detail?.kazOsAiObservationApi || null;
    inboxAnswerApi = event.detail?.kazOsInboxAnswerApi || null;
    v3DashboardApi = event.detail?.kazOsV3DashboardApi || null;
    v3InboxApi = event.detail?.kazOsV3InboxApi || null;
    const previewLink = byId('kazOsV3PreviewLink');
    if (previewLink) previewLink.hidden = !allowed() || !globalThis.PALURU_KAZ_OS_V3_PREVIEW_ENABLED;
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
    capaApi = null;
    todayApi = null;
    inboxApi = null;
    contextApi = null;
    aiEngineApi = null;
    aiObservationApi = null;
    inboxAnswerApi = null;
    v3DashboardApi = null;
    v3InboxApi = null;
    const previewLink = byId('kazOsV3PreviewLink');
    if (previewLink) previewLink.hidden = true;
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
  byId('kazOsView')?.addEventListener?.('click', event => {
    if (!globalThis.PALURU_KAZ_OS_V3_PREVIEW_ENABLED || !/^#kaz-os\/v3(?:\/|$)/.test(location.hash)) return;
    const anchor = event.target.closest?.('a[href^="#kaz-os/"]');
    if (!anchor || !byId('kazOsView').contains(anchor)) return;
    const path = anchor.getAttribute('href').slice('#kaz-os/'.length);
    if (!/^(today|work|projects|capa|context|inbox)(?:\/[^/]+)?$/.test(path)) return;
    event.preventDefault();
    location.hash = `#kaz-os/v3/${path}`;
  });
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
