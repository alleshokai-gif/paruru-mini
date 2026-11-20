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
    const rows = snapshot?.schema === 1 && snapshot.date === date &&
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
      if(!dom && /^https:\/\/ok-corporation\.jp\/media-download\/\d+\/[a-f0-9]+\/PDF\/$/.test(href))
        return {href, label:'公式の全号PDF'};
      if(dom && /^https:\/\/rosen\.mikke-sales\.com\/stores\/taira\/flyers\/\d+\/?$/.test(href))
        return {href, label:'公開元の全カテゴリ明細'};
      if(corpus.source_kind === 'image' && (
        corpus.store === 'iy' && /^https:\/\/promo\.hatobase\.jp\/flyers\/00521\/\d+\/\d+\/?$/.test(href) ||
        corpus.store === 'yaoko' && href === 'https://yap-pd.yaoko-net.com/app/flyer/1221/' ||
        corpus.store === 'life' && href === 'https://store.lifecorp.jp/detail/east648/'
      )) return {href, label:'公式のチラシ原本'};
    } catch (_) {}
    return null;
  }
  function render(doc, target, snapshot, items, date = dayTokyo()) {
    const el = (tag, value) => { const n = doc.createElement(tag); if (value !== undefined) n.textContent = value; return n; };
    target.replaceChildren(el('h2', '今日のスーパー'), el('p', date + ' の夕食案・各案1店舗'));
    const today = snapshot?.schema === 1 && snapshot.date === date;
    const confirmed = today && Array.isArray(snapshot.offers) && snapshot.offers.length <= 1000
      ? snapshot.offers.filter(o => isOffer(o,date) && eligibleState(snapshot.states?.[o.store])) : [];
    const plans = today ? recommend(snapshot, items, date) : [];
    if (!today) target.append(el('p', '当日のチラシ情報を確認できません。買い物リストは引き続き使えます。'));
    else if (!plans.length) target.append(el('p', '今日有効で確認済みの献立候補はありません。'));
    else if (plans.length < 3) target.append(el('p', '掲載価格を確認できた材料に絞って表示しています。'));
    if (plans.length) target.append(el('p', '掲載品を基にした候補です。6店舗の合計額を比較したものではありません。'));
    for (const plan of plans) {
      const a = el('article'); a.className = 'supermarket-plan';
      const o = plan.offer;
      a.append(el('h3', plan.name), el('p', '買い物先：' + plan.store),
        el('p', o.title + '・' + o.spec + '：税抜 ' + o.net_yen + '円 / ' + o.unit + '・税込参考 ' + (o.tax_included_sen / 100).toFixed(2) + '円（' +
          o.conditions + '、' + (o.kind === 'special' ? '特売' : '週間掲載価格') + '）'),
        el('p', '価格未確認：' + plan.rest.join('、') + '。合計額・在庫は不明です。'));
      if (plan.listed.length) a.append(el('p', 'リストの同系統掲載品（数量・規格・在庫は別途確認）：' + plan.listed.join('、')));
      if (plan.unknown.length) a.append(el('p', 'リスト掲載・価格未確認：' + plan.unknown.join('、')));
      const link = el('a', '公式資料 ' + o.from + '〜' + o.until);
      link.href = o.source; link.target = '_blank'; link.rel = 'noopener noreferrer';
      a.append(link); target.append(a);
    }
    const state = el('ul');
    state.setAttribute('aria-label', '6店舗の取得状況');
    for (const [id, name] of Object.entries(stores)) {
      const code = today && snapshot.states?.[id];
      const label = Object.hasOwn(statusLabels, code) ? statusLabels[code] : '未確認';
      const count=confirmed.filter(o=>o.store===id).length;
      state.append(el('li', name + '：' + label + (count ? '（' + count + '商品）' : '')));
    }
    target.append(state);
    // Whole-paper observations are independent of confirmed offers and menus.
    // These values remain unverified readings, including nonfood and no-price rows.
    const corpus=today&&snapshot.corpus;
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
            row.append(el('p',[item.product_type,item.spec,...(item.variants||[])].filter(Boolean).join('・')));
            const quotes=Array.isArray(item.prices)?item.prices:[];
            if(!quotes.length)row.append(el('p',item.price_state==='not_printed'?'価格非掲載':'価格読取未確定'));
            for(const price of quotes)row.append(el('p','未照合の読取：'+price.raw_text+(price.unit_text?' / '+price.unit_text:'')+(price.payment_condition?'（'+price.payment_condition+'）':'')));
            if(item.conditions?.length)row.append(el('p','条件の読取・商品との対応未照合：'+item.conditions.join(' / ')));
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
          const row=el('p',o.title+'・'+o.spec+'：税抜 '+o.net_yen+'円 / '+o.unit+
            '・税込参考 '+(o.tax_included_sen/100).toFixed(2)+'円（'+o.conditions+'） '+o.from+'〜'+o.until+' ');
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
