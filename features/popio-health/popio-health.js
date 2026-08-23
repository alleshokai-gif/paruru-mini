(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PALURUPopioHealth = api;
  if (typeof document !== 'undefined' && document.addEventListener) api.install(document);
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const PET_ID = 'popio';
  const TOKYO_TIME_ZONE = 'Asia/Tokyo';
  const RECENT_EVENT_DAYS = 7;
  const OBSERVATION_PERIODS = Object.freeze([7, 30]);
  const REMINDER_HOURS = Object.freeze({ breakfast: 10, dinner: 22 });
  const PET_HEALTH_READ_ACTIONS = Object.freeze({ 'pet.health.getDailySummary': true, 'pet.health.listRecentEvents': true, 'pet.health.getDashboard': true });
  const FLAG_ORDER = Object.freeze(['vomiting', 'sneeze_cough', 'pain_behavior']);
  const state = {
    authContext: null,
    petHealthApi: null,
    summary: null,
    summaryStatus: 'idle',
    recentEvents: [],
    recentStatus: 'idle',
    dashboard: null,
    dashboardStatus: 'idle',
    dashboardFresh: false,
    dashboardCache: null,
    observationPeriod: 7,
    historyExpanded: false,
    observationExpanded: false,
    mounted: false,
  };
  let saveFlow_ = null;
  let dashboardLoad_ = null;

  function install(doc) {
    doc.addEventListener('DOMContentLoaded', mount_);
    doc.addEventListener('paruru:authenticated', function (event) {
      const detail = event && event.detail || {};
      state.authContext = detail.context || null;
      state.petHealthApi = typeof detail.petHealthApi === 'function' ? detail.petHealthApi : null;
      state.dashboardCache = detail.petHealthDashboardCache && typeof detail.petHealthDashboardCache.load === 'function' && typeof detail.petHealthDashboardCache.save === 'function' ? detail.petHealthDashboardCache : null;
    });
    doc.addEventListener('popio-health:opened', open_);
  }

  function mount_() {
    if (state.mounted) return;
    const mount = document.querySelector('#popioHealthMount');
    if (!mount) return;
    const root = document.createElement('section');
    root.id = 'popioHealthRoot';
    root.className = 'popio-health';
    root.innerHTML = `
      <header class="popio-health-header">
        <div><p class="popio-health-eyebrow">Pet Health</p><h1>🐶 ぽぴお</h1></div>
        <p id="popioHealthDate" class="popio-health-date"></p>
      </header>
      <div class="popio-health-status-row"><p id="popioHealthStatus" class="popio-health-status" role="status" aria-live="polite"></p><button id="popioDashboardReload" type="button" hidden>再読み込み</button></div>
      <section class="popio-reminder-card" aria-labelledby="popioReminderTitle">
        <h2 id="popioReminderTitle">⚠️ 今日の記録</h2>
        <p id="popioReminderStatus" class="popio-reminder-status"></p>
        <div id="popioReminderList" class="popio-reminder-list"></div>
      </section>
      <section class="popio-summary-card" aria-label="今日のまとめ">
        <div><span>🍚 ごはん</span><strong id="popioSummaryMeal">--</strong></div>
        <div class="popio-summary-water"><span>💧 水</span><strong id="popioSummaryWater">--</strong><small id="popioSummaryWaterHint"></small></div>
        <div><span>💩 うんち</span><strong id="popioSummaryStool">--</strong></div>
        <div><span>⚖️ 体重</span><strong id="popioSummaryWeight">--</strong></div>
      </section>
      <div class="popio-record-list">
        ${mealForm_()}
        ${stoolForm_()}
        ${waterBottleForm_()}
        ${urineForm_()}
        ${weightForm_()}
        ${observationForm_()}
      </div>
      <section class="popio-history-card" aria-labelledby="popioHistoryToggle">
        <button id="popioHistoryToggle" class="popio-section-toggle" type="button" data-popio-section-toggle="history" aria-controls="popioHistoryContent" aria-expanded="false"><span class="popio-section-toggle-label">📋 最近の記録</span><span class="popio-section-toggle-chevron" data-popio-section-chevron="history" aria-hidden="true">▼</span></button>
        <div id="popioHistoryContent" class="popio-collapsible-content" hidden>
          <p id="popioHistoryStatus" class="popio-history-status" role="status" aria-live="polite"></p>
          <div id="popioHistoryList" class="popio-history-list"></div>
        </div>
      </section>
      <section class="popio-observation-card" aria-labelledby="popioObservationToggle">
        <button id="popioObservationToggle" class="popio-section-toggle" type="button" data-popio-section-toggle="observation" aria-controls="popioObservationContent" aria-expanded="false"><span class="popio-section-toggle-label">📈 観察</span><span class="popio-section-toggle-chevron" data-popio-section-chevron="observation" aria-hidden="true">▼</span></button>
        <div id="popioObservationContent" class="popio-collapsible-content" hidden>
          <div class="popio-observation-periods" role="group" aria-label="表示期間"><button type="button" data-popio-observation-period="7" aria-pressed="true">7日</button><button type="button" data-popio-observation-period="30" aria-pressed="false">30日</button></div>
          <p id="popioObservationStatus" class="popio-observation-status" role="status" aria-live="polite"></p>
          <section class="popio-trend-card"><h3>⚖️ 体重</h3><div id="popioWeightTrend" class="popio-weight-trend"></div></section>
          <section class="popio-trend-card"><h3>🍚 食事量</h3><div id="popioMealTrend" class="popio-trend-list"></div></section>
          <section class="popio-trend-card"><h3>💩 うんち</h3><div id="popioStoolTrend" class="popio-trend-list"></div></section>
        </div>
      </section>`;
    mount.append(root);
    root.addEventListener('submit', submitRecord_);
    root.addEventListener('input', handleContentChanged_);
    root.addEventListener('change', handleContentChanged_);
    root.addEventListener('click', handleTimestampClick_);
    state.mounted = true;
    initializeTimestampControls_(root);
    renderDate_();
    renderSummary_();
    renderRecentEvents_();
    renderObservation_();
    renderCollapsibleSections_();
  }

  function mealForm_() {
    return `<details class="popio-card" open><summary>🍚 ごはん</summary><form class="popio-record-form" data-event-type="meal">
      <fieldset><legend>タイミング</legend><div class="popio-choice-grid popio-choice-grid-four">
        ${choice_('mealSlot','breakfast','朝',true)}${choice_('mealSlot','lunch','昼')}${choice_('mealSlot','dinner','夜')}${choice_('mealSlot','snack','補食')}
      </div></fieldset>
      <label class="popio-field"><span>量（任意）</span><span class="popio-unit-input"><input name="amountG" type="text" inputmode="decimal" maxlength="6"><em>g</em></span></label>
      <fieldset><legend>食べ方</legend><div class="popio-choice-grid popio-choice-grid-three">
        ${choice_('completion','finished','完食',true)}${choice_('completion','partial','一部食べた')}${choice_('completion','refused','食べなかった')}
      </div></fieldset>
      ${note_()}${timestampControl_()}${submit_()}
    </form></details>`;
  }

  function stoolForm_() {
    return `<details class="popio-card" open><summary>💩 うんち</summary><form class="popio-record-form" data-event-type="stool">
      <fieldset><legend>かたさ（任意）</legend><div class="popio-choice-grid popio-choice-grid-five">
        ${choice_('stoolForm','pellet','コロコロ')}${choice_('stoolForm','formed','形あり')}${choice_('stoolForm','banana','バナナ')}${choice_('stoolForm','soft','やわらかい')}${choice_('stoolForm','watery','水様')}
      </div></fieldset>
      <fieldset><legend>量（任意）</legend><div class="popio-choice-grid popio-choice-grid-three">
        ${choice_('stoolAmount','small','少')}${choice_('stoolAmount','normal','普通')}${choice_('stoolAmount','large','多')}
      </div></fieldset>
      <label class="popio-check"><input name="coprophagy" type="checkbox"><span>食糞あり</span></label>
      ${note_()}${timestampControl_()}${submit_()}
    </form></details>`;
  }

  function waterBottleForm_() {
    return `<details class="popio-card"><summary>💧 水ボトル</summary><form class="popio-record-form" data-event-type="water_bottle">
      <p class="popio-water-bottle-state" data-popio-water-bottle-state>前回の記録を読み込み中…</p>
      <section class="popio-water-bottle-previous" data-popio-water-bottle-previous hidden>
        <span>前回</span><strong data-popio-water-bottle-previous-at></strong><strong data-popio-water-bottle-previous-fill></strong>
      </section>
      <label class="popio-field" data-popio-water-bottle-remaining hidden><span>今の残り</span><span class="popio-unit-input"><input name="remainingMl" type="text" inputmode="numeric" maxlength="4"><em>mL</em></span></label>
      <label class="popio-field"><span>交換後のボトル量</span><span class="popio-unit-input"><input name="newFillMl" type="text" inputmode="numeric" maxlength="4" required><em>mL</em></span></label>
      <section class="popio-water-bottle-preview" data-popio-water-bottle-preview hidden aria-live="polite"></section>
      <button class="popio-water-bottle-reload" type="button" data-popio-water-bottle-reload hidden>再読み込み</button>
      ${note_()}${timestampControl_()}${submit_('セットを記録')}
    </form></details>`;
  }

  function urineForm_() {
    return `<details class="popio-card"><summary>🚽 おしっこ</summary><form class="popio-record-form" data-event-type="urine">
      <fieldset><legend>様子（任意）</legend><div class="popio-choice-grid popio-choice-grid-three">
        ${choice_('urineStatus','','記録だけ',true)}${choice_('urineStatus','normal','いつもどおり')}${choice_('urineStatus','concern','気になる')}
      </div></fieldset>
      ${note_()}${timestampControl_()}${submit_()}
    </form></details>`;
  }

  function weightForm_() {
    return `<details class="popio-card"><summary>⚖️ 体重</summary><form class="popio-record-form" data-event-type="weight">
      <label class="popio-field"><span>体重</span><span class="popio-unit-input"><input name="weightKg" type="text" inputmode="decimal" maxlength="7" required><em>kg</em></span></label>
      ${note_()}${timestampControl_()}${submit_()}
    </form></details>`;
  }

  function observationForm_() {
    return `<details class="popio-card"><summary>👀 体調</summary><form class="popio-record-form" data-event-type="observation">
      <fieldset><legend>元気（任意）</legend><div class="popio-choice-grid popio-choice-grid-three">
        ${choice_('energy','good','元気')}${choice_('energy','normal','普通')}${choice_('energy','low','元気ない')}
      </div></fieldset>
      <fieldset><legend>食欲（任意）</legend><div class="popio-choice-grid popio-choice-grid-three">
        ${choice_('appetite','good','あり')}${choice_('appetite','normal','普通')}${choice_('appetite','low','少ない')}
      </div></fieldset>
      <div class="popio-flag-list" aria-label="気になること">
        ${check_('flags','vomiting','嘔吐')}${check_('flags','sneeze_cough','くしゃみ・咳')}${check_('flags','pain_behavior','痛がる様子')}
      </div>
      ${note_()}${timestampControl_()}${submit_()}
    </form></details>`;
  }

  function choice_(name, value, label, checked) {
    return `<label class="popio-choice"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}><span>${label}</span></label>`;
  }
  function check_(name, value, label) {
    return `<label class="popio-check"><input type="checkbox" name="${name}" value="${value}"><span>${label}</span></label>`;
  }
  function note_() {
    return '<label class="popio-field"><span>メモ（任意）</span><textarea name="note" rows="2" maxlength="500"></textarea></label>';
  }
  function timestampControl_() {
    return `<section class="popio-occurred-at" data-popio-occurred-at>
      <input type="hidden" name="occurredAtMode" value="now">
      <div class="popio-occurred-at-summary">
        <span>🕐 記録日時</span><output data-popio-occurred-at-label>いま</output>
        <button type="button" class="popio-occurred-at-toggle" data-popio-timestamp-toggle aria-expanded="false">変更</button>
      </div>
      <div class="popio-occurred-at-panel" data-popio-timestamp-panel hidden>
        <label class="popio-field"><span>日付</span><select name="occurredAtDate" data-popio-timestamp-input><option value="today">今日</option><option value="yesterday">昨日</option><option value="custom">日付を選ぶ</option></select></label>
        <label class="popio-field"><span>時間</span><select name="occurredAtHour" data-popio-timestamp-input>${timestampHourOptions_()}</select></label>
        <label class="popio-field" data-popio-custom-date hidden><span>日付を選ぶ</span><input name="occurredAtCustomDate" type="date" data-popio-timestamp-input></label>
        <button type="button" class="popio-occurred-at-reset" data-popio-timestamp-reset>いまに戻す</button>
      </div>
    </section>`;
  }
  function timestampHourOptions_() {
    return Array.from({ length: 24 }, function (_, hour) { return '<option value="' + hour + '">' + hour + '時</option>'; }).join('');
  }
  function submit_(label) {
    return '<button class="popio-submit" type="submit">' + String(label || '記録する') + '</button><div class="popio-correction-actions" data-popio-correction-actions hidden><button type="button" data-popio-void>記録を取り消す</button><button type="button" data-popio-correction-cancel>キャンセル</button></div><p class="popio-form-status" data-popio-form-status role="status" aria-live="polite"></p>';
  }

  function formValues_(form) {
    const data = new FormData(form);
    const values = {};
    data.forEach(function (value, key) { if (key !== 'flags') values[key] = value; });
    values.flags = data.getAll('flags');
    values.coprophagy = data.has('coprophagy');
    return values;
  }

  function buildEventPayload_(eventType, values, now) {
    const input = values && typeof values === 'object' ? values : {};
    const event = { eventType: String(eventType || '') };
    if (event.eventType === 'meal') {
      event.mealSlot = requiredEnum_(input.mealSlot, ['breakfast','lunch','dinner','snack'], 'ごはんのタイミング');
      event.completion = requiredEnum_(input.completion, ['finished','partial','refused'], '食べ方');
      const amount = decimal_(input.amountG, '量', 1, true);
      if (amount !== null) event.amountG = amount;
      if (event.completion === 'refused' && amount !== null && amount !== 0) throw inputError_('食べなかった場合、量は空欄か0にしてください');
      if (event.completion !== 'refused' && amount !== null && amount <= 0) throw inputError_('食べた量は0より大きくしてください');
    } else if (event.eventType === 'water') {
      event.amountMl = integer_(input.amountMl, '飲んだ量', 1, 10000);
    } else if (event.eventType === 'water_bottle') {
      event.newFillMl = integer_(input.newFillMl, '交換後のボトル量', 1, 5000);
      const remaining = optionalInteger_(input.remainingMl, '今の残り', 0, 5000);
      if (remaining !== null) event.remainingMl = remaining;
    } else if (event.eventType === 'stool') {
      optionalEnum_(event, 'stoolForm', input.stoolForm, ['pellet','formed','banana','soft','watery']);
      optionalEnum_(event, 'stoolAmount', input.stoolAmount, ['small','normal','large']);
      if (input.coprophagy === true) event.coprophagy = true;
    } else if (event.eventType === 'urine') {
      optionalEnum_(event, 'urineStatus', input.urineStatus, ['normal','concern']);
    } else if (event.eventType === 'weight') {
      event.weightKg = rangedDecimal_(input.weightKg, '体重', 3, 0.1, 200);
    } else if (event.eventType === 'observation') {
      optionalEnum_(event, 'energy', input.energy, ['good','normal','low']);
      optionalEnum_(event, 'appetite', input.appetite, ['good','normal','low']);
      const flags = normalizeFlags_(input.flags);
      if (flags.length) event.flags = flags;
    } else {
      throw inputError_('記録の種類を確認できませんでした');
    }
    const occurredAt = buildOccurredAt_(input, now);
    if (occurredAt) event.occurredAt = occurredAt;
    const note = String(input.note || '').normalize('NFC').trim();
    if (note) event.note = note;
    if (event.eventType === 'observation' && !event.energy && !event.appetite && !event.flags && !event.note) {
      throw inputError_('体調を1つ以上入力してください');
    }
    return event;
  }

  function requiredEnum_(value, allowed, label) {
    const normalized = String(value || '');
    if (!allowed.includes(normalized)) throw inputError_(label + 'を選んでください');
    return normalized;
  }
  function optionalEnum_(target, key, value, allowed) {
    const normalized = String(value || '');
    if (!normalized) return;
    if (!allowed.includes(normalized)) throw inputError_('入力内容を確認してください');
    target[key] = normalized;
  }
  function normalizeFlags_(value) {
    const values = Array.isArray(value) ? value.map(String) : [];
    if (values.some(function (flag) { return !FLAG_ORDER.includes(flag); })) throw inputError_('体調フラグを確認してください');
    return FLAG_ORDER.filter(function (flag) { return values.includes(flag); });
  }
  function decimal_(value, label, decimals, optional) {
    const raw = String(value === undefined || value === null ? '' : value).trim();
    if (!raw && optional) return null;
    if (!new RegExp('^(?:0|[1-9]\\d*)(?:\\.\\d{1,' + decimals + '})?$').test(raw)) throw inputError_(label + 'を数字で入力してください');
    const number = Number(raw);
    if (!Number.isFinite(number)) throw inputError_(label + 'を数字で入力してください');
    return Object.is(number, -0) ? 0 : number;
  }
  function rangedDecimal_(value, label, decimals, min, max) {
    const number = decimal_(value, label, decimals, false);
    if (number < min || number > max) throw inputError_(label + 'を確認してください');
    return number;
  }
  function integer_(value, label, min, max) {
    const raw = String(value === undefined || value === null ? '' : value).trim();
    if (!/^\d+$/.test(raw)) throw inputError_(label + 'を整数で入力してください');
    const number = Number(raw);
    if (!Number.isSafeInteger(number) || number < min || number > max) throw inputError_(label + 'を確認してください');
    return number;
  }
  function optionalInteger_(value, label, min, max) {
    const raw = String(value === undefined || value === null ? '' : value).trim();
    if (!raw) return null;
    return integer_(raw, label, min, max);
  }
  function inputError_(message) { const error = new Error(message); error.code = 'INVALID_INPUT'; return error; }

  function buildOccurredAt_(values, now) {
    const input = values && typeof values === 'object' ? values : {};
    if (String(input.occurredAtMode || 'now') !== 'explicit') return '';
    const current = validDate_(now);
    const today = tokyoDate_(current);
    const dateMode = String(input.occurredAtDate || '');
    let localDate = '';
    if (dateMode === 'today') localDate = today;
    else if (dateMode === 'yesterday') localDate = tokyoPreviousDate_(current);
    else if (dateMode === 'custom') {
      localDate = validLocalDate_(input.occurredAtCustomDate);
      if (localDate > today) throw inputError_('未来の時刻は記録できません');
    } else throw inputError_('日付を確認してください');
    const hour = strictHour_(input.occurredAtHour);
    if (localDate === today && hour > tokyoHour_(current)) throw inputError_('未来の時刻は記録できません');
    return localDate + 'T' + String(hour).padStart(2, '0') + ':00:00+09:00';
  }

  function timestampLabel_(values, now) {
    const input = values && typeof values === 'object' ? values : {};
    if (String(input.occurredAtMode || 'now') !== 'explicit') return 'いま';
    const current = validDate_(now);
    const today = tokyoDate_(current);
    const yesterday = tokyoPreviousDate_(current);
    const dateMode = String(input.occurredAtDate || '');
    const localDate = dateMode === 'today' ? today : dateMode === 'yesterday' ? yesterday : dateMode === 'custom' ? String(input.occurredAtCustomDate || '') : '';
    const hour = String(input.occurredAtHour || '');
    if (!/^\d{1,2}$/.test(hour) || Number(hour) < 0 || Number(hour) > 23) return '日時を選ぶ';
    if (localDate === today) return '今日 ' + Number(hour) + '時';
    if (localDate === yesterday) return '昨日 ' + Number(hour) + '時';
    if (/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      const parts = localDate.split('-');
      return Number(parts[1]) + '/' + Number(parts[2]) + ' ' + Number(hour) + '時';
    }
    return '日時を選ぶ';
  }

  function validDate_(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value === undefined ? Date.now() : value);
    if (!Number.isFinite(date.getTime())) throw inputError_('日時を確認してください');
    return date;
  }
  function validLocalDate_(value) {
    const normalized = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw inputError_('日付を確認してください');
    const parts = normalized.split('-').map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) throw inputError_('日付を確認してください');
    return normalized;
  }
  function strictHour_(value) {
    const raw = String(value === undefined || value === null ? '' : value);
    if (!/^\d{1,2}$/.test(raw)) throw inputError_('時間を確認してください');
    const hour = Number(raw);
    if (!Number.isSafeInteger(hour) || hour < 0 || hour > 23) throw inputError_('時間を確認してください');
    return hour;
  }

  function buildRecordRequest_(clientRequestId, event) {
    return { petId: PET_ID, clientRequestId: String(clientRequestId || ''), event: event };
  }
  function buildCorrectionRequest_(clientRequestId, correctionOfEventId, event) {
    return { petId: PET_ID, clientRequestId: String(clientRequestId || ''), correctionOfEventId: String(correctionOfEventId || ''), event: event };
  }
  function buildVoidRequest_(clientRequestId, correctionOfEventId) {
    return { petId: PET_ID, clientRequestId: String(clientRequestId || ''), correctionOfEventId: String(correctionOfEventId || '') };
  }
  function petHealthWriteAction_(write) {
    const action = String(write && write.action || 'pet.health.record');
    if (action !== 'pet.health.record' && action !== 'pet.health.correct' && action !== 'pet.health.void') throw inputError_('記録操作を確認できませんでした');
    return action;
  }
  function buildPetHealthWriteRequest_(clientRequestId, event, write) {
    const action = petHealthWriteAction_(write);
    if (action === 'pet.health.correct') return buildCorrectionRequest_(clientRequestId, write.correctionOfEventId, event);
    if (action === 'pet.health.void') return buildVoidRequest_(clientRequestId, write.correctionOfEventId);
    return buildRecordRequest_(clientRequestId, event);
  }

  function createPetHealthSaveFlow_(deps) {
    const saving = Object.create(null);
    const requests = Object.create(null);
    const createId = deps.createRequestId;
    return {
      async save(formKey, event, write) {
        const key = String(formKey || '');
        if (saving[key]) return { skipped: true, saved: false };
        const action = petHealthWriteAction_(write);
        const fingerprint = JSON.stringify({ action: action, correctionOfEventId: write && write.correctionOfEventId || '', event: event || {} });
        if (!requests[key] || requests[key].fingerprint !== fingerprint) {
          requests[key] = { id: createId(), fingerprint: fingerprint };
        }
        const request = buildPetHealthWriteRequest_(requests[key].id, event, write);
        saving[key] = true;
        if (deps.onSaving) deps.onSaving(key, request);
        try {
          if (deps.isOnline && !deps.isOnline()) { const error = new Error('OFFLINE'); error.code = 'OFFLINE'; throw error; }
          const data = await deps.call(request, action);
          delete requests[key];
          const postSave = deps.onSuccess ? await deps.onSuccess(key, data, request, action) : null;
          if (deps.onSaved) deps.onSaved(key, data, postSave, request, action);
          return { skipped: false, saved: true, data: data, postSave: postSave };
        } catch (error) {
          if (deps.onFailure) deps.onFailure(key, error, request);
          return { skipped: false, saved: false, error: error };
        } finally {
          saving[key] = false;
          if (deps.onSettled) deps.onSettled(key);
        }
      },
      contentChanged(formKey) { const key = String(formKey || ''); if (!saving[key]) delete requests[key]; },
      isSaving(formKey) { return Boolean(saving[String(formKey || '')]); },
      requestId(formKey) { const item = requests[String(formKey || '')]; return item ? item.id : ''; },
    };
  }

  function ensureSaveFlow_() {
    if (saveFlow_) return saveFlow_;
    saveFlow_ = createPetHealthSaveFlow_({
      createRequestId: createUuid_,
      isOnline: function () { return typeof navigator === 'undefined' || navigator.onLine !== false; },
      call: function (request, action) { return call_(action, request); },
      onSaving: function (key) { setFormSaving_(key, true); setFormStatus_(key, '保存中…'); },
      onSuccess: async function (key) {
        const form = form_(key);
        if (form) { form.reset(); resetTimestampControl_(form); exitCorrectionMode_(form); }
        const refreshed = await loadDashboard_({ quiet: true });
        return { writeSaved: true, dashboardRefreshed: refreshed, summaryRefreshed: refreshed, recentRefreshed: refreshed };
      },
      onSaved: function (key, _data, postSave, _request, action) { setFormStatus_(key, savedStatusMessage_(postSave, action)); },
      onFailure: function (key, error) { setFormStatus_(key, error && error.code === 'OFFLINE' ? 'オフライン中。未保存です。入力は残しています。' : '保存できませんでした。入力は残しています。'); },
      onSettled: function (key) {
        setFormSaving_(key, false);
        if (key === 'water_bottle') renderWaterBottle_();
      },
    });
    return saveFlow_;
  }

  async function submitRecord_(event) {
    const form = event.target && event.target.closest ? event.target.closest('.popio-record-form') : null;
    if (!form) return;
    event.preventDefault();
    const key = String(form.dataset.eventType || '');
    if (ensureSaveFlow_().isSaving(key)) return;
    const correctionOfEventId = String(form.dataset.correctionOfEventId || '');
    let payload;
    try {
      payload = buildEventPayload_(key, formValues_(form));
      if (key === 'water_bottle' && !correctionOfEventId) validateWaterBottleForm_(form, payload);
    }
    catch (error) { setFormStatus_(key, String(error && error.message || '入力内容を確認してください')); return; }
    await ensureSaveFlow_().save(key, payload, correctionOfEventId ? { action: 'pet.health.correct', correctionOfEventId: correctionOfEventId } : null);
  }

  function handleContentChanged_(event) {
    const form = event.target && event.target.closest ? event.target.closest('.popio-record-form') : null;
    if (!form) return;
    if (event.target && event.target.matches && event.target.matches('[data-popio-timestamp-input]')) {
      const mode = form.querySelector('[name="occurredAtMode"]');
      if (mode) mode.value = 'explicit';
      updateCustomDateVisibility_(form);
      updateTimestampLabel_(form);
    }
    if (String(form.dataset.eventType || '') === 'water_bottle') updateWaterBottlePreview_(form);
    ensureSaveFlow_().contentChanged(String(form.dataset.eventType || ''));
    setFormStatus_(String(form.dataset.eventType || ''), '');
  }

  function collapsibleSectionState_(current, section) {
    const next = { historyExpanded: Boolean(current && current.historyExpanded), observationExpanded: Boolean(current && current.observationExpanded) };
    if (section === 'history') next.historyExpanded = !next.historyExpanded;
    if (section === 'observation') next.observationExpanded = !next.observationExpanded;
    return next;
  }
  function toggleCollapsibleSection_(section) {
    Object.assign(state, collapsibleSectionState_(state, section));
    renderCollapsibleSections_();
  }
  function renderCollapsibleSections_() {
    [
      { key: 'history', expanded: state.historyExpanded, buttonId: 'popioHistoryToggle', contentId: 'popioHistoryContent' },
      { key: 'observation', expanded: state.observationExpanded, buttonId: 'popioObservationToggle', contentId: 'popioObservationContent' },
    ].forEach(function (section) {
      const button = document.getElementById(section.buttonId), content = document.getElementById(section.contentId), chevron = document.querySelector('[data-popio-section-chevron="' + section.key + '"]');
      if (button) button.setAttribute('aria-expanded', String(section.expanded));
      if (content) content.hidden = !section.expanded;
      if (chevron) chevron.textContent = section.expanded ? '▲' : '▼';
    });
  }

  function handleTimestampClick_(event) {
    const sectionToggle = event.target && event.target.closest ? event.target.closest('[data-popio-section-toggle]') : null;
    if (sectionToggle) {
      event.preventDefault();
      toggleCollapsibleSection_(sectionToggle.dataset.popioSectionToggle);
      return;
    }
    const observationPeriod = event.target && event.target.closest ? event.target.closest('[data-popio-observation-period]') : null;
    if (observationPeriod) {
      event.preventDefault();
      state.observationPeriod = observationPeriod_(observationPeriod.dataset.popioObservationPeriod);
      renderObservation_();
      return;
    }
    const correction = event.target && event.target.closest ? event.target.closest('[data-popio-correction-event-id]') : null;
    if (correction) {
      event.preventDefault();
      startCorrection_(String(correction.dataset.popioCorrectionEventId || ''));
      return;
    }
    const cancelCorrection = event.target && event.target.closest ? event.target.closest('[data-popio-correction-cancel]') : null;
    if (cancelCorrection) {
      event.preventDefault();
      const form = cancelCorrection.closest('.popio-record-form');
      if (form) { form.reset(); resetTimestampControl_(form); exitCorrectionMode_(form); if (form.dataset.eventType === 'water_bottle') renderWaterBottle_(); ensureSaveFlow_().contentChanged(String(form.dataset.eventType || '')); setFormStatus_(String(form.dataset.eventType || ''), ''); }
      return;
    }
    const voidButton = event.target && event.target.closest ? event.target.closest('[data-popio-void]') : null;
    if (voidButton) {
      event.preventDefault();
      const form = voidButton.closest('.popio-record-form'), key = String(form && form.dataset.eventType || ''), correctionOfEventId = String(form && form.dataset.correctionOfEventId || '');
      if (!form || !key || !correctionOfEventId || ensureSaveFlow_().isSaving(key)) return;
      if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('この記録を取り消しますか？')) return;
      void ensureSaveFlow_().save(key, null, { action: 'pet.health.void', correctionOfEventId: correctionOfEventId });
      return;
    }
    const shortcut = event.target && event.target.closest ? event.target.closest('[data-popio-reminder-slot]') : null;
    if (shortcut) {
      event.preventDefault();
      if (applyMealReminderShortcut_(document, shortcut.dataset.popioReminderSlot)) {
        ensureSaveFlow_().contentChanged('meal');
        setFormStatus_('meal', '');
      }
      return;
    }
    const reload = event.target && event.target.closest ? event.target.closest('[data-popio-water-bottle-reload]') : null;
    if (reload) {
      event.preventDefault();
      if (!reload.disabled) void reloadWaterBottleSummary_();
      return;
    }
    const dashboardReload = event.target && event.target.closest ? event.target.closest('#popioDashboardReload') : null;
    if (dashboardReload) {
      event.preventDefault();
      if (!dashboardReload.disabled) void loadDashboard_();
      return;
    }
    const toggle = event.target && event.target.closest ? event.target.closest('[data-popio-timestamp-toggle]') : null;
    if (toggle) {
      const form = toggle.closest('.popio-record-form');
      const panel = form && form.querySelector('[data-popio-timestamp-panel]');
      if (!form || !panel) return;
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      return;
    }
    const reset = event.target && event.target.closest ? event.target.closest('[data-popio-timestamp-reset]') : null;
    if (!reset) return;
    const form = reset.closest('.popio-record-form');
    if (!form) return;
    resetTimestampControl_(form);
    ensureSaveFlow_().contentChanged(String(form.dataset.eventType || ''));
    setFormStatus_(String(form.dataset.eventType || ''), '');
  }

  function applyMealReminderShortcut_(root, slot) {
    if (!root || ['breakfast', 'dinner'].indexOf(slot) < 0) return false;
    const form = root.querySelector('.popio-record-form[data-event-type="meal"]');
    const input = form && form.querySelector('[name="mealSlot"][value="' + slot + '"]');
    if (!form || !input) return false;
    const details = form.closest('details');
    if (details) details.open = true;
    input.checked = true;
    if (details && typeof details.scrollIntoView === 'function') details.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (typeof input.focus === 'function') input.focus();
    return true;
  }

  function setCorrectionValue_(form, name, value) {
    if (!form) return;
    if (name === 'flags') {
      const selected = Array.isArray(value) ? value.map(String) : [];
      form.querySelectorAll('[name="flags"]').forEach(function (input) { input.checked = selected.includes(String(input.value)); });
      return;
    }
    if (name === 'coprophagy') { const input = form.querySelector('[name="coprophagy"]'); if (input) input.checked = value === true; return; }
    const radio = form.querySelector('[name="' + name + '"][value="' + String(value) + '"]');
    if (radio && radio.type === 'radio') { radio.checked = true; return; }
    const input = form.querySelector('[name="' + name + '"]');
    if (input) input.value = value === undefined || value === null ? '' : String(value);
  }
  function setCorrectionOccurredAt_(form, occurredAt) {
    const date = new Date(String(occurredAt || ''));
    if (!Number.isFinite(date.getTime())) return false;
    const mode = form.querySelector('[name="occurredAtMode"]'), dateInput = form.querySelector('[name="occurredAtDate"]'), hour = form.querySelector('[name="occurredAtHour"]'), custom = form.querySelector('[name="occurredAtCustomDate"]'), panel = form.querySelector('[data-popio-timestamp-panel]'), toggle = form.querySelector('[data-popio-timestamp-toggle]'), localDate = tokyoDate_(date), today = tokyoDate_(), yesterday = tokyoPreviousDate_();
    if (!mode || !dateInput || !hour) return false;
    mode.value = 'explicit';
    if (localDate === today) dateInput.value = 'today';
    else if (localDate === yesterday) dateInput.value = 'yesterday';
    else { dateInput.value = 'custom'; if (custom) custom.value = localDate; }
    hour.value = String(tokyoHour_(date));
    if (panel) panel.hidden = false;
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    updateCustomDateVisibility_(form); updateTimestampLabel_(form);
    return true;
  }
  function enterCorrectionMode_(form, event) {
    if (!form || !event || !String(event.eventId || '')) return false;
    form.reset(); resetTimestampControl_(form);
    ['mealSlot','amountG','completion','remainingMl','newFillMl','stoolForm','stoolAmount','coprophagy','urineStatus','weightKg','energy','appetite','flags','note'].forEach(function(key){if(petHealthOwn_(event,key))setCorrectionValue_(form,key,event[key]);});
    if (!setCorrectionOccurredAt_(form, event.occurredAt)) return false;
    form.dataset.correctionOfEventId = String(event.eventId);
    const actions = form.querySelector('[data-popio-correction-actions]'), submit = form.querySelector('.popio-submit'), details = form.closest('details');
    if (actions) actions.hidden = false;
    if (submit) submit.textContent = '修正を保存';
    if (details) { details.open = true; if (typeof details.scrollIntoView === 'function') details.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    if (form.dataset.eventType === 'water_bottle') renderWaterBottle_();
    return true;
  }
  function exitCorrectionMode_(form) {
    if (!form) return;
    delete form.dataset.correctionOfEventId;
    const actions = form.querySelector('[data-popio-correction-actions]'), submit = form.querySelector('.popio-submit');
    if (actions) actions.hidden = true;
    if (submit) submit.textContent = form.dataset.eventType === 'water_bottle' ? 'セットを記録' : '記録する';
  }
  function startCorrection_(eventId) {
    const event = state.recentEvents.find(function(item){return String(item && item.eventId || '') === String(eventId || '');});
    if (!event) return false;
    return enterCorrectionMode_(form_(event.eventType), event);
  }

  function initializeTimestampControls_(root) {
    root.querySelectorAll('.popio-record-form').forEach(function (form) {
      const hour = form.querySelector('[name="occurredAtHour"]');
      const customDate = form.querySelector('[name="occurredAtCustomDate"]');
      if (hour) hour.value = String(tokyoHour_());
      if (customDate) customDate.max = tokyoDate_();
      updateCustomDateVisibility_(form);
      updateTimestampLabel_(form);
    });
  }

  function resetTimestampControl_(form) {
    const mode = form.querySelector('[name="occurredAtMode"]');
    const date = form.querySelector('[name="occurredAtDate"]');
    const hour = form.querySelector('[name="occurredAtHour"]');
    const customDate = form.querySelector('[name="occurredAtCustomDate"]');
    const panel = form.querySelector('[data-popio-timestamp-panel]');
    const toggle = form.querySelector('[data-popio-timestamp-toggle]');
    if (mode) mode.value = 'now';
    if (date) date.value = 'today';
    if (hour) hour.value = String(tokyoHour_());
    if (customDate) { customDate.value = ''; customDate.max = tokyoDate_(); }
    if (panel) panel.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    updateCustomDateVisibility_(form);
    updateTimestampLabel_(form);
  }

  function updateCustomDateVisibility_(form) {
    const date = form.querySelector('[name="occurredAtDate"]');
    const custom = form.querySelector('[data-popio-custom-date]');
    if (custom) custom.hidden = !date || date.value !== 'custom';
  }

  function updateTimestampLabel_(form) {
    const label = form.querySelector('[data-popio-occurred-at-label]');
    if (label) label.textContent = timestampLabel_(formValues_(form));
  }

  function waterBottleUiModel_(summary, status, fresh) {
    if (fresh === false && status === 'loaded' && summary && typeof summary === 'object') return { ready: false, canReload: true, message: '最新のボトル状態を確認できないため記録できません' };
    if (status !== 'loaded' || !summary || typeof summary !== 'object') return { ready: false, canReload: status === 'failed', message: status === 'loading' ? '前回の記録を読み込み中…' : '前回の水ボトル記録を読み込めませんでした' };
    const bottle = summary.waterBottle;
    if (!bottle || typeof bottle !== 'object' || !Number.isSafeInteger(Number(bottle.eventCount)) || Number(bottle.eventCount) < 0 || (bottle.latest !== null && (!bottle.latest || typeof bottle.latest !== 'object' || !Number.isSafeInteger(Number(bottle.latest.newFillMl)) || Number(bottle.latest.newFillMl) < 1 || Number(bottle.latest.newFillMl) > 5000 || !Number.isFinite(new Date(String(bottle.latest.occurredAt || '')).getTime())))) {
      return { ready: false, canReload: false, message: '前回の水ボトル記録を読み込めませんでした' };
    }
    if (bottle.latest === null) return { ready: true, canReload: false, hasPrevious: false, message: 'まだ交換記録なし。最初の水量を記録します。', defaultNewFillMl: '', latestInterval: null };
    return {
      ready: true,
      canReload: false,
      hasPrevious: true,
      message: '前回の交換をもとに記録します。',
      previousOccurredAt: String(bottle.latest.occurredAt || ''),
      previousFillMl: Number(bottle.latest.newFillMl),
      defaultNewFillMl: String(Number(bottle.latest.newFillMl)),
      latestInterval: bottle.latestInterval || null,
    };
  }

  function waterBottlePreview_(previous, values, now) {
    if (!previous || !Number.isSafeInteger(Number(previous.newFillMl))) return null;
    const remaining = optionalInteger_(values && values.remainingMl, '今の残り', 0, 5000);
    if (remaining === null) return null;
    if (remaining > Number(previous.newFillMl)) return { error: '今の残りは前回セット量以下で入力してください' };
    let current;
    try {
      const occurredAt = buildOccurredAt_(values || {}, now);
      current = occurredAt ? new Date(occurredAt) : validDate_(now);
    } catch (error) {
      return { error: String(error && error.message || '日時を確認してください') };
    }
    const prior = new Date(String(previous.occurredAt || ''));
    if (!Number.isFinite(prior.getTime()) || current.getTime() <= prior.getTime()) return { error: '前回より後の日時を選んでください' };
    const bottleDecreaseMl = Number(previous.newFillMl) - remaining;
    const elapsedMs = current.getTime() - prior.getTime();
    return { bottleDecreaseMl: bottleDecreaseMl, elapsedHours: Math.round((elapsedMs / 3600000) * 10) / 10, normalized24hMl: Math.round(bottleDecreaseMl / elapsedMs * 86400000), shortInterval: elapsedMs < 6 * 3600000 };
  }

  function validateWaterBottleForm_(form, event) {
    const model = waterBottleUiModel_(state.summary, state.summaryStatus, state.dashboardFresh);
    if (!model.ready) throw inputError_('前回の水ボトル記録を読み込めませんでした');
    if (!model.hasPrevious) {
      if (petHealthOwn_(event, 'remainingMl')) throw inputError_('最初の記録では今の残りを入力しません');
      return;
    }
    if (!petHealthOwn_(event, 'remainingMl')) throw inputError_('今の残りを入力してください');
    if (event.remainingMl > model.previousFillMl) throw inputError_('今の残りは前回セット量以下で入力してください');
    const preview = waterBottlePreview_({ occurredAt: model.previousOccurredAt, newFillMl: model.previousFillMl }, formValues_(form));
    if (preview && preview.error) throw inputError_(preview.error);
  }

  function renderWaterBottle_() {
    const form = form_('water_bottle');
    if (!form) return;
    const model = waterBottleUiModel_(state.summary, state.summaryStatus, state.dashboardFresh);
    const stateLabel = form.querySelector('[data-popio-water-bottle-state]');
    const previous = form.querySelector('[data-popio-water-bottle-previous]');
    const remaining = form.querySelector('[data-popio-water-bottle-remaining]');
    const newFill = form.querySelector('[name="newFillMl"]');
    const preview = form.querySelector('[data-popio-water-bottle-preview]');
    const reload = form.querySelector('[data-popio-water-bottle-reload]');
    const submit = form.querySelector('.popio-submit');
    if (stateLabel) stateLabel.textContent = model.message;
    if (previous) previous.hidden = !model.ready || !model.hasPrevious;
    if (remaining) remaining.hidden = !model.ready || !model.hasPrevious;
    if (model.hasPrevious) {
      setWaterBottleText_(form, '[data-popio-water-bottle-previous-at]', formatOccurredAt_(model.previousOccurredAt));
      setWaterBottleText_(form, '[data-popio-water-bottle-previous-fill]', model.previousFillMl + 'mL');
    }
    if (newFill && !newFill.value && model.ready) newFill.value = model.defaultNewFillMl;
    form.querySelectorAll('input,select,textarea,button').forEach(function (control) {
      if (control === reload) return;
      control.disabled = !model.ready;
    });
    if (submit) submit.disabled = !model.ready;
    if (reload) {
      reload.hidden = !model.canReload;
      reload.disabled = !model.canReload || Boolean(saveFlow_ && saveFlow_.isSaving('water_bottle'));
      reload.textContent = '再読み込み';
    }
    renderWaterBottlePreview_(form, model, preview);
  }

  async function reloadWaterBottleSummary_() {
    const form = form_('water_bottle');
    const reload = form && form.querySelector('[data-popio-water-bottle-reload]');
    if (reload) { reload.disabled = true; reload.textContent = '再読み込み中…'; }
    await loadDashboard_({ quiet: true });
  }

  function updateWaterBottlePreview_(form) {
    const model = waterBottleUiModel_(state.summary, state.summaryStatus, state.dashboardFresh);
    renderWaterBottlePreview_(form, model, form.querySelector('[data-popio-water-bottle-preview]'));
  }

  function renderWaterBottlePreview_(form, model, target) {
    if (!target) return;
    const livePreview = model.ready && model.hasPrevious ? waterBottlePreview_({ occurredAt: model.previousOccurredAt, newFillMl: model.previousFillMl }, formValues_(form)) : null;
    if (livePreview && livePreview.error) {
      target.hidden = false;
      target.textContent = livePreview.error;
      return;
    }
    const interval = livePreview || model.latestInterval;
    if (!interval || interval.error) {
      target.hidden = true;
      target.textContent = '';
      return;
    }
    const hours = Number(interval.elapsedHours);
    const normalizedLabel = hours < 6 || interval.shortInterval ? '24時間換算（参考） 約' : '24時間換算 約';
    target.hidden = false;
    target.innerHTML = '<strong>今回の目安</strong><span>ボトル減少量 ' + Number(interval.bottleDecreaseMl) + 'mL</span><span>' + hours + '時間</span><span>' + normalizedLabel + Number(interval.normalized24hMl) + 'mL</span><small>※こぼれ等を含む目安</small>';
  }

  function setWaterBottleText_(form, selector, value) {
    const element = form.querySelector(selector);
    if (element) element.textContent = String(value || '');
  }

  function formatOccurredAt_(value, now) {
    const date = new Date(String(value || ''));
    if (!Number.isFinite(date.getTime())) return '--';
    const localDate = tokyoDate_(date),today = tokyoDate_(now),yesterday = tokyoPreviousDate_(now),hour = tokyoHour_(date);
    if (localDate === today) return '今日 ' + hour + '時';
    if (localDate === yesterday) return '昨日 ' + hour + '時';
    const parts = localDate.split('-');
    return Number(parts[1]) + '/' + Number(parts[2]) + ' ' + hour + '時';
  }

  function petHealthOwn_(object, key) { return Object.prototype.hasOwnProperty.call(object || {}, key); }

  function form_(key) { return document.querySelector('.popio-record-form[data-event-type="' + String(key || '') + '"]'); }
  function setFormSaving_(key, saving) {
    const form = form_(key); if (!form) return;
    form.setAttribute('aria-busy', String(Boolean(saving)));
    form.querySelectorAll('input,select,textarea,button').forEach(function (control) { control.disabled = Boolean(saving); });
  }
  function savedStatusMessage_(postSave, action) {
    const refreshed = postSave && Object.prototype.hasOwnProperty.call(postSave, 'dashboardRefreshed') ? postSave.dashboardRefreshed : postSave && postSave.summaryRefreshed;
    const saved = action === 'pet.health.correct' ? '修正しました' : action === 'pet.health.void' ? '記録を取り消しました' : '保存しました';
    return postSave && postSave.writeSaved === true && refreshed === false
      ? saved + '。最新表示を更新できませんでした。' : saved;
  }
  function setFormStatus_(key, message) { const form = form_(key); const status = form && form.querySelector('[data-popio-form-status]'); if (status) status.textContent = message || ''; }

  function shouldBlockPetHealthOffline_(action, online) {
    return online === false && !PET_HEALTH_READ_ACTIONS[action];
  }

  async function call_(action, body) {
    if (!state.authContext || !state.petHealthApi) { const error = new Error('AUTHENTICATION_REQUIRED'); error.code = 'AUTHENTICATION_REQUIRED'; throw error; }
    if (typeof navigator !== 'undefined' && shouldBlockPetHealthOffline_(action, navigator.onLine)) { const error = new Error('OFFLINE'); error.code = 'OFFLINE'; throw error; }
    return state.petHealthApi(action, body || {});
  }

  async function open_() {
    if (!state.mounted) mount_();
    renderDate_();
    hydrateDashboardCache_();
    await loadDashboard_();
  }
  function createPetHealthDashboardLoader_(deps) {
    return {
      load: function () {
        return deps.call('pet.health.getDashboard', { petId: PET_ID, localDate: deps.localDate() });
      },
    };
  }
  function dashboardDataValid_(value) {
    return Boolean(value) && typeof value === 'object' && value.petId === PET_ID && /^\d{4}-\d{2}-\d{2}$/.test(String(value.localDate || '')) && value.timezone === TOKYO_TIME_ZONE && value.summary && typeof value.summary === 'object' && Array.isArray(value.recentEvents);
  }
  function dashboardSnapshotState_(dashboard, fresh) {
    if (!dashboardDataValid_(dashboard)) return null;
    return { dashboard: dashboard, summary: dashboard.summary, summaryStatus: 'loaded', recentEvents: dashboard.recentEvents, recentStatus: 'loaded', dashboardFresh: Boolean(fresh) };
  }
  function dashboardFailureState_(dashboard) {
    const retained = dashboardSnapshotState_(dashboard, false);
    return retained || { dashboard: null, summary: null, summaryStatus: 'failed', recentEvents: [], recentStatus: 'failed', dashboardFresh: false };
  }
  function dashboardSnapshotAvailable_() {
    return dashboardDataValid_(state.dashboard) && state.summaryStatus === 'loaded' && state.recentStatus === 'loaded';
  }
  function applyDashboard_(dashboard, fresh) {
    const next = dashboardSnapshotState_(dashboard, fresh);
    if (!next) return false;
    Object.assign(state, next);
    renderSummary_();
    renderRecentEvents_();
    renderObservation_();
    return true;
  }
  function hydrateDashboardCache_() {
    if (state.dashboard || !state.dashboardCache) return false;
    let cached = null;
    try { cached = state.dashboardCache.load(); } catch (_) { cached = null; }
    if (!cached || !dashboardDataValid_(cached.dashboard)) return false;
    applyDashboard_(cached.dashboard, false);
    state.dashboardStatus = 'cached';
    setRootStatus_('更新中…');
    setDashboardReloadVisible_(false);
    return true;
  }
  function saveDashboardCache_(dashboard) {
    if (!state.dashboardCache) return;
    try { state.dashboardCache.save(dashboard); } catch (_) { /* cache is optional */ }
  }
  function setDashboardReloadVisible_(visible) {
    const reload = document.getElementById('popioDashboardReload');
    if (!reload) return;
    reload.hidden = !visible;
    reload.disabled = !visible || Boolean(dashboardLoad_);
  }
  function loadDashboard_(options) {
    if (dashboardLoad_) return dashboardLoad_;
    const quiet = Boolean(options && options.quiet);
    const hadSnapshot = dashboardSnapshotAvailable_();
    state.dashboardStatus = 'loading';
    state.dashboardFresh = false;
    if (!quiet) setRootStatus_(hadSnapshot ? '更新中…' : '読み込み中…');
    setDashboardReloadVisible_(false);
    renderSummary_();
    renderObservation_();
    const work = createPetHealthDashboardLoader_({ call: call_, localDate: tokyoDate_ }).load()
      .then(function (dashboard) {
        if (!dashboardDataValid_(dashboard)) { const error = new Error('PET_HEALTH_UNAVAILABLE'); error.code = 'PET_HEALTH_UNAVAILABLE'; throw error; }
        applyDashboard_(dashboard, true);
        state.dashboardStatus = 'loaded';
        saveDashboardCache_(dashboard);
        setRootStatus_('');
        setDashboardReloadVisible_(false);
        return true;
      })
      .catch(function (error) {
        state.dashboardStatus = 'failed';
        state.dashboardFresh = false;
        Object.assign(state, dashboardFailureState_(hadSnapshot ? state.dashboard : null));
        renderSummary_();
        renderRecentEvents_();
        renderObservation_();
        setRootStatus_(hadSnapshot ? '最新情報を更新できませんでした' : (error && error.code === 'OFFLINE' ? 'オフライン中。読み込めませんでした' : '読み込めませんでした'));
        setDashboardReloadVisible_(true);
        return false;
      });
    dashboardLoad_ = work.then(function (result) { dashboardLoad_ = null; setDashboardReloadVisible_(state.dashboardStatus === 'failed'); return result; }, function (error) { dashboardLoad_ = null; setDashboardReloadVisible_(true); throw error; });
    return dashboardLoad_;
  }
  function createPetHealthSummaryLoader_(deps) {
    return {
      load: function () {
        return deps.call('pet.health.getDailySummary', { petId: PET_ID, localDate: deps.localDate() });
      },
    };
  }
  function createPetHealthRecentLoader_(deps) {
    return {
      load: function () {
        return deps.call('pet.health.listRecentEvents', { petId: PET_ID, days: RECENT_EVENT_DAYS });
      },
    };
  }
  function createPetHealthReadRefresher_(deps) {
    return {
      async load(options) {
        const results = await Promise.all([deps.loadSummary(options), deps.loadRecent(options)]);
        return { summary: results[0], recent: results[1] };
      },
    };
  }
  function refreshPetHealthReads_(options) {
    return createPetHealthReadRefresher_({ loadSummary: loadSummary_, loadRecent: loadRecentEvents_ }).load(options);
  }
  async function loadSummary_(options) {
    const quiet = Boolean(options && options.quiet);
    if (!quiet) setRootStatus_('読み込み中…');
    state.summaryStatus = 'loading';
    try {
      state.summary = await createPetHealthSummaryLoader_({ call: call_, localDate: tokyoDate_ }).load();
      state.summaryStatus = 'loaded';
      renderSummary_();
      setRootStatus_('');
      return true;
    } catch (error) {
      state.summary = null;
      state.summaryStatus = 'failed';
      renderSummary_();
      setRootStatus_(error && error.code === 'OFFLINE' ? 'オフライン中。記録はまだ読み込めません。' : '記録はまだ読み込めませんでした');
      return false;
    }
  }
  async function loadRecentEvents_() {
    state.recentStatus = 'loading';
    renderRecentEvents_();
    try {
      const data = await createPetHealthRecentLoader_({ call: call_ }).load();
      state.recentEvents = Array.isArray(data && data.events) ? data.events : [];
      state.recentStatus = 'loaded';
      renderRecentEvents_();
      return true;
    } catch (_) {
      state.recentEvents = [];
      state.recentStatus = 'failed';
      renderRecentEvents_();
      return false;
    }
  }

  function summaryDisplayModel_(summary, status) {
    if (status !== 'loaded' || !summary || typeof summary !== 'object') return { meal: '--', water: '--', waterHint: '', stool: '--', weight: '--' };
    const meal = summary.meal && Number(summary.meal.eventCount) === 0 ? '0g' : summary.meal && typeof summary.meal.totalAmountG === 'number' ? summary.meal.totalAmountG + 'g' : '--';
    const waterBottle = summary.waterBottle && typeof summary.waterBottle === 'object' ? summary.waterBottle : null;
    const latestInterval = waterBottle && waterBottle.latestInterval && typeof waterBottle.latestInterval === 'object' ? waterBottle.latestInterval : null;
    const normalized24hMl = latestInterval && Number(latestInterval.normalized24hMl);
    const elapsedHours = latestInterval && Number(latestInterval.elapsedHours);
    const hasBottleInterval = Number.isFinite(normalized24hMl) && normalized24hMl >= 0;
    const hasBottleSet = Boolean(waterBottle && waterBottle.latest && typeof waterBottle.latest === 'object');
    const hasLegacyWater = summary.water && Number(summary.water.eventCount) > 0 && Number.isFinite(Number(summary.water.totalAmountMl));
    const water = hasBottleInterval ? normalized24hMl + 'mL/24h' : hasBottleSet ? '計測中' : hasLegacyWater ? Number(summary.water.totalAmountMl) + 'mL' : '--';
    const waterHint = hasBottleInterval ? (Number.isFinite(elapsedHours) && elapsedHours < 6 ? '短時間データのため参考' : '直近交換区間から換算') : hasBottleSet ? '次回交換で算出' : '';
    const stool = summary.stool && Number.isFinite(Number(summary.stool.count)) ? String(Number(summary.stool.count)) + '回' : '--';
    const weight = summary.latestWeight && typeof summary.latestWeight.weightKg === 'number' ? summary.latestWeight.weightKg + 'kg' : '--';
    return { meal: meal, water: water, waterHint: waterHint, stool: stool, weight: weight };
  }
  function recordingReminderModel_(summary, status, now) {
    const slots = summary && summary.meal && summary.meal.bySlot;
    const count = function (slot) { return slots && slots[slot] ? slots[slot].eventCount : NaN; };
    const breakfast = count('breakfast'), dinner = count('dinner');
    if (status !== 'loaded' || !Number.isSafeInteger(breakfast) || breakfast < 0 || !Number.isSafeInteger(dinner) || dinner < 0) {
      return { known: false, items: [], message: '今日の記録を確認できませんでした' };
    }
    const hour = tokyoHour_(now), items = [];
    if (hour >= REMINDER_HOURS.breakfast && breakfast === 0) items.push({ slot: 'breakfast', label: '朝ごはん', message: '朝ごはんの記録、まだやで' });
    if (hour >= REMINDER_HOURS.dinner && dinner === 0) items.push({ slot: 'dinner', label: '夜ごはん', message: '夜ごはんの記録、忘れとらん？' });
    return { known: true, items: items, message: items.length ? '' : '今のところ入力忘れはないで' };
  }
  function reminderIcon_(model) {
    return model && model.known ? (model.items.length ? '⚠️' : '✅') : '◻️';
  }
  function renderReminder_() {
    const title = document.getElementById('popioReminderTitle'), status = document.getElementById('popioReminderStatus'), list = document.getElementById('popioReminderList');
    if (!status || !list) return;
    const model = recordingReminderModel_(state.summary, state.summaryStatus);
    if (title) title.textContent = reminderIcon_(model) + ' 今日の記録';
    status.textContent = model.message;
    list.textContent = '';
    model.items.forEach(function (item) {
      const row = document.createElement('div'), text = document.createElement('span'), button = document.createElement('button');
      row.className = 'popio-reminder-item';
      text.textContent = '🍚 ' + item.message;
      button.type = 'button';
      button.dataset.popioReminderSlot = item.slot;
      button.textContent = item.label + 'を記録';
      row.append(text, button);
      list.append(row);
    });
  }
  function recentEventLabel_(event) {
    const data = event || {}, mealSlots = { breakfast: '朝', lunch: '昼', dinner: '夜', snack: '補食' }, completions = { finished: '完食', partial: '一部', refused: '食べなかった' }, stoolForms = { pellet: 'コロコロ', formed: '形あり', banana: 'バナナ', soft: 'やわらかい', watery: '水様' }, stoolAmounts = { small: '少なめ', normal: '普通', large: '多め' };
    let label = '';
    if (data.eventType === 'meal') {
      const parts = ['🍚', mealSlots[data.mealSlot] || 'ごはん'];
      if (data.completion !== 'refused' && typeof data.amountG === 'number') parts.push(data.amountG + 'g');
      if (completions[data.completion]) parts.push(completions[data.completion]);
      label = parts.join(' ');
    } else if (data.eventType === 'stool') {
      const details = [stoolForms[data.stoolForm], stoolAmounts[data.stoolAmount]].filter(Boolean);
      label = details.length ? '💩 ' + details.join(' / ') : '💩 うんち';
    } else if (data.eventType === 'water_bottle') {
      label = typeof data.bottleDecreaseMl === 'number' ? '💧 ' + data.bottleDecreaseMl + 'mL減 / ' + data.elapsedHours + 'h' : '💧 水ボトル交換' + (typeof data.newFillMl === 'number' ? ' ' + data.newFillMl + 'mL' : '');
    } else if (data.eventType === 'water') label = '💧 水' + (typeof data.amountMl === 'number' ? ' ' + data.amountMl + 'mL' : '');
    else if (data.eventType === 'urine') label = '🚽 おしっこ' + (data.urineStatus === 'concern' ? ' / 気になる' : '');
    else if (data.eventType === 'weight') label = '⚖️ ' + (typeof data.weightKg === 'number' ? data.weightKg + 'kg' : '体重');
    else if (data.eventType === 'observation') {
      const flags = { vomiting: '嘔吐', sneeze_cough: 'くしゃみ・咳', pain_behavior: '痛がる様子' };
      const details = Array.isArray(data.flags) ? data.flags.map(function (flag) { return flags[flag]; }).filter(Boolean) : [];
      label = '👀 体調' + (details.length ? ' / ' + details.join('・') : '');
    } else label = '記録';
    return label + (String(data.note || '') ? ' 📝' : '');
  }
  function historyDateLabel_(localDate, now) {
    if (localDate === tokyoDate_(now)) return '今日 ' + Number(localDate.slice(5, 7)) + '/' + Number(localDate.slice(8, 10));
    if (localDate === tokyoPreviousDate_(now)) return '昨日 ' + Number(localDate.slice(5, 7)) + '/' + Number(localDate.slice(8, 10));
    return Number(localDate.slice(5, 7)) + '/' + Number(localDate.slice(8, 10));
  }
  function historyViewModel_(events, status, now) {
    if (status === 'loading' || status === 'idle') return { state: 'loading', message: '最近の記録を読み込み中…', groups: [] };
    if (status !== 'loaded' || !Array.isArray(events)) return { state: 'failed', message: '最近の記録を読み込めませんでした', groups: [] };
    if (events.some(function (event) { return !event || !/^\d{4}-\d{2}-\d{2}$/.test(String(event.localDate || '')) || !Number.isFinite(new Date(String(event.occurredAt || '')).getTime()); })) return { state: 'failed', message: '最近の記録を読み込めませんでした', groups: [] };
    const ordered = events.slice().sort(function (a, b) { return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime() || String(a.eventId || '').localeCompare(String(b.eventId || '')); });
    const groups = [];
    ordered.forEach(function (event) {
      let group = groups.length && groups[groups.length - 1];
      if (!group || group.localDate !== event.localDate) { group = { localDate: event.localDate, label: historyDateLabel_(event.localDate, now), items: [] }; groups.push(group); }
      group.items.push({ eventId: String(event.eventId || ''), time: String(tokyoHour_(new Date(event.occurredAt))).padStart(2, '0') + '時', label: recentEventLabel_(event) });
    });
    return { state: groups.length ? 'loaded' : 'empty', message: groups.length ? '' : '最近の記録はまだないで', groups: groups };
  }
  function renderRecentEvents_() {
    const status = document.getElementById('popioHistoryStatus'), list = document.getElementById('popioHistoryList');
    if (!status || !list) return;
    const model = historyViewModel_(state.recentEvents, state.recentStatus);
    status.textContent = model.message;
    list.textContent = '';
    model.groups.forEach(function (group) {
      const section = document.createElement('section'), heading = document.createElement('h3');
      section.className = 'popio-history-group';
      heading.textContent = group.label;
      section.append(heading);
      group.items.forEach(function (item) {
        const row = document.createElement('div'), time = document.createElement('time'), label = document.createElement('span'), edit = document.createElement('button');
        row.className = 'popio-history-item';
        row.dataset.eventId = item.eventId;
        time.textContent = item.time;
        label.textContent = item.label;
        edit.type = 'button';
        edit.dataset.popioCorrectionEventId = item.eventId;
        edit.textContent = '修正';
        row.append(time, label, edit);
        section.append(row);
      });
      list.append(section);
    });
  }
  function observationPeriod_(value) {
    const period = Number(value);
    return OBSERVATION_PERIODS.indexOf(period) >= 0 ? period : 7;
  }
  function shiftObservationDate_(localDate, days) {
    const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(localDate || ''));
    if (!match) return '';
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)));
    return date.toISOString().slice(0, 10);
  }
  function observationDateLabel_(localDate) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(localDate || '')) ? Number(localDate.slice(5, 7)) + '/' + Number(localDate.slice(8, 10)) : '--';
  }
  function observationForms_(forms) {
    const labels = { pellet: 'コロコロ', formed: '形あり', banana: 'バナナ', soft: 'やわらかい', watery: '水様' };
    const counts = forms && typeof forms === 'object' ? forms : {}, max = Math.max.apply(null, Object.keys(labels).map(function (key) { return Number(counts[key]) || 0; }));
    if (!max) return '';
    const winners = Object.keys(labels).filter(function (key) { return Number(counts[key]) === max; });
    return winners.length === 1 ? labels[winners[0]] : '複数';
  }
  function observationTrendModel_(trends, period) {
    const days = observationPeriod_(period);
    if (!trends || typeof trends !== 'object' || trends.rangeDays !== 30 || !/^\d{4}-\d{2}-\d{2}$/.test(String(trends.toLocalDate || '')) || !trends.weight || !trends.meal || !trends.stool || !Array.isArray(trends.weight.items) || !Array.isArray(trends.meal.daily) || !Array.isArray(trends.stool.daily)) return { state: 'unavailable', period: days, localDates: [], weight: [], meal: [], stool: [] };
    const fromLocalDate = shiftObservationDate_(trends.toLocalDate, -(days - 1)), localDates = Array.from({ length: days }, function (_, index) { return shiftObservationDate_(fromLocalDate, index); });
    const allowed = new Set(localDates), mealByDate = Object.create(null), stoolByDate = Object.create(null);
    trends.meal.daily.forEach(function (item) { if (item && allowed.has(item.localDate)) mealByDate[item.localDate] = item; });
    trends.stool.daily.forEach(function (item) { if (item && allowed.has(item.localDate)) stoolByDate[item.localDate] = item; });
    const weight = trends.weight.items.filter(function (item) { return item && allowed.has(item.localDate) && typeof item.weightKg === 'number' && Number.isFinite(item.weightKg) && item.weightKg >= 0.1 && item.weightKg <= 200 && Number.isFinite(new Date(String(item.occurredAt || '')).getTime()); }).slice().sort(function (a, b) { return String(a.localDate).localeCompare(String(b.localDate)) || new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(); });
    const meal = localDates.map(function (localDate) {
      const item = mealByDate[localDate] || {};
      return { localDate: localDate, knownAmountG: typeof item.knownAmountG === 'number' && Number.isFinite(item.knownAmountG) ? item.knownAmountG : 0, amountStatus: ['complete', 'partial', 'unknown', 'no_events'].indexOf(item.amountStatus) >= 0 ? item.amountStatus : 'no_events' };
    });
    const stool = localDates.map(function (localDate) {
      const item = stoolByDate[localDate] || {}, forms = item.forms && typeof item.forms === 'object' ? item.forms : {};
      return { localDate: localDate, count: Number.isSafeInteger(Number(item.count)) && Number(item.count) >= 0 ? Number(item.count) : 0, forms: forms, formLabel: observationForms_(forms) };
    });
    return { state: 'loaded', period: days, localDates: localDates, weight: weight, meal: meal, stool: stool };
  }
  function observationMealLabel_(item) {
    if (!item || item.amountStatus === 'no_events' || item.amountStatus === 'unknown') return '--';
    return String(item.knownAmountG) + 'g' + (item.amountStatus === 'partial' ? '+' : '');
  }
  function renderTrendEmpty_(target, message) {
    if (!target) return;
    target.textContent = '';
    const text = document.createElement('p');
    text.className = 'popio-trend-empty';
    text.textContent = message;
    target.append(text);
  }
  function weightAxisModel_(items) {
    const values = (Array.isArray(items) ? items : []).map(function (item) { return item && Number(item.weightKg); }).filter(function (value) { return Number.isFinite(value) && value >= 0.1 && value <= 200; });
    if (!values.length) return null;
    const minimum = Math.min.apply(null, values), maximum = Math.max.apply(null, values), step = 0.5;
    const lower = Math.max(0.1, Math.floor((minimum - 0.1) / step) * step);
    const initialUpper = Math.ceil((maximum + 0.1) / step) * step;
    const upper = Math.max(initialUpper, lower + 1);
    const midpoint = lower + (upper - lower) / 2;
    const ticks = [upper, midpoint, lower].map(function (value) { const rounded = Math.round(value * 10) / 10; return { value: rounded, label: rounded.toFixed(1) }; });
    return { minimum: ticks[2].value, maximum: ticks[0].value, ticks: ticks };
  }
  function renderWeightTrend_(target, model) {
    if (!target) return;
    target.textContent = '';
    if (!model.weight.length) { renderTrendEmpty_(target, '体重記録はまだないで'); return; }
    const axisModel = weightAxisModel_(model.weight);
    if (!axisModel) { renderTrendEmpty_(target, '体重記録はまだないで'); return; }
    const width = 320, height = 148, plotLeft = 42, plotRight = 12, plotTop = 12, plotBottom = 14;
    const x = function (item) { const index = Math.max(0, model.localDates.indexOf(item.localDate)); return plotLeft + (width - plotLeft - plotRight) * (model.localDates.length === 1 ? 0.5 : index / (model.localDates.length - 1)); };
    const yForValue = function (value) { return height - plotBottom - (height - plotTop - plotBottom) * ((value - axisModel.minimum) / (axisModel.maximum - axisModel.minimum)); };
    const y = function (item) { return yForValue(item.weightKg); };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'popio-weight-chart'); svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '体重推移');
    axisModel.ticks.forEach(function (tick) {
      const y = yForValue(tick.value), guide = document.createElementNS('http://www.w3.org/2000/svg', 'line'), label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      guide.setAttribute('x1', plotLeft); guide.setAttribute('x2', width - plotRight); guide.setAttribute('y1', y); guide.setAttribute('y2', y); guide.setAttribute('class', 'popio-weight-guide');
      label.setAttribute('x', plotLeft - 6); label.setAttribute('y', y + 3.5); label.setAttribute('text-anchor', 'end'); label.setAttribute('class', 'popio-weight-tick'); label.textContent = tick.label;
      svg.append(guide, label);
    });
    if (model.weight.length > 1) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      line.setAttribute('points', model.weight.map(function (item) { return x(item) + ',' + y(item); }).join(' ')); line.setAttribute('fill', 'none'); line.setAttribute('class', 'popio-weight-line'); svg.append(line);
    }
    model.weight.forEach(function (item) { const point = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); point.setAttribute('cx', x(item)); point.setAttribute('cy', y(item)); point.setAttribute('r', '4'); point.setAttribute('class', 'popio-weight-point'); svg.append(point); });
    const summary = document.createElement('p'), axis = document.createElement('div');
    summary.className = 'popio-trend-caption'; summary.textContent = '最新 ' + model.weight[model.weight.length - 1].weightKg + 'kg';
    axis.className = 'popio-trend-axis'; axis.textContent = observationDateLabel_(model.localDates[0]) + ' 〜 ' + observationDateLabel_(model.localDates[model.localDates.length - 1]);
    target.append(svg, summary, axis);
  }
  function renderMealTrend_(target, model) {
    if (!target) return;
    target.textContent = '';
    const maximum = Math.max.apply(null, model.meal.map(function (item) { return item.amountStatus === 'complete' || item.amountStatus === 'partial' ? item.knownAmountG : 0; }).concat([1]));
    model.meal.forEach(function (item) {
      const row = document.createElement('div'), date = document.createElement('span'), track = document.createElement('span'), fill = document.createElement('i'), value = document.createElement('strong'), known = item.amountStatus === 'complete' || item.amountStatus === 'partial';
      row.className = 'popio-trend-row' + (known ? '' : ' is-missing'); date.textContent = observationDateLabel_(item.localDate); track.className = 'popio-trend-bar'; fill.style.width = known ? Math.round(item.knownAmountG / maximum * 100) + '%' : '0%'; value.textContent = observationMealLabel_(item); track.append(fill); row.append(date, track, value); target.append(row);
    });
  }
  function renderStoolTrend_(target, model) {
    if (!target) return;
    target.textContent = '';
    const maximum = Math.max.apply(null, model.stool.map(function (item) { return item.count; }).concat([1]));
    model.stool.forEach(function (item) {
      const row = document.createElement('div'), date = document.createElement('span'), track = document.createElement('span'), fill = document.createElement('i'), value = document.createElement('strong'), form = document.createElement('small');
      row.className = 'popio-trend-row'; date.textContent = observationDateLabel_(item.localDate); track.className = 'popio-trend-bar'; fill.style.width = Math.round(item.count / maximum * 100) + '%'; value.textContent = item.count + '回'; form.textContent = item.formLabel; track.append(fill); row.append(date, track, value, form); target.append(row);
    });
  }
  function renderObservation_() {
    const status = document.getElementById('popioObservationStatus'), weight = document.getElementById('popioWeightTrend'), meal = document.getElementById('popioMealTrend'), stool = document.getElementById('popioStoolTrend');
    if (!status || !weight || !meal || !stool) return;
    document.querySelectorAll('[data-popio-observation-period]').forEach(function (button) { const active = observationPeriod_(button.dataset.popioObservationPeriod) === state.observationPeriod; button.setAttribute('aria-pressed', String(active)); });
    const model = observationTrendModel_(state.dashboard && state.dashboard.trends, state.observationPeriod);
    if (model.state !== 'loaded') {
      status.textContent = state.dashboardStatus === 'loading' || state.dashboardStatus === 'cached' ? '観察データを読み込み中…' : '観察データを読み込めませんでした';
      renderTrendEmpty_(weight, '体重記録はまだないで'); renderTrendEmpty_(meal, '--'); renderTrendEmpty_(stool, '--');
      return;
    }
    status.textContent = '';
    renderWeightTrend_(weight, model); renderMealTrend_(meal, model); renderStoolTrend_(stool, model);
  }
  function renderSummary_() {
    const model = summaryDisplayModel_(state.summary, state.summaryStatus);
    setText_('popioSummaryMeal', model.meal); setText_('popioSummaryWater', model.water); setText_('popioSummaryWaterHint', model.waterHint); setText_('popioSummaryStool', model.stool); setText_('popioSummaryWeight', model.weight);
    renderReminder_();
    renderWaterBottle_();
  }
  function renderDate_() { const value = tokyoDate_(); const parts = value.split('-'); setText_('popioHealthDate', parts.length === 3 ? '今日 ' + Number(parts[1]) + '/' + Number(parts[2]) : '今日'); }
  function setRootStatus_(message) { setText_('popioHealthStatus', message || ''); }
  function setText_(id, value) { const element = document.getElementById(id); if (element) element.textContent = String(value); }
  function tokyoDate_(now) { return validDate_(now).toLocaleDateString('sv-SE', { timeZone: TOKYO_TIME_ZONE }); }
  function tokyoHour_(now) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: TOKYO_TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).formatToParts(validDate_(now));
    const hour = parts.find(function (part) { return part.type === 'hour'; });
    return hour ? Number(hour.value) : 0;
  }
  function tokyoPreviousDate_(now) {
    const parts = tokyoDate_(now).split('-').map(Number);
    const previous = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] - 1));
    return previous.toISOString().slice(0, 10);
  }

  function createUuid_() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') return '';
    const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    return Array.from(bytes, function (value) { return value.toString(16).padStart(2, '0'); }).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  }

  return Object.freeze({
    PET_ID: PET_ID,
    install: install,
    buildEventPayload_: buildEventPayload_,
    buildOccurredAt_: buildOccurredAt_,
    buildRecordRequest_: buildRecordRequest_,
    buildCorrectionRequest_: buildCorrectionRequest_,
    buildVoidRequest_: buildVoidRequest_,
    applyMealReminderShortcut_: applyMealReminderShortcut_,
    createPetHealthDashboardLoader_: createPetHealthDashboardLoader_,
    createPetHealthReadRefresher_: createPetHealthReadRefresher_,
    createPetHealthRecentLoader_: createPetHealthRecentLoader_,
    createPetHealthSaveFlow_: createPetHealthSaveFlow_,
    createPetHealthSummaryLoader_: createPetHealthSummaryLoader_,
    historyViewModel_: historyViewModel_,
    collapsibleSectionState_: collapsibleSectionState_,
    observationTrendModel_: observationTrendModel_,
    observationMealLabel_: observationMealLabel_,
    observationForms_: observationForms_,
    observationPeriod_: observationPeriod_,
    weightAxisModel_: weightAxisModel_,
    dashboardDataValid_: dashboardDataValid_,
    dashboardFailureState_: dashboardFailureState_,
    dashboardSnapshotState_: dashboardSnapshotState_,
    recentEventLabel_: recentEventLabel_,
    reminderIcon_: reminderIcon_,
    recordingReminderModel_: recordingReminderModel_,
    savedStatusMessage_: savedStatusMessage_,
    shouldBlockPetHealthOffline_: shouldBlockPetHealthOffline_,
    summaryDisplayModel_: summaryDisplayModel_,
    timestampLabel_: timestampLabel_,
    tokyoDate_: tokyoDate_,
    tokyoHour_: tokyoHour_,
    tokyoPreviousDate_: tokyoPreviousDate_,
    waterBottleUiModel_: waterBottleUiModel_,
    waterBottlePreview_: waterBottlePreview_,
    formatOccurredAt_: formatOccurredAt_,
    petHealthWriteAction_: petHealthWriteAction_,
  });
}));
