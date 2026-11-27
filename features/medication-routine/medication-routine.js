/* PALURU Issue251 medication routine UI (vanilla, in-memory only). */
(function (g) {
  'use strict';
  var SLOTS = ['morning', 'evening'];
  var SLOT_LABEL = { morning: '朝', evening: '夜' };
  var DAYS = ['日', '月', '火', '水', '木', '金', '土'];
  var TIMER_FIELDS = [
    ['sublingualSeconds', '舌下タイマー(秒)'], ['foodDrinkMinutes', '飲食タイマー(分)'],
    ['observationMinutes', '経過観察タイマー(分)'], ['exerciseBathMinutes', '運動・入浴タイマー(分)']
  ];
  var KIND_LABEL = { sublingualSeconds: '舌下', foodDrinkMinutes: '飲食', observationMinutes: '経過観察', exerciseBathMinutes: '運動・入浴' };
  var STATUS_LABEL = { unrecorded: '未記録', completed: '記録済み', held: '見送りを記録' };
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  var DEFINITE = /^(VALIDATION|FORBIDDEN|UNAUTHORIZED|NOT_FOUND|INVALID)/;
  var uid = 0;
  var current = null;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function jst(d) { return new Date(d.getTime() + 9 * 3600000); }
  function localDate(d) { var x=jst(d); return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate()); }
  function toLocalInput(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var x=jst(d); return localDate(d) + 'T' + pad(x.getUTCHours()) + ':' + pad(x.getUTCMinutes());
  }
  function fromLocalInput(v) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return '';
    var d = new Date(v + ':00+09:00');
    return isNaN(d.getTime()) || toLocalInput(d.toISOString()) !== v ? '' : d.toISOString();
  }
  function fmtTime(iso) {
    var d = new Date(iso);
    var x=jst(d); return isNaN(d.getTime()) ? '' : pad(x.getUTCHours()) + ':' + pad(x.getUTCMinutes());
  }
  function fmtDT(iso, day) {
    var t = fmtTime(iso);
    if (!t) return '';
    var d = new Date(iso);
    var x=jst(d); return (localDate(d) === day ? t : (x.getUTCMonth() + 1) + '/' + x.getUTCDate() + ' ' + t) + ' JST';
  }
  function remainText(iso, now) {
    var ms = Date.parse(iso) - (now === undefined ? Date.now() : now);
    if (isNaN(ms)) return '';
    if (ms <= 0) return '終了';
    if (ms < 60000) return 'あと' + Math.ceil(ms / 1000) + '秒';
    var m = Math.ceil(ms / 60000);
    return 'あと' + (m >= 60 ? Math.floor(m / 60) + '時間' + (m % 60) + '分' : m + '分');
  }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function uuid() {
    var c = g.crypto || {};
    if (typeof c.randomUUID === 'function') return c.randomUUID();
    var b = new Uint8Array(16), i, o = [];
    if (typeof c.getRandomValues === 'function') c.getRandomValues(b);
    else for (i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    for (i = 0; i < 16; i++) o.push((b[i] < 16 ? '0' : '') + b[i].toString(16));
    return o.slice(0, 4).join('') + '-' + o.slice(4, 6).join('') + '-' + o.slice(6, 8).join('') + '-' +
      o.slice(8, 10).join('') + '-' + o.slice(10).join('');
  }
  function errCode(e) {
    var c = e && (e.code || (e.error && e.error.code));
    return typeof c === 'string' && /^[A-Z_]{3,40}$/.test(c) ? c : '';
  }

  function mount(opts) {
    if (current) current.clear();
    opts = opts || {};
    var api = opts.api, ctx = opts.context || {};
    var homeEl = opts.homeMount || null, panelEl = opts.panelMount || null;
    var doc = ((panelEl || homeEl) || {}).ownerDocument;
    var s = {
      dead: false, gen: 0, epoch: 0, target: '', targets: [], ctxLoaded: false, data: null, saving: null,
      intents: {}, newPlanId: '', selPlan: '', timer: null, serverMs: null, clockStart: 0, midnightRefresh: false
    };
    var views = [];
    var inst = { refresh: refresh, clear: clear };
    function monotonic() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
    function serverNow() { return new Date(s.serverMs === null ? Date.now() : s.serverMs + monotonic() - s.clockStart); }
    current = inst;

    function h(tag, cls, text, attrs) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
      return e;
    }
    function call(action, body) { return Promise.resolve().then(function () { return api(action, body); }); }

    function build(el, full) {
      el.textContent = '';
      var root = h('section', 'mr-root ' + (full ? 'mr-full' : 'mr-compact'), null, { 'aria-label': '服薬ルーティン' });
      var v = { el: root, full: full, sig: '', statuses: [] };
      root.appendChild(h('h2', 'mr-title', '服薬ルーティン'));
      v.target = h('p', 'mr-target');
      root.appendChild(v.target);
      if (full) {
        v.pick = h('div', 'mr-field mr-pick');
        v.pick.hidden = true;
        root.appendChild(v.pick);
      }
      var st = h('p', 'mr-status', '', { role: 'status', 'aria-live': 'polite' });
      v.statuses.push(st); root.appendChild(st);
      root.appendChild(h('p', 'mr-note mr-transport',
        '音声通知は未接続です。リマインダーを設定しても通知・音は出ません。'));
      v.list = h('div', 'mr-list'); root.appendChild(v.list);
      if (full) {
        v.settings = h('div', 'mr-settings'); v.settings.hidden = true; root.appendChild(v.settings);
        var st2 = h('p', 'mr-status'); v.statuses.push(st2); root.appendChild(st2);
      }
      el.appendChild(root);
      views.push(v);
    }

    function setStatus(msg, bad) {
      views.forEach(function (v) {
        v.statuses.forEach(function (e) {
          e.textContent = msg || '';
          e.className = 'mr-status' + (bad ? ' mr-bad' : '');
        });
      });
    }
    function applyBusy() {
      views.forEach(function (v) {
        v.el.setAttribute('aria-busy', s.saving ? 'true' : 'false');
        [].forEach.call(v.el.querySelectorAll('[data-mr-act]'), function (b) { b.disabled = !!s.saving; });
      });
    }
    function targetName() {
      for (var i = 0; i < s.targets.length; i++) if (s.targets[i].userId === s.target) return s.targets[i].displayName || ('対象' + (i + 1));
      return '';
    }

    /* ---------- loading ---------- */
    function guard(ep, tgt) { return !s.dead && ep === s.epoch && tgt === s.target; }

    function init() {
      s.target=ctx.memberUserId;s.ctxLoaded=true;
      s.targets=[{userId:ctx.memberUserId,displayName:'自分'}];
      renderTargets();
      return loadData(++s.epoch);
    }

    function loadData(ep, msg, bad) {
      var tgt = s.target, date = s.serverMs === null ? undefined : localDate(serverNow());
      if (!msg) setStatus('読み込み中…');
      return call('health.medication.get', { targetMemberUserId: tgt, localDate: date }).then(function (d) {
        if (!guard(ep, tgt)) return;
        d = d || {};
        d.plans = Array.isArray(d.plans) ? d.plans : [];
        d.occurrences = Array.isArray(d.occurrences) ? d.occurrences : [];
        if (!d.localDate || !Number.isFinite(Date.parse(d.serverNow))) {
          s.data=null; renderAll(); setStatus('データを確認できませんでした。再取得してください。',true); return;
        }
        s.serverMs = Date.parse(d.serverNow); s.clockStart = monotonic();
        if (Array.isArray(d.targets)) {
          s.targets=d.targets.filter(function(item){return item&&typeof item.userId==='string';});
          renderTargets();
        }
        s.data = d;
        renderAll();
        setStatus(msg || '', bad);
      }, function (e) {
        if (!guard(ep, tgt)) return;
        s.data = null;
        renderAll();
        setStatus('読み込みに失敗しました' + (errCode(e) ? '(' + errCode(e) + ')' : '') + '。再読み込みしてください。', true);
      });
    }

    function refresh() {
      if (s.dead) return Promise.resolve();
      return s.ctxLoaded ? loadData(++s.epoch) : init();
    }

    function switchTarget(id) {
      if (s.dead || id === s.target) return;
      s.gen++; s.epoch++; s.saving = null; s.target = id; s.data = null;
      s.selPlan = ''; s.newPlanId = '';
      renderTargets(); renderAll(); applyBusy();
      loadData(s.epoch);
    }

    /* ---------- rendering ---------- */
    function renderTargets() {
      views.forEach(function (v) {
        v.target.textContent = targetName() ? '対象: ' + targetName() : '';
        if (!v.pick) return;
        v.pick.textContent = '';
        v.pick.hidden = s.targets.length < 2;
        if (s.targets.length < 2) return;
        var id = 'mr-t' + (++uid);
        var sel = h('select', 'mr-input', null, { id: id });
        s.targets.forEach(function (t, i) {
          var o = h('option', '', t.displayName || ('対象' + (i + 1)));
          o.value = t.userId; sel.appendChild(o);
        });
        sel.value = s.target;
        sel.addEventListener('change', function () { switchTarget(sel.value); });
        v.pick.appendChild(h('label', '', '表示する対象', { 'for': id }));
        v.pick.appendChild(sel);
      });
    }

    function renderAll() {
      views.forEach(function (v) {
        renderList(v);
        if (v.full) renderSettings(v);
      });
      applyBusy(); tick();
    }

    function renderList(v) {
      var d = s.data, L = v.list;
      L.textContent = '';
      if (!d) return;
      if (!d.configured) {
        L.appendChild(h('p', 'mr-note', '服薬ルーティンはまだ設定されていません。' +
          (d.canConfigure ? '設定にはバックエンド側の準備が必要な場合があります。' : '')));
      }
      var any = false;
      var order = SLOTS.concat(d.occurrences.map(function (o) { return o.slot; }).filter(function (x) { return SLOTS.indexOf(x) < 0; }));
      var seen = {};
      order.forEach(function (slot) {
        if (seen[slot]) return; seen[slot] = 1;
        var list = d.occurrences.filter(function (o) { return o.slot === slot; });
        if (!list.length) return;
        any = true;
        var sec = h('section', 'mr-slot');
        sec.appendChild(h('h3', 'mr-slot-title', SLOT_LABEL[slot] || String(slot)));
        list.forEach(function (o) { sec.appendChild(card(o, v.full)); });
        L.appendChild(sec);
      });
      if (!any && d.configured) L.appendChild(h('p', 'mr-note', '今日の予定はありません。'));
    }

    function card(o, full) {
      var d = s.data, st = STATUS_LABEL[o.status] ? o.status : 'unrecorded';
      var c = h('article', 'mr-card mr-' + st);
      var head = h('div', 'mr-card-head');
      head.appendChild(h('strong', 'mr-card-title', o.label || (SLOT_LABEL[o.slot] || '')));
      head.appendChild(h('span', 'mr-badge', STATUS_LABEL[st]));
      c.appendChild(head);
      if (o.doseText) c.appendChild(h('p', 'mr-dose', o.doseText));
      c.appendChild(h('p', 'mr-time', '予定 ' + (fmtDT(o.scheduledAt, d.localDate) || '--:--')));
      if (st === 'completed') c.appendChild(h('p', 'mr-time mr-actual', '実際の時刻 ' + (fmtDT(o.occurredAt, d.localDate) || '時刻なし')));
      if (st === 'held') c.appendChild(h('p', 'mr-time', '見送りとして記録されています。'));
      (Array.isArray(o.timers) ? o.timers : []).forEach(function (t) {
        var row = h('p', 'mr-timer');
        row.appendChild(h('span', '', (KIND_LABEL[t.kind] || String(t.kind || 'タイマー')) + ' ' + (fmtDT(t.endsAt, d.localDate) || '--:--') + ' まで '));
        var r = h('span', 'mr-remain'); r.setAttribute('data-end', t.endsAt || '');
        row.appendChild(r); c.appendChild(row);
      });
      if (d.canRecord) {
        if (!o.eventId) {
          var bar = h('div', 'mr-actions');
          var b1 = h('button', 'mr-btn mr-primary', '服用した(今の時刻で記録)', { type: 'button', 'data-mr-act': '1' });
          b1.addEventListener('click', function () { record(o, 'completed', null, '', true); });
          var b2 = h('button', 'mr-btn', '見送りとして記録', { type: 'button', 'data-mr-act': '1' });
          b2.addEventListener('click', function () { record(o, 'held', null, '', false); });
          bar.appendChild(b1); bar.appendChild(b2); c.appendChild(bar);
        }
        if (full) c.appendChild(editForm(o));
      }
      return c;
    }

    function editForm(o) {
      var det = h('details', 'mr-details');
      det.appendChild(h('summary', '', o.eventId ? '記録を修正' : '時刻を指定して記録'));
      var f = h('form', 'mr-form'); f.noValidate = true;
      var id = 'mr-e' + (++uid);
      var sel = h('select', 'mr-input', null, { id: id + 's' });
      ['completed', 'held', 'unrecorded'].forEach(function (k) {
        var op = h('option', '', STATUS_LABEL[k]); op.value = k; sel.appendChild(op);
      });
      sel.value = o.status && STATUS_LABEL[o.status] ? o.status : 'completed';
      var dt = h('input', 'mr-input', null, { type: 'datetime-local', id: id + 'd' });
      dt.value = toLocalInput(o.occurredAt || serverNow().toISOString());
      var rs = h('input', 'mr-input', null, { type: 'text', maxlength: '200', id: id + 'r' });
      var msg = h('p', 'mr-bad', '', { role: 'alert' });
      function row(lab, el, idk) { var w = h('div', 'mr-field'); w.appendChild(h('label', '', lab, { 'for': idk })); w.appendChild(el); f.appendChild(w); return w; }
      row('状態', sel, id + 's');
      var dw = row('実際の時刻', dt, id + 'd');
      if (o.eventId) row('修正の理由(必須)', rs, id + 'r');
      function sync() { dw.hidden = sel.value !== 'completed'; }
      sel.addEventListener('change', sync); sync();
      var b = h('button', 'mr-btn mr-primary', '保存', { type: 'submit', 'data-mr-act': '1' });
      f.appendChild(msg); f.appendChild(b);
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var at = '';
        if (sel.value === 'completed') {
          at = dt.value ? fromLocalInput(dt.value) : '';
          if (!at) { msg.textContent = '実際の時刻を入力してください。'; return; }
        }
        if (o.eventId && !rs.value.trim()) { msg.textContent = '修正の理由を入力してください。'; return; }
        if (!o.eventId && sel.value === 'unrecorded') { msg.textContent = '変更がありません。'; return; }
        msg.textContent = '';
        record(o, sel.value, at, rs.value.trim(), false);
      });
      det.appendChild(f);
      return det;
    }

    function tick() {
      if (s.data && !s.saving && !s.midnightRefresh && localDate(serverNow()) !== s.data.localDate) {
        s.midnightRefresh = true;
        loadData(++s.epoch).finally(function(){s.midnightRefresh=false;});
        return;
      }
      views.forEach(function (v) {
        [].forEach.call(v.el.querySelectorAll('.mr-remain'), function (e) {
          e.textContent = remainText(e.getAttribute('data-end'), serverNow().getTime());
        });
      });
    }

    /* ---------- mutations ---------- */
    function intent(key, payload, reuse) {
      var sig = JSON.stringify(payload), it = s.intents[key];
      if (it && (reuse || it.sig === sig)) return it;
      return (s.intents[key] = { id: uuid(), payload: payload, sig: sig });
    }

    function mutate(action, key, payload, reuse, okMsg, extra, onPersist) {
      if (s.dead || s.saving || !s.data) return;
      var tgt = s.target, gen = s.gen, tok = {};
      var it = intent(key, payload, reuse);
      var body = { targetMemberUserId: tgt, localDate: s.data.localDate, clientRequestId: it.id, payload: it.payload };
      if (extra) for (var k in extra) body[k] = extra[k];
      s.saving = tok; applyBusy(); setStatus('保存中…');
      function done() { if (s.saving === tok) s.saving = null; return gen === s.gen && !s.dead && tgt === s.target; }
      return call(action, body).then(function (res) {
        var live = done();
        if (!res || res.persisted !== true) {
          if (live) { applyBusy(); setStatus('保存を確認できませんでした。同じ操作で再試行できます。', true); }
          return;
        }
        delete s.intents[key];
        if (!live) return;
        if (onPersist) onPersist();
        return loadData(++s.epoch, okMsg + (res.replayed ? '(送信済みの内容を確認しました)' : ''));
      }, function (e) {
        var live = done(), code = errCode(e);
        if (code === 'REVISION_CONFLICT' || code === 'IDEMPOTENCY_CONFLICT') {
          delete s.intents[key];
          if (live) return loadData(++s.epoch, '他の端末で内容が更新されたため保存しませんでした。最新の状態を読み込みました。内容を確認してもう一度操作してください。', true);
          return;
        }
        if (DEFINITE.test(code)) delete s.intents[key];
        if (live) { applyBusy(); setStatus('保存できませんでした' + (code ? '(' + code + ')' : '') + '。通信状況を確認してください。', true); }
      });
    }

    function record(o, status, occurredAt, reason, tap) {
      if (!s.data || !s.data.canRecord) return;
      var payload = { planId: o.planId, planRevision: o.planRevision, expectedEventId: o.eventId || '', status: status };
      if (status === 'completed') payload.occurredAt = tap ? serverNow().toISOString() : occurredAt;
      if (reason) payload.correctionReason = reason;
      var key = ['rec', s.target, s.data.localDate, o.planId, o.slot, status, o.eventId || '', o.planRevision].join('|') + (tap ? '' : '|' + JSON.stringify(payload));
      mutate('health.medication.record', key, payload, tap, '記録しました', { slot: o.slot });
    }

    /* ---------- settings ---------- */
    function renderSettings(v) {
      var d = s.data, S = v.settings;
      if (!d || !d.canConfigure || !d.configured) { v.sig = ''; S.textContent = ''; S.hidden = true; return; }
      var ids = d.plans.map(function (p) { return p.planId; });
      if (s.selPlan !== '__new' && ids.indexOf(s.selPlan) < 0) s.selPlan = ids[0] || '__new';
      if (s.selPlan === '__new' && !s.newPlanId) s.newPlanId = uuid();
      var sig = s.target + '|' + s.selPlan + '|' + JSON.stringify(d.plans);
      if (sig === v.sig) return;
      v.sig = sig; S.textContent = ''; S.hidden = false;
      S.appendChild(h('h3', 'mr-slot-title', '設定'));
      S.appendChild(h('p', 'mr-note', '入力した内容がそのまま表示されます。服薬量・時刻は設定者が決めた値で、この画面は推奨を行いません。'));
      if (!d.configured) S.appendChild(h('p', 'mr-note', 'バックエンドの設定が済んでいない場合、保存できないことがあります。'));
      var pid = 'mr-p' + (++uid), sel = h('select', 'mr-input', null, { id: pid });
      d.plans.forEach(function (p, i) {
        var o = h('option', '', p.label || ('設定' + (i + 1))); o.value = p.planId; sel.appendChild(o);
      });
      var on = h('option', '', '新しい設定を追加'); on.value = '__new'; sel.appendChild(on);
      sel.value = s.selPlan;
      sel.addEventListener('change', function () { s.selPlan = sel.value; renderAll(); });
      var w = h('div', 'mr-field'); w.appendChild(h('label', '', '設定を選ぶ', { 'for': pid })); w.appendChild(sel);
      S.appendChild(w);
      var plan = null;
      d.plans.forEach(function (p) { if (p.planId === s.selPlan) plan = p; });
      S.appendChild(planForm(plan));
    }

    function planForm(plan) {
      var isNew = !plan, src = clone(plan) || {};
      var times = src.times || {}, timers = src.timers || {}, fc = src.futureChange || {}, rem = src.reminders || {};
      var ovr = clone(src.weekdayOverrides) || {};
      var f = h('form', 'mr-form'); f.noValidate = true;
      function fld(lab, el, hint) {
        var id = 'mr-f' + (++uid); el.id = id;
        var w = h('div', 'mr-field'); w.appendChild(h('label', '', lab, { 'for': id })); w.appendChild(el);
        if (hint) w.appendChild(h('p', 'mr-hint', hint));
        f.appendChild(w); return el;
      }
      function inp(type, val, extra) {
        var i = h('input', 'mr-input', null, { type: type }); i.value = val == null ? '' : String(val);
        if (extra) for (var k in extra) i.setAttribute(k, extra[k]);
        return i;
      }
      function chk(lab, val) {
        var w = h('label', 'mr-check'), c = h('input', '', null, { type: 'checkbox' });
        c.checked = !!val; w.appendChild(c); w.appendChild(h('span', '', lab)); f.appendChild(w); return c;
      }
      var label = fld('名称', inp('text', src.label, { maxlength: '60' }));
      var dose = fld('設定内容', inp('text', src.doseText, { maxlength: '120' }), '自由入力です。');
      var start = fld('開始日', inp('date', src.startDate));
      var enabled = chk('この設定を有効にする', isNew ? true : src.enabled);
      var tm = fld('朝の時刻', inp('time', times.morning));
      var te = fld('夜の時刻', inp('time', times.evening));
      f.appendChild(h('p', 'mr-hint', '時刻を空にすると、その時間帯の予定は作成されません。'));

      var days = ['0', '1', '2', '3', '4', '5', '6'];
      Object.keys(ovr).forEach(function (k) { if (days.indexOf(k) < 0) days.push(k); });
      function dayName(k) { return /^[0-6]$/.test(k) ? DAYS[+k] + '曜日' : '曜日キー ' + k; }
      var daySel = h('select', 'mr-input');
      var o0 = h('option', '', '(指定しない)'); o0.value = ''; daySel.appendChild(o0);
      days.forEach(function (k) { var o = h('option', '', dayName(k)); o.value = k; daySel.appendChild(o); });
      fld('曜日ごとの時刻を変える', daySel);
      var om = fld('その曜日の朝の時刻', inp('time', ''));
      var oe = fld('その曜日の夜の時刻', inp('time', ''));
      var sum = h('p', 'mr-hint'); f.appendChild(sum);
      var cur = '';
      function commit() {
        if (cur === '') return;
        var e = Object.assign({}, ovr[cur]);
        if (om.value) e.morning = om.value; else delete e.morning;
        if (oe.value) e.evening = oe.value; else delete e.evening;
        if (Object.keys(e).length) ovr[cur] = e; else delete ovr[cur];
      }
      function show() {
        var e = ovr[cur] || {};
        om.value = e.morning || ''; oe.value = e.evening || '';
        om.disabled = oe.disabled = cur === '';
        sum.textContent = '設定済みの曜日別時刻: ' + (Object.keys(ovr).sort().map(function (k) {
          var x = ovr[k] || {};
          return dayName(k) + (x.morning ? ' 朝' + x.morning : '') + (x.evening ? ' 夜' + x.evening : '');
        }).join(' / ') || 'なし');
      }
      daySel.addEventListener('change', function () { commit(); cur = daySel.value; show(); });
      om.addEventListener('change', function () { commit(); show(); });
      oe.addEventListener('change', function () { commit(); show(); });
      show();

      var tin = {};
      TIMER_FIELDS.forEach(function (t) {
        tin[t[0]] = fld(t[1], inp('number', timers[t[0]] || 0, { min: '0', step: '1', inputmode: 'numeric' }));
      });
      f.appendChild(h('p', 'mr-hint', 'タイマーは0で使用しません。'));
      var fcd = fld('将来の変更予定日(参考表示のみ)', inp('date', fc.date));
      var fcn = fld('将来の変更メモ(参考表示のみ)', inp('text', fc.note, { maxlength: '200' }), '予定は自動では反映されません。');
      var rEn = chk('リマインダーを使う(通知は未接続のため鳴りません)', rem.enabled);
      var rRep = fld('リマインダーの繰り返し間隔(分)', inp('number', rem.repeatMinutes || 0, { min: '0', step: '1', inputmode: 'numeric' }));

      var msg = h('p', 'mr-bad', '', { role: 'alert' });
      var b = h('button', 'mr-btn mr-primary', '保存', { type: 'submit', 'data-mr-act': '1' });
      f.appendChild(msg); f.appendChild(b);

      function num(el, name) {
        var t = el.value.trim();
        if (t === '') return 0;
        var n = Number(t);
        if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Error(name + 'は0以上の整数で入力してください。');
        return n;
      }
      function tchk(val, name) {
        if (val && !TIME_RE.test(val)) throw new Error(name + 'を HH:MM 形式で入力してください。');
      }
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var plan2;
        try {
          commit(); show();
          if (!label.value.trim()) throw new Error('名称を入力してください。');
          if (!start.value) throw new Error('開始日を入力してください。');
          tchk(tm.value, '朝の時刻'); tchk(te.value, '夜の時刻');
          Object.keys(ovr).forEach(function (k) {
            tchk(ovr[k].morning, dayName(k) + 'の朝の時刻'); tchk(ovr[k].evening, dayName(k) + 'の夜の時刻');
          });
          plan2 = clone(src); delete plan2.planId; delete plan2.revision;
          plan2.label = label.value.trim(); plan2.startDate = start.value; plan2.doseText = dose.value.trim();
          plan2.enabled = enabled.checked;
          plan2.times = Object.assign({}, src.times);
          if (tm.value) plan2.times.morning = tm.value; else delete plan2.times.morning;
          if (te.value) plan2.times.evening = te.value; else delete plan2.times.evening;
          plan2.weekdayOverrides = clone(ovr);
          plan2.timers = Object.assign({}, src.timers);
          TIMER_FIELDS.forEach(function (t) { plan2.timers[t[0]] = num(tin[t[0]], t[1]); });
          plan2.futureChange = Object.assign({}, src.futureChange, { date: fcd.value, note: fcn.value.trim() });
          plan2.reminders = Object.assign({}, src.reminders, { enabled: rEn.checked, repeatMinutes: num(rRep, 'リマインダーの間隔') });
        } catch (e) { msg.textContent = e.message; return; }
        msg.textContent = '';
        var planId = isNew ? s.newPlanId : plan.planId;
        var payload = { planId: planId, expectedRevision: isNew ? 0 : plan.revision, plan: plan2 };
        mutate('health.medication.plan.put', 'plan|' + s.target + '|' + planId + '|' + JSON.stringify(payload),
          payload, false, '設定を保存しました', null, function () {
            if (isNew) { s.selPlan = planId; s.newPlanId = ''; }
          });
      });
      return f;
    }

    /* ---------- lifecycle ---------- */
    function clear() {
      if (s.dead) return;
      s.dead = true; s.gen++; s.epoch++; s.saving = null; s.data = null; s.intents = {};
      s.targets = []; s.target = ''; s.newPlanId = '';
      if (s.timer) { clearInterval(s.timer); s.timer = null; }
      views.forEach(function (v) { if (v.el.parentNode) v.el.parentNode.removeChild(v.el); });
      views = [];
      if (current === inst) current = null;
    }

    if (typeof api !== 'function' || typeof ctx.memberUserId !== 'string' || !ctx.memberUserId || !doc) {
      s.dead = true;
      return { refresh: function () { return Promise.resolve(); }, clear: function () {} };
    }
    if (homeEl) build(homeEl, false);
    if (panelEl) build(panelEl, true);
    s.target = ctx.memberUserId;
    s.timer = setInterval(tick, 15000);
    init();
    return inst;
  }

  var api = { mount: mount, _util: { localDate: localDate, fmtTime: fmtTime, toLocalInput: toLocalInput, fromLocalInput: fromLocalInput, remainText: remainText } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PALURUMedicationRoutine = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
