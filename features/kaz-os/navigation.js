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
    daily_planner: '今日の提案', check_in: '今日の進み具合',
    night_review: '明日への持ち越し', gardener: '記憶の整理',
    feedback: 'Feedback', capa: 'CAPA',
  });
  const aiJudgmentLabels = Object.freeze({
    FOCUS_REVIEW: '今日の集中対象を確認', BLOCKER_REVIEW: '障害を確認',
    REPLAN_REVIEW: '再計画を確認', PROGRESS_REVIEW: '進捗を確認',
    CARRY_FORWARD_REVIEW: '翌日への繰越を確認', LESSON_REVIEW: '振り返りを確認',
    DUPLICATE_REVIEW: '重複候補を確認', CONFLICT_REVIEW: '文脈の衝突を確認',
    CONTEXT_GAP_REVIEW: 'Contextの不足を確認', WORKFLOW_REVIEW: '手順の改善を確認',
    RECURRENCE_REVIEW: '再発傾向を確認', EFFECTIVENESS_REVIEW: '対策の効果を確認',
    NO_ADVICE: '追加提案なし', NEEDS_INPUT: '必要なときだけ進み具合を選択',
  });

  async function workForEvidence(evidence, snapshot) {
    if (evidence?.source !== 'work' || !/^[a-f0-9]{64}$/.test(evidence.source_ref_hash || '')
        || !snapshot?.work || !globalThis.crypto?.subtle || !globalThis.TextEncoder) return null;
    const encoder = new globalThis.TextEncoder();
    const todayIds = new Set(['now', 'next', 'scheduled'].flatMap(lane =>
      (snapshot.today?.[lane] || []).map(row => row?.id)));
    for (const item of snapshot.work) {
      if (!item || typeof item.id !== 'string' || item.state === 'CANCELLED') continue;
      if (!todayIds.has(item.id)) continue;
      const bytes = encoder.encode(JSON.stringify({ original_ref: item.id, source: 'work' }));
      const hash = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
        .map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash === evidence.source_ref_hash) return item;
    }
    return null;
  }

  async function appendAiJudgments(host, page, current, snapshot = null) {
    if (!aiEngineApi || !aiFeaturesByPage[page] || !current()) return;
    const section = document.createElement('section');
    section.className = 'kp-card';
    const heading = document.createElement('h2');
    heading.textContent = 'AI提案（確認用）';
    section.appendChild(heading);
    const note = document.createElement('p');
    note.textContent = '提案は確認用です。予定や記録の確定は行いません。';
    section.appendChild(note);
    try {
      const view = await aiEngineApi();
      if (!current()) return;
      const wanted = new Set(aiFeaturesByPage[page]);
      const latest = new Map();
      for (const row of view.judgments.filter(row => wanted.has(row.feature))) {
        const prior = latest.get(row.feature);
        if (!prior || Date.parse(row.as_of) > Date.parse(prior.as_of)) latest.set(row.feature, row);
      }
      const rows = [...latest.values()];
      if (!rows.length) {
        const empty = document.createElement('p');
        empty.textContent = 'いま表示できる提案はありません。';
        section.appendChild(empty);
      }
      for (const row of rows) {
        const item = document.createElement('p');
        const target = page === 'today' && row.status === 'review_pending'
          ? await workForEvidence(row.evidence, snapshot) : null;
        if (!current()) return;
        const action = target && !['DONE', 'CANCELLED'].includes(target.state)
          ? [target.title, target.next_action].filter(value => typeof value === 'string' && value.trim())
              .join('：') : '';
        const time = Number.isFinite(Date.parse(row.as_of))
          ? `（${new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo',
            hour: '2-digit', minute: '2-digit' }).format(new Date(row.as_of))}時点）` : '';
        item.textContent = `${aiFeatureLabels[row.feature]}${time}: ${aiJudgmentLabels[row.judgment] || '確認してください'}`
          + (action ? ` — ${action}` : '');
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

  function observationCandidates(snapshot) {
    const work = new Map((snapshot.work || []).filter(item => item && typeof item.id === 'string'
      && !['DONE', 'CANCELLED'].includes(item.state)).map(item => [item.id, item]));
    const seen = new Set();
    return ['now', 'next', 'scheduled'].flatMap(lane => snapshot.today?.[lane] || [])
      .map(row => work.get(row?.id)).filter(item => {
        if (!item || seen.has(item.id)) return false;
        seen.add(item.id); return true;
      });
  }

  function jstParts(date = new Date()) {
    return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]));
  }

  function observedAtJst() {
    const p = jstParts();
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+09:00`;
  }

  function sameJstDay(instant) {
    const parsed = Date.parse(instant);
    if (!Number.isFinite(parsed)) return false;
    const source = jstParts(new Date(parsed)), now = jstParts();
    return source.year === now.year && source.month === now.month && source.day === now.day;
  }

  function appendAiObservationControls(host, snapshot, current) {
    if (!current()) return;
    const work = observationCandidates(snapshot);
    const section = document.createElement('section');
    section.className = 'kp-card kai-observation';
    section.dataset.aiObservationFeature = 'check_in';
    const title = document.createElement('h2'); title.textContent = '今日の進み具合';
    const guidance = document.createElement('p');
    guidance.textContent = '変わった項目だけ選んでください。変わりなければ操作は不要です。';
    section.append(title, guidance);
    if (!aiObservationApi || snapshot?.status !== 'CURRENT'
        || !sameJstDay(snapshot.generated_at)
        || ['work', 'today'].some(key => snapshot.sources?.[key]?.status !== 'current')) {
      const unavailable = document.createElement('p');
      unavailable.textContent = '現在のやることを確認できないため、記録は使えません。画面を更新してください。';
      section.appendChild(unavailable); host.prepend(section); return;
    }
    if (!work.length) {
      const empty = document.createElement('p'); empty.textContent = 'いま操作が必要な項目はありません。';
      section.appendChild(empty); host.prepend(section); return;
    }
    const note = document.createElement('textarea'); note.maxLength = 300;
    note.rows = 2; note.placeholder = '補足があれば入力（任意）';
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = '補足を追加';
    details.append(summary, note);
    const completed = new Set();
    const allButtons = new Map();
    async function submit(feature, item, action, label, output, buttons) {
      if (completed.has(item.id)) return;
      buttons.forEach(button => { button.disabled = true; });
      output.textContent = '記録しています…';
      try {
        const receipt = await aiObservationApi({ feature, work_id: item.id, action,
          observed_at: observedAtJst(), note: feature === 'check_in' ? note.value.trim() : '' });
        if (!current()) return;
        if (receipt.work_updated === true) {
          output.textContent = action === 'done'
            ? '完了を反映しました。' : '明日へ持ち越しました。';
          if (receipt.snapshot_refresh === 'unknown' || receipt.snapshot_refresh === 'not_configured')
            output.textContent += ' 一覧の更新は確認中です。';
          completed.add(item.id);
          if (action === 'done') item.state = 'DONE';
          (allButtons.get(item.id) || []).forEach(button => { button.disabled = true; });
        } else {
          output.textContent = receipt.status === 'already_saved'
            ? '同じ選択は記録済みです。' : `${label}を記録しました。`;
          buttons.forEach(button => { button.disabled = button.dataset.progressAction === action; });
        }
      } catch (error) {
        if (!current()) return;
        if (['AUTHENTICATION_REQUIRED', 'AUTH_ENVELOPE_TIMEOUT'].includes(error?.code)) {
          output.textContent = 'ログインを確認できませんでした。再ログイン後に操作してください。';
          buttons.forEach(button => { button.disabled = false; });
        } else if (['AI_PROGRESS_INVALID', 'AI_PROGRESS_TIME_INVALID', 'AI_PROGRESS_WORK_INVALID'].includes(error?.code)) {
          output.textContent = 'やることの状態や時刻が変わっています。画面を更新して確認してください。';
          buttons.forEach(button => { button.disabled = false; });
        } else if (error?.code === 'AI_PROGRESS_TIMED_SCHEDULE') {
          output.textContent = '時刻付きの予定は上書きできません。予定を確認してください。';
          buttons.forEach(button => { button.disabled = false; });
        } else if (error?.code === 'AI_PROGRESS_WRITE_CONFIG_INVALID') {
          output.textContent = '更新の準備ができていません。しばらくしてから確認してください。';
          buttons.forEach(button => { button.disabled = false; });
        } else if (error?.code === 'AI_PROGRESS_STORE_UNAVAILABLE') {
          output.textContent = '保存できませんでした。接続を確認し、後で操作してください。';
          buttons.forEach(button => { button.disabled = false; });
        } else {
          output.textContent = '保存結果を確認できません。重複を避けるため、この画面からは再送信しないでください。';
        }
      }
    }
    for (const item of work) {
      const row = document.createElement('div'); row.className = 'kai-observation-work';
      const name = document.createElement('strong'); name.textContent = item.title || '名称未設定のWork';
      const actions = document.createElement('div'); actions.className = 'kai-observation-actions';
      const output = document.createElement('p'); output.setAttribute('role', 'status');
      output.setAttribute('aria-live', 'polite');
      const buttons = [];
      for (const [action, label] of [['on_track', '予定どおり'], ['delayed', '遅れている'], ['done', '完了']]) {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = label; button.className = 'kp-button kai-observation-send';
        button.dataset.progressAction = action;
        button.setAttribute('aria-label', `${item.title || '名称未設定のWork'}: ${label}`);
        button.addEventListener('click', () => void submit('check_in', item,
          action, label, output, buttons));
        buttons.push(button); actions.appendChild(button);
      }
      allButtons.set(item.id, buttons);
      row.append(name, actions, output); section.appendChild(row);
    }
    section.appendChild(details);
    host.prepend(section);
    if (Number(jstParts().hour) < 20) return;
    const night = document.createElement('section'); night.className = 'kp-card kai-observation kai-night-review';
    night.dataset.aiObservationFeature = 'night_review';
    const nightTitle = document.createElement('h2'); nightTitle.textContent = '明日への持ち越し';
    const nightText = document.createElement('p');
    nightText.textContent = '未完了の項目だけ表示しています。明日も続けるものだけ選んでください。';
    night.append(nightTitle, nightText);
    for (const item of work) {
      const row = document.createElement('div'); row.className = 'kai-observation-work';
      const name = document.createElement('strong'); name.textContent = item.title || '名称未設定のWork';
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'kp-button kai-observation-send'; button.textContent = '明日へ持ち越し';
      button.dataset.progressAction = 'carry_forward';
      button.setAttribute('aria-label', `${item.title || '名称未設定のWork'}: 明日へ持ち越し`);
      const output = document.createElement('p'); output.setAttribute('role', 'status');
      output.setAttribute('aria-live', 'polite');
      button.addEventListener('click', () => void submit('night_review', item,
        'carry_forward', '明日への持ち越し', output, [button]));
      allButtons.get(item.id)?.push(button);
      row.append(name, button, output); night.appendChild(row);
    }
    section.after(night);
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
        if (selection.page === 'today') appendAiObservationControls(host, snapshot, current);
        void appendAiJudgments(host, selection.page, current, snapshot);
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
