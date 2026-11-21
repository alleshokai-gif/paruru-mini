(function(root) {
  'use strict';
  const stores = Object.freeze({
    ok: 'オーケー 溝ノ口店', iy: 'イトーヨーカドー 溝ノ口店',
    maruetsu: 'マルエツ 川崎坂戸店', life: 'ライフ 溝口店',
    rosen: 'そうてつローゼン たいら店', yaoko: 'ヤオコー 川崎枡形店'
  });
  // PAUSED (2026-11-21): automatic meal plans and recommended-store surfaces are
  // paused by the user. recommend() and its recipe data are kept as history only;
  // render() never calls them.
  const paused = Object.freeze({meal_plans: true, recommended_stores: true, since: '2026-11-21'});
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
  // HISTORICAL / PAUSED: not used by render(). Kept so old data and tests remain readable.
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

  // ---- Category prices (今日何が安いか) ----
  // Ordered fallback contract matches the backend's versioned public rules.
  const categoryContract = {"schema":1,"categories":[{"id":"meat","label":"肉"},{"id":"fish","label":"魚・魚介"},{"id":"vegetable","label":"野菜"},{"id":"eggs","label":"卵"},{"id":"processed","label":"加工品・惣菜"},{"id":"other","label":"その他"}],"rules":[{"category":"processed","pattern":"キムチ|卵豆腐|玉子豆腐|厚焼|だし巻|茶碗蒸|魚肉ソーセージ|ソーセージ|ハム|ベーコン|チキンナゲット|ナゲット|餃子|ギョーザ|ぎょうざ|寿司|すし|焼きそば|やきそば|弁当|コロッケ|カキフライ|唐揚|からあげ|天ぷら|蒲焼|かば焼|ハンバーグ|カレー|レトルト|缶詰"},{"category":"other","pattern":"コシヒカリ|パールライス|精米|玄米|無洗米|牛乳|乳飲料|ヨーグルト|チーズ|バター|マーガリン|アイス"},{"category":"eggs","pattern":"卵|たまご|玉子"},{"category":"fish","pattern":"魚|鮭|さけ|サケ|鯖|さば|サバ|鯵|あじ|まぐろ|マグロ|ぶり|ブリ|ほっけ|かつお|鯛|たい|いわし|さんま|えび|エビ|海老|いか|イカ|たこ|タコ|かき|牡蠣|ほたて|帆立|しらす|うなぎ"},{"category":"meat","pattern":"牛|豚|鶏|とり肉|ラム|ひき肉|挽肉|むね肉|もも肉|手羽|焼肉|ステーキ"},{"category":"vegetable","pattern":"野菜|キャベツ|白菜|ほうれん|小松菜|レタス|トマト|玉ねぎ|たまねぎ|にんじん|人参|じゃが|大根|ブロッコリー|きゅうり|なす|ピーマン|もやし|ねぎ|かぼちゃ|きのこ|しめじ|えのき"}],"fixtures":[["寿司","processed"],["焼きそば","processed"],["卵豆腐","processed"],["厚焼き卵","processed"],["生卵","eggs"],["魚肉ソーセージ","processed"],["チキンナゲット","processed"],["冷凍餃子","processed"],["いか","fish"],["たこ","fish"],["えび","fish"],["牛乳","other"],["冷凍むきエビ","fish"],["冷凍ブロッコリー","vegetable"],["フードレーベル 焼肉トラジ白菜キムチ","processed"],["パールライス 魚沼コシヒカリ","other"],["米国産牛肉","meat"],["米沢牛","meat"]]};
  const categories = Object.freeze(categoryContract.categories.map(c=>[c.id,c.label]));
  const categoryIds = categories.map(c=>c[0]);
  const classificationRules = categoryContract.rules.map(r=>[r.category,new RegExp(r.pattern,'i')]);
  const classify = (name,spec='') => {
    const t=(String(name??'')+' '+String(spec??'')).normalize('NFKC').toLowerCase();
    return classificationRules.find(([,pattern])=>pattern.test(t))?.[0] || 'other';
  };
  const storeIds = Object.keys(stores);
  const shortName = id => stores[id].split(' ')[0];
  const priceText = o => '税抜 ' + o.net_yen + '円・税込参考 ' + (o.tax_included_sen / 100).toFixed(2) + '円';
  const kindText = o => o.kind === 'special' ? '特売' : '週間掲載価格';
  const httpsUrl = s => { try { return new URL(s).protocol === 'https:' ? new URL(s).href : null; } catch (_) { return null; } };
  const statusRank = {confirmed: 0, reference: 1, unknown: 2};
  const dayLimited = raw => typeof raw === 'string' && /限り|限定|のみ/.test(raw.normalize('NFKC'));
  const inRange = (from, until, date) => (from == null || validDay(from) && from <= date) && (until == null || validDay(until) && date <= until);

  function rowsFromDto(dto, date, snapshot) {
    if (dto?.schema!==1 || dto.display_date!==date || dto.snapshot_date!==(snapshot.snapshot_date||snapshot.date) ||
        dto.freshness!==snapshot.freshness || !Array.isArray(dto.categories) || dto.categories.length>12) return null;
    // The additive DTO cannot invent a store, quote or period. Match it back to
    // the already validated source rows; raw source facts remain authoritative.
    const canonical=rowsFromLegacy(snapshot,date),out=[],seen=new Set();
    for(const cat of dto.categories) {
      if(!categoryIds.includes(cat?.id)||!Array.isArray(cat.rows)||cat.rows.length>1000)continue;
      for(const r of cat.rows) {
        if(!r||r.category!==cat.id||!Object.hasOwn(stores,r.store)||!Array.isArray(r.conditions))continue;
        const c=canonical.find(c=>c.price_status===r.price_status&&c.store===r.store&&c.source===r.source&&
          c.name===r.name&&(c.spec||null)===(r.spec||null)&&c.category===r.category&&
          (r.price_status!=='confirmed'||(c.unit||null)===(typeof r.unit==='string'?r.unit.trim()||null:null)&&
            c.price_text.replace(/[\s/・]/g,'')===String(r.price_text||'').replace(/[\s/・]/g,'')&&
            JSON.stringify(c.quote_conditions.filter(Boolean))===JSON.stringify((r.conditions||[]).filter(Boolean)))&&
          (r.price_status==='confirmed'||c.id===r.id));
        if(!c||seen.has(c.id))continue;
        seen.add(c.id);out.push(c);
      }
    }
    return out;
  }
  function rowsFromLegacy(snapshot,date) {
    const out=[],fresh=snapshot.freshness;
    if(fresh!=='previous_day'&&fresh!=='edition_reference'&&Array.isArray(snapshot.offers)&&snapshot.offers.length<=1000)
      for(const o of snapshot.offers) {
        if(!isOffer(o,date)||!eligibleState(snapshot.states?.[o.store]))continue;
        const unit=o.unit.trim()||null;
        out.push({id:'o:'+out.length,category:classify(o.title,o.spec),name:o.title,spec:o.spec,
          store:o.store,price_status:'confirmed',price_text:priceText(o),unit,unit_status:unit?'known':'unknown',
          item_validity:'unconfirmed',valid_from:null,valid_until:null,edition_from:o.from,edition_until:o.until,
          obtained_at:typeof o.obtained_at==='string'?o.obtained_at:null,source:httpsUrl(o.source),quote_conditions:[o.conditions||''],conditions:[o.conditions,kindText(o)].filter(Boolean)});
      }
    const corpus=fresh==='previous_day'?null:fresh==='edition_reference'?snapshot.reference_corpus:snapshot.corpus;
    const catalogs=corpus?.schema===2&&Array.isArray(corpus.catalogs)&&corpus.catalogs.length<=24?corpus.catalogs:[corpus];
    for(const c of catalogs) {
      if(!editionCatalogValid(c,date,snapshot.snapshot_date||snapshot.date))continue;
      const source=referenceSource(c,c.source_kind==='dom');if(!source)continue;
      for(const page of c.pages) for(const [ordinal,i] of page.items.entries()) {
        if(!i?.name?.trim()||['promotion','service'].includes(i.product_type)||!inRange(i.valid_from,i.valid_until,date))continue;
        const dated=i.item_validity==='dated'&&validDay(i.valid_from)&&validDay(i.valid_until);
        if(!dated&&i.item_validity===undefined&&dayLimited(i.validity_raw_text))continue;
        const quotes=Array.isArray(i.prices)?i.prices.filter(q=>q&&typeof q.raw_text==='string'&&q.raw_text):[];
        const known=i.price_state==='priced'&&quotes.some(q=>Number.isFinite(q.net_yen)||Number.isFinite(q.tax_included_yen));
        const units=[...new Set(quotes.map(q=>q.unit_text).filter(u=>typeof u==='string'&&u))];
        const conditions=[...(Array.isArray(i.conditions)?i.conditions:[])];
        const raw=quotes.map(q=>{if(q.payment_condition)conditions.push(q.payment_condition);conditions.push(...(q.other_conditions||[]));
          return q.raw_text+' / '+(q.unit_text||'単位未確認')+(q.payment_condition?'（'+q.payment_condition+'）':'')+
            (q.other_conditions?.length?'・'+q.other_conditions.join('、'):'');}).join(' / ');
        out.push({id:c.corpus_id+':'+page.face+':'+(i.source_ordinal??ordinal),category:classify(i.name,i.spec),name:i.name.trim(),spec:i.spec,
          store:c.store,price_status:known?'reference':'unknown',price_text:known?raw:'価格未確認',unit:units.join(' / ')||null,
          unit_status:quotes.length&&quotes.every(q=>q.unit_text)?'known':'unknown',item_validity:dated?'dated':'unconfirmed',
          valid_from:dated?i.valid_from:null,valid_until:dated?i.valid_until:null,edition_from:c.document_from,edition_until:c.document_until,
          obtained_at:c.obtained_at,source:source.href,conditions:[...new Set(conditions.filter(x=>typeof x==='string'))]});
      }
    }
    return out;
  }
  function categoryRows(snapshot, date) {
    if (!isTodayProjection(snapshot, date)) return [];
    const dto = snapshot.category_prices_v1 === undefined ? null : rowsFromDto(snapshot.category_prices_v1, date, snapshot);
    return dto ?? rowsFromLegacy(snapshot, date);
  }
  // Grouped by status then store order (round-robin across stores within a status).
  // No numeric price comparison or sorting anywhere.
  function arrange(rows) {
    const out = [];
    for (const status of ['confirmed', 'reference', 'unknown']) {
      const lanes = storeIds.map(id => rows.filter(r => r.price_status === status && r.store === id)
        .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).filter(l => l.length);
      for (let i = 0; lanes.some(l => i < l.length); i++) for (const l of lanes) if (i < l.length) out.push(l[i]);
    }
    return out;
  }

  const PAGE = 8;
  let selectSeq = 0;
  function render(doc, target, snapshot, items, date = dayTokyo()) {
    const el = (tag, value, cls) => { const n = doc.createElement(tag); if (value !== undefined) n.textContent = value; if (cls) n.className = cls; return n; };
    const badge = (kind, text) => el('span', text, 'supermarket-badge is-' + kind);
    const linkTo = (text, href) => { const a = el('a', text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
    const today = isTodayProjection(snapshot, date);
    const previousDay = today && snapshot.freshness === 'previous_day';
    const editionReference = today && snapshot.freshness === 'edition_reference';
    const referenceOnly = previousDay || editionReference;
    target.replaceChildren(el('h2', '今日何が安いか'),
      el('p', '自動の献立・おすすめ店舗の表示は一時停止中です。以下は掲載品の一覧で、店舗の順位や最安の判定ではありません。', 'supermarket-note'),
      el('p', '価格確認済み＝原本価格の照合済み（商品日付・在庫は別） / 参考＝読み取った価格（未照合） / 価格不明＝価格を読み取れていない', 'supermarket-legend'),
      el('p', '表示日：' + date + (today && snapshot.snapshot_date ? ' / 保存スナップショット：' + snapshot.snapshot_date : ''), 'supermarket-meta'));
    if (editionReference) target.append(el('p',
      '号の掲載期間が有効な参考情報です。当日再取得・価格確認済みの意味ではありません。', 'supermarket-note'));
    if (previousDay) target.append(el('p',
      '本日の再収集ではありません。商品別の適用日が未確認のため、前日分は今日の掲載として表示しません。', 'supermarket-note'));
    if (!today) target.append(el('p', '当日のチラシ情報を確認できません。買い物リストは引き続き使えます。', 'supermarket-note'));
    const stateLabel = id => {
      const code = today && snapshot.states?.[id];
      return editionReference ? '保存済みの号を参照（当日再取得なし）' : previousDay && eligibleState(code) ? '前日照合（当日再取得なし）' : Object.hasOwn(statusLabels, code) ? statusLabels[code] : '未確認';
    };
    const confirmed = today && !referenceOnly && Array.isArray(snapshot.offers) && snapshot.offers.length <= 1000
      ? snapshot.offers.filter(o => isOffer(o,date) && eligibleState(snapshot.states?.[o.store])) : [];
    const all = today ? categoryRows(snapshot, date) : [];
    const dc=today&&snapshot.category_prices_v1?.display_counts;
    if(dc&&[dc.total,dc.shown,dc.omitted].every(n=>Number.isSafeInteger(n)&&n>=0)&&dc.total===dc.shown+dc.omitted&&dc.omitted)
      target.append(el('p','カテゴリ価格一覧は表示容量により一部省略：全'+dc.total+'行 / 配信'+dc.shown+'行 / 省略'+dc.omitted+'行（現在の絞込み件数とは別）','supermarket-note'));
    if(today&&snapshot.category_status==='omitted_response_budget')target.append(el('p','カテゴリ価格一覧は表示容量により省略しました。保存済み資料から表示できる情報を参照しています。','supermarket-note'));
    if (today && !all.length) target.append(el('p', '今日表示できる掲載商品はありません。', 'supermarket-note'));
    if (all.length) {
      const countIn = cat => all.filter(r => r.category === cat).length;
      const firstFilled = categoryIds.find(id => countIn(id)) || categoryIds[0];
      const filter = {cat: firstFilled, store: 'all'};
      const more = {};
      const chips = [];
      const box = el('section', undefined, 'supermarket-picker');
      box.setAttribute('aria-label', 'カテゴリ別の掲載価格');
      const results = el('div', undefined, 'supermarket-results');
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
      const validityLine = r => r.item_validity === 'dated'
        ? '商品の販売日：' + r.valid_from + '〜' + r.valid_until
        : '商品の販売日：未確認' + (r.edition_from && r.edition_until ? '（紙面の掲載期間 ' + r.edition_from + '〜' + r.edition_until + '）' : '（紙面期間も未確認）');
      const label = {confirmed: '価格確認済み', reference: '参考', unknown: '価格不明'};
      const rowNode = r => {
        const c = el('article', undefined, 'supermarket-offer-card is-' + r.price_status);
        c.append(el('p', r.name+(r.spec?'・'+r.spec:''), 'supermarket-offer-title'), badge(r.price_status, label[r.price_status]),
          el('p', '店舗：' + stores[r.store], 'supermarket-meta'));
        if (r.price_status === 'unknown') c.append(el('p', '価格不明 / '+(r.unit||'単位不明'), 'supermarket-meta'));
        else c.append(el('p', (r.price_text || '価格表記なし') + (r.unit_status === 'known' ? ' / ' + r.unit : '（単位不明）'), 'supermarket-price'));
        if(r.price_status==='confirmed'&&r.quote_conditions?.some(Boolean))c.append(el('p','販売条件：'+r.quote_conditions.filter(Boolean).join(' / '),'supermarket-price-conditions supermarket-meta'));
        if(r.item_validity!=='dated')c.append(el('p','商品別適用日：未確認','supermarket-meta'));
        const d = el('details', undefined, 'supermarket-row-details'); d.append(el('summary', '日付・条件・出典'));
        d.append(el('p', validityLine(r), 'supermarket-meta'));
        if (r.obtained_at) d.append(el('p', '取得・保存：' + r.obtained_at, 'supermarket-meta'));
        d.append(el('p', r.price_status === 'confirmed' ? '原本価格の照合済み。商品日付・在庫は別です。' : '読取値・条件との対応は未照合', 'supermarket-meta'));
        if (r.conditions.length) d.append(el('p', '条件：' + r.conditions.join(' / '), 'supermarket-meta'));
        if (r.source) d.append(linkTo('出典を開く', r.source));
        c.append(d);
        return c;
      };
      const list = (rows, key, title) => {
        const wrap = el('div', undefined, 'supermarket-group');
        const shown = rows.slice(0, PAGE * (1 + (more[key] || 0)));
        if (title) wrap.append(el('h4', title + '（' + shown.length + '/' + rows.length + '件）'));
        for (const r of shown) wrap.append(rowNode(r));
        if (shown.length < rows.length) {
          const b = el('button', 'さらに表示（残り' + (rows.length - shown.length) + '件）', 'supermarket-more'); b.type = 'button';
          b.addEventListener('click', () => { more[key] = (more[key] || 0) + 1; draw(); });
          wrap.append(b);
        }
        return wrap;
      };
      function draw() {
        results.replaceChildren();
        const catLabel = categories.find(c => c[0] === filter.cat)[1];
        const inCat = all.filter(r => r.category === filter.cat);
        const rows = arrange(inCat.filter(r => filter.store === 'all' || r.store === filter.store));
        const priced = rows.filter(r => r.price_status !== 'unknown'), unknown = rows.filter(r => r.price_status === 'unknown');
        const n = s => rows.filter(r => r.price_status === s).length;
        results.append(el('p', catLabel + (filter.store === 'all' ? '・全店舗' : '・' + stores[filter.store]) + '：確認済み' + n('confirmed') + ' / 参考' + n('reference') + ' / 価格不明' + n('unknown') + '件', 'supermarket-meta'));
        results.append(el('p', '価格・単位・内容量が異なる商品を並べています。金額順や最安の判定はしていません。', 'supermarket-meta'));
        if (!rows.length) results.append(el('p', (filter.store === 'all' ? '' : stores[filter.store] + '（' + stateLabel(filter.store) + '）：') + '「' + catLabel + '」の掲載はありません。', 'supermarket-note'));
        if (priced.length) results.append(list(priced, filter.cat + '|' + filter.store + '|p', null));
        if (unknown.length) {
          const d = el('details', undefined, 'supermarket-unknown');
          d.append(el('summary', '価格不明（' + unknown.length + '件）・順位なし'));
          d.append(list(unknown, filter.cat + '|' + filter.store + '|u', null));
          results.append(d);
        }
      }
      const selectId = 'supermarketCategorySelect' + (++selectSeq);
      const catField = el('div', undefined, 'supermarket-category-field');
      const catLabel = el('label', '種類で絞り込み', 'supermarket-category-label');
      catLabel.htmlFor = selectId;
      const catSelect = el('select', undefined, 'supermarket-category-select');
      catSelect.id = selectId;
      for (const [id, l] of categories) {
        const o = el('option', l + '（' + countIn(id) + '）'); o.value = id; o.selected = id === filter.cat;
        catSelect.append(o);
      }
      catSelect.addEventListener('change', () => {
        if (!categoryIds.includes(catSelect.value)) return;
        filter.cat = catSelect.value;
        draw();
      });
      catField.append(catLabel, catSelect);
      box.append(catField,
        bar('店舗で絞り込み（任意）', [['all', '全店舗'], ...storeIds.map(id => [id, shortName(id) + '（' + all.filter(r => r.store === id).length + '）'])], 'store'),
        results);
      draw();
      target.append(box);
    }
    const stateBox = el('details', undefined, 'supermarket-states');
    stateBox.append(el('summary', '6店舗の取得状況'));
    const state = el('ul');
    state.setAttribute('aria-label', '6店舗の取得状況');
    for (const [id, name] of Object.entries(stores)) {
      const count = all.filter(r => r.store === id).length;
      state.append(el('li', name + '：' + stateLabel(id) + (count ? '（' + count + '件）' : '')));
    }
    stateBox.append(state);
    target.append(stateBox);
    // Whole-paper observations are independent of confirmed offers.
    // These values remain unverified readings, including nonfood and no-price rows.
    const corpus=today&&(referenceOnly?snapshot.reference_corpus:snapshot.corpus);
    if (editionReference && corpus) target.append(el('h3','掲載期間内のチラシ・参考'),
      el('p','取得・保存時刻、号の掲載期間、商品別の適用日は別です。商品日付未確認の掲載も参考として残します。確定価格・在庫・最安比較には使いません。','supermarket-note'));
    if (previousDay && corpus) target.append(el('h3','前回のチラシ・参考'),
      el('p','保存日：'+snapshot.snapshot_date+'。以下は前回紙面の読取です。今日の特売・有効商品数・価格比較には使っていません。', 'supermarket-note'));
    if(today&&snapshot.corpus_status==='too_large')target.append(el('p','全紙面の読取はDBに保存されています。表示サイズの上限を超えたため、ここでは確認済み商品だけを表示しています。'));
    if(today&&snapshot.corpus_status==='partial')target.append(el('p','読取はDBに保存されています。表示容量を超えた分は、この画面から省略しています。'));
    const catalogs=corpus?.schema===2&&Array.isArray(corpus.catalogs)&&corpus.catalogs.length<=24?corpus.catalogs:[corpus];
    if(corpus?.schema===2) {
      const catalogCounts=catalogs.map(catalog=>{
        if(catalog?.schema!==1||catalog.verification_state!=='needs_review'||!Array.isArray(catalog.pages)||catalog.pages.length>64)return null;
        const frames=catalog.pages.reduce((n,p)=>n+(Array.isArray(p.items)?p.items.length:0),0);
        return frames<=2000?displayCounts(catalog,frames):null;
      });
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
        details.append(el('p','食品以外・価格非掲載・表示例・案内を含みます。読取値は確定売価ではなく、買い物先の判断には使っていません。'));
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
    if(confirmed.length) {
      const details=el('details');details.className='supermarket-offers';
      details.append(el('summary','価格確認済み掲載商品（'+confirmed.length+'件）'));
      for(const [id,name] of Object.entries(stores)) {
        const offers=confirmed.filter(o=>o.store===id);if(!offers.length)continue;
        details.append(el('h4',name));
        for(const o of offers) {
          const row=el('p',o.title+'・'+o.spec+'：'+priceText(o)+' / '+o.unit+'（'+o.conditions+'） '+o.from+'〜'+o.until+' ');
          row.className='supermarket-offer';
          const link=el('a','公式資料');link.href=o.source;link.target='_blank';link.rel='noopener noreferrer';
          row.append(link);details.append(row);
        }
      }
      target.append(details);
    }
  }
  const api = Object.freeze({stores, dayTokyo, recommend, render, paused, classify, categoryRows});
  root.PALURUSupermarketPoc = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
