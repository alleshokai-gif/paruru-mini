/* Kaz-only PROJECTS and controlled-proposal INBOX navigation. Operational writes remain absent. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  let context = null, projectsApi = null, workApi = null, capaApi = null, todayApi = null, inboxApi = null, contextApi = null, developmentMetricsApi = null, inboxAnswerApi = null, aiEngineApi = null, aiObservationApi = null;
  let v3DashboardApi = null, v3InboxApi = null, previewEpoch = 0, todayClockTimer = null;
  let lastKazRoute = '#kaz-os/today';
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

  function recordTodayDiagnostic(stage, outcome, classification = 'none', errorCode = null) {
    try {
      const diagnostics = globalThis.PALURUTransportDiagnostics;
      if (!diagnostics?.start || !diagnostics?.record) return;
      const context = diagnostics.start('kaz_read', 'kazOs.today.render');
      diagnostics.record(context, { attempt: 1, elapsedMs: 0, classification,
        backendStage: stage, outcome, errorCode, transportType: null });
    } catch (_) { /* Diagnostics must not affect TODAY rendering. */ }
  }

  function todaySafeError(error) {
    const known = new Set(['AUTHENTICATION_REQUIRED', 'FORBIDDEN', 'DIRECT_READ_FAILED',
      'DIRECT_READ_RESPONSE_INVALID', 'TODAY_CONTRACT_INVALID', 'DIRECT_READ_CONFIG_INVALID']);
    if (known.has(error?.code)) return error.code;
    if (error?.name === 'TypeError') return 'TODAY_RENDER_TYPE_ERROR';
    if (error?.name === 'ReferenceError') return 'TODAY_RENDER_REFERENCE_ERROR';
    if (error?.name === 'SyntaxError') return 'TODAY_RENDER_SYNTAX_ERROR';
    return 'TODAY_RENDER_FAILED';
  }

  async function digestJson(value) {
    const bytes = new globalThis.TextEncoder().encode(JSON.stringify(value));
    return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
      .map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function workEvidenceText(item, withBlocker) {
    const fields = ['title', 'state', 'next_action', ...(withBlocker ? ['blocker'] : [])];
    return Array.from(fields.map(key => typeof item[key] === 'string' ? item[key].trim() : '')
      .filter(Boolean).join(' · ').trim()).slice(0, 400).join('');
  }

  async function workForEvidence(evidence, snapshot) {
    if (evidence?.source !== 'work' || !/^[a-f0-9]{64}$/.test(evidence.source_ref_hash || '')
        || !/^[a-f0-9]{64}$/.test(evidence.source_revision || '')
        || !/^[a-f0-9]{64}$/.test(evidence.quote_hash || '')
        || !Number.isInteger(evidence.start) || !Number.isInteger(evidence.end)
        || evidence.start < 0 || evidence.end <= evidence.start
        || !snapshot?.work || !globalThis.crypto?.subtle || !globalThis.TextEncoder) return null;
    const todayIds = new Set(['now', 'next', 'scheduled'].flatMap(lane =>
      (snapshot.today?.[lane] || []).map(row => row?.id)));
    for (const item of snapshot.work) {
      if (!item || typeof item.id !== 'string' || ['DONE', 'CANCELLED'].includes(item.state)) continue;
      if (!todayIds.has(item.id)) continue;
      if (await digestJson({ original_ref: item.id, source: 'work' }) !== evidence.source_ref_hash) continue;
      for (const withBlocker of [true, false]) {
        const text = workEvidenceText(item, withBlocker);
        if (await digestJson({ original_ref: item.id, revision: item.source_revision ?? null,
          source: 'work', text }) !== evidence.source_revision) continue;
        const quote = Array.from(text).slice(evidence.start, evidence.end).join('');
        if (quote && text.split(quote).length === 2
            && await digestJson(quote) === evidence.quote_hash) return { item, quote };
      }
    }
    return null;
  }

  function createTodayActionBrief(host, snapshot, plan, current, controlsHost = host) {
    const section = document.createElement('section');
    section.className = 'kp-card kai-action-brief';
    section.dataset.aiActionBrief = 'true';
    host.prepend(section);
    let rows = [], renderEpoch = 0, aiState = 'loading', aiError = '';
    let dashboard = snapshot, dailyPlan = plan;
    const progress = new Map();
    const activeWorkFor = value => new Map((value?.work || []).filter(item => item
      && typeof item.id === 'string' && !['DONE', 'CANCELLED'].includes(item.state))
      .map(item => [item.id, item]));
    let activeWork = activeWorkFor(snapshot);
    const lane = name => (dashboard.today?.[name] || []).map(item => activeWork.get(item?.id))
      .filter((item, index, all) => item && !['done', 'carry_forward', 'delayed', 'blocked'].includes(progress.get(item.id))
        && all.findIndex(other => other?.id === item.id) === index);
    const addText = (parent, tag, value, className = '') => {
      const node = document.createElement(tag);
      node.className = className;
      node.textContent = value;
      parent.appendChild(node);
      return node;
    };
    const addWork = (parent, item, source, { prominentAction = false } = {}) => {
      const link = document.createElement('a');
      link.className = 'kai-action-link';
      link.href = `#kaz-os/work/${encodeURIComponent(item.id)}`;
      const fullTitle = item.title || '名称未設定のWork';
      const titleExcerpt = Array.from(fullTitle).slice(0, 72).join('');
      link.textContent = `${titleExcerpt}${titleExcerpt.length < fullTitle.length ? '…' : ''}`;
      parent.appendChild(link);
      if (titleExcerpt.length < fullTitle.length) {
        const titleDetail = document.createElement('details');
        titleDetail.className = 'kai-action-detail';
        const titleSummary = document.createElement('summary'); titleSummary.textContent = 'タイトル全文';
        const titleBody = document.createElement('p'); titleBody.textContent = fullTitle;
        titleDetail.append(titleSummary, titleBody); parent.appendChild(titleDetail);
      }
      const fullAction = typeof item.next_action === 'string' ? item.next_action.trim() : '';
      const firstSentence = fullAction.split(/[。\n]/, 1)[0];
      const excerpt = Array.from(firstSentence).slice(0, 110).join('');
      const shortened = Array.from(firstSentence).length > 110 || firstSentence.length < fullAction.length;
      if (fullAction) {
        if (prominentAction) {
          addText(parent, 'p', `最初の一手（Work記録）: ${excerpt}${shortened ? '…' : ''}`, 'kai-action-first-step');
          if (shortened) {
            const action = document.createElement('details');
            action.className = 'kai-action-detail';
            const summary = document.createElement('summary'); summary.textContent = 'Workに記録された次の行動';
            const body = document.createElement('p'); body.textContent = fullAction;
            action.append(summary, body); parent.appendChild(action);
          }
        } else {
          const action = document.createElement('details');
          action.className = 'kai-action-detail';
          const summary = document.createElement('summary');
          summary.textContent = `次の行動: ${excerpt}${shortened ? '…' : ''}`;
          const body = document.createElement('p'); body.textContent = fullAction;
          action.append(summary, body); parent.appendChild(action);
        }
      } else addText(parent, 'p', '次の行動は未記録です。Workの詳細を確認してください。');
      addText(parent, 'p', source, 'kai-action-source');
      if (progress.get(item.id) === 'delayed')
        addText(parent, 'p', '延期を記録済み。次の提案更新に反映します。', 'kai-action-source');
      else if (progress.get(item.id) === 'blocked')
        addText(parent, 'p', 'ブロックを記録済み。次の提案更新に反映します。', 'kai-action-source');
      else if (progress.get(item.id) === 'on_track')
        addText(parent, 'p', '継続中と記録済み。次の提案更新に反映します。', 'kai-action-source');
    };
    const calendarWindows = now => {
      const calendar = dailyPlan?.sources?.calendar;
      const hasPlan = dailyPlan?.schema_version === 'kaz-today-plan-v2';
      const planValid = hasPlan
        && calendar?.status === 'ok' && calendar?.complete === true
        && (calendar.valid_until == null || Date.parse(calendar.valid_until) > now)
        && Array.isArray(dailyPlan.today?.calendar_free_windows);
      const dashboardValid = !hasPlan && dashboard?.sources?.calendar?.status === 'current';
      const windows = planValid ? dailyPlan.today.calendar_free_windows
        : dashboardValid ? dashboard.today?.kaz_free_windows || [] : [];
      return { confirmed: planValid || dashboardValid, windows };
    };
    const companyWindows = now => {
      const planValid = dailyPlan?.schema_version === 'kaz-today-plan-v2'
        && dailyPlan.sources?.calendar?.status === 'ok'
        && dailyPlan.sources?.calendar?.complete === true
        && dailyPlan.sources?.work_busy?.status === 'ok'
        && !(dailyPlan.today?.limitations || []).includes('company_work_hours_unconfigured')
        && (dailyPlan.sources.calendar.valid_until == null
          || Date.parse(dailyPlan.sources.calendar.valid_until) > now)
        && Array.isArray(dailyPlan.today?.company_free_windows);
      const dashboardValid = dailyPlan?.schema_version !== 'kaz-today-plan-v2'
        && dashboard?.sources?.calendar?.status === 'current'
        && dashboard?.sources?.work_busy?.status === 'current'
        && Array.isArray(dashboard.today?.company_free_windows);
      return { confirmed: planValid || dashboardValid,
        windows: planValid ? dailyPlan.today.company_free_windows
          : dashboardValid ? dashboard.today.company_free_windows : [] };
    };
    const planningDomain = item => {
      const area = (dashboard?.projects || []).find(project => project?.id === item?.project_id)?.area;
      if (area === 'WORK') return 'company';
      if (['PERSONAL', 'FAMILY', 'PALURU', 'PHARLINK', 'CONTENT'].includes(area)) return 'personal';
      return null;
    };
    const timeFit = (parent, item, now) => {
      const domain = planningDomain(item);
      if (domain !== 'company' && domain !== 'personal') {
        addText(parent, 'p', 'ProjectのAreaが未分類のため、実行できる時間帯を割り当てていません。', 'kai-action-fit');
        return false;
      }
      const estimate = Number(item.estimate_min);
      if (!Number.isInteger(estimate) || estimate <= 0) return false;
      const availability = domain === 'company' ? companyWindows(now) : calendarWindows(now);
      if (!availability.confirmed) {
        addText(parent, 'p', domain === 'company'
          ? '会社の勤務時間またはBUSY予定を確認できないため、実行枠は未確認です。'
          : '家庭・個人の空き時間を確認できません。', 'kai-action-fit');
        return false;
      }
      const windows = availability.windows.filter(window => {
        const start = Date.parse(window?.start), end = Date.parse(window?.end);
        return Number.isFinite(start) && Number.isFinite(end) && end > now && end - Math.max(start, now) >= estimate * 60000;
      }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      const window = windows[0];
      if (!window) return false;
      const start = Math.max(Date.parse(window.start), now);
      const clock = value => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo',
        hour: '2-digit', minute: '2-digit' }).format(new Date(value));
      addText(parent, 'p', `${domain === 'company' ? '会社' : '家庭・個人'}の空き時間の目安 ${clock(start)}–${clock(Date.parse(window.end))} · Work見積り${estimate}分（予定への割当なし）`, 'kai-action-fit');
      return true;
    };
    const openProgressFor = item => {
      const review = controlsHost.querySelector('.kai-observation-review');
      const section = controlsHost.querySelector('[data-ai-observation-feature="check_in"]');
      const row = section && [...section.querySelectorAll('.kai-observation-work')]
        .find(candidate => candidate.dataset.workItem === item.id);
      if (!review || !row) return;
      review.open = true;
      row.open = true;
      row.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    };
    const addProgressButton = (parent, item) => {
      const button = addText(parent, 'button', 'このWorkの進捗操作を開く', 'kp-button kai-action-progress');
      button.type = 'button';
      button.addEventListener('click', () => openProgressFor(item));
    };
    const availableTime = now => {
      const availability = calendarWindows(now);
      const windows = availability.windows.filter(window => {
        const start = Date.parse(window?.start), end = Date.parse(window?.end);
        return Number.isFinite(start) && Number.isFinite(end) && end > now && start < end;
      }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      if (!availability.confirmed) return '利用できる時間は未確認です。';
      const window = windows[0];
      if (!window) return '今日の確認済み空き時間はありません。';
      const start = Math.max(Date.parse(window.start), now), end = Date.parse(window.end);
      const clock = value => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo',
        hour: '2-digit', minute: '2-digit' }).format(new Date(value));
      const minutes = Math.max(0, Math.floor((end - start) / 60000));
      return `次の確認済み空き時間 ${clock(start)}–${clock(end)} · ${minutes}分`;
    };
    const judgmentText = row => ({
      FOCUS_REVIEW: '今日の集中対象として確認',
      BLOCKER_REVIEW: '作業を止めている要因を確認',
      REPLAN_REVIEW: '予定の組み直しを確認',
      PROGRESS_REVIEW: '進捗に応じた次の行動を確認',
      NEEDS_INPUT: '判断に必要な入力を確認',
      NO_ADVICE: 'いま個別の行動提案はありません',
    })[row?.judgment] || 'AIの判断内容を確認してください';
    async function update(nextRows = rows, nextState = aiState, errorCode = aiError) {
      rows = nextRows;
      aiState = nextState;
      aiError = errorCode;
      const epoch = ++renderEpoch;
      const now = Date.now();
      const valid = dashboard?.status === 'CURRENT' && sameJstDay(dashboard.generated_at)
        && ['work', 'today', 'calendar'].every(key => {
          const source = dashboard.sources?.[key];
          return source?.status === 'current'
            && (source.valid_until == null || Date.parse(source.valid_until) > now);
        });
      if (!current()) return;
      section.replaceChildren();
      addText(section, 'h2', '今、何をする？');
      if (!valid) {
        addText(section, 'p', '今日の予定またはWorkを確認できません。最新のAI判断と空き時間は未確認です。', 'kp-notice');
        return;
      }
      const latest = new Map();
      for (const row of rows.filter(row => sameJstDay(row?.as_of)
        && ['daily_planner', 'check_in'].includes(row.feature))) {
        const prior = latest.get(row.feature);
        if (!prior || Date.parse(row.as_of) > Date.parse(prior.as_of)) latest.set(row.feature, row);
      }
      const resolved = new Map();
      for (const [feature, row] of latest) {
        if (row.status === 'review_pending') resolved.set(feature, await workForEvidence(row.evidence, dashboard));
      }
      if (epoch !== renderEpoch || !current()) return;
      addText(section, 'p', availableTime(now), 'kai-action-availability');
      const nowCandidate = lane('now')[0] || null;
      addText(section, 'h3', 'NOW · 今やること（確認済み情報から選定）');
      if (nowCandidate) {
        addWork(section, nowCandidate, '決定的Plannerの現在候補 · Calendar・Work状態を反映', { prominentAction: true });
        timeFit(section, nowCandidate, now);
        addProgressButton(section, nowCandidate);
      } else {
        addText(section, 'p', '現在時刻に実行可能と確認できたWorkはありません。', 'kai-action-source');
      }
      const row = [...latest.values()].sort((a, b) => Date.parse(b.as_of) - Date.parse(a.as_of))[0] || null;
      const match = row ? resolved.get(row.feature) : null;
      const target = match?.item && !progress.has(match.item.id) ? match.item : null;
      const nextCandidate = [...new Map([...lane('next'), ...lane('scheduled')]
        .filter(item => !nowCandidate || item.id !== nowCandidate.id)
        .map(item => [item.id, item])).values()][0] || null;
      if (aiState === 'loading') {
        addText(section, 'p', 'AI Plannerの今日の判断を確認しています…', 'kai-action-source');
      } else if (aiState === 'unavailable') {
        addText(section, 'p', `AI判断は未取得です${aiError ? `（${aiError}）` : ''}。下のWork候補は別のPlanner情報として表示します。`, 'kp-notice');
      } else if (!row) {
        addText(section, 'p', '今日のAI判断はありません。下のWork候補はAI判断とは別の情報です。', 'kai-action-source');
      } else {
        addText(section, 'p', `AI Planner · ${judgmentText(row)}`, 'kai-action-recommendation');
        const judgmentDetails = document.createElement('details');
        judgmentDetails.className = 'kai-action-details';
        const judgmentSummary = document.createElement('summary');
        judgmentSummary.textContent = '判断の理由・日時';
        judgmentDetails.appendChild(judgmentSummary);
        const judgmentTime = document.createElement('p');
        const asOf = Date.parse(row.as_of || '');
        judgmentTime.textContent = `生成日時: ${Number.isFinite(asOf)
          ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(asOf)) + ' JST'
          : 'unknown'}`;
        judgmentDetails.appendChild(judgmentTime);
        const judgmentReason = document.createElement('p');
        judgmentReason.textContent = row.recommendation?.reason?.trim()
          || row.reason?.trim() || 'この判断に理由は記録されていません。';
        judgmentDetails.appendChild(judgmentReason);
        section.appendChild(judgmentDetails);
        if (row.judgment === 'NO_ADVICE') {
          addText(section, 'p', 'AIから個別のWork提案は出ていません。', 'kai-action-source');
        } else if (target) {
          const recommendation = row.feature === 'daily_planner' ? row.recommendation : null;
          const sameAsNow = nowCandidate?.id === target.id;
          if (sameAsNow) {
            addText(section, 'p', 'AI Plannerの対象はNOW候補と一致しています。', 'kai-action-source');
          } else {
            const nowTitle = nowCandidate?.title || '現在候補なし';
            const timestamp = Number.isFinite(asOf)
              ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(asOf)) + ' JST'
              : '時点不明';
            addText(section, 'p', `AI Planner（${timestamp}）は別のWorkを推薦しています。NOWは「${nowTitle}」です。推薦は生成時点の判断で、現在の実行順を上書きしません。`, 'kp-notice');
          }
          if (recommendation?.first_step) {
            const source = recommendation.action_origin === 'work_record'
              ? 'Work記録' : 'AI生成（根拠はWork記録）';
            addText(section, 'p', `最初の一手（${source}）: ${recommendation.first_step}`,
              'kai-action-first-step');
          }
          if (!sameAsNow) addWork(section, target,
            `AI判断が参照したWork · ${row.feature === 'daily_planner' ? 'Daily Planner' : 'Check-in'}（NOWとは別）`,
            { prominentAction: !recommendation });
          const fitShown = timeFit(section, target, now);
          if (planningDomain(target) === 'personal' && !fitShown
              && recommendation?.estimate_min !== null && recommendation?.estimate_min !== undefined) {
            addText(section, 'p', `所要時間の目安: ${recommendation.estimate_min}分（Work見積り）`,
              'kai-action-fit');
          }
          if (match.quote) {
            const evidence = document.createElement('details');
            evidence.className = 'kai-action-detail';
            const summary = document.createElement('summary'); summary.textContent = 'AIが参照した根拠（Work記録）';
            const body = document.createElement('p'); body.textContent = match.quote;
            evidence.append(summary, body); section.appendChild(evidence);
          }
          if (!sameAsNow) addProgressButton(section, target);
        } else if (match?.item && progress.has(match.item.id)) {
          addText(section, 'p', '進み具合を記録しました。次は確認済みのWork順から選び直しています。', 'kai-action-source');
        } else {
          addText(section, 'p', 'このAI判断を、今日のWork候補に結び付ける証拠は確認できません。', 'kp-notice');
        }
      }
      if (!target && nextCandidate) {
        addText(section, 'h3', '次に取り組む候補（確認済みのWork順）', 'kai-action-next-heading');
        addWork(section, nextCandidate, '決定的Plannerの候補 · 新しいAI判断ではありません', { prominentAction: true });
        timeFit(section, nextCandidate, now);
        addProgressButton(section, nextCandidate);
      }
      const candidates = [...new Map([...lane('now'), ...lane('next')].map(item => [item.id, item])).values()];
      const fallback = document.createElement('details');
      fallback.className = 'kai-work-candidates';
      const fallbackSummary = document.createElement('summary');
      fallbackSummary.textContent = `PlannerのWork候補（AI判断とは別） · ${candidates.length}件`;
      fallback.appendChild(fallbackSummary);
      candidates.slice(0, 3).forEach(item => addWork(fallback, item, 'TODAY Plannerの優先候補 · AI判断ではありません'));
      if (!candidates.length) addText(fallback, 'p', 'Work候補はありません。');
      section.appendChild(fallback);
    }
    void update([], 'loading');
    return { update, refreshSources(nextDashboard, nextPlan) {
      if (nextDashboard?.schema_version === 'kaz-os-dashboard-v3') {
        dashboard = nextDashboard;
        activeWork = activeWorkFor(nextDashboard);
      }
      if (nextPlan?.schema_version === 'kaz-today-plan-v2') dailyPlan = nextPlan;
      void update(rows, aiState, aiError);
    }, onProgress(itemId, action) {
      progress.set(itemId, action);
      void update(rows, aiState, aiError);
    }, unavailable(error) {
      const code = typeof error === 'string' && /^[A-Z0-9_]{1,80}$/.test(error) ? error : '';
      void update(rows, 'unavailable', code);
    } };
  }

  async function appendAiJudgments(host, page, current, snapshot = null, brief = null) {
    if (!current()) return;
    if (!aiEngineApi || !aiFeaturesByPage[page]) {
      if (page === 'today') brief?.unavailable('AI_ENGINE_UNAVAILABLE');
      return;
    }
    const section = document.createElement(page === 'today' ? 'details' : 'section');
    section.className = 'kp-card kai-ai-judgments';
    let todaySummary = null;
    if (page === 'today') {
      todaySummary = document.createElement('summary');
      todaySummary.textContent = 'ほかのAI判断';
      section.appendChild(todaySummary);
    } else {
      const heading = document.createElement('h2');
      heading.textContent = 'AI判断';
      section.appendChild(heading);
    }

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
      if (brief) void brief.update(rows, 'ready');
      if (page === 'today' && rows.length) todaySummary.textContent = `ほかのAI判断 · ${rows.length}件`;
      if (!rows.length) {
        const empty = document.createElement('p');
        empty.textContent = 'いま表示できる提案はありません。';
        section.appendChild(empty);
      }
      for (const row of rows) {
        const item = document.createElement('details');
        item.className = 'kai-ai-judgment';
        const target = page === 'today' && row.status === 'review_pending'
          ? (await workForEvidence(row.evidence, snapshot))?.item || null : null;
        if (!current()) return;
        const action = target && !['DONE', 'CANCELLED'].includes(target.state)
          ? [target.title, target.next_action].filter(value => typeof value === 'string' && value.trim())
              .join('：') : '';
        const time = Number.isFinite(Date.parse(row.as_of))
          ? `（${new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo',
            hour: '2-digit', minute: '2-digit' }).format(new Date(row.as_of))}時点）` : '';
        const summary = document.createElement('summary');
        summary.textContent = `${aiFeatureLabels[row.feature]}${time}: ${aiJudgmentLabels[row.judgment] || '確認してください'}`;
        item.appendChild(summary);
        if (action) {
          const detail = document.createElement('p');
          detail.textContent = `対象Work: ${action}`;
          item.appendChild(detail);
        }
        if (typeof row.reason === 'string' && row.reason.trim()) {
          const reason = document.createElement('p');
          reason.textContent = `判断の要約: ${Array.from(row.reason.trim()).slice(0, 160).join('')}`;
          item.appendChild(reason);
        }
        section.appendChild(item);
      }
    } catch (error) {
      if (!current()) return;
      if (brief) brief.unavailable(error?.code);
      if (page === 'today') todaySummary.textContent = 'ほかのAI判断 · 取得できません';
      const unavailable = document.createElement('p');
      const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code)
        ? `（${error.code}）` : '';
      unavailable.textContent = `AI判断は未取得です${code}。予定・Work候補の表示は続けます。`;
      section.appendChild(unavailable);
    }
    if (current()) {
      const briefSection = page === 'today' && host.querySelector('.kai-action-brief');
      if (briefSection) briefSection.after(section);
      else host.appendChild(section);
    }
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

  function appendAiObservationControls(host, snapshot, current, onProgress = null) {
    if (!current()) return;
    const work = observationCandidates(snapshot);
    const section = document.createElement('section');
    section.className = 'kp-card kai-observation';
    section.dataset.aiObservationFeature = 'check_in';
    const title = document.createElement('h2'); title.textContent = '今日の進み具合';
    const review = document.createElement('details');
    review.className = 'kai-observation-review';
    const reviewSummary = document.createElement('summary');
    reviewSummary.textContent = '状態変更が必要な項目だけ確認する';
    review.appendChild(reviewSummary);
    const guidance = document.createElement('p');
    guidance.textContent = '項目ごとに開いて、状態が変わったものだけ記録してください。未操作のWorkは変更されません。';
    review.appendChild(guidance);
    section.append(title, review);
    if (!aiObservationApi || snapshot?.status !== 'CURRENT'
        || !sameJstDay(snapshot.generated_at)
        || ['work', 'today'].some(key => snapshot.sources?.[key]?.status !== 'current')) {
      const unavailable = document.createElement('p');
      unavailable.textContent = '現在のやることを確認できないため、記録は使えません。画面を更新してください。';
      review.appendChild(unavailable);
      const overview = host.querySelector('[data-today-overview]');
      if (overview) overview.after(section); else host.append(section);
      return;
    }
    if (!work.length) {
      const empty = document.createElement('p'); empty.textContent = 'いま操作が必要な項目はありません。';
      review.appendChild(empty);
      const overview = host.querySelector('[data-today-overview]');
      if (overview) overview.after(section); else host.append(section);
      return;
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
        let refreshed = null;
        if (receipt.work_updated === true) {
          output.textContent = action === 'done'
            ? '完了を反映しました。' : '明日へ持ち越しました。';
          if (receipt.snapshot_refresh === 'unknown' || receipt.snapshot_refresh === 'not_configured')
            output.textContent += ' 一覧の更新は確認中です。';
          completed.add(item.id);
          (allButtons.get(item.id) || []).forEach(button => { button.disabled = true; });
          refreshed = await onProgress?.(item.id, action);
        } else {
          output.textContent = receipt.status === 'already_saved'
            ? '同じ選択は記録済みです。' : `${label}を記録しました。`;
          buttons.forEach(button => { button.disabled = button.dataset.progressAction === action; });
          refreshed = await onProgress?.(item.id, action);
        }
        if (refreshed === true) output.textContent += ' 今日の計画を読み直しました。';
        else if (refreshed === false) output.textContent += ' 最新計画の再読込は未確認です。画面を更新して確認してください。';
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
      const row = document.createElement('details'); row.className = 'kai-observation-work';
      row.dataset.workItem = item.id;
      const name = document.createElement('summary'); name.textContent = item.title || '名称未設定のWork';
      const actions = document.createElement('div'); actions.className = 'kai-observation-actions';
      const output = document.createElement('p'); output.setAttribute('role', 'status');
      output.setAttribute('aria-live', 'polite');
      const buttons = [];
      for (const [action, label] of [['on_track', '継続中'], ['delayed', '延期'],
        ['blocked', 'ブロック'], ['done', '完了']]) {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = label; button.className = 'kp-button kai-observation-send';
        button.dataset.progressAction = action;
        button.setAttribute('aria-label', `${item.title || '名称未設定のWork'}: ${label}`);
        button.addEventListener('click', () => void submit('check_in', item,
          action, label, output, buttons));
        buttons.push(button); actions.appendChild(button);
      }
      allButtons.set(item.id, buttons);
      row.append(name, actions, output); review.appendChild(row);
    }
    review.appendChild(details);
    const overview = host.querySelector('[data-today-overview]');
    if (overview) overview.after(section); else host.append(section);
    if (Number(jstParts().hour) < 20) return;
    const night = document.createElement('section'); night.className = 'kp-card kai-observation kai-night-review';
    night.dataset.aiObservationFeature = 'night_review';
    const nightTitle = document.createElement('h2'); nightTitle.textContent = '明日への持ち越し';
    const nightText = document.createElement('p');
    nightText.textContent = '未完了の項目だけ表示しています。明日も続けるものだけ選んでください。';
    night.append(nightTitle, nightText);
    for (const item of work) {
      const row = document.createElement('details'); row.className = 'kai-observation-work';
      const name = document.createElement('summary'); name.textContent = item.title || '名称未設定のWork';
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
    host.appendChild(night);
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
    const metrics = byId('kazOsDevelopmentMetricsLink');
    if (metrics) {
      metrics.hidden = !allowed();
      metrics.href = '#kaz-os/v3/metrics';
      if (page === 'metrics') metrics.setAttribute('aria-current', 'page');
      else metrics.removeAttribute('aria-current');
    }
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
    clearTimeout(todayClockTimer);
    todayClockTimer = null;
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
      recordTodayDiagnostic('TODAY_RENDER', 'progress');
      globalThis.KazPersonalView.render(host, selection, data);
      recordTodayDiagnostic('TODAY_RENDER_COMPLETE', 'success');
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
      recordTodayDiagnostic('TODAY_READ_OR_RENDER_FAILED', 'unresolved',
        error?.transportClassification || (error?.httpStatus ? 'http' : 'unknown'), todaySafeError(error));
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
    const metricsOnly = location.hash === '#kaz-os/v3/metrics';
    if (!metricsOnly && /^#kaz-os\/(today|work|projects|capa|context)(?:\/[^/]+)?$/.test(location.hash)) {
      lastKazRoute = location.hash;
      try { sessionStorage.setItem('paluruKazMetricsReturnRoute', lastKazRoute); } catch (_) { /* In-memory return still works. */ }
    } else if (metricsOnly && lastKazRoute === '#kaz-os/today') {
      try {
        const savedRoute = sessionStorage.getItem('paluruKazMetricsReturnRoute');
        if (/^#kaz-os\/(today|work|projects|capa|context)(?:\/[^/]+)?$/.test(savedRoute || '')) lastKazRoute = savedRoute;
      } catch (_) { /* Direct metrics links return to TODAY. */ }
    }
    const previewEnabled = Boolean(globalThis.PALURU_KAZ_OS_V3_PREVIEW_ENABLED);
    const preview = (previewEnabled || metricsOnly)
      && /^#kaz-os\/v3(?:\/(today|work|projects|capa|context|metrics)(?:\/([^/]+))?)?$/.exec(location.hash);
    const cutover = /^#kaz-os\/(today|work|projects|capa|context)(?:\/([^/]+))?$/.exec(location.hash);
    if (preview || cutover) {
      const legacyNav = byId('kazOsNav');
      if (legacyNav) legacyNav.hidden = false;
      const selection = { page: preview ? (preview[1] || 'today') : cutover[1], id: null };
      // Metrics are read from the direct API even when opened through the V3 route.
      // Keep the surrounding five-tab navigation on the normal supported routes.
      configureKazNav(Boolean(preview && selection.page !== 'metrics'), selection.page);
      try { if ((preview || cutover)[2]) selection.id = decodeURIComponent((preview || cutover)[2]); } catch { /* Invalid ID is not selected. */ }
      const requestEpoch = previewEpoch;
      const current = () => requestEpoch === previewEpoch && allowed() && active() && !document.hidden;
      const pageLabel = { today: '今日の予定', work: 'やること', projects: 'プロジェクト', capa: 'CAPA', context: 'Context Observatory', metrics: '開発実績', inbox: '確認待ち' }[selection.page];
      byId('kazOsView')?.setAttribute('aria-label', pageLabel);
      const host = byId('kazPersonalContent');
      if (!host) return;
      host.textContent = `${pageLabel}を確認中…`;
      let todayFailureStage = 'DASHBOARD_READ';
      try {
        if (selection.page === 'context') {
          const data = await contextApi();
          if (!current()) return;
          globalThis.KazPersonalView.render(host, selection, data);
          await appendAiJudgments(host, selection.page, current);
          return;
        }
        if (selection.page === 'metrics') {
          if (typeof developmentMetricsApi !== 'function') throw Error('DEVELOPMENT_METRICS_UNAVAILABLE');
          const metrics = await developmentMetricsApi();
          if (!current()) return;
          renderDevelopmentMetrics(host, metrics);
          return;
        }
        const [snapshotResult, planResult] = await Promise.allSettled([
          selection.page === 'inbox' ? v3InboxApi() : v3DashboardApi(),
          selection.page === 'today' && typeof todayApi === 'function' ? todayApi() : Promise.resolve(null),
        ]);
        const validTodayPlan = selection.page === 'today' && planResult.status === 'fulfilled'
          && planResult.value?.schema_version === 'kaz-today-plan-v2' && planResult.value?.today;
        if (snapshotResult.status !== 'fulfilled' && validTodayPlan) {
          host.replaceChildren();
          const notice = document.createElement('p');
          notice.className = 'kp-notice';
          notice.setAttribute('role', 'status');
          notice.textContent = 'NOW・NEXTと会社／家庭の計画を表示中。進捗情報を取得できないため、進捗操作は一時的に利用できません。';
          const planHost = document.createElement('div');
          planHost.dataset.dailyPlanning = 'v2-partial';
          host.append(notice, planHost);
          todayFailureStage = 'TODAY_RENDER';
          globalThis.KazPersonalView.render(planHost, selection, planResult.value);
          recordTodayDiagnostic('TODAY_PLAN_PARTIAL_DISPLAY', 'success', 'none', 'DASHBOARD_SNAPSHOT_UNAVAILABLE');
          return;
        }
        if (snapshotResult.status !== 'fulfilled') {
          todayFailureStage = 'DASHBOARD_READ_FAILED';
          throw snapshotResult.reason;
        }
        let snapshot = snapshotResult.value;
        let dailyPlan = planResult.status === 'fulfilled' ? planResult.value : null;
        if (!current()) return;
        todayFailureStage = 'COMPONENT_CONTRACT';
        const data = selection.page === 'inbox'
          ? globalThis.KazV3ComponentData.inbox(snapshot)
          : selection.page === 'today' && dailyPlan?.schema_version === 'kaz-today-plan-v2'
            ? dailyPlan : globalThis.KazV3ComponentData.dashboard(snapshot, selection.page, Date.now());
        const options = selection.page === 'inbox' ? {
          answerApi: controlledInbox(data) ? inboxAnswerApi : null,
          projectsApi: async () => globalThis.KazV3ComponentData.dashboard(await v3DashboardApi(), 'projects'),
        } : selection.page === 'today' ? {
          answerApi: typeof inboxAnswerApi === 'function' ? inboxAnswerApi : null,
        } : {};
        let plannerHost = host;
        let briefHost = host;
        let actionHost = host;
        if (selection.page === 'today' && dailyPlan?.schema_version === 'kaz-today-plan-v2') {
          host.replaceChildren();
          briefHost = document.createElement('div');
          briefHost.dataset.todayBrief = 'true';
          plannerHost = document.createElement('div');
          plannerHost.dataset.dailyPlanning = 'v2';
          actionHost = document.createElement('div');
          actionHost.dataset.todayActions = 'true';
          host.append(briefHost, plannerHost, actionHost);
        }
        todayFailureStage = 'TODAY_RENDER';
        globalThis.KazPersonalView.render(plannerHost, selection, data, Date.now(), options);
        if (selection.page === 'today') recordTodayDiagnostic('TODAY_RENDER_COMPLETE', 'success');
        if (selection.page === 'today' && dailyPlan?.schema_version !== 'kaz-today-plan-v2') {
          const notice = document.createElement('p');
          notice.className = 'kp-notice';
          notice.textContent = '今日の時間枠付き計画を更新できません。表示中のWork順は確認済みの範囲で見ています。';
          host.prepend(notice);
        }
        let brief = null;
        if (selection.page === 'today') {
          brief = createTodayActionBrief(briefHost, snapshot, dailyPlan, current, actionHost);
          appendAiObservationControls(actionHost, snapshot, current, async (id, action) => {
            brief?.onProgress(id, action);
            const [freshSnapshot, refreshedPlan] = await Promise.allSettled([
              typeof v3DashboardApi === 'function' ? v3DashboardApi() : Promise.reject(Error('DASHBOARD_UNAVAILABLE')),
              typeof todayApi === 'function' ? todayApi() : Promise.reject(Error('TODAY_UNAVAILABLE')),
            ]);
            if (!current()) return false;
            if (freshSnapshot.status === 'fulfilled'
                && freshSnapshot.value?.schema_version === 'kaz-os-dashboard-v3') snapshot = freshSnapshot.value;
            if (refreshedPlan.status === 'fulfilled'
                && refreshedPlan.value?.schema_version === 'kaz-today-plan-v2') dailyPlan = refreshedPlan.value;
            brief?.refreshSources(snapshot, dailyPlan);
            if (dailyPlan?.schema_version === 'kaz-today-plan-v2')
              globalThis.KazPersonalView.render(plannerHost, selection, dailyPlan, Date.now(), options);
            return freshSnapshot.status === 'fulfilled'
              && refreshedPlan.status === 'fulfilled'
              && snapshot?.schema_version === 'kaz-os-dashboard-v3'
              && dailyPlan?.schema_version === 'kaz-today-plan-v2';
          });
          const updateClock = () => {
            if (!current()) return;
            const todayJst = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo',
              year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
            const expiredSource = [dailyPlan?.sources?.work_items, dailyPlan?.sources?.calendar,
              snapshot?.sources?.work, snapshot?.sources?.today, snapshot?.sources?.calendar]
              .some(source => Number.isFinite(Date.parse(source?.valid_until))
                && Date.parse(source.valid_until) <= Date.now());
            if (dailyPlan?.planning_date && dailyPlan.planning_date !== todayJst || expiredSource) {
              void render();
              return;
            }
            globalThis.KazPersonalView.render(plannerHost, selection, dailyPlan, Date.now(), options);
            brief?.update();
            todayClockTimer = setTimeout(updateClock, 60000);
            todayClockTimer?.unref?.();
          };
          todayClockTimer = setTimeout(updateClock, 60000);
          todayClockTimer?.unref?.();
        }
        void appendAiJudgments(actionHost, selection.page, current, snapshot, brief);
      } catch (error) {
        if (!current()) return;
        if (selection.page === 'metrics') {
          host.replaceChildren();
          const unavailable = document.createElement('p');
          unavailable.setAttribute('role', 'status');
          unavailable.textContent = '開発実績を読み込めませんでした。統計は未確認やで（0件とは扱わへん）。';
          host.append(unavailable);
          return;
        }
        if (selection.page === 'today') recordTodayDiagnostic(todayFailureStage,
          'unresolved', error?.transportClassification || (error?.httpStatus ? 'http' : 'unknown'), todaySafeError(error));
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

  function renderDevelopmentMetrics(host, value) {
    host.replaceChildren();
    const returnLink = document.createElement('a');
    returnLink.className = 'development-metrics-return';
    returnLink.href = /^#kaz-os\/(today|work|projects|capa|context)(?:\/[^/]+)?$/.test(lastKazRoute)
      ? lastKazRoute : '#kaz-os/today';
    const route = returnLink.href.slice(returnLink.href.indexOf('#'));
    returnLink.textContent = '← ' + ({
      '#kaz-os/today': 'TODAYへ戻る', '#kaz-os/work': 'WORKへ戻る',
      '#kaz-os/projects': 'PROJECTSへ戻る', '#kaz-os/capa': 'CAPAへ戻る',
      '#kaz-os/context': 'CONTEXTへ戻る',
    }[route] || '元の画面へ戻る');
    host.append(returnLink);
    const heading = document.createElement('h2');
    heading.textContent = '開発実績';
    host.append(heading);
    const totals = value.totals || {};
    const summary = document.createElement('p');
    const sourceStatus = value.source?.status;
    summary.textContent = sourceStatus === 'empty'
      ? 'まだ統計は取り込まれてへん。'
      : `セッション ${totals.sessions ?? 'unknown'}件 / input ${totals.input_tokens ?? 'unknown'} / output ${totals.output_tokens ?? 'unknown'} / 観測時間 ${totals.observed_span_ms == null ? 'unknown' : Math.round(totals.observed_span_ms / 60000) + '分'}${sourceStatus === 'partial' ? ' / 一部ログ未読' : ''}`;
    host.append(summary);
    const tokenNote = document.createElement('p');
    tokenNote.textContent = `合計は各セッションのthread累積値の最大スナップショットを1回ずつ足した値（ログ内の更新を重複加算していない）。inputにはcached input ${totals.cached_input_tokens ?? 'unknown'}を含む（内数）。cache write ${totals.cache_write_input_tokens ?? 'unknown'}、reasoning output ${totals.reasoning_output_tokens ?? 'unknown'}（outputの内数）。観測時間はセッションごとの開始〜最終記録の合計で、並行セッションは重なる。`;
    host.append(tokenNote);
    const outcomes = totals.github_outcomes || {};
    const linked = totals.github_linked_sessions;
    const outcomeSummary = document.createElement('p');
    outcomeSummary.textContent = `GitHub成果の明示リンク ${linked ?? 'unknown'} / ${totals.sessions ?? 'unknown'} セッション (${Number.isFinite(totals.github_linked_rate) ? Math.round(totals.github_linked_rate * 100) + '%' : 'unknown'})。PR/CIで確認できた状態: complete ${outcomes.complete ?? 'unknown'} / incomplete ${outcomes.incomplete ?? 'unknown'} / failed ${outcomes.failed ?? 'unknown'} / unknown ${outcomes.unknown ?? 'unknown'}。merged PRはGitHub上の証拠で、作業全体の完成判定とは別。`;
    host.append(outcomeSummary);
    if (value.schema_version === 'kaz-development-metrics-view-0.4') {
      const taskOutcomes = totals.task_outcomes || {};
      const reportOutcomes = totals.task_self_reports || {};
      const taskSummary = document.createElement('p');
      taskSummary.textContent = `GitHub識別子で束ねたタスク ${totals.tasks ?? 'unknown'}件（完了 ${taskOutcomes.complete ?? 'unknown'} / 未完了 ${taskOutcomes.incomplete ?? 'unknown'} / 失敗 ${taskOutcomes.failed ?? 'unknown'} / unknown ${taskOutcomes.unknown ?? 'unknown'}）。Codex最終報告の自己申告: 完了 ${reportOutcomes.complete ?? 'unknown'} / 未完了 ${reportOutcomes.incomplete ?? 'unknown'} / 失敗 ${reportOutcomes.failed ?? 'unknown'} / unknown ${reportOutcomes.unknown ?? 'unknown'}。紐付け不能・複数候補 ${totals.unlinked_or_ambiguous_sessions ?? 'unknown'}セッション。`;
      host.append(taskSummary);
      const taskNote = document.createElement('p');
      taskNote.textContent = 'タスクは全セッションに共通する単一のPRまたはcommit識別子だけで束ねる。GitHub証拠と最終報告の自己申告は別集計。経過時間は最初の開始〜最後の記録、観測時間は各セッションの合計で、並行作業では一致しない。';
      host.append(taskNote);
      const taskWrap = document.createElement('div');
      taskWrap.className = 'development-metrics-table-wrap';
      const taskTable = document.createElement('table');
      taskTable.className = 'development-metrics-table';
      const taskHeaders = ['GitHub識別子', 'セッション', 'GitHub証拠 / CI', '自己申告', 'モデル / 推論', 'input / output / cached', '経過時間', '観測時間', '人間 / 中断 / エラー', '再試行 / 手戻り', 'Context参照'];
      const taskHead = document.createElement('thead');
      const taskHeadRow = document.createElement('tr');
      for (const label of taskHeaders) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; taskHeadRow.append(cell); }
      taskHead.append(taskHeadRow); taskTable.append(taskHead);
      const taskBody = document.createElement('tbody');
      for (const task of value.tasks || []) {
        const row = document.createElement('tr');
        const referenceCell = document.createElement('td');
        const reference = task.reference || {};
        const anchor = document.createElement('a');
        if (reference.kind === 'pull_request' && Number.isInteger(reference.number)
            && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(reference.repository || '')) {
          anchor.href = `https://github.com/${reference.repository}/pull/${reference.number}`;
          anchor.textContent = `PR #${reference.number}`;
        } else if (reference.kind === 'commit' && /^[a-f0-9]{40}$/.test(reference.sha || '')
            && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(reference.repository || '')) {
          anchor.href = `https://github.com/${reference.repository}/commit/${reference.sha}`;
          anchor.textContent = `commit ${reference.sha.slice(0, 8)}`;
        } else anchor.textContent = 'GitHub unknown';
        referenceCell.append(anchor); row.append(referenceCell);
        const context = task.context_usage || {};
        const values = [task.session_count, `${task.github_outcome || 'unknown'} / ${task.github_status || 'unknown'} / ${task.reference_source || 'unknown'}`, task.self_reported_outcome,
          `${task.model || 'unknown'} / ${task.reasoning_level || 'unknown'}`,
          `${task.input_tokens ?? 'unknown'} / ${task.output_tokens ?? 'unknown'} / ${task.cached_input_tokens ?? 'unknown'}`,
          task.elapsed_time_ms == null ? 'unknown' : `${Math.round(task.elapsed_time_ms / 60000)}分`,
          task.observed_time_ms == null ? 'unknown' : `${Math.round(task.observed_time_ms / 60000)}分`,
          `${task.human_message_count ?? 'unknown'} / ${task.aborted_turn_count ?? 'unknown'} / ${task.explicit_error_count ?? 'unknown'}`,
          `${task.retry_count ?? 'unknown'} / ${task.rework_count ?? 'unknown'}`,
          context.status === 'known' ? `${context.calls}回（成功${context.successes}・失敗${context.errors}・unknown${context.unknown_results}）` : 'unknown'];
        for (const valueCell of values) { const cell = document.createElement('td'); cell.textContent = valueCell == null ? 'unknown' : String(valueCell); row.append(cell); }
        taskBody.append(row);
      }
      taskTable.append(taskBody); taskWrap.append(taskTable); host.append(taskWrap);
    }
    const modelHeading = document.createElement('h3');
    modelHeading.textContent = 'モデル別';
    host.append(modelHeading);
    const tableWrap = document.createElement('div');
    tableWrap.className = 'development-metrics-table-wrap';
    const table = document.createElement('table');
    table.className = 'development-metrics-table';
    const headers = ['モデル', 'セッション', 'input', 'output', 'cached input', '観測時間', '人間メッセージ', '中断ターン', 'GitHub complete', 'input / complete', 'output / complete', '観測時間 / complete', 'human messages / complete', 'resolve_context'];
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const label of headers) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; headerRow.append(cell); }
    thead.append(headerRow); table.append(thead);
    const tbody = document.createElement('tbody');
    for (const model of value.models || []) {
      const row = document.createElement('tr');
      for (const cellValue of [model.model, model.sessions, model.input_tokens, model.output_tokens,
        model.cached_input_tokens, model.observed_span_ms == null ? 'unknown' : Math.round(model.observed_span_ms / 60000) + '分',
        model.human_message_count, model.aborted_turn_count, model.github_complete_sessions,
        model.input_tokens_per_complete_session, model.output_tokens_per_complete_session,
        model.observed_span_ms_per_complete_session == null ? 'unknown' : Math.round(model.observed_span_ms_per_complete_session / 60000) + '分',
        model.human_messages_per_complete_session, model.context_reference_sessions]) {
        const cell = document.createElement('td'); cell.textContent = cellValue == null ? 'unknown' : String(cellValue); row.append(cell);
      }
      tbody.append(row);
    }
    table.append(tbody); tableWrap.append(table); host.append(tableWrap);
    const contextHeading = document.createElement('h3');
    contextHeading.textContent = 'Kaz Context参照とGitHub成果'; host.append(contextHeading);
    const contextSummary = document.createElement('p');
    contextSummary.textContent = `resolve_context記録: ${totals.resolve_context_sessions ?? 'unknown'}セッション / ${totals.resolve_context_calls ?? 'unknown'}回（成功 ${totals.resolve_context_successes ?? 'unknown'}・明示エラー ${totals.resolve_context_errors ?? 'unknown'}・結果unknown ${totals.resolve_context_unknown ?? 'unknown'}）。`;
    host.append(contextSummary);
    const contextNote = document.createElement('p');
    contextNote.textContent = 'resolve_contextの明示記録があるセッション別の相関比較。因果効果は示さず、cache hit率はContext効果として扱わへん。';
    host.append(contextNote);
    const contextWrap = document.createElement('div');
    contextWrap.className = 'development-metrics-table-wrap';
    const contextTable = document.createElement('table');
    contextTable.className = 'development-metrics-table';
    const contextHeaders = ['参照記録', 'セッション', 'GitHub complete', 'input / complete', 'output / complete', '観測時間 / complete', 'human messages / complete'];
    const contextHead = document.createElement('thead');
    const contextHeaderRow = document.createElement('tr');
    for (const label of contextHeaders) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; contextHeaderRow.append(cell); }
    contextHead.append(contextHeaderRow); contextTable.append(contextHead);
    const contextBody = document.createElement('tbody');
    const contextLabels = { reference_observed: 'あり', no_recorded_reference: '記録なし', reference_unknown: 'unknown' };
    for (const group of value.context_comparison || []) {
      const row = document.createElement('tr');
      for (const cellValue of [contextLabels[group.group] || 'unknown', group.sessions,
        group.github_complete_sessions, group.input_tokens_per_complete_session,
        group.output_tokens_per_complete_session,
        group.observed_span_ms_per_complete_session == null ? 'unknown' : Math.round(group.observed_span_ms_per_complete_session / 60000) + '分',
        group.human_messages_per_complete_session]) {
        const cell = document.createElement('td'); cell.textContent = cellValue == null ? 'unknown' : String(cellValue); row.append(cell);
      }
      contextBody.append(row);
    }
    contextTable.append(contextBody); contextWrap.append(contextTable); host.append(contextWrap);
    const qualityHeading = document.createElement('h3');
    qualityHeading.textContent = '取得状況'; host.append(qualityHeading);
    const quality = document.createElement('ul');
    for (const [label, key] of [['モデル', 'model'], ['推論レベル', 'reasoning_level'], ['input tokens', 'input_tokens'], ['total tokens', 'total_tokens'],
      ['output tokens', 'output_tokens'], ['cached input', 'cached_input_tokens'], ['観測時間', 'observed_span_ms'],
      ['人間メッセージ数', 'human_message_count'], ['中断ターン数', 'aborted_turn_count'],
      ['明示エラー数', 'explicit_error_count'], ['成果判定', 'work_outcome']]) {
      const item = document.createElement('li'); const stat = value.availability?.[key];
      const rate = Number.isFinite(stat?.known_rate) ? `${Math.round(stat.known_rate * 100)}%` : 'unknown';
      item.textContent = `${label}: 取得 ${stat?.known ?? 'unknown'} / unknown ${stat?.unknown ?? 'unknown'} (${rate})`;
      quality.append(item);
    }
    host.append(quality);
    const intervention = document.createElement('p');
    intervention.textContent = `観測できた人間メッセージ ${totals.human_message_count ?? 'unknown'} / 中断ターン ${totals.aborted_turn_count ?? 'unknown'} / 明示エラー ${totals.explicit_error_count ?? 'unknown'}。メッセージ数は介入回数そのものではなくproxy。手戻り・再試行はunknown、作業全体の完成判定もunknown。`;
    host.append(intervention);
    const ledger = document.createElement('p');
    ledger.textContent = 'OpenAI API Ledger: unknown（Codexプラン利用とは別集計）';
    host.append(ledger);
    const collected = document.createElement('p');
    const generatedAt = Date.parse(value.generated_at || '');
    const collectionTime = Number.isFinite(generatedAt)
      ? new Date(generatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) + ' JST'
      : '日時 unknown';
    const collectionState = sourceStatus === 'current' ? '正常'
      : sourceStatus === 'partial' ? `一部ログ未読 ${value.source?.unreadable_count ?? 'unknown'}件`
        : sourceStatus === 'empty' ? '未収集' : '状態 unknown';
    collected.textContent = `最終収集 ${collectionTime} / 収集状態 ${collectionState}`;
    host.append(collected);
    const list = document.createElement('ul');
    for (const item of value.sessions || []) {
      const row = document.createElement('li');
      const date = item.started_at ? new Date(item.started_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '日時 unknown';
      const github = document.createElement('span');
      const links = Array.isArray(item.github_links) ? item.github_links : [];
      if (!links.length) github.textContent = `GitHub ${item.github_outcome || 'unknown'}`;
      else links.forEach((link, index) => {
        if (index) github.append(document.createTextNode(' / '));
        const anchor = document.createElement('a');
        if (link.kind === 'pull_request' && Number.isInteger(link.number)) {
          anchor.href = `https://github.com/${link.repository}/pull/${link.number}`;
          anchor.textContent = `PR #${link.number} (${link.status || 'unknown'})`;
        } else if (link.kind === 'commit' && /^[a-f0-9]{40}$/.test(link.sha || '')) {
          anchor.href = `https://github.com/${link.repository}/commit/${link.sha}`;
          anchor.textContent = `commit ${link.sha.slice(0, 8)} (CI ${link.ci_status || 'unknown'})`;
        } else { anchor.textContent = 'GitHub unknown'; }
        github.append(anchor);
      });
      row.append(document.createTextNode(`${date} / ${item.model || 'model unknown'} / ${item.reasoning_level || 'effort unknown'} / input ${item.input_tokens ?? 'unknown'} / output ${item.output_tokens ?? 'unknown'} / cached ${item.cached_input_tokens ?? 'unknown'} / human messages ${item.human_message_count ?? 'unknown'} / aborted ${item.aborted_turn_count ?? 'unknown'} / work outcome ${item.work_outcome || 'unknown'} / `), github);
      list.append(row);
    }
    host.append(list);
    host.append(list);
    host.querySelector('.development-metrics-return')?.remove();
    const nodes = Array.from(host.children);
    const titleIndex = nodes.findIndex(node => node.tag === 'h2' || node.tagName?.toLowerCase() === 'h2');
    const title = nodes[titleIndex];
    const supportingDetails = nodes.slice(titleIndex + 2);
    const dashboard = document.createElement('div');
    dashboard.className = 'development-metrics-dashboard';
    const addCard = (label, value, detail) => {
      const card = document.createElement('section');
      card.className = 'development-metrics-card';
      const name = document.createElement('h3'); name.textContent = label;
      const number = document.createElement('strong'); number.textContent = value;
      const note = document.createElement('p'); note.textContent = detail;
      card.append(name, number, note); dashboard.append(card);
    };
    const unknown = 'unknown';
    const sessionCount = totals.sessions ?? unknown;
    const collectionText = nodes.find(node => node.textContent?.startsWith('最終収集'))?.textContent || '収集状態 unknown';
    const githubRate = Number.isFinite(totals.github_linked_rate)
      ? `${Math.round(totals.github_linked_rate * 100)}%` : unknown;
    const observedTime = totals.observed_span_ms == null ? unknown : `${Math.round(totals.observed_span_ms / 60000)}分`;
    addCard('Codexセッション', `${sessionCount}件`, `観測時間 ${observedTime} · ${collectionText}`);
    addCard('成果紐付けセッション', `${totals.github_linked_sessions ?? unknown} / ${sessionCount}`,
      `紐付け率 ${githubRate} · complete ${outcomes.complete ?? unknown} / incomplete ${outcomes.incomplete ?? unknown} / failed ${outcomes.failed ?? unknown} / unknown ${outcomes.unknown ?? unknown}`);
    addCard('Codex利用量', `入力 ${totals.input_tokens ?? unknown}`,
      `出力 ${totals.output_tokens ?? unknown} · cached input ${totals.cached_input_tokens ?? unknown}（入力の内数）`);
    if (value.schema_version === 'kaz-development-metrics-view-0.4') {
      const taskOutcomes = totals.task_outcomes || {};
      addCard('GitHub識別タスク', `${totals.tasks ?? unknown}件`,
        `complete ${taskOutcomes.complete ?? unknown} / incomplete ${taskOutcomes.incomplete ?? unknown} / failed ${taskOutcomes.failed ?? unknown} / unknown ${taskOutcomes.unknown ?? unknown}`);
    }
    const disclosure = document.createElement('details');
    disclosure.className = 'development-metrics-details';
    const disclosureTitle = document.createElement('summary');
    disclosureTitle.textContent = '集計について・詳細データ';
    disclosure.appendChild(disclosureTitle);
    supportingDetails.forEach(node => disclosure.appendChild(node));
    host.replaceChildren(title, dashboard, disclosure);
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
    developmentMetricsApi = event.detail?.kazOsDevelopmentMetricsApi || null;
    aiEngineApi = event.detail?.kazOsAiEngineApi || null;
    aiObservationApi = event.detail?.kazOsAiObservationApi || null;
    inboxAnswerApi = event.detail?.kazOsInboxAnswerApi || null;
    v3DashboardApi = event.detail?.kazOsV3DashboardApi || null;
    v3InboxApi = event.detail?.kazOsV3InboxApi || null;
    const previewLink = byId('kazOsV3PreviewLink');
    if (previewLink) previewLink.hidden = !allowed() || !globalThis.PALURU_KAZ_OS_V3_PREVIEW_ENABLED;
    const metricsLink = byId('kazOsDevelopmentMetricsLink');
    if (metricsLink) metricsLink.hidden = !allowed();
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
    developmentMetricsApi = null;
    aiEngineApi = null;
    aiObservationApi = null;
    inboxAnswerApi = null;
    v3DashboardApi = null;
    v3InboxApi = null;
    const previewLink = byId('kazOsV3PreviewLink');
    if (previewLink) previewLink.hidden = true;
    const metricsLink = byId('kazOsDevelopmentMetricsLink');
    if (metricsLink) metricsLink.hidden = true;
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
    if (!globalThis.PALURU_KAZ_OS_V3_PREVIEW_ENABLED) return;
    if (!/^#kaz-os\/v3(?:\/|$)/.test(location.hash)) return;
    const anchor = event.target.closest?.('a[href^="#kaz-os/"]');
    if (!anchor || !byId('kazOsView').contains(anchor)) return;
    const path = anchor.getAttribute('href').slice('#kaz-os/'.length);
    if (!/^(today|work|projects|capa|context|metrics|inbox)(?:\/[^/]+)?$/.test(path)) return;
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
