/* Issue #240 harness driver. Fixture-only: no network, no storage writes except what navigation.js already does
   (sessionStorage return route). Review/observation write APIs are stubs that never persist. */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const scenario = KazUi240Fixtures.scenarios.includes(params.get('scenario')) ? params.get('scenario') : 'normal';
  const view = params.get('view') === 'progress' ? 'progress' : 'kaz';
  const read = key => async () => {
    if (scenario === 'loading') return new Promise(() => {});
    await new Promise(resolve => setTimeout(resolve, 30));
    const value = KazUi240Fixtures.build(scenario, Date.now())[key];
    if (value && value.__error) throw Object.assign(new Error(value.__error), { code: value.__error });
    return JSON.parse(JSON.stringify(value));
  };
  const refuse = code => async () => { throw Object.assign(new Error(code), { code }); };

  // Scenario / view switcher.
  const select = document.getElementById('harnessScenario');
  for (const name of KazUi240Fixtures.scenarios) {
    const option = document.createElement('option'); option.value = name; option.textContent = name;
    select.append(option);
  }
  select.value = scenario;
  select.addEventListener('change', () => {
    const next = new URLSearchParams(location.search); next.set('scenario', select.value);
    location.search = next.toString();
  });
  document.getElementById('harnessView').textContent = view === 'progress' ? 'Kaz OSへ' : 'Progress診断へ';
  document.getElementById('harnessView').addEventListener('click', () => {
    const next = new URLSearchParams(location.search);
    if (view === 'progress') next.delete('view'); else next.set('view', 'progress');
    location.search = next.toString();
  });

  document.body.dataset.harnessView = view;
  document.getElementById('kazOsView').classList.toggle('is-active', view === 'kaz');
  document.getElementById('kazOsDiagnostics').hidden = view !== 'progress';

  // navigation.js asks the app shell to open the view; the harness shell answers.
  document.addEventListener('paruru:view-request', () => {
    if (view === 'kaz') document.dispatchEvent(new CustomEvent('kaz-os:opened', { detail: {} }));
  });

  document.dispatchEvent(new CustomEvent('paruru:authenticated', { detail: {
    context: { role: 'admin', allowedViews: ['kaz-os'] },
    kazOsV3DashboardApi: read('snapshot'),
    kazOsTodayApi: read('plan'),
    kazOsContextApi: read('context'),
    kazOsDevelopmentMetricsApi: read('metrics'),
    kazOsAutonomousWorkApi: read('autonomous'),
    kazOsAutonomousReviewApi: refuse('HARNESS_WRITE_DISABLED'),
    kazOsAiEngineApi: async () => ({ judgments: [] }),
    kazOsAiProgressStatusApi: async () => ({ status: 'not_recorded' }),
    kazOsAiObservationApi: refuse('HARNESS_WRITE_DISABLED'),
    kazOsInboxAnswerApi: null,
    kazOsProgressApi: read('progress'),
  } }));

  if (view === 'progress') document.dispatchEvent(new CustomEvent('kaz-os:diagnostics-opened'));
  else {
    if (!/^#kaz-os\//.test(location.hash)) location.hash = '#kaz-os/today';
    else document.dispatchEvent(new CustomEvent('kaz-os:opened', { detail: {} }));
  }

  // ---- Self check: results are pasted back to the reviewer as JSON. ----
  function describe(node) {
    const id = node.id ? '#' + node.id : '';
    const cls = typeof node.className === 'string' && node.className ? '.' + node.className.trim().split(/\s+/).join('.') : '';
    return node.tagName.toLowerCase() + id + cls;
  }
  function check() {
    const content = view === 'progress' ? document.getElementById('kazOsContent') : document.getElementById('kazPersonalContent');
    const width = document.documentElement.clientWidth;
    const offenders = [];
    for (const node of content.querySelectorAll('*')) {
      const box = node.getBoundingClientRect();
      if (box.width === 0) continue;
      if (box.right > width + 1 || box.left < -1) {
        if (node.closest('.development-metrics-table-wrap') && !node.classList.contains('development-metrics-table-wrap')) continue;
        offenders.push({ el: describe(node), left: Math.round(box.left), right: Math.round(box.right) });
      }
    }
    const briefs = [...content.querySelectorAll('dl.kp-brief')].map(dl =>
      [...dl.querySelectorAll(':scope > dt')].map(dt => dt.textContent));
    const order = ['今日の判断', '理由・影響', '対応証拠', '次担当'];
    const text = content.innerText || '';
    const heldWithBigValue = [...content.querySelectorAll('.development-metrics-card[data-metric-verdict="hold"] strong')]
      .filter(s => /%|秒|分/.test(s.textContent)).length;
    const bigHundred = [...content.querySelectorAll('.development-productivity .development-metrics-dashboard strong')]
      .filter(s => s.textContent.trim() === '100%' && s.closest('[data-metric-verdict]')?.dataset.metricVerdict !== 'complete').length;
    // "FAILED" shown without a Japanese label (allowed: "失敗（FAILED）" and code suffixes like X_FAILED).
    const bareFailed = (text.match(/(^|[^（A-Za-z_])FAILED/g) || []).length;
    const aiActiveWithoutRun = [...content.querySelectorAll('*')].filter(n => n.children.length === 0
      && /AI対応中|AI実行中/.test(n.textContent) && !/Run [0-9a-f]{6,}|AI対応中とは扱|AI対応中とは扱いません/.test(n.textContent)).length;
    const nav = document.getElementById('harnessBottomNav').getBoundingClientRect();
    const fixedTall = [...content.querySelectorAll('*')].filter(n => {
      const s = getComputedStyle(n);
      return /px$/.test(s.height) && n.style.height && parseFloat(s.height) > 200;
    }).length;
    const result = {
      scenario, view, route: location.hash, viewport: width, buildId: globalThis.BUILD_ID || null,
      documentScrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > width + 1,
      offenders: offenders.slice(0, 8), offenderCount: offenders.length,
      briefCount: briefs.length,
      briefOrderOk: briefs.every(dts => dts.every((dt, i) => dt === order.filter(o => dts.includes(o))[i])),
      briefLabels: briefs.map(d => d.join('>')),
      unobservedCount: (text.match(/未観測/g) || []).length,
      trueZeroCount: (text.match(/真の0/g) || []).length,
      heldMetricCards: content.querySelectorAll('[data-metric-verdict="hold"]').length,
      heldWithBigValue, bigHundredOnIncomplete: bigHundred,
      bareFailedCount: bareFailed,
      aiActiveWithoutRun,
      contextPopulations: [...content.querySelectorAll('[data-context-population]')].map(n => n.dataset.contextPopulation),
      periodSelect: (() => { const s = content.querySelector('.development-productivity select'); return s ? s.value : null; })(),
      contentBottomPadding: getComputedStyle(content).paddingBottom,
      bottomNavTop: Math.round(nav.top), fixedTallElements: fixedTall,
      scrollHeight: document.documentElement.scrollHeight,
    };
    document.getElementById('harnessResult').textContent = JSON.stringify(result, null, 2);
    return result;
  }
  globalThis.KazUi240Check = check;
  document.getElementById('harnessCheck').addEventListener('click', check);
})();
