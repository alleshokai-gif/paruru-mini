/*
 * PALURU 試合動画 (handball match videos) view module.
 *
 * - No automatic initialisation, no global auth reads, no network access.
 * - Exposes globalThis.PaluruMatchVideos = { create, ...pure helpers }.
 * - List payload is DISPLAY METADATA ONLY. watchUrl / thumbnailUrl are never read.
 * - A watch link is obtained by getLink(id) only after the user's click, shown as a
 *   single-use, explicitly labelled YouTube anchor, and discarded afterwards.
 * - All payload text is rendered via textContent only. Nothing is persisted or logged.
 * See UI_NOTES.md for the lifecycle contract.
 */
(function (root) {
  'use strict';

  const LIMITS = Object.freeze({
    maxItems: 1000,         // complete bounded backend catalog; DOM stays paged
    maxScan: 1000,          // raw rows inspected at most
    idLength: 200,
    tournamentLabel: 80,
    matchLabel: 80,
    partLabel: 40,
    urlLength: 512,
    cardPage: 20,           // cards per "さらに表示" step
    thumbBytes: 2 * 1024 * 1024,
    thumbConcurrency: 3,
    thumbTimeoutMs: 15000,
    linkTimeoutMs: 15000,
    linkLifetimeMs: 60000   // revealed link reverts to the button after this
  });

  const STATUS = Object.freeze({
    match_identified: Object.freeze({ rank: 2, label: '試合確認済み', tone: 'ok' }),
    tournament_only: Object.freeze({ rank: 1, label: '大会のみ確認', tone: 'warn' }),
    unclassified: Object.freeze({ rank: 0, label: '分類未確認', tone: 'warn' })
  });
  const STATUS_BY_RANK = ['unclassified', 'tournament_only', 'match_identified'];

  const THUMB_UNSUPPORTED_CODES = ['THUMBNAIL_UNSUPPORTED', 'NOT_SUPPORTED', 'UNSUPPORTED'];
  const THUMB_NONE_CODES = ['THUMBNAIL_NOT_FOUND', 'NOT_FOUND'];
  const IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const WEEKDAYS = '日月火水木金土';
  const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F​‌‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;
  const UNSAFE_ID = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿]/;
  const VIDEO_TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
  const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

  /* ------------------------------------------------------------------ */
  /* Pure helpers                                                        */
  /* ------------------------------------------------------------------ */

  function cleanText(value, max) {
    if (typeof value !== 'string') return '';
    const limit = Math.max(1, max | 0);
    let s = value.length > limit * 4 + 64 ? value.slice(0, limit * 4 + 64) : value;
    s = s.replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim();
    const chars = Array.from(s);
    return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : s;
  }

  function cleanId(value) {
    if (typeof value !== 'string') return null;
    if (value.length === 0 || value.length > LIMITS.idLength) return null;
    if (UNSAFE_ID.test(value) || value.trim() === '') return null;
    return value; // opaque: compared exactly, never displayed
  }

  function parseMatchDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const y = Number(value.slice(0, 4)), m = Number(value.slice(5, 7)), d = Number(value.slice(8, 10));
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
    return value;
  }

  function formatMatchDate(value) {
    const v = parseMatchDate(value);
    if (!v) return '日付不明';
    const y = Number(v.slice(0, 4)), m = Number(v.slice(5, 7)), d = Number(v.slice(8, 10));
    const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    return y + '年' + m + '月' + d + '日（' + wd + '）';
  }

  function shortMatchDate(value) {
    const v = parseMatchDate(value);
    return v ? Number(v.slice(5, 7)) + '/' + Number(v.slice(8, 10)) : '日付不明';
  }

  /** postedAt: 'YYYY-MM-DD' (date only) or ISO timestamp with zone. */
  function parsePostedAt(value) {
    if (typeof value !== 'string' || value.length > 40) return null;
    if (parseMatchDate(value)) return Object.freeze({ kind: 'date', value: value });
    if (TIMESTAMP.test(value) && Number.isFinite(Date.parse(value))) return Object.freeze({ kind: 'timestamp', value: value });
    return null;
  }

  function formatPostedAt(posted) {
    const p = posted && typeof posted === 'object' ? posted : parsePostedAt(posted);
    if (!p) return '投稿日不明';
    if (p.kind === 'date') {
      // Date only: never invent a time.
      return '投稿 ' + Number(p.value.slice(0, 4)) + '年' + Number(p.value.slice(5, 7)) + '月' + Number(p.value.slice(8, 10)) + '日';
    }
    try {
      return '投稿 ' + new Date(p.value).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (_) {
      return '投稿日不明';
    }
  }

  function normalizeStatus(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STATUS, value) ? value : 'unclassified';
  }

  /** Returns a rebuilt canonical YouTube watch URL, or null if not allowed. */
  function safeWatchUrl(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > LIMITS.urlLength) return null;
    if (/[\s\u0000-\u001F\u007F\\]/.test(value)) return null;
    if (!/^https:\/\//i.test(value)) return null;
    let u;
    try { u = new URL(value); } catch (_) { return null; }
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    const host = u.hostname.toLowerCase();
    if (host === 'www.youtube.com' || host === 'youtube.com') {
      if (u.pathname !== '/watch') return null;
      const v = u.searchParams.getAll('v');
      if (v.length !== 1 || !VIDEO_TOKEN.test(v[0])) return null;
      return 'https://www.youtube.com/watch?v=' + v[0];
    }
    if (host === 'youtu.be') {
      const m = /^\/([A-Za-z0-9_-]{1,64})$/.exec(u.pathname);
      return m ? 'https://youtu.be/' + m[1] : null;
    }
    return null;
  }

  /** getLink response proposal: a URL string or {watchUrl: string}. */
  function linkFromResponse(response) {
    try {
      if (typeof response === 'string') return safeWatchUrl(response);
      if (response && typeof response === 'object' && !Array.isArray(response)) return safeWatchUrl(response.watchUrl);
    } catch (_) { /* fall through */ }
    return null;
  }

  function sniffImageType(bytes) {
    const b = bytes;
    if (!b || typeof b.length !== 'number' || b.length < 4) return null;
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
        b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
        (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'image/gif';
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    return null;
  }

  /** Reads ONLY whitelisted display-metadata keys. watchUrl/thumbnailUrl are never touched. */
  function normalizeItem(raw, order) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = cleanId(raw.id);
    if (!id) return null;
    return Object.freeze({
      id: id,
      order: order,
      status: normalizeStatus(raw.classificationStatus),
      tournamentId: cleanId(raw.tournamentId),
      matchId: cleanId(raw.matchId),
      tournamentLabel: cleanText(raw.tournamentLabel, LIMITS.tournamentLabel),
      matchLabel: cleanText(raw.matchLabel, LIMITS.matchLabel),
      partLabel: cleanText(raw.partLabel, LIMITS.partLabel),
      matchDate: parseMatchDate(raw.matchDate),   // never derived from postedAt
      postedAt: parsePostedAt(raw.postedAt)
    });
  }

  /** Validates the list payload. Throws {code:'INVALID_PAYLOAD'} on bad shape. */
  function normalizePayload(payload) {
    let raw;
    try { raw = payload && typeof payload === 'object' ? payload.items : undefined; } catch (_) { raw = undefined; }
    if (!Array.isArray(raw)) {
      const err = new Error('INVALID_PAYLOAD');
      err.code = 'INVALID_PAYLOAD';
      throw err;
    }
    const items = [], seen = new Set();
    let invalidCount = 0, truncated = false;
    const scan = Math.min(raw.length, LIMITS.maxScan);
    for (let i = 0; i < scan; i++) {
      if (items.length >= LIMITS.maxItems) { truncated = true; break; }
      let item = null;
      try { item = normalizeItem(raw[i], items.length); } catch (_) { item = null; }
      if (!item || seen.has(item.id)) { invalidCount++; continue; }
      seen.add(item.id);
      items.push(item);
    }
    if (raw.length > scan) truncated = true;
    return { items: items, invalidCount: invalidCount, truncated: truncated };
  }

  function weakestStatus(parts) {
    let rank = 2;
    for (const p of parts) rank = Math.min(rank, STATUS[p.status].rank);
    return STATUS_BY_RANK[rank];
  }

  function sortCards(cards) {
    cards.sort(function (a, b) {
      if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.date && !b.date) return -1;
      if (!a.date && b.date) return 1;
      return a.first - b.first;
    });
  }

  function single(it) {
    // One upload = one card. Keyed by the item's own opaque id; never merged by label/date.
    return { kind: 'single', key: 'i:' + it.id, label: it.matchLabel, parts: [it], first: it.order,
      date: it.matchDate, dateConflict: false, status: it.status };
  }

  function disambiguate(list, labelOf, suffixOf) {
    const counts = new Map();
    for (const x of list) counts.set(labelOf(x), (counts.get(labelOf(x)) || 0) + 1);
    const seen = new Map();
    for (const x of list) {
      const label = labelOf(x);
      if (counts.get(label) > 1) {
        const n = (seen.get(label) || 0) + 1;
        seen.set(label, n);
        x.optionLabel = label + '（' + suffixOf(x, n) + '）';
      } else {
        x.optionLabel = label;
      }
    }
  }

  /**
   * tournament (by tournamentId) -> cards.
   * A "match" card groups parts ONLY when they share non-null tournamentId AND matchId.
   * Rows with matchId null become individual "試合未確定" cards (one per upload).
   * Rows with tournamentId null go to `unassigned`, one card each.
   */
  function buildCatalog(items) {
    const tMap = new Map(), tournaments = [], unassigned = [];
    for (const it of items) {
      if (!it.tournamentId) { unassigned.push(single(it)); continue; }
      let t = tMap.get(it.tournamentId);
      if (!t) {
        t = { id: it.tournamentId, label: it.tournamentLabel || '大会名未設定', cards: [], matches: [],
          singleCount: 0, videoCount: 0, matchMap: new Map() };
        tMap.set(it.tournamentId, t);
        tournaments.push(t);
      }
      t.videoCount++;
      if (!it.matchId) { t.cards.push(single(it)); t.singleCount++; continue; }
      let m = t.matchMap.get(it.matchId);
      if (!m) {
        m = { kind: 'match', key: 'm:' + it.matchId, id: it.matchId, label: '', parts: [], first: it.order,
          date: null, dateConflict: false, status: 'unclassified' };
        t.matchMap.set(it.matchId, m);
        t.cards.push(m);
        t.matches.push(m);
      }
      m.parts.push(it);
    }
    for (const t of tournaments) {
      for (const m of t.matches) {
        const dates = new Set(m.parts.map(function (p) { return p.matchDate; }));
        m.date = dates.size === 1 ? m.parts[0].matchDate : null;
        m.dateConflict = dates.size > 1;
        m.status = weakestStatus(m.parts);
        const named = m.parts.find(function (p) { return p.matchLabel; });
        m.label = named ? named.matchLabel : '試合名未設定';
      }
      sortCards(t.cards);
      sortCards(t.matches);
      disambiguate(t.matches, function (m) { return m.label; }, function (m, n) {
        return (m.dateConflict ? '日付要確認' : shortMatchDate(m.date)) + '・' + n;
      });
      delete t.matchMap;
    }
    sortCards(unassigned);
    disambiguate(tournaments, function (t) { return t.label; }, function (_t, n) { return String(n); });
    return { tournaments: tournaments, unassigned: unassigned, videoCount: items.length };
  }

  function readBlobHead(blob) {
    const head = blob.slice(0, 12);
    if (typeof head.arrayBuffer === 'function') return head.arrayBuffer();
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsArrayBuffer(head);
    });
  }

  /** Resolves to the verified mime type, or null. Never throws. */
  async function validateImageBlob(blob) {
    try {
      if (typeof Blob === 'undefined' || !(blob instanceof Blob)) return null;
      const type = String(blob.type || '').toLowerCase().split(';')[0].trim();
      if (IMAGE_TYPES.indexOf(type) < 0) return null;
      if (!(blob.size > 0 && blob.size <= LIMITS.thumbBytes)) return null;
      const bytes = new Uint8Array(await readBlobHead(blob));
      return sniffImageType(bytes) === type ? type : null;
    } catch (_) {
      return null;
    }
  }

  function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
      promise,
      new Promise(function (_r, reject) { timer = setTimeout(function () { reject(new Error('TIMEOUT')); }, ms); })
    ]).finally(function () { clearTimeout(timer); });
  }

  function errorCode(err) {
    try { return err && typeof err.code === 'string' ? err.code : ''; } catch (_) { return ''; }
  }

  /* ------------------------------------------------------------------ */
  /* View controller                                                     */
  /* ------------------------------------------------------------------ */

  const THUMB_TEXT = Object.freeze({
    loading: '読み込み中',
    none: 'サムネイルなし',
    unavailable: 'サムネイル表示不可',
    failed: 'サムネイル読込失敗'
  });

  function create(options) {
    const opts = options || {};
    const host = opts.root;
    if (!host || typeof host.appendChild !== 'function' || !host.ownerDocument) {
      throw new TypeError('MATCH_VIDEOS_ROOT_REQUIRED');
    }
    const doc = host.ownerDocument;
    const read = typeof opts.read === 'function' ? opts.read : null;
    const getLink = typeof opts.getLink === 'function' ? opts.getLink : null;
    const readThumbnail = typeof opts.readThumbnail === 'function' ? opts.readThumbnail : null;
    const onBack = typeof opts.onBack === 'function' ? opts.onBack : null;
    const onSignIn = typeof opts.onSignIn === 'function' ? opts.onSignIn : null;
    const URLApi = root.URL;

    let session = { authenticated: false, allowed: false };
    let isOpen = false, destroyed = false, loading = false;
    let seq = 0, viewState = 'closed', currentLoad = null;
    let catalog = null, meta = null;
    // Selection (memory only). selT: {type:'all'} | {type:'t', id} | {type:'u'}
    // selM: {type:'all'} | {type:'m', id} | {type:'x'} (match-unconfirmed uploads)
    let selT = { type: 'all' }, selM = { type: 'all' };
    let cardLimit = LIMITS.cardPage;

    // Thumbnails
    let thumbGen = 0, thumbActive = 0, thumbsUnsupported = false;
    const thumbCache = new Map();
    const thumbPending = new Set();
    const thumbQueue = [];
    const slots = new Map();
    const objectUrls = new Set();
    let visibleThumbs = new WeakMap();
    const thumbObserver = typeof root.IntersectionObserver === 'function' ? new root.IntersectionObserver(entries => {
      for (const entry of entries) {
        const item = visibleThumbs.get(entry.target);
        if (entry.isIntersecting && item && isOpen && !destroyed) {
          thumbObserver.unobserve(entry.target);
          visibleThumbs.delete(entry.target);
          queueThumb(item, entry.target);
        }
      }
    }) : null;

    // Link (at most one in flight or revealed at a time; never cached)
    let linkGen = 0, active = null; // {slot, item, context, timer}

    function el(tag, cls, text) {
      const node = doc.createElement(tag);
      if (cls) node.className = cls;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function option(text, value) {
      const o = doc.createElement('option');
      o.value = value;
      o.textContent = text;
      return o;
    }
    function button(text, cls, handler) {
      const b = el('button', cls, text);
      b.type = 'button';
      b.addEventListener('click', function () { if (!destroyed) handler(); });
      return b;
    }
    function badge(text, tone) {
      const b = el('span', 'mv-badge mv-badge-' + tone, text);
      return b;
    }
    function statusBadge(status) {
      const s = STATUS[status];
      return badge(s.label, s.tone);
    }

    /* ---------- scaffold ---------- */
    host.replaceChildren();
    const wrap = el('div', 'mv');
    wrap.dataset.state = 'closed';
    const header = el('div', 'view-header mv-header');
    if (onBack) header.append(button('戻る', 'secondary-button mv-back', function () { onBack(); }));
    header.append(el('h1', 'mv-title', '試合動画'));
    const lead = el('p', 'mv-lead', '大会・試合ごとに動画を探せます。「リンクを取得」を押すと、YouTubeで開くリンクが表示されます。');

    const panel = el('div', 'mv-panel');
    const controls = el('div', 'mv-controls');
    controls.hidden = true;
    const tField = el('label', 'mv-field');
    const tSelect = el('select', 'mv-select');
    tSelect.name = 'matchVideosTournament';
    tField.append(el('span', 'mv-field-label', '大会'), tSelect);
    const mField = el('label', 'mv-field');
    const mSelect = el('select', 'mv-select');
    mSelect.name = 'matchVideosMatch';
    mField.append(el('span', 'mv-field-label', '試合'), mSelect);
    const reloadBtn = button('再読み込み', 'mv-button mv-reload', function () { reload(); });
    controls.append(tField, mField, reloadBtn);

    const status = el('p', 'mv-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const notices = el('div', 'mv-notices');
    const body = el('div', 'mv-body');
    panel.append(controls, status, notices, body);
    wrap.append(header, lead, panel);
    host.append(wrap);

    tSelect.addEventListener('change', function () {
      if (destroyed || !catalog) return;
      const v = tSelect.value;
      const m = /^t(\d+)$/.exec(v);
      const t = m ? catalog.tournaments[Number(m[1])] : null;
      if (t) selT = { type: 't', id: t.id };
      else if (v === 'u' && catalog.unassigned.length) selT = { type: 'u' };
      else selT = { type: 'all' };
      selM = { type: 'all' };              // always reset: match IDs are tournament-scoped
      fillMatchOptions();
      filterRerender();
    });
    mSelect.addEventListener('change', function () {
      if (destroyed || !catalog) return;
      const t = currentTournament();
      const v = mSelect.value;
      const m = /^m(\d+)$/.exec(v);
      const match = t && m ? t.matches[Number(m[1])] : null;
      if (match) selM = { type: 'm', id: match.id };
      else if (t && v === 'x' && t.singleCount) selM = { type: 'x' };
      else selM = { type: 'all' };
      filterRerender();
    });

    /* ---------- state helpers ---------- */
    function setViewState(name) {
      viewState = name;
      wrap.dataset.state = name;
      body.setAttribute('aria-busy', name === 'loading' ? 'true' : 'false');
    }

    function revokeThumbs() {
      thumbGen++;
      thumbObserver?.disconnect();
      visibleThumbs = new WeakMap();
      for (const url of objectUrls) { try { URLApi.revokeObjectURL(url); } catch (_) { /* ignore */ } }
      objectUrls.clear();
      thumbCache.clear();
      thumbPending.clear();
      thumbQueue.length = 0;
      slots.clear();
    }

    function resetData() {
      clearLinks();
      revokeThumbs();
      thumbsUnsupported = false;
      catalog = null;
      meta = null;
      cardLimit = LIMITS.cardPage;
      body.replaceChildren();
      notices.replaceChildren();
      tSelect.replaceChildren();
      mSelect.replaceChildren();
      controls.hidden = true;
    }

    function resetSelection() { selT = { type: 'all' }; selM = { type: 'all' }; }

    const STATES = {
      'signed-out': { icon: '鍵', title: 'ログインが必要です', text: '試合動画を見るには、ログインしてください。' },
      forbidden: { icon: '×', title: '閲覧権限がありません', text: 'このアカウントでは試合動画を表示できません。必要な場合は管理者にお問い合わせください。' },
      'not-configured': { icon: '－', title: '試合動画は未接続です', text: '動画の配信元との接続がまだ設定されていないため、表示できません。' },
      error: { icon: '!', title: '試合動画を読み込めませんでした', text: '通信状況を確認して、もう一度お試しください。' },
      invalid: { icon: '!', title: '試合動画を読み込めませんでした', text: '受け取ったデータの形式を確認できませんでした。時間をおいてもう一度お試しください。' },
      empty: { icon: '▶', title: 'まだ試合動画がありません', text: '動画が登録されると、大会・試合ごとにここへ表示されます。' }
    };

    function showState(kind) {
      const def = STATES[kind];
      clearLinks();
      setViewState(kind);
      controls.hidden = true;
      status.className = 'mv-status mv-sr';
      status.textContent = def.title;
      const card = el('section', 'mv-state');
      card.dataset.kind = kind;
      const icon = el('span', 'mv-state-icon', def.icon);
      icon.setAttribute('aria-hidden', 'true');
      card.append(icon, el('h2', 'mv-state-title', def.title), el('p', 'mv-state-text', def.text));
      if ((kind === 'error' || kind === 'invalid') && read) {
        card.append(button('もう一度読み込む', 'mv-button mv-button-primary', function () { reload(); }));
      }
      if (kind === 'signed-out' && onSignIn) {
        card.append(button('ログインする', 'mv-button mv-button-primary', function () { onSignIn(); }));
      }
      body.replaceChildren(card);
    }

    function showLoading() {
      setViewState('loading');
      controls.hidden = true;
      status.className = 'mv-status';
      status.textContent = '試合動画を読み込み中…';
      const box = el('div', 'mv-skeletons');
      box.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 3; i++) box.append(el('div', 'mv-skeleton'));
      body.replaceChildren(box);
    }

    function gate() {
      if (!session.authenticated) { showState('signed-out'); return false; }
      if (!session.allowed) { showState('forbidden'); return false; }
      if (!read) { showState('not-configured'); return false; }
      return true;
    }

    function loseSession(code) {
      seq++;
      loading = false;
      currentLoad = null;
      session = code === 'FORBIDDEN' ? { authenticated: true, allowed: false } : { authenticated: false, allowed: false };
      resetData();
      resetSelection();
      showState(code === 'FORBIDDEN' ? 'forbidden' : 'signed-out');
    }

    function handleReadError(err) {
      const code = errorCode(err);
      if (code === 'UNAUTHENTICATED' || code === 'FORBIDDEN') loseSession(code);
      else if (code === 'MATCH_VIDEOS_NOT_CONFIGURED') showState('not-configured');
      else showState('error');
    }

    async function load() {
      if (destroyed || !isOpen) return;
      const current = ++seq;
      resetData();
      if (!gate()) { loading = false; return; }
      loading = true;
      showLoading();
      let payload;
      try {
        payload = await read();
      } catch (err) {
        if (current !== seq || !isOpen || destroyed) return;
        loading = false;
        handleReadError(err);
        return;
      }
      if (current !== seq || !isOpen || destroyed) return;  // late read: ignore
      loading = false;
      let normalized;
      try { normalized = normalizePayload(payload); } catch (_) { showState('invalid'); return; }
      payload = null;
      catalog = buildCatalog(normalized.items);
      meta = { invalidCount: normalized.invalidCount, truncated: normalized.truncated };
      if (!catalog.videoCount) {
        showState('empty');
        renderNotices();
        return;
      }
      // Keep the in-memory selection only if it is still valid.
      if (selT.type === 't') {
        const t = currentTournament();
        if (!t) resetSelection();
        else if (selM.type === 'm' && !t.matches.some(function (m) { return m.id === selM.id; })) selM = { type: 'all' };
        else if (selM.type === 'x' && !t.singleCount) selM = { type: 'all' };
      } else if (selT.type === 'u' && !catalog.unassigned.length) {
        resetSelection();
      } else {
        selM = { type: 'all' };
      }
      renderReady();
    }

    function currentTournament() {
      if (!catalog || selT.type !== 't') return null;
      for (const t of catalog.tournaments) if (t.id === selT.id) return t;
      return null;
    }

    function fillTournamentOptions() {
      tSelect.replaceChildren(option('すべての大会', ''));
      let selected = '';
      catalog.tournaments.forEach(function (t, i) {
        tSelect.append(option(t.optionLabel, 't' + i));
        if (selT.type === 't' && t.id === selT.id) selected = 't' + i;
      });
      if (catalog.unassigned.length) {
        tSelect.append(option('大会未分類の動画（' + catalog.unassigned.length + '本）', 'u'));
        if (selT.type === 'u') selected = 'u';
      }
      tSelect.value = selected;
      tSelect.disabled = tSelect.options.length <= 1;
    }

    function fillMatchOptions() {
      const t = currentTournament();
      if (!t) {
        mSelect.replaceChildren(option(selT.type === 'u' ? '大会未分類のため選べません' : '大会を選ぶと選べます', ''));
        mSelect.value = '';
        mSelect.disabled = true;
        return;
      }
      mSelect.replaceChildren(option('すべての試合', ''));
      let selected = '';
      t.matches.forEach(function (m, i) {
        mSelect.append(option(m.optionLabel, 'm' + i));
        if (selM.type === 'm' && m.id === selM.id) selected = 'm' + i;
      });
      if (t.singleCount) {
        mSelect.append(option('試合未確定の動画（' + t.singleCount + '本）', 'x'));
        if (selM.type === 'x') selected = 'x';
      }
      mSelect.value = selected;
      mSelect.disabled = false;
    }

    function renderReady() {
      setViewState('ready');
      controls.hidden = false;
      reloadBtn.disabled = false;
      fillTournamentOptions();
      fillMatchOptions();
      renderList(null);
    }

    function filterRerender() {
      clearLinks();
      revokeThumbs();
      cardLimit = LIMITS.cardPage;
      renderList(null);
    }

    function renderNotices() {
      notices.replaceChildren();
      if (!meta) return;
      if (meta.truncated) {
        notices.append(el('p', 'mv-notice', '表示できる上限（' + LIMITS.maxItems + '本）を超えたため、一部の動画のみ表示しています。'));
      }
      if (meta.invalidCount > 0) {
        notices.append(el('p', 'mv-notice', '形式を確認できない動画データが' + meta.invalidCount + '件あったため、表示から除外しました。'));
      }
    }

    function visibleSections() {
      const out = [];
      if (selT.type === 'u') {
        out.push({ unassigned: true, title: '大会未分類の動画', cards: catalog.unassigned });
        return out;
      }
      const t = currentTournament();
      if (t) {
        let cards = t.cards;
        if (selM.type === 'm') cards = t.cards.filter(function (c) { return c.kind === 'match' && c.id === selM.id; });
        else if (selM.type === 'x') cards = t.cards.filter(function (c) { return c.kind === 'single'; });
        out.push({ title: t.label, cards: cards });
        return out;
      }
      for (const tour of catalog.tournaments) out.push({ title: tour.label, cards: tour.cards });
      if (catalog.unassigned.length) out.push({ unassigned: true, title: '大会未分類の動画', cards: catalog.unassigned });
      return out;
    }

    function renderList(focusIndex) {
      clearLinks();
      slots.clear();
      const frag = doc.createDocumentFragment();
      const sections = visibleSections();
      const cards = [];
      let rendered = 0, totalCards = 0, matchCount = 0, singleCount = 0, videoCount = 0;

      for (const sec of sections) {
        let secMatches = 0, secSingles = 0, secVideos = 0;
        for (const c of sec.cards) {
          if (c.kind === 'match') secMatches++; else secSingles++;
          secVideos += c.parts.length;
        }
        totalCards += sec.cards.length;
        matchCount += secMatches;
        singleCount += secSingles;
        videoCount += secVideos;
        if (rendered >= cardLimit || !sec.cards.length) continue;

        const section = el('section', sec.unassigned ? 'mv-tournament mv-unassigned' : 'mv-tournament');
        const head = el('div', 'mv-tournament-head');
        const metaBits = [];
        if (secMatches) metaBits.push('試合 ' + secMatches);
        if (secSingles) metaBits.push('試合未確定 ' + secSingles + '本');
        metaBits.push('動画 ' + secVideos + '本');
        head.append(el('h2', 'mv-tournament-title', sec.title), el('p', 'mv-tournament-meta', metaBits.join(' · ')));
        section.append(head);
        if (sec.unassigned) {
          section.append(el('p', 'mv-section-note', '大会がまだ確認されていない動画です。1本ずつ表示しています。'));
        } else if (secSingles) {
          section.append(el('p', 'mv-section-note', '「試合未確定」の動画は、同じ試合か確認されていないため、名称や日付が同じでも1本ずつ表示しています。'));
        }
        const grid = el('div', 'mv-match-grid');
        for (const c of sec.cards) {
          if (rendered >= cardLimit) break;
          const node = card(c, !!sec.unassigned);
          grid.append(node);
          cards.push(node);
          rendered++;
        }
        section.append(grid);
        frag.append(section);
      }

      const remaining = totalCards - rendered;
      if (remaining > 0) {
        const before = rendered;
        frag.append(button('さらに表示（残り' + remaining + '件）', 'mv-button mv-more', function () {
          cardLimit += LIMITS.cardPage;
          renderList(before);
        }));
      }

      body.replaceChildren(frag);

      const bits = [];
      if (selT.type !== 'all') bits.push('表示中');
      else bits.push('大会 ' + catalog.tournaments.length);
      bits.push('試合 ' + matchCount);
      if (singleCount) bits.push('試合未確定 ' + singleCount + '本');
      bits.push('動画 ' + videoCount + '本');
      status.className = 'mv-status';
      status.textContent = bits.join(' · ');
      renderNotices();

      if (focusIndex !== null && cards[focusIndex]) cards[focusIndex].focus();
    }

    function card(c, unassigned) {
      const node = el('article', 'mv-match' + (c.kind === 'single' ? ' is-single' : ''));
      node.tabIndex = -1;
      const head = el('div', 'mv-match-head');
      const metaRow = el('div', 'mv-match-meta');
      metaRow.append(el('span', 'mv-match-date' + (c.date ? '' : ' is-unknown'),
        c.dateConflict ? '試合日 要確認' : formatMatchDate(c.date)));
      if (c.kind === 'single') metaRow.append(badge(unassigned ? '大会未確定' : '試合未確定', 'warn'));
      metaRow.append(statusBadge(c.status));
      if (c.kind === 'match') metaRow.append(el('span', 'mv-match-count', '動画 ' + c.parts.length + '本'));
      head.append(metaRow);
      if (c.kind === 'match') {
        head.append(el('h3', 'mv-match-title', c.label));
      } else {
        const p = c.parts[0];
        head.append(el('h3', 'mv-match-title', c.label || '試合名なし'));
        if (c.label) head.append(el('p', 'mv-match-hint', '試合名は参考情報です。同じ試合かは未確認です。'));
        if (unassigned && p.tournamentLabel) head.append(el('p', 'mv-match-hint', '大会名（未確認）: ' + p.tournamentLabel));
      }
      const list = el('ul', 'mv-parts');
      c.parts.forEach(function (p, i) {
        list.append(partRow(p, i, {
          showDate: c.dateConflict,
          showStatus: c.kind === 'match' && p.status !== c.status,
          context: c.label || '試合名なし'
        }));
      });
      node.append(head, list);
      return node;
    }

    function partRow(p, index, flags) {
      const li = el('li', 'mv-part');
      const label = p.partLabel || '動画' + (index + 1);
      const thumb = el('span', 'mv-thumb');
      thumb.setAttribute('aria-hidden', 'true');
      const text = el('div', 'mv-part-text');
      const labelLine = el('p', 'mv-part-label', label);
      text.append(labelLine);
      if (flags.showStatus) text.append(statusBadge(p.status));
      const metaBits = [];
      if (flags.showDate) metaBits.push('試合日 ' + formatMatchDate(p.matchDate));
      metaBits.push(formatPostedAt(p.postedAt));
      text.append(el('p', 'mv-part-meta', metaBits.join(' · ')));
      const action = el('div', 'mv-part-action');
      li.append(thumb, text, action);
      const ctx = { item: p, slot: action, name: flags.context + ' ' + label };
      renderLinkIdle(ctx, false);
      attachThumb(p, thumb);
      return li;
    }

    /* ---------- links: fetched fresh on click, single use, never cached ---------- */
    function focusIfInside(slot, target) {
      const activeEl = doc.activeElement;
      return activeEl && slot.contains(activeEl) ? target : null;
    }

    function renderLinkIdle(ctx, restoreFocus, message) {
      const slot = ctx.slot;
      if (!getLink) {
        slot.dataset.link = 'unavailable';
        slot.replaceChildren(el('span', 'mv-link-note is-muted', 'リンクを利用できません（未接続）'));
        return;
      }
      slot.dataset.link = message ? 'error' : 'idle';
      const b = button(message ? 'もう一度取得' : 'リンクを取得', 'mv-button mv-link-button', function () { void requestLink(ctx); });
      b.append(el('span', 'mv-sr', '（' + ctx.name + '）'));
      const nodes = [];
      if (message) {
        const msg = el('p', 'mv-link-note is-error', message);
        msg.setAttribute('role', 'alert');
        nodes.push(msg);
      }
      nodes.push(b);
      slot.replaceChildren.apply(slot, nodes);
      if (restoreFocus) b.focus();
    }

    function clearLinks() {
      linkGen++;
      if (!active) return;
      const a = active;
      active = null;
      clearTimeout(a.timer);
      if (a.ctx.slot.isConnected && !destroyed) {
        const hadFocus = !!focusIfInside(a.ctx.slot, true);
        renderLinkIdle(a.ctx, hadFocus);
      }
    }

    async function requestLink(ctx) {
      if (destroyed || !isOpen || viewState !== 'ready' || !getLink) return;
      clearLinks();                         // only one link in flight / revealed at a time
      const gen = linkGen;
      active = { ctx: ctx, timer: 0 };
      ctx.slot.dataset.link = 'loading';
      const pending = el('button', 'mv-button mv-link-button', 'リンクを確認中…');
      pending.type = 'button';
      pending.disabled = true;
      ctx.slot.replaceChildren(pending);
      pending.setAttribute('aria-busy', 'true');
      let response;
      try {
        response = await withTimeout(Promise.resolve().then(function () {
          return gen === linkGen && isOpen && !destroyed ? getLink(ctx.item.id) : null;
        }), LIMITS.linkTimeoutMs);
      } catch (err) {
        if (gen !== linkGen || destroyed || !isOpen) return;
        const code = errorCode(err);
        active = null;
        if (code === 'UNAUTHENTICATED') { loseSession(code); return; }
        if (!ctx.slot.isConnected) return;
        renderLinkIdle(ctx, true, code === 'FORBIDDEN' ? 'この動画を開く権限がありません。' : 'リンクを取得できませんでした。');
        return;
      }
      if (gen !== linkGen || destroyed || !isOpen || !ctx.slot.isConnected) return;  // late: discard
      const url = linkFromResponse(response);
      response = null;
      if (!url) {
        active = null;
        renderLinkIdle(ctx, true, '有効なYouTubeリンクを確認できませんでした。');
        return;
      }
      ctx.slot.dataset.link = 'ready';
      const a = el('a', 'mv-button mv-button-primary mv-link-open');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.referrerPolicy = 'no-referrer';
      a.append(el('span', null, 'YouTubeで開く'), el('span', 'mv-sr', '（' + ctx.name + '、新しいタブで開きます）'));
      const done = function () { setTimeout(function () { if (gen === linkGen) clearLinks(); }, 0); };
      a.addEventListener('click', done);
      a.addEventListener('auxclick', done);
      const note = el('p', 'mv-link-note', 'この画面のリンク表示は1分で閉じます。開き直す時は再取得してください。');
      ctx.slot.replaceChildren(a, note);
      active.timer = setTimeout(function () { if (gen === linkGen) clearLinks(); }, LIMITS.linkLifetimeMs);
      a.focus();
    }

    /* ---------- thumbnails ---------- */
    function setThumb(slot, kind) {
      slot.dataset.thumb = kind;
      slot.replaceChildren(el('span', 'mv-thumb-text', THUMB_TEXT[kind]));
    }

    function applyThumb(id, slot, result) {
      if (result.status === 'none') { setThumb(slot, 'none'); return; }
      if (result.status === 'unsupported') { setThumb(slot, 'unavailable'); return; }
      if (result.status !== 'loaded') { setThumb(slot, 'failed'); return; }
      const img = el('img', 'mv-thumb-img');
      img.alt = '';
      img.decoding = 'async';
      img.addEventListener('error', function () {
        if (objectUrls.has(result.url)) {
          try { URLApi.revokeObjectURL(result.url); } catch (_) { /* ignore */ }
          objectUrls.delete(result.url);
        }
        thumbCache.set(id, { status: 'failed' });
        if (slot.isConnected) setThumb(slot, 'failed');
      });
      slot.dataset.thumb = 'loaded';
      slot.replaceChildren(img);
      img.src = result.url;
    }

    function attachThumb(item, slot) {
      slots.set(item.id, slot);
      if (!readThumbnail || !thumbObserver) { setThumb(slot, 'unavailable'); return; }
      setThumb(slot, 'none');
      visibleThumbs.set(slot, item);
      thumbObserver.observe(slot);
    }

    function queueThumb(item, slot) {
      if (!readThumbnail || thumbsUnsupported || !URLApi || typeof URLApi.createObjectURL !== 'function') {
        setThumb(slot, 'unavailable');
        return;
      }
      const cached = thumbCache.get(item.id);
      if (cached) { applyThumb(item.id, slot, cached); return; }
      setThumb(slot, 'loading');
      if (!thumbPending.has(item.id)) {
        thumbPending.add(item.id);
        thumbQueue.push(item.id);
        pumpThumbs();
      }
    }

    function pumpThumbs() {
      while (!thumbsUnsupported && thumbActive < LIMITS.thumbConcurrency && thumbQueue.length) {
        const id = thumbQueue.shift();
        const gen = thumbGen;
        thumbActive++;
        runThumb(id, gen).finally(function () {
          thumbActive--;
          if (!destroyed) pumpThumbs();
        });
      }
    }

    function markUnsupported() {
      thumbsUnsupported = true;
      thumbQueue.length = 0;
      thumbPending.clear();
      for (const slot of slots.values()) {
        if (slot.isConnected && slot.dataset.thumb === 'loading') setThumb(slot, 'unavailable');
      }
    }

    async function runThumb(id, gen) {
      let result = { status: 'failed' };
      try {
        const blob = await withTimeout(Promise.resolve().then(function () {
          return gen === thumbGen && isOpen && !destroyed ? readThumbnail(id) : null;
        }), LIMITS.thumbTimeoutMs);
        if (gen !== thumbGen || destroyed) return;
        if (blob === null || blob === undefined) {
          result = { status: 'none' };
        } else {
          const type = await validateImageBlob(blob);
          if (gen !== thumbGen || destroyed) return;
          if (type) {
            const url = URLApi.createObjectURL(blob);
            objectUrls.add(url);
            result = { status: 'loaded', url: url };
          }
        }
      } catch (err) {
        if (gen !== thumbGen || destroyed) return;
        const code = errorCode(err);
        if (THUMB_UNSUPPORTED_CODES.indexOf(code) >= 0) { markUnsupported(); return; }
        if (THUMB_NONE_CODES.indexOf(code) >= 0) result = { status: 'none' };
      }
      thumbCache.set(id, result);
      thumbPending.delete(id);
      const slot = slots.get(id);
      if (slot && slot.isConnected) applyThumb(id, slot, result);
    }

    /* ---------- public lifecycle ---------- */
    function open() {
      if (destroyed) return Promise.resolve();
      if (isOpen && (loading || catalog)) return currentLoad || Promise.resolve();
      isOpen = true;
      currentLoad = load();
      return currentLoad;
    }

    function reload() {
      if (destroyed || !isOpen || loading) return currentLoad || Promise.resolve();
      currentLoad = load();
      return currentLoad;
    }

    function close() {
      if (destroyed) return;
      isOpen = false;
      seq++;
      loading = false;
      currentLoad = null;
      resetData();
      resetSelection();
      setViewState('closed');
      status.className = 'mv-status';
      status.textContent = '';
    }

    function setSession(next) {
      if (destroyed) return;
      const authenticated = !!(next && next.authenticated === true);
      session = { authenticated: authenticated, allowed: authenticated && !!(next && next.allowed === true) };
      seq++;
      loading = false;
      currentLoad = null;
      resetData();
      resetSelection();
      if (!isOpen) { setViewState('closed'); status.textContent = ''; return; }
      currentLoad = load();
    }

    function destroy() {
      if (destroyed) return;
      close();
      destroyed = true;
      host.replaceChildren();
    }

    function getState() {
      return Object.freeze({ state: viewState, isOpen: isOpen, loading: loading, destroyed: destroyed });
    }

    return Object.freeze({ open: open, close: close, reload: reload, setSession: setSession, destroy: destroy, getState: getState });
  }

  root.PaluruMatchVideos = Object.freeze({
    create: create,
    normalizePayload: normalizePayload,
    buildCatalog: buildCatalog,
    safeWatchUrl: safeWatchUrl,
    linkFromResponse: linkFromResponse,
    cleanText: cleanText,
    parseMatchDate: parseMatchDate,
    parsePostedAt: parsePostedAt,
    formatMatchDate: formatMatchDate,
    formatPostedAt: formatPostedAt,
    normalizeStatus: normalizeStatus,
    sniffImageType: sniffImageType,
    validateImageBlob: validateImageBlob,
    STATUS: STATUS,
    LIMITS: LIMITS
  });
})(globalThis);
