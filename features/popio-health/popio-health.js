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
        ${waterBottleForm_()}
        ${urineForm_()}
        ${weightForm_()}
        ${observationForm_()}
      </div>`;
    mount.append(root);
    root.addEventListener('submit', submitRecord_);
    root.addEventListener('input', handleContentChanged_);
    root.addEventListener('change', handleContentChanged_);
    root.addEventListener('click', handleTimestampClick_);
    state.mounted = true;
    initializeTimestampControls_(root);
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
      <label class="popio-field"><span>新しく入れた量</span><span class="popio-unit-input"><input name="newFillMl" type="text" inputmode="numeric" maxlength="4" required><em>mL</em></span></label>
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
    return '<button class="popio-submit" type="submit">' + String(label || '記録する') + '</button><p class="popio-form-status" data-popio-form-status role="status" aria-live="polite"></p>';
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
      event.newFillMl = integer_(input.newFillMl, '新しく入れた量', 1, 5000);
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
          const postSave = deps.onSuccess ? await deps.onSuccess(key, data, request) : null;
          delete requests[key];
          if (deps.onSaved) deps.onSaved(key, data, postSave);
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
      call: function (request) { return call_('pet.health.record', request); },
      onSaving: function (key) { setFormSaving_(key, true); setFormStatus_(key, '保存中…'); },
      onSuccess: async function (key) {
        const form = form_(key);
        if (form) { form.reset(); resetTimestampControl_(form); }
        return { writeSaved: true, summaryRefreshed: await loadSummary_({ quiet: true }) };
      },
      onSaved: function (key, _data, postSave) { setFormStatus_(key, savedStatusMessage_(postSave)); },
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
    let payload;
    try {
      payload = buildEventPayload_(key, formValues_(form));
      if (key === 'water_bottle') validateWaterBottleForm_(form, payload);
    }
    catch (error) { setFormStatus_(key, String(error && error.message || '入力内容を確認してください')); return; }
    await ensureSaveFlow_().save(key, payload);
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

  function handleTimestampClick_(event) {
    const reload = event.target && event.target.closest ? event.target.closest('[data-popio-water-bottle-reload]') : null;
    if (reload) {
      event.preventDefault();
      if (!reload.disabled) void reloadWaterBottleSummary_();
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

  function waterBottleUiModel_(summary, status) {
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
    const model = waterBottleUiModel_(state.summary, state.summaryStatus);
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
    const model = waterBottleUiModel_(state.summary, state.summaryStatus);
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
    await loadSummary_({ quiet: true });
  }

  function updateWaterBottlePreview_(form) {
    const model = waterBottleUiModel_(state.summary, state.summaryStatus);
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
  function savedStatusMessage_(postSave) {
    return postSave && postSave.writeSaved === true && postSave.summaryRefreshed === false
      ? '保存しました。最新表示を更新できませんでした。' : '保存しました';
  }
  function setFormStatus_(key, message) { const form = form_(key); const status = form && form.querySelector('[data-popio-form-status]'); if (status) status.textContent = message || ''; }

  function shouldBlockPetHealthOffline_(action, online) {
    return online === false && action !== 'pet.health.getDailySummary';
  }

  async function call_(action, body) {
    if (!state.authContext || !state.petHealthApi) { const error = new Error('AUTHENTICATION_REQUIRED'); error.code = 'AUTHENTICATION_REQUIRED'; throw error; }
    if (typeof navigator !== 'undefined' && shouldBlockPetHealthOffline_(action, navigator.onLine)) { const error = new Error('OFFLINE'); error.code = 'OFFLINE'; throw error; }
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
    createPetHealthSaveFlow_: createPetHealthSaveFlow_,
    createPetHealthSummaryLoader_: createPetHealthSummaryLoader_,
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
  });
}));
