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
  const FLAG_ORDER = Object.freeze(['vomiting', 'sneeze_cough', 'pain_behavior']);
  const state = {
    authContext: null,
    petHealthApi: null,
    summary: null,
    summaryStatus: 'idle',
    mounted: false,
  };
  let saveFlow_ = null;

  function install(doc) {
    doc.addEventListener('DOMContentLoaded', mount_);
    doc.addEventListener('paruru:authenticated', function (event) {
      const detail = event && event.detail || {};
      state.authContext = detail.context || null;
      state.petHealthApi = typeof detail.petHealthApi === 'function' ? detail.petHealthApi : null;
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
      <p id="popioHealthStatus" class="popio-health-status" role="status" aria-live="polite"></p>
      <section class="popio-summary-card" aria-label="今日のまとめ">
        <div><span>🍚 ごはん</span><strong id="popioSummaryMeal">--</strong></div>
        <div><span>💧 水</span><strong id="popioSummaryWater">--</strong></div>
        <div><span>💩 うんち</span><strong id="popioSummaryStool">--</strong></div>
        <div><span>⚖️ 体重</span><strong id="popioSummaryWeight">--</strong></div>
      </section>
      <div class="popio-record-list">
        ${mealForm_()}
        ${stoolForm_()}
        ${waterForm_()}
        ${urineForm_()}
        ${weightForm_()}
        ${observationForm_()}
      </div>`;
    mount.append(root);
    root.addEventListener('submit', submitRecord_);
    root.addEventListener('input', handleContentChanged_);
    root.addEventListener('change', handleContentChanged_);
    state.mounted = true;
    renderDate_();
    renderSummary_();
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
      ${note_()}${submit_()}
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
      ${note_()}${submit_()}
    </form></details>`;
  }

  function waterForm_() {
    return `<details class="popio-card"><summary>💧 水</summary><form class="popio-record-form" data-event-type="water">
      <label class="popio-field"><span>飲んだ量</span><span class="popio-unit-input"><input name="amountMl" type="text" inputmode="numeric" maxlength="5" required><em>mL</em></span></label>
      ${note_()}${submit_()}
    </form></details>`;
  }

  function urineForm_() {
    return `<details class="popio-card"><summary>🚽 おしっこ</summary><form class="popio-record-form" data-event-type="urine">
      <fieldset><legend>様子（任意）</legend><div class="popio-choice-grid popio-choice-grid-three">
        ${choice_('urineStatus','','記録だけ',true)}${choice_('urineStatus','normal','いつもどおり')}${choice_('urineStatus','concern','気になる')}
      </div></fieldset>
      ${note_()}${submit_()}
    </form></details>`;
  }

  function weightForm_() {
    return `<details class="popio-card"><summary>⚖️ 体重</summary><form class="popio-record-form" data-event-type="weight">
      <label class="popio-field"><span>体重</span><span class="popio-unit-input"><input name="weightKg" type="text" inputmode="decimal" maxlength="7" required><em>kg</em></span></label>
      ${note_()}${submit_()}
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
      ${note_()}${submit_()}
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
  function submit_() {
    return '<button class="popio-submit" type="submit">記録する</button><p class="popio-form-status" data-popio-form-status role="status" aria-live="polite"></p>';
  }

  function formValues_(form) {
    const data = new FormData(form);
    const values = {};
    data.forEach(function (value, key) { if (key !== 'flags') values[key] = value; });
    values.flags = data.getAll('flags');
    values.coprophagy = data.has('coprophagy');
    return values;
  }

  function buildEventPayload_(eventType, values) {
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
  function inputError_(message) { const error = new Error(message); error.code = 'INVALID_INPUT'; return error; }

  function buildRecordRequest_(clientRequestId, event) {
    return { petId: PET_ID, clientRequestId: String(clientRequestId || ''), event: event };
  }

  function createPetHealthSaveFlow_(deps) {
    const saving = Object.create(null);
    const requests = Object.create(null);
    const createId = deps.createRequestId;
    return {
      async save(formKey, event) {
        const key = String(formKey || '');
        if (saving[key]) return { skipped: true, saved: false };
        const fingerprint = JSON.stringify(event || {});
        if (!requests[key] || requests[key].fingerprint !== fingerprint) {
          requests[key] = { id: createId(), fingerprint: fingerprint };
        }
        const request = buildRecordRequest_(requests[key].id, event);
        saving[key] = true;
        if (deps.onSaving) deps.onSaving(key, request);
        try {
          if (deps.isOnline && !deps.isOnline()) { const error = new Error('OFFLINE'); error.code = 'OFFLINE'; throw error; }
          const data = await deps.call(request);
          if (deps.onSuccess) await deps.onSuccess(key, data, request);
          delete requests[key];
          if (deps.onSaved) deps.onSaved(key, data);
          return { skipped: false, saved: true, data: data };
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
      call: function (request) { return call_('pet.health.record', request); },
      onSaving: function (key) { setFormSaving_(key, true); setFormStatus_(key, '保存中…'); },
      onSuccess: async function (key) { const form = form_(key); if (form) form.reset(); await loadSummary_({ quiet: true }); },
      onSaved: function (key) { setFormStatus_(key, '保存しました'); },
      onFailure: function (key, error) { setFormStatus_(key, error && error.code === 'OFFLINE' ? 'オフライン中。未保存です。入力は残しています。' : '保存できませんでした。入力は残しています。'); },
      onSettled: function (key) { setFormSaving_(key, false); },
    });
    return saveFlow_;
  }

  async function submitRecord_(event) {
    const form = event.target && event.target.closest ? event.target.closest('.popio-record-form') : null;
    if (!form) return;
    event.preventDefault();
    const key = String(form.dataset.eventType || '');
    if (ensureSaveFlow_().isSaving(key)) return;
    let payload;
    try { payload = buildEventPayload_(key, formValues_(form)); }
    catch (error) { setFormStatus_(key, String(error && error.message || '入力内容を確認してください')); return; }
    await ensureSaveFlow_().save(key, payload);
  }

  function handleContentChanged_(event) {
    const form = event.target && event.target.closest ? event.target.closest('.popio-record-form') : null;
    if (!form) return;
    ensureSaveFlow_().contentChanged(String(form.dataset.eventType || ''));
    setFormStatus_(String(form.dataset.eventType || ''), '');
  }

  function form_(key) { return document.querySelector('.popio-record-form[data-event-type="' + String(key || '') + '"]'); }
  function setFormSaving_(key, saving) {
    const form = form_(key); if (!form) return;
    form.setAttribute('aria-busy', String(Boolean(saving)));
    form.querySelectorAll('input,select,textarea,button').forEach(function (control) { control.disabled = Boolean(saving); });
  }
  function setFormStatus_(key, message) { const form = form_(key); const status = form && form.querySelector('[data-popio-form-status]'); if (status) status.textContent = message || ''; }

  async function call_(action, body) {
    if (!state.authContext || !state.petHealthApi) { const error = new Error('AUTHENTICATION_REQUIRED'); error.code = 'AUTHENTICATION_REQUIRED'; throw error; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { const error = new Error('OFFLINE'); error.code = 'OFFLINE'; throw error; }
    return state.petHealthApi(action, body || {});
  }

  async function open_() { if (!state.mounted) mount_(); renderDate_(); await loadSummary_(); }
  function createPetHealthSummaryLoader_(deps) {
    return {
      load: function () {
        return deps.call('pet.health.getDailySummary', { petId: PET_ID, localDate: deps.localDate() });
      },
    };
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

  function summaryDisplayModel_(summary, status) {
    if (status !== 'loaded' || !summary || typeof summary !== 'object') return { meal: '--', water: '--', stool: '--', weight: '--' };
    const meal = summary.meal && Number(summary.meal.eventCount) === 0 ? '0g' : summary.meal && typeof summary.meal.totalAmountG === 'number' ? summary.meal.totalAmountG + 'g' : '--';
    const water = summary.water && Number(summary.water.eventCount) === 0 ? '0mL' : summary.water && typeof summary.water.totalAmountMl === 'number' ? summary.water.totalAmountMl + 'mL' : '--';
    const stool = summary.stool && Number.isFinite(Number(summary.stool.count)) ? String(Number(summary.stool.count)) + '回' : '--';
    const weight = summary.latestWeight && typeof summary.latestWeight.weightKg === 'number' ? summary.latestWeight.weightKg + 'kg' : '--';
    return { meal: meal, water: water, stool: stool, weight: weight };
  }
  function renderSummary_() {
    const model = summaryDisplayModel_(state.summary, state.summaryStatus);
    setText_('popioSummaryMeal', model.meal); setText_('popioSummaryWater', model.water); setText_('popioSummaryStool', model.stool); setText_('popioSummaryWeight', model.weight);
  }
  function renderDate_() { const value = tokyoDate_(); const parts = value.split('-'); setText_('popioHealthDate', parts.length === 3 ? '今日 ' + Number(parts[1]) + '/' + Number(parts[2]) : '今日'); }
  function setRootStatus_(message) { setText_('popioHealthStatus', message || ''); }
  function setText_(id, value) { const element = document.getElementById(id); if (element) element.textContent = String(value); }
  function tokyoDate_(now) { return (now instanceof Date ? now : new Date(now || Date.now())).toLocaleDateString('sv-SE', { timeZone: TOKYO_TIME_ZONE }); }

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
    buildRecordRequest_: buildRecordRequest_,
    createPetHealthSaveFlow_: createPetHealthSaveFlow_,
    createPetHealthSummaryLoader_: createPetHealthSummaryLoader_,
    summaryDisplayModel_: summaryDisplayModel_,
    tokyoDate_: tokyoDate_,
  });
}));
