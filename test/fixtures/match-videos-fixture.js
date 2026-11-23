/*
 * Synthetic fixture for features/match-videos/page.js.
 * - All labels/IDs are fabricated. No real teams, schools, videos or URLs.
 * - List items are DISPLAY METADATA ONLY (no watchUrl / thumbnailUrl), except the
 *   `malicious` scenario which adds them on purpose to prove they are ignored.
 * - read(), getLink(), readThumbnail() are local promises. No fetch/XHR.
 * - Clicks on revealed links are prevented (no navigation). preventDefault only,
 *   so the module's own single-use handler still runs.
 * Query: ?scenario=<name>
 */
(function () {
  'use strict';

  const api = globalThis.PaluruMatchVideos;
  // Clearly nonexistent synthetic link values (never navigated to).
  const WATCH = 'https://www.youtube.com/watch?v=fixture-only-not-a-video';
  const WATCH_SHORT = 'https://youtu.be/fixture-only-not-a-video';

  const SCENARIOS = [
    ['normal', '通常（大会3・ID/名称重複・複数パート・試合未確定2本）'],
    ['empty', '0件'],
    ['loading', '読み込み中のまま'],
    ['slow', '3秒後に応答（遅延応答の破棄確認）'],
    ['unauthenticated', '未ログイン（セッション）'],
    ['expired', '未ログイン（read が UNAUTHENTICATED）'],
    ['forbidden', '権限なし（セッション）'],
    ['denied', '権限なし（read が FORBIDDEN）'],
    ['unconfigured', '未接続（MATCH_VIDEOS_NOT_CONFIGURED）'],
    ['no-reader', '未接続（read 未注入）'],
    ['failed', '読み込みエラー'],
    ['invalid', '不正なレスポンス形式'],
    ['thumbnail-failed', 'サムネイル失敗・不正画像'],
    ['thumbnail-unsupported', 'サムネイル非対応（THUMBNAIL_UNSUPPORTED）'],
    ['no-thumbnail-reader', 'サムネイル読込関数なし'],
    ['link-failed', 'リンク取得失敗・権限なし・不正URL・遅延'],
    ['link-expired', 'リンク取得で UNAUTHENTICATED'],
    ['no-link-reader', 'getLink 未注入'],
    ['unclassified', '分類未確定のみ'],
    ['long', '長い名称・大量件数・上限超過'],
    ['malicious', '悪意ある値・想定外の URL 項目']
  ];
  const NAMES = SCENARIOS.map(function (s) { return s[0]; });

  /* ---------- synthetic metadata ---------- */
  function v(id, tId, tLabel, mId, mLabel, date, posted, part, status, extra) {
    const item = {
      id: id, tournamentId: tId, tournamentLabel: tLabel, matchId: mId, matchLabel: mLabel,
      matchDate: date, postedAt: posted, partLabel: part,
      classificationStatus: tId ? (mId ? 'match_identified' : 'tournament_only') : 'unclassified'
    };
    if (extra) for (const k of Object.keys(extra)) item[k] = extra[k];
    return item;
  }
  const OC = 'opponent_confirmed', PA = 'partial', TE = 'tentative', UN = 'unconfirmed';

  function normalItems() {
    const A = 'fx-t-a', AL = '第1回 サンプル春季交流大会';
    const B = 'fx-t-b', BL = 'サンプル秋季カップ';
    const C = 'fx-t-c', CL = 'サンプル秋季カップ'; // same label as B, different tournament
    return [
      // Confirmed shared matchId -> ONE card with 前半/後半
      v('fx-v-01', A, AL, 'fx-m-1', '1回戦 チームA 対 チームB', '2026-05-03', '2026-05-03T20:15:00+09:00', '前半', OC),
      v('fx-v-02', A, AL, 'fx-m-1', '1回戦 チームA 対 チームB', '2026-05-03', '2026-05-03', '後半', OC),
      // Shared matchId, mixed statuses -> card shows weakest (一部確認), parts show their own
      v('fx-v-03', A, AL, 'fx-m-2', '2回戦 チームA 対 チームC', '2026-05-04', '2026-05-04T19:00:00+09:00', '前半', OC),
      v('fx-v-04', A, AL, 'fx-m-2', '2回戦 チームA 対 チームC', '2026-05-04', '2026-05-04T19:05:00+09:00', '後半', PA),
      v('fx-v-05', A, AL, 'fx-m-2', '2回戦 チームA 対 チームC', '2026-05-04', '2026-05-04T19:10:00+09:00', '延長', PA),
      // matchDate null with postedAt present -> 日付不明
      v('fx-v-06', A, AL, 'fx-m-3', '順位決定戦 チームD 対 チームE', null, '2026-05-06T09:00:00+09:00', '前半', TE),
      v('fx-v-07', A, AL, 'fx-m-3', null, null, null, '後半', TE),
      // TWO uploads: same tournament, same label, same date, matchId null -> MUST stay separate
      v('fx-v-08', A, AL, null, '練習試合 チームA 対 チームH', '2026-05-05', '2026-05-05', '前半', TE),
      v('fx-v-09', A, AL, null, '練習試合 チームA 対 チームH', '2026-05-05', '2026-05-05', '後半', UN),
      // Tournament B reuses match ID fx-m-1 AND the same match label as A
      v('fx-v-10', B, BL, 'fx-m-1', '1回戦 チームA 対 チームB', '2026-10-12', '2026-10-12T21:00:00+09:00', '前半', OC),
      v('fx-v-11', B, BL, 'fx-m-1', '1回戦 チームA 対 チームB', '2026-10-12', '2026-10-12T21:05:00+09:00', '後半', OC),
      v('fx-v-12', B, BL, 'fx-m-2', '決勝 チームA 対 チームF', '2026-10-13', '2026-10-13', '前半', PA),
      v('fx-v-13', B, BL, 'fx-m-2', '決勝 チームA 対 チームF', '2026-10-13', '2026-10-13', '後半', PA),
      // Tournament C: same label as B, reuses fx-m-1 again
      v('fx-v-14', C, CL, 'fx-m-1', '1回戦 チームA 対 チームB', null, '2026-11-02T12:00:00+09:00', '前半', TE),
      v('fx-v-15', C, CL, 'fx-m-1', '1回戦 チームA 対 チームB', null, '2026-11-02T12:10:00+09:00', '後半', TE),
      // No tournament
      v('fx-v-16', null, null, null, null, null, '2026-11-10T08:00:00+09:00', '練習の記録', UN),
      v('fx-v-17', null, 'サンプル冬季大会（候補）', 'fx-m-1', '候補 チームA 対 チームG', null, null, '前半', TE)
    ];
  }

  function unclassifiedItems() {
    return [
      v('fx-u-1', null, null, null, null, null, '2026-11-01T10:00:00+09:00', '前半', UN),
      v('fx-u-2', null, null, null, null, null, '2026-11-01', '後半', UN),
      v('fx-u-3', 'fx-t-x', 'サンプル冬季大会（仮）', null, '1回戦（仮）', '2026-12-01', null, '', 'pending-review'),
      v('fx-u-4', 'fx-t-x', 'サンプル冬季大会（仮）', null, '1回戦（仮）', '2026-12-01', null, '前半', null),
      v('fx-u-5', 'fx-t-x', 'サンプル冬季大会（仮）', null, '1回戦（仮）', '2026-12-01', null, '後半', 'confirmed')
    ];
  }

  function longItems() {
    const items = [];
    const longT = 'とても長い名称のサンプル大会'.repeat(12);
    const unbroken = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(6);
    const parts = ['前半', '後半', '延長前半', '延長後半'];
    const statuses = [OC, PA, TE, UN];
    let n = 0;
    for (let t = 0; t < 2; t++) {
      const tId = 'fx-long-t-' + t;
      const tLabel = t === 0 ? longT : unbroken;
      for (let m = 0; m < 45; m++) {
        const day = String((m % 28) + 1).padStart(2, '0');
        const date = m % 9 === 4 ? null : '2026-0' + (t + 6) + '-' + day;
        const label = m % 10 === 3 ? '同名の試合 チームA 対 チームB'
          : '第' + (m + 1) + '試合 ' + 'とても長いチーム名のサンプルチーム'.repeat(3) + ' 対 チームZ';
        const count = 2 + (m % 3);
        for (let p = 0; p < count; p++) {
          n++;
          const d = m === 7 && p === 1 ? '2026-07-30' : date; // conflicting dates -> 試合日 要確認
          items.push(v('fx-long-v-' + n, tId, tLabel, m % 11 === 5 ? null : 'fx-m-' + m, label, d,
            '2026-08-01T12:00:00Z', p === 0 && m === 0 ? 'とても長いパート名'.repeat(10) : parts[p], statuses[(m + p) % 4]));
        }
      }
    }
    for (let i = 0; i < 40; i++) {
      n++;
      items.push(v('fx-long-v-' + n, null, null, null, null, null, null, '分類待ち ' + (i + 1), UN));
    }
    return items; // > LIMITS.maxItems -> truncation notice
  }

  function maliciousItems() {
    const T = 'fx-t-evil', TL = '<img src=x onerror="alert(1)">';
    // watchUrl / thumbnailUrl are present ON PURPOSE: the module must ignore them.
    const leak = { watchUrl: 'javascript:alert(1)', thumbnailUrl: 'https://example.invalid/should-never-load.png' };
    return [
      v('fx-x-1', T, TL, 'fx-m-1', '"><script>alert(1)</script>', '2026-02-30', 'not-a-date', '<b>前半</b>', OC, leak),
      v('fx-x-2', T, TL, 'fx-m-1', '"><script>alert(1)</script>', '2026/05/03', '2026-05-03T25:99', '後半‮evil\u0000\u0007', OC, { watchUrl: WATCH }),
      v('fx-x-3', T, TL, 'fx-m-2', '{{constructor.constructor("alert(1)")()}}', '2026-05-03', '2026-13-01', 'lookalike host', 'CONFIRMED'),
      v('fx-x-4', T, TL, 'fx-m-2', '{{constructor.constructor("alert(1)")()}}', '2026-05-03', null, 'credentials', 'confirmed'),
      v('fx-x-5', T, TL, 'fx-m-2', '{{constructor.constructor("alert(1)")()}}', '2026-05-03', null, 'embed path', '__proto__'),
      v('fx-x-6', T, TL, 'fx-m-3', 'data / duplicate v', null, null, 'data url', TE),
      v('fx-x-7', T, TL, 'fx-m-3', 'data / duplicate v', null, null, 'duplicate v', TE),
      v('fx-x-8', T, TL, 'fx-m-3', 'data / duplicate v', null, null, 'leading space', TE),
      v('fx-x-9', T, TL, 'fx-m-3', 'data / duplicate v', null, null, 'object response', TE),
      v('fx-x-10', '__proto__', '__proto__ 大会', 'constructor', 'constructor 試合', '2026-01-10', null, '前半', OC),
      // invalid rows -> counted and excluded
      v('fx-x-1', T, 'dup id', 'fx-m-1', 'dup', null, null, 'duplicate id', OC),
      v(42, T, 'numeric id', 'fx-m-1', 'x', null, null, 'x', OC),
      v('', T, 'empty id', 'fx-m-1', 'x', null, null, 'x', OC),
      null, 'string row', 7, [], { id: { nested: true } }
    ];
  }

  /* ---------- synthetic thumbnails (local bytes, never remote) ---------- */
  const TINTS = [[0x5c, 0x6b, 0xc0], [0x46, 0x54, 0xa3], [0x8e, 0x99, 0xd6], [0x6f, 0x9f, 0xb8], [0xa0, 0x8c, 0xc8]];
  function gifBlob(seed) {
    const c = TINTS[seed % TINTS.length];
    const bytes = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
      c[0], c[1], c[2], 0xff, 0xff, 0xff,
      0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0x02, 0x02, 0x44, 0x01, 0x00, 0x3b];
    return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
  }
  function hashId(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h;
  }
  function delay(ms, value, fail) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () { if (fail) reject(value); else resolve(value); }, ms);
    });
  }
  function codeError(code) { const e = new Error(code); e.code = code; return e; }

  let thumbRequests = 0, linkRequests = 0, reads = 0;
  function countThumb() { thumbRequests++; updateOut(); }

  function okThumb(id) {
    countThumb();
    if (id === 'fx-v-07') return delay(150, null);                              // no thumbnail
    if (id === 'fx-v-16') return delay(150, codeError('THUMBNAIL_NOT_FOUND'), true); // no thumbnail
    const canvas=document.createElement('canvas');canvas.width=96;canvas.height=54;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#5c6bc0';ctx.fillRect(0,0,96,54);
    // Synthetic geometric JPEG only; exercise the actual base64-to-Blob contract decoder.
    return new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.8)).then(async blob=>{
      const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
      for(const b of bytes)binary+=String.fromCharCode(b);
      return PaluruMatchVideoMedia.decode({id,status:'available',mimeType:'image/jpeg',base64:btoa(binary)},id);
    });
  }
  function failingThumb(id) {
    countThumb();
    const h = hashId(id) % 5;
    if (h === 0) return delay(200, codeError('THUMBNAIL_FAILED'), true);
    if (h === 1) return delay(200, new Blob(['<html>not an image</html>'], { type: 'text/html' }));
    if (h === 2) return delay(200, new Blob([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], { type: 'image/png' }));
    if (h === 3) return delay(200, new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }));
    return delay(200, 'not-a-blob');
  }
  function unsupportedThumb() { countThumb(); return delay(200, codeError('THUMBNAIL_UNSUPPORTED'), true); }
  function maliciousThumb(id) {
    countThumb();
    if (id === 'fx-x-10') return delay(100, gifBlob(1));
    return delay(100, new Blob(['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'], { type: 'image/svg+xml' }));
  }

  /* ---------- synthetic getLink (fresh per click) ---------- */
  function countLink() { linkRequests++; updateOut(); }
  function okLink(id) {
    countLink();
    // Alternate the two proposed response shapes.
    return delay(500, hashId(id) % 2 ? WATCH : { watchUrl: WATCH_SHORT });
  }
  function failingLink(id) {
    countLink();
    const h = hashId(id) % 5;
    if (h === 0) return delay(400, codeError('FORBIDDEN'), true);
    if (h === 1) return delay(400, codeError('LINK_FAILED'), true);
    if (h === 2) return delay(400, 'http://www.youtube.com/watch?v=fixture-only-not-a-video');
    if (h === 3) return delay(5000, WATCH); // slow: change the filter / close to prove it is discarded
    return delay(400, { watchUrl: WATCH });
  }
  function expiredLink() { countLink(); return delay(400, codeError('UNAUTHENTICATED'), true); }
  const MALICIOUS_LINKS = {
    'fx-x-1': 'javascript:alert(1)',
    'fx-x-2': 'data:text/html,<script>alert(1)</script>',
    'fx-x-3': 'https://www.youtube.com.evil.invalid/watch?v=fixture-only-not-a-video',
    'fx-x-4': 'https://user:pw@www.youtube.com/watch?v=fixture-only-not-a-video',
    'fx-x-5': 'https://www.youtube.com/embed/fixture-only-not-a-video',
    'fx-x-6': { watchUrl: 'data:text/html,x' },
    'fx-x-7': 'https://www.youtube.com/watch?v=a&v=b',
    'fx-x-8': ' ' + WATCH,
    'fx-x-9': { watchUrl: WATCH, extra: '<script>' },
    'fx-x-10': WATCH
  };
  function maliciousLink(id) {
    countLink();
    return delay(200, Object.prototype.hasOwnProperty.call(MALICIOUS_LINKS, id) ? MALICIOUS_LINKS[id] : { nope: true });
  }

  /* ---------- scenario wiring ---------- */
  function reader(fn) { return function () { reads++; updateOut(); return fn(); }; }
  const OK = { authenticated: true, allowed: true };
  function list(items, ms) { return reader(function () { return delay(ms || 300, { items: items() }); }); }
  function rejecting(code, ms) { return reader(function () { return delay(ms || 300, codeError(code), true); }); }

  function scenarioConfig(name) {
    const base = { session: OK, read: list(normalItems, 500), getLink: okLink, readThumbnail: okThumb };
    switch (name) {
      case 'empty': return Object.assign(base, { read: reader(function () { return delay(300, { items: [] }); }) });
      case 'loading': return Object.assign(base, { read: reader(function () { return new Promise(function () {}); }) });
      case 'slow': return Object.assign(base, { read: list(normalItems, 3000) });
      case 'unauthenticated': return Object.assign(base, { session: { authenticated: false, allowed: false } });
      case 'expired': return Object.assign(base, { read: rejecting('UNAUTHENTICATED') });
      case 'forbidden': return Object.assign(base, { session: { authenticated: true, allowed: false } });
      case 'denied': return Object.assign(base, { read: rejecting('FORBIDDEN') });
      case 'unconfigured': return Object.assign(base, { read: rejecting('MATCH_VIDEOS_NOT_CONFIGURED') });
      case 'no-reader': return Object.assign(base, { read: undefined });
      case 'failed': return Object.assign(base, { read: rejecting('FIXTURE_READ_FAILED', 400) });
      case 'invalid': return Object.assign(base, { read: reader(function () { return delay(200, { items: 'not-an-array' }); }) });
      case 'thumbnail-failed': return Object.assign(base, { readThumbnail: failingThumb });
      case 'thumbnail-unsupported': return Object.assign(base, { readThumbnail: unsupportedThumb });
      case 'no-thumbnail-reader': return Object.assign(base, { readThumbnail: undefined });
      case 'link-failed': return Object.assign(base, { getLink: failingLink });
      case 'link-expired': return Object.assign(base, { getLink: expiredLink });
      case 'no-link-reader': return Object.assign(base, { getLink: undefined });
      case 'unclassified': return Object.assign(base, { read: list(unclassifiedItems) });
      case 'long': return Object.assign(base, { read: list(longItems) });
      case 'malicious': return Object.assign(base, { read: list(maliciousItems), getLink: maliciousLink, readThumbnail: maliciousThumb });
      default: return base;
    }
  }

  /* ---------- live blob URL counter (fixture-only instrumentation) ---------- */
  let liveBlobUrls = 0;
  const live = new Set();
  const origCreate = URL.createObjectURL.bind(URL);
  const origRevoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = function (obj) { const u = origCreate(obj); live.add(u); liveBlobUrls = live.size; updateOut(); return u; };
  URL.revokeObjectURL = function (u) { live.delete(u); liveBlobUrls = live.size; origRevoke(u); updateOut(); };

  /* ---------- DOM ---------- */
  const view = document.getElementById('matchVideosView');
  const rootEl = document.getElementById('matchVideosRoot');
  const select = document.getElementById('fxScenario');
  const out = document.getElementById('fxOut');
  let lastMessage = '', controller = null;

  for (const s of SCENARIOS) {
    const o = document.createElement('option');
    o.value = s[0];
    o.textContent = s[0] + ' — ' + s[1];
    select.append(o);
  }
  const requested = new URLSearchParams(location.search).get('scenario');
  let scenario = NAMES.indexOf(requested) >= 0 ? requested : 'normal';
  select.value = scenario;

  function updateOut() {
    if (!out) return;
    const st = controller ? controller.getState() : { state: '-', isOpen: false };
    const revealed = rootEl.querySelectorAll('a[href]').length;
    out.textContent = 'scenario=' + scenario + ' state=' + st.state + ' open=' + st.isOpen +
      ' reads=' + reads + ' linkRequests=' + linkRequests + ' revealedLinks=' + revealed +
      ' thumbRequests=' + thumbRequests + ' liveBlobUrls=' + liveBlobUrls +
      (lastMessage ? '\n' + lastMessage : '');
  }
  function note(msg) { lastMessage = msg; updateOut(); }

  function build() {
    if (controller) controller.destroy();
    const config = scenarioConfig(scenario);
    controller = api.create({
      root: rootEl,
      read: config.read,
      getLink: config.getLink,
      readThumbnail: config.readThumbnail,
      onBack: function () { note('onBack() が呼ばれました（検証用: 遷移なし）'); },
      onSignIn: function () { note('onSignIn() が呼ばれました（検証用: 遷移なし）'); }
    });
    controller.setSession(config.session);
    view.hidden = false;
    controller.open().then(updateOut);
    updateOut();
  }

  select.addEventListener('change', function () {
    scenario = NAMES.indexOf(select.value) >= 0 ? select.value : 'normal';
    reads = 0; thumbRequests = 0; linkRequests = 0; lastMessage = '';
    const url = new URL(location.href);
    url.searchParams.set('scenario', scenario);
    history.replaceState(null, '', url.pathname + url.search);
    build();
  });
  document.getElementById('fxOpen').addEventListener('click', function () { view.hidden = false; controller.open().then(updateOut); updateOut(); });
  document.getElementById('fxClose').addEventListener('click', function () { controller.close(); view.hidden = true; updateOut(); });
  document.getElementById('fxLogout').addEventListener('click', function () { controller.setSession({ authenticated: false }); updateOut(); });
  document.getElementById('fxLogin').addEventListener('click', function () { controller.setSession({ authenticated: true, allowed: true }); updateOut(); });
  document.getElementById('fxDeny').addEventListener('click', function () { controller.setSession({ authenticated: true, allowed: false }); updateOut(); });
  document.getElementById('fxRecreate').addEventListener('click', function () { build(); });

  document.querySelectorAll('[data-fx-nav]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.fxNav === 'match-videos') { view.hidden = false; controller.open().then(updateOut); }
      else note('検証用プレースホルダーです（遷移しません）');
    });
  });

  // Prevent navigation from revealed links. preventDefault ONLY (no stopPropagation),
  // so the module's single-use handler still clears the link afterwards.
  function block(e) {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !rootEl.contains(a)) return;
    e.preventDefault();
    note('リンク遷移を停止しました（検証用）: linkPresent=' + Boolean(a.getAttribute('href')) + ' target=' + a.target +
      ' rel=' + a.rel + ' referrerpolicy=' + a.referrerPolicy);
  }
  document.addEventListener('click', block, true);
  document.addEventListener('auxclick', block, true);

  // Keep the revealed-link counter current.
  new MutationObserver(function () { updateOut(); }).observe(rootEl, { childList: true, subtree: true });

  build();
})();
