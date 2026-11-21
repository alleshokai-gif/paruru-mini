(function(root) {
  'use strict';
  const stores = Object.freeze({
    ok: 'オーケー 溝ノ口店', iy: 'イトーヨーカドー 溝ノ口店',
    maruetsu: 'マルエツ 川崎坂戸店', life: 'ライフ 溝口店',
    rosen: 'そうてつローゼン たいら店', yaoko: 'ヤオコー 川崎枡形店'
  });
  const recipes = [
    {name: '鶏むねの照り焼き・温野菜・ごはん', main: '鶏むね', rest: ['温野菜用の野菜', '米']},
    {name: '焼き銀鮭・青菜のおひたし・みそ汁', main: '銀鮭', rest: ['青菜', 'みそ汁の具']},
    {name: 'ラムステーキ・じゃがいも・サラダ', main: 'ラム', rest: ['じゃがいも', 'サラダ野菜']},
    {name: 'めかじきのソテー・サラダ・スープ', main: 'めかじき', rest: ['サラダ野菜', 'スープの具']},
    {name: '焼きほっけ・冷ややっこ・ごはん', main: 'ほっけ', rest: ['豆腐', '米']},
    {name: '豚肉のしょうが焼き・キャベツ・ごはん', main: '豚肉', rest: ['キャベツ', '米']},
    {name: '牛肉と野菜の炒め物・ごはん', main: '牛肉', rest: ['炒め物用の野菜', '米']}
  ];
  const normalize = x => x.normalize('NFKC').toLowerCase().trim().replace(/\s/g, '').replace(/むね肉/g, 'むね');
  function dayTokyo(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit' })
      .formatToParts(now);
    return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
  }
  const eligibleState = state => state === 'checked' || state === 'unchanged';
  const validDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10) === s;
  function editionCatalogValid(c, date, snapshotDate) {
    if(c?.schema!==1 || !Object.hasOwn(stores,c.store) || c.verification_state!=='needs_review' ||
       !validDay(c.document_from) || !validDay(c.document_until) ||
       c.document_from>date || date>c.document_until || c.document_from>c.document_until ||
       (Date.parse(c.document_until)-Date.parse(c.document_from))/86400000>62 ||
       !Array.isArray(c.pages) || !c.pages.length || c.pages.length>64 ||
       typeof c.obtained_at!=='string' || !Number.isFinite(Date.parse(c.obtained_at)) ||
       Date.parse(c.obtained_at)>=Date.parse(snapshotDate+'T15:00:00Z')) return false;
    const dom=c.source_kind==='dom';
    if(c.store==='ok' && (dom || !/^https:\/\/ok-corporation\.jp\/media-download\//.test(c.source_document)))return false;
    if(c.store==='rosen' && !dom)return false;
    if(!referenceSource(c,dom))return false;
    return c.pages.every(p=>Array.isArray(p.items)&&p.items.length<=1000&&p.items.every(i=>
      i && i.verification_state==='needs_review' &&
      (i.valid_from==null || validDay(i.valid_from)&&i.valid_from<=date) &&
      (i.valid_until==null || validDay(i.valid_until)&&date<=i.valid_until) &&
      !(i.valid_from && i.valid_until && i.valid_from>i.valid_until)));
  }
  function isTodayProjection(snapshot, date) {
    if (!validDay(date) || snapshot?.schema !== 1 || snapshot.date !== date) return false;
    // Older same-day Gateway DTOs remain compatible. Raw yesterday snapshots
    // are never accepted here; only the Gateway revalidates individual offers.
    if (snapshot.snapshot_date === undefined && snapshot.freshness === undefined) return true;
    if (snapshot.freshness === 'current') return snapshot.snapshot_date === date;
    if (snapshot.freshness === 'edition_reference') {
      const sourceDate=snapshot.snapshot_date;
      if(!validDay(sourceDate)||sourceDate>date || (Date.parse(date)-Date.parse(sourceDate))/86400000>62 ||
         !Array.isArray(snapshot.offers)||snapshot.offers.length!==0) return false;
      const c=snapshot.reference_corpus;
      const catalogs=c?.schema===2&&Array.isArray(c.catalogs)&&c.catalogs.length<=24?c.catalogs:[c];
      return catalogs.length>0&&catalogs.every(c=>editionCatalogValid(c,date,sourceDate));
    }
    const previous = new Date(date + 'T00:00:00Z');
    if (!Number.isFinite(previous.getTime()) || previous.toISOString().slice(0,10) !== date) return false;
    previous.setUTCDate(previous.getUTCDate() - 1);
    return snapshot.freshness === 'previous_day' && snapshot.snapshot_date === previous.toISOString().slice(0,10) &&
      ['item_validity_unproven','no_offers'].includes(snapshot.carry_forward_status) &&
      Array.isArray(snapshot.offers) && snapshot.offers.length === 0;
  }
  function isOffer(o, date) {
    try {
      return !!stores[o.store] && /^\d{4}-\d{2}-\d{2}$/.test(o.from) &&
        /^\d{4}-\d{2}-\d{2}$/.test(o.until) && o.from <= date && date <= o.until &&
        typeof o.title === 'string' && o.title.length <= 160 &&
        typeof o.spec === 'string' && typeof o.unit === 'string' && typeof o.conditions === 'string' &&
        ['weekly_information','special'].includes(o.kind) &&
        ['visually_verified','ocr_validated'].includes(o.confidence) &&
        Number.isInteger(o.net_yen) && o.net_yen > 0 && Number.isInteger(o.tax_included_sen) &&
        o.tax_included_sen >= o.net_yen * 100 &&
        new URL(o.source).protocol === 'https:';
    } catch (_) { return false; }
  }
  function recommend(snapshot, items, date = dayTokyo()) {
    const rows = isTodayProjection(snapshot, date) &&
        Array.isArray(snapshot.offers) && snapshot.offers.length <= 1000
      ? snapshot.offers.filter(o => isOffer(o, date) && eligibleState(snapshot.states?.[o.store])) : [];
    const pending = items.filter(i => i.status === 'pending' && (!i.due_date || i.due_date <= date));
    const plans = [];
    for (const recipe of recipes) {
      const needle = normalize(recipe.main);
      const candidates = rows.filter(o => normalize(o.title).includes(needle)).map(offer => ({
        offer,
        listed: pending.filter(i => rows.some(other => other.store === offer.store
          && normalize(i.name).length > 1 && normalize(other.title).includes(normalize(i.name))))
      }));
      // Prefer observed overlap, not cross-store unit prices or invented basket totals.
      candidates.sort((a,b) => b.listed.length - a.listed.length);
      const best = candidates[0];
      if (!best) continue;
      plans.push({ name: recipe.name, store: stores[best.offer.store], offer: best.offer, rest: recipe.rest,
        listed: best.listed.map(i => i.name), unknown: pending.filter(i => !best.listed.includes(i)).map(i => i.name) });
      if (plans.length === 3) break;
    }
    return plans;
  }
  const statusLabels = {
    checked: '確認済み', unchanged: '更新なし', needs_review: '新しい資料・価格未照合',
    expired: '期限切れ', failed: '取得失敗', held: '自動取得保留'
  };
  const partialCoverage = corpus => corpus?.coverage === 'partial' || corpus?.coverage?.state === 'partial' || corpus?.coverage?.status === 'partial';
  function displayCounts(corpus, shown) {
    const counts = corpus?.display_counts || (corpus?.display_total_frames !== undefined ? {
      total:corpus.display_total_frames, shown:corpus.displayed_frames,
      omitted:corpus.display_omitted_frames ?? corpus.display_total_frames - corpus.displayed_frames
    } : null);
    return counts && [counts.total, counts.shown, counts.omitted].every(n => Number.isSafeInteger(n) && n >= 0) &&
      counts.shown === shown && counts.total === counts.shown + counts.omitted ? counts : null;
  }
  const countLabel = counts => '保存全'+counts.total+'枠 / 画面'+counts.shown+'枠 / 未表示'+counts.omitted+'枠';
  function referenceSource(corpus, dom) {
    try {
      const url = new URL(corpus.source_document), href = url.href;
      if(!dom && corpus.store === 'ok' && /^https:\/\/ok-corporation\.jp\/media-download\/\d+\/[a-f0-9]+\/PDF\/$/.test(href))
        return {href, label:'公式の全号PDF'};
      if(dom && corpus.store === 'rosen' && /^https:\/\/rosen\.mikke-sales\.com\/stores\/taira\/flyers\/\d+\/?$/.test(href))
        return {href, label:'公開元の全カテゴリ明細'};
      if(corpus.source_kind === 'image' && (
        corpus.store === 'iy' && /^https:\/\/promo\.hatobase\.jp\/flyers\/00521\/\d+\/\d+\/?$/.test(href) ||
        corpus.store === 'yaoko' && href === 'https://yap-pd.yaoko-net.com/app/flyer/1221/' ||
        corpus.store === 'life' && href === 'https://store.lifecorp.jp/detail/east648/' ||
        corpus.store === 'maruetsu' && href === 'https://tokubai.co.jp/%E3%83%9E%E3%83%AB%E3%82%A8%E3%83%84/3541/leaflets/108663201/print'
      )) return {href, label:'公式のチラシ原本'};
    } catch (_) {}
    return null;
  }
  // Display-only grouping from the product name; it never affects recommend().
  const categories = [['meat', '肉'], ['fish', '魚'], ['veg', '野菜'], ['other', 'その他']];
  const categoryPatterns = [
    ['fish', /鮭|さけ|サーモン|魚|ぶり|鰤|さば|鯖|サバ|あじ|アジ|鯵|いわし|イワシ|まぐろ|マグロ|刺身|えび|エビ|イカ|タラ|鱈|ほっけ|ホッケ|かじき|カジキ|さんま|サンマ|あさり|貝|かつお|カツオ|鯛|ししゃも|干物|切身|切り身/],
    ['meat', /肉|鶏|豚|牛|ラム|羊|ひき|挽|ハム|ベーコン|ソーセージ|ウインナー|ステーキ|ささみ|手羽/],
    ['veg', /野菜|キャベツ|レタス|トマト|きゅうり|キュウリ|胡瓜|じゃがいも|ジャガイモ|玉ねぎ|たまねぎ|玉葱|にんじん|人参|大根|白菜|ほうれん|小松菜|ねぎ|ネギ|もやし|ナス|茄子|ピーマン|ブロッコリー|きのこ|キノコ|しいたけ|えのき|しめじ|かぼちゃ|さつまいも|ごぼう|れんこん|アスパラ|サラダ|青菜/]
  ];
  const categoryOf = title => {
    const t = String(title).normalize('NFKC');
    const hit = categoryPatterns.find(([, re]) => re.test(t));
    return hit ? hit[0] : 'other';
  };
  const storeIds = Object.keys(stores);
  const shortName = id => stores[id].split(' ')[0];
  const shortDate = s => s.slice(5).replace('-', '/');
  const priceText = o => '税抜 ' + o.net_yen + '円 / ' + o.unit + '・税込参考 ' + (o.tax_included_sen / 100).toFixed(2) + '円';
  const kindText = o => o.kind === 'special' ? '特売' : '週間掲載価格';
  const byStoreThenTitle = (a, b) => storeIds.indexOf(a.store) - storeIds.indexOf(b.store) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
  // Round-robin across stores so one store does not fill the short list.
  function pickSome(rows, limit) {
    const lanes = storeIds.map(id => rows.filter(o => o.store === id)).filter(l => l.length);
    const out = [];
    for (let i = 0; out.length < limit && lanes.some(l => i < l.length); i++)
      for (const l of lanes) if (i < l.length && out.length < limit) out.push(l[i]);
    return out;
  }
  // Same title, spec and explicit unit only. No unit conversion, no ranking.
  function comparable(rows) {
    const groups = new Map();
    for (const o of rows) {
      if (!o.spec.trim() || !o.unit.trim()) continue;
      const key = JSON.stringify([o.title.trim(), o.spec.trim(), o.unit.trim()]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }
    return [...groups.values()].filter(g => new Set(g.map(o => o.store)).size >= 2);
  }
  function render(doc, target, snapshot, items, date = dayTokyo()) {
    const el = (tag, value, cls) => { const n = doc.createElement(tag); if (value !== undefined) n.textContent = value; if (cls) n.className = cls; return n; };
    const badge = (kind, text) => el('span', text, 'supermarket-badge is-' + kind);
    const linkTo = (text, href) => { const a = el('a', text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
    target.replaceChildren(el('h2', '今日のスーパー'), el('p', date + ' の夕食案・各案1店舗'),
      el('p', '確認済み＝今日有効と照合できた掲載価格 / 参考＝読み取った価格（未照合） / 未確認＝価格不明', 'supermarket-legend'));
    const today = isTodayProjection(snapshot, date);
    const previousDay = today && snapshot.freshness === 'previous_day';
    const editionReference = today && snapshot.freshness === 'edition_reference';
    const referenceOnly = previousDay || editionReference;
    if (editionReference) target.append(el('p', '表示日：'+date+' / 保存スナップショット：'+snapshot.snapshot_date+
      '。号の掲載期間が有効な参考情報です。当日再取得・価格確認済みの意味ではありません。', 'supermarket-note'));
    if (previousDay) target.append(el('p', '表示日：' + date + ' / 保存スナップショット：' + snapshot.snapshot_date +
      '。本日の再収集ではありません。', 'supermarket-note'));
    if (previousDay && snapshot.carry_forward_status === 'item_validity_unproven') target.append(el('p',
      '商品別の適用日の根拠が未確認です。号全体の期間だけでは、今日の確認済み商品・献立に持ち越しません。', 'supermarket-note'));
    const confirmed = today && Array.isArray(snapshot.offers) && snapshot.offers.length <= 1000
      ? snapshot.offers.filter(o => isOffer(o,date) && eligibleState(snapshot.states?.[o.store])) : [];
    const stateLabel = id => {
      const code = today && snapshot.states?.[id];
      return editionReference ? '保存済みの号を参照（当日再取得なし）' : previousDay && eligibleState(code) ? '前日照合（当日再取得なし）' : Object.hasOwn(statusLabels, code) ? statusLabels[code] : '未確認';
    };
    const plans = today ? recommend(snapshot, items, date) : [];
    if (!today) target.append(el('p', '当日のチラシ情報を確認できません。買い物リストは引き続き使えます。', 'supermarket-note'));
    else if (!plans.length) target.append(el('p', '今日有効で確認済みの献立候補はありません。', 'supermarket-note'));
    else if (plans.length < 3) target.append(el('p', '掲載価格を確認できた材料に絞って表示しています。', 'supermarket-note'));
    if (plans.length) target.append(el('p', '掲載品を基にした候補です。6店舗の合計額を比較したものではありません。', 'supermarket-note'));
    for (const plan of plans) {
      const a = el('article'); a.className = 'supermarket-plan';
      const o = plan.offer;
      const main = el('div', undefined, 'supermarket-ingredient');
      main.append(el('p', o.title + '・' + o.spec), badge('confirmed', '確認済み'),
        el('p', priceText(o) + '（' + o.conditions + '、' + kindText(o) + '）', 'supermarket-price'));
      const rest = el('div', undefined, 'supermarket-ingredient');
      rest.append(el('p', '価格未確認：' + plan.rest.join('、') + '。合計額・在庫は不明です。'), badge('unknown', '未確認'));
      a.append(el('h3', plan.name), el('p', '買い物先：' + plan.store, 'supermarket-store'), el('p', '必要な材料', 'supermarket-label'), main, rest);
      if (plan.listed.length) a.append(el('p', 'リストの同系統掲載品（数量・規格・在庫は別途確認）：' + plan.listed.join('、')));
      if (plan.unknown.length) a.append(el('p', 'リスト掲載・価格未確認：' + plan.unknown.join('、')));
      a.append(linkTo('公式資料 ' + o.from + '〜' + o.until, o.source));
      target.append(a);
    }
    // Short, filterable selection of today's confirmed offers. Never ranked across stores.
    if (confirmed.length) {
      const sorted = [...confirmed].sort(byStoreThenTitle);
      const filter = {store: 'all', cat: 'all'};
      const box = el('section', undefined, 'supermarket-picker');
      box.setAttribute('aria-label', '今日の確認済み商品');
      const results = el('div', undefined, 'supermarket-results');
      const chips = [];
      const bar = (label, defs, key) => {
        const g = el('div', undefined, 'supermarket-chips');
        g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
        for (const [value, text] of defs) {
          const b = el('button', text); b.type = 'button'; b.className = 'supermarket-chip';
          b.setAttribute('aria-pressed', String(filter[key] === value));
          b.addEventListener('click', () => {
            filter[key] = value;
            for (const c of chips) if (c.key === key) c.node.setAttribute('aria-pressed', String(c.value === value));
            draw();
          });
          chips.push({key, value, node: b}); g.append(b);
        }
        return g;
      };
      const card = o => {
        const c = el('div', undefined, 'supermarket-offer-card');
        const when = el('p', o.conditions + '・' + kindText(o) + '・' + shortDate(o.from) + '〜' + shortDate(o.until) + ' ', 'supermarket-meta');
        when.append(linkTo('公式資料', o.source));
        c.append(el('p', o.title, 'supermarket-offer-title'), badge('confirmed', '確認済み'),
          el('p', shortName(o.store) + '・' + o.spec, 'supermarket-meta'),
          el('p', priceText(o), 'supermarket-price'), when);
        return c;
      };
      function draw() {
        results.replaceChildren();
        const inStore = sorted.filter(o => filter.store === 'all' || o.store === filter.store);
        const rows = inStore.filter(o => filter.cat === 'all' || categoryOf(o.title) === filter.cat);
        results.append(el('p', '表示条件に合う確認済み商品：' + rows.length + '件', 'supermarket-meta'));
        if (filter.store !== 'all' && !inStore.length)
          results.append(el('p', stores[filter.store] + '：' + stateLabel(filter.store) + '。今日の確認済み商品はありません。', 'supermarket-note'));
        else if (!rows.length) results.append(el('p', 'この条件の確認済み商品はありません。', 'supermarket-note'));
        const limit = filter.cat === 'all' ? 3 : 8;
        for (const [id, label] of categories) {
          const group = rows.filter(o => categoryOf(o.title) === id);
          if (!group.length) continue;
          const shown = pickSome(group, limit);
          const wrap = el('div', undefined, 'supermarket-group');
          wrap.append(el('h4', label + '（' + shown.length + '/' + group.length + '件）'));
          for (const o of shown) wrap.append(card(o));
          results.append(wrap);
        }
        if (rows.length > 0) results.append(el('p', '全件は下の「当日有効な掲載商品」で開けます。', 'supermarket-meta'));
        const pairs = comparable(rows).slice(0, 3);
        if (pairs.length) {
          const cmp = el('div', undefined, 'supermarket-compare');
          cmp.append(el('h4', '同じ品名・規格・単位の掲載'),
            el('p', '表記が完全に同じものだけを並べています。単位の換算や全店の最安・合計は示しません。', 'supermarket-meta'));
          for (const g of pairs) {
            cmp.append(el('p', g[0].title + '・' + g[0].spec + '（' + g[0].unit + '）', 'supermarket-offer-title'));
            for (const o of g) cmp.append(el('p', shortName(o.store) + '：' + priceText(o) + '（' + o.conditions + '）', 'supermarket-meta'));
          }
          results.append(cmp);
        }
      }
      box.append(el('h3', '今日の確認済み商品'),
        bar('店舗で絞り込み', [['all', '全店舗'], ...storeIds.map(id => [id, shortName(id) + '（' + confirmed.filter(o => o.store === id).length + '）'])], 'store'),
        bar('種類で絞り込み', [['all', 'すべて'], ...categories.map(([id, label]) => [id, label])], 'cat'),
        results);
      draw();
      target.append(box);
    } else if (today) target.append(el('p', '今日有効で確認済みの掲載商品はまだありません。', 'supermarket-note'));
    const state = el('ul');
    state.setAttribute('aria-label', '6店舗の取得状況');
    for (const [id, name] of Object.entries(stores)) {
      const label = stateLabel(id);
      const count=confirmed.filter(o=>o.store===id).length;
      state.append(el('li', name + '：' + label + (count ? '（' + count + '商品）' : '')));
    }
    target.append(state);
    // Whole-paper observations are independent of confirmed offers and menus.
    // These values remain unverified readings, including nonfood and no-price rows.
    const corpus=today&&(referenceOnly?snapshot.reference_corpus:snapshot.corpus);
    if (editionReference && corpus) target.append(el('h3','掲載期間内のチラシ・参考'),
      el('p','取得・保存時刻、号の掲載期間、商品別の適用日は別です。商品日付未確認の掲載も参考として残します。確定価格・在庫・献立・最安比較には使いません。','supermarket-note'));
    if (previousDay && corpus) target.append(el('h3','前回のチラシ・参考'),
      el('p','保存日：'+snapshot.snapshot_date+'。以下は前回紙面の読取です。今日の特売・有効商品数・献立・価格比較には使っていません。', 'supermarket-note'));
    if(today&&snapshot.corpus_status==='too_large')target.append(el('p','全紙面の読取はDBに保存されています。表示サイズの上限を超えたため、ここでは確認済み商品だけを表示しています。'));
    if(today&&snapshot.corpus_status==='partial')target.append(el('p','読取はDBに保存されています。表示容量を超えた分は、この画面から省略しています。'));
    const catalogs=corpus?.schema===2&&Array.isArray(corpus.catalogs)&&corpus.catalogs.length<=24?corpus.catalogs:[corpus];
    if(corpus?.schema===2) {
      const catalogCounts=catalogs.map(catalog=>{
        if(catalog?.schema!==1||catalog.verification_state!=='needs_review'||!Array.isArray(catalog.pages)||catalog.pages.length>64)return null;
        const frames=catalog.pages.reduce((n,p)=>n+(Array.isArray(p.items)?p.items.length:0),0);
        return frames<=2000?displayCounts(catalog,frames):null;
      });
      // The Gateway projects counts per catalog. Aggregate only known totals;
      // missing metadata must not become an invented bundle-wide saved count.
      if(catalogCounts.length&&catalogCounts.every(Boolean)) {
        const counts=catalogCounts.reduce((sum,c)=>({total:sum.total+c.total,shown:sum.shown+c.shown,omitted:sum.omitted+c.omitted}),{total:0,shown:0,omitted:0});
        if(Object.values(counts).every(Number.isSafeInteger))target.append(el('p',countLabel(counts)));
      }
      if(catalogs.some(partialCoverage))target.append(el('p','部分データです。原本の全掲載商品・全号を確認したものではありません。'));
    }
    for(const corpus of catalogs)if(corpus?.schema===1&&corpus.verification_state==='needs_review'&&Array.isArray(corpus.pages)&&corpus.pages.length<=64) {
      const count=corpus.pages.reduce((n,p)=>n+(Array.isArray(p.items)?p.items.length:0),0);
      if(count<=2000) {
        const details=el('details');details.className='supermarket-corpus';
        const dom=corpus.source_kind==='dom';
        const rows=corpus.pages.flatMap(p=>Array.isArray(p.items)?p.items:[]);
        const referenceCount=rows.filter(item=>item.price_state!=='discount_only'&&Array.isArray(item.prices)&&
          item.prices.some(price=>price&&(Number.isFinite(price.net_yen)||Number.isFinite(price.tax_included_yen)))).length;
        const store=Object.hasOwn(stores,corpus.store)?stores[corpus.store]:'店舗未確認';
        details.append(el('summary',(dom?'公開明細の読取':corpus.physical_pdf_pages===null||partialCoverage(corpus)?'紙面のAI読取':'全紙面のAI読取')+'（'+count+'枠・条件未照合）'));
        details.append(el('p','店舗：'+store+' / 号：'+corpus.issue_id));
        const counts=displayCounts(corpus,count);
        if(counts)details.append(el('p',countLabel(counts)));
        if(referenceOnly && Number.isSafeInteger(corpus.reference_excluded_frames) && corpus.reference_excluded_frames>0)
          details.append(el('p','日付・期限条件で除外：'+corpus.reference_excluded_frames+'枠。全掲載が表示されるとは限りません。'));
        if(partialCoverage(corpus))details.append(el('p','部分データです。原本の全掲載商品・全号を確認したものではありません。'));
        details.append(el('p','参考価格あり '+referenceCount+'枠・価格未確認 '+(count-referenceCount)+'枠・確定0枠（この読取内）'));
        const hasPrintedPeriod=rows.some(item=>typeof item.validity_raw_text==='string'&&item.validity_raw_text.trim()||item.valid_from||item.valid_until);
        details.append(el('p','紙面期間：'+(corpus.document_from&&corpus.document_until?corpus.document_from+'〜'+corpus.document_until:'未確認')+
          (hasPrintedPeriod?'。期間は原本との対応要確認です。':'。商品ごとの販売日は未確認です。')));
        details.append(el('p','食品以外・価格非掲載・表示例・案内を含みます。読取値は確定売価ではなく、献立や買い物先の判断には使っていません。'));
        const faceCount=Number.isSafeInteger(corpus.logical_faces)&&corpus.logical_faces>0?corpus.logical_faces:corpus.pages.length;
        const extent=dom?corpus.logical_views+' 日付・カテゴリ表示':corpus.physical_pdf_pages===null?
          '観測'+faceCount+'面 / 全号枚数未確認':corpus.physical_pdf_pages+' PDFページ / '+corpus.logical_faces+'面';
        const timeLabel=corpus.source_kind==='image'&&corpus.store!=='ok'&&!dom?
          '保存記録の時刻（実取得時刻は未確認）':'取得';
        details.append(el('p',corpus.issue_id+'・'+extent+'・'+timeLabel+' '+corpus.obtained_at));
        for(const [index,page] of corpus.pages.entries()) {
          const rows=Array.isArray(page.items)?page.items:[];
          const faceLabel=dom?(page.label||page.face):page.face==='front'?'表':page.face==='back'?'裏':page.label||'観測面'+(index+1);
          details.append(el('h4',faceLabel+'（'+rows.length+'枠）'));
          if(page.document_period_raw)details.append(el('p','紙面の期間表記：'+page.document_period_raw));
          for(const item of rows) {
            const row=el('article');row.className='supermarket-corpus-item';
            row.append(el('h5',item.name||'名称を読み取れない枠'));
            const hasQuote=Array.isArray(item.prices)&&item.price_state!=='discount_only'&&item.prices.some(p=>p&&(Number.isFinite(p.net_yen)||Number.isFinite(p.tax_included_yen)));
            row.append(hasQuote?badge('reference','参考・未照合'):badge('unknown','価格未確認'));
            row.append(el('p',[item.product_type,item.spec,...(item.variants||[])].filter(Boolean).join('・')));
            const quotes=Array.isArray(item.prices)?item.prices:[];
            if(!quotes.length)row.append(el('p',item.price_state==='not_printed'?'価格非掲載':'価格読取未確定'));
            for(const price of quotes)row.append(el('p','未照合の読取：'+price.raw_text+(price.unit_text?' / '+price.unit_text:'')+(price.payment_condition?'（'+price.payment_condition+'）':'')));
            if(item.conditions?.length)row.append(el('p','条件の読取・商品との対応未照合：'+item.conditions.join(' / ')));
            row.append(el('p',item.valid_from&&item.valid_until ?
              '商品別適用日の読取：'+item.valid_from+'〜'+item.valid_until+'（価格・条件は未照合）' :
              '商品別適用日：未確認（号の掲載期間とは別）'));
            row.append(el('p','商品への期間・店舗条件・位置の対応は要確認。'+(item.validity_raw_text||'')));
            details.append(row);
          }
        }
        if(corpus.source_notes?.length) {
          const notes=el('details');notes.append(el('summary','紙面の注意書き（対応未照合）'));
          for(const n of corpus.source_notes)notes.append(el('p',n.raw_text));details.append(notes);
        }
        if(corpus.unresolved_source_notes?.length)for(const n of corpus.unresolved_source_notes)details.append(el('p','未確定：'+n.reason));
        const source=referenceSource(corpus,dom);
        if(source) {
          const a=el('a',source.label);a.href=source.href;a.target='_blank';a.rel='noopener noreferrer';details.append(a);
        }
        target.append(details);
      }
    }
    // Coverage is separate from the three menu recommendations. A newly
    // collected store's verified prices must remain inspectable even when
    // the unchanged recommendation logic chooses another store for a menu.
    if(confirmed.length) {
      const details=el('details');details.className='supermarket-offers';
      details.append(el('summary','当日有効な掲載商品（'+confirmed.length+'件）'));
      for(const [id,name] of Object.entries(stores)) {
        const offers=confirmed.filter(o=>o.store===id);if(!offers.length)continue;
        details.append(el('h4',name));
        for(const o of offers) {
          const row=el('p',o.title+'・'+o.spec+'：'+priceText(o)+'（'+o.conditions+'） '+o.from+'〜'+o.until+' ');
          row.className='supermarket-offer';
          const link=el('a','公式資料');link.href=o.source;link.target='_blank';link.rel='noopener noreferrer';
          row.append(link);details.append(row);
        }
      }
      target.append(details);
    }
  }
  const api = Object.freeze({stores, dayTokyo, recommend, render});
  root.PALURUSupermarketPoc = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
