(function (root) {
  "use strict";
  const doc = root.document;
  const panel = doc.getElementById("locationHistory");
  if (!panel) return;
  const maxSource = 192 * 1024 ** 2;
  const maxUpload = 30 * 1024 ** 2;
  const categories = ["飲食店", "小売店", "商業施設", "宿泊施設", "観光・文化施設", "交通施設", "その他の公開施設"];
  const forms = [...panel.querySelectorAll("form[data-location-action]")];
  const results = panel.querySelector("[data-location-results]");
  const summary = panel.querySelector("[data-location-summary]");
  const search = panel.querySelector('[data-location-action="search"]');
  const searchStatus = panel.querySelector('[data-location-status="search"]');
  const editStatus = panel.querySelector('[data-location-status="edit"]');
  const pagination = panel.querySelector("[data-location-pagination]");
  const previous = panel.querySelector("[data-location-prev]");
  const next = panel.querySelector("[data-location-next]");
  const pageNumber = panel.querySelector("[data-location-page-number]");
  const listTitle = panel.querySelector("[data-location-list-title]");
  const attribution = panel.querySelector("[data-location-attribution]");
  const providers = panel.querySelector("[data-location-providers]");
  const counts = new Intl.NumberFormat("ja-JP");
  const errors = {
    FORBIDDEN: "この機能は所有者本人だけが利用できます。",
    LOCATION_BUSY: "別の処理が実行中です。少し待ってからもう一度お試しください。",
    LOCATION_CONCURRENT_UPDATE: "別の更新が先に保存されました。もう一度お試しください。",
    TIMELINE_SIZE_INVALID: "ファイルが空か、取り込み上限を超えています。",
    TIMELINE_SEGMENTS_INVALID: "GoogleタイムラインのsemanticSegmentsを読み取れませんでした。",
    TIMELINE_NO_SUPPORTED_EVENTS: "対応する訪問・移動・経路の記録がありません。",
    TIMELINE_JSON_INVALID: "JSONを読み取れませんでした。",
    LOCATION_PLACE_NOT_ELIGIBLE: "この施設名は公開検索用に登録できません。",
    LOCATION_SEARCH_INVALID: "日付とカテゴリを確認してください。",
  };
  let session = null;
  let owner = null;
  let requestNumber = 0;
  let currentPage = 1;
  let filters = {};
  let loading = false;
  function reset() {
    session?.abort.abort();
    session = null;
    owner = null;
    panel.hidden = true;
    results.replaceChildren();
    currentPage = 1;
    filters = {};
    pagination.hidden = true;
    attribution.hidden = true;
    summary.textContent = "";
    editStatus.textContent = "";
    for (const form of forms) {
      form.reset();
      form.querySelector("button").disabled = false;
      panel.querySelector('[data-location-status="' + form.dataset.locationAction + '"]').textContent = "";
    }
  }
  doc.addEventListener("kaz-os:locked", event => {
    if (event.detail?.state !== "booting") return reset();
    session?.abort.abort();
    session = null;
    panel.hidden = true;
    results.replaceChildren();
    pagination.hidden = true;
    attribution.hidden = true;
    summary.textContent = "";
    searchStatus.textContent = "";
    editStatus.textContent = "";
    for (const form of forms) form.querySelector("button").disabled = false;
  });
  doc.addEventListener("paruru:authenticated", event => {
    const context = event.detail?.context;
    if (context?.role !== "admin" || !context.memberUserId || typeof event.detail.getLocationHistoryAuth !== "function") return reset();
    if (owner !== context.memberUserId) reset();
    owner = context.memberUserId;
    const resumed = !session;
    session ||= { auth: event.detail.getLocationHistoryAuth, abort: new AbortController() };
    if (resumed && panel.classList.contains("is-active")) {
      panel.hidden = false;
      void runSearch();
    }
  });
  async function call(active, action, body, type = "application/json") {
    const token = (await active.auth())?.idToken;
    const base = root.PALURU_READ_TRANSPORT_V2_CONFIG?.v3BaseUrl;
    if (!base || !token || active !== session) throw new Error("FORBIDDEN");
    const response = await root.fetch(base.replace(/\/$/, "") + "/v3/location-history/" + action, {
      method: "POST", cache: "no-store", credentials: "omit", redirect: "error",
      headers: { Authorization: "Bearer " + token, "Content-Type": type }, body,
      signal: active.abort.signal,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value?.error?.code || "LOCATION_UNAVAILABLE");
    return value;
  }
  function element(tag, text) {
    const value = doc.createElement(tag);
    if (text) value.textContent = text;
    return value;
  }
  function button(text, handle) {
    const value = element("button", text);
    value.type = "button";
    value.className = "secondary-button";
    value.addEventListener("click", () => handle(value));
    return value;
  }
  let saving = false;
  async function correct(payload, control) {
    if (!session || saving) return;
    const active = session;
    saving = true;
    control.disabled = true;
    editStatus.textContent = "保存中…";
    try {
      await call(active, "corrections", JSON.stringify(payload));
      if (active !== session) return;
      if (payload.action === "rename" && search.elements.query.value.trim()) search.elements.query.value = payload.name;
      if (payload.action === "select") search.elements.query.value = "";
      if (payload.action === "reset_name") search.elements.query.value = "";
      editStatus.textContent = "修正を保存しました。";
      await runSearch();
    } catch (error) {
      if (active === session) editStatus.textContent = errors[error.message] || "修正を保存できませんでした。";
    } finally {
      saving = false;
      control.disabled = false;
    }
  }
  function renderPlace(row) {
    const item = element("li");
    const uncertain = row.name_state === "unresolved" || row.name_state === "nearby";
    const area = row.area ? row.area + " 周辺" : row.coarse_coord?.map(n => n.toFixed(2)).join(", ");
    const title = element("strong", uncertain && area ? area + "の訪問候補" : row.name);
    const badge = {estimated: "名称推定", nearby: "周辺候補・名称未確定", unresolved: "名称未確定",
      owner: "本人修正", place_id: "Google Mapsの施設IDと一致"}[row.name_state];
    const line = row.visit_count ? "訪問候補 " + row.visit_count + "回　最終 " + row.last_visit_day
      : "該当期間に記録なし。未訪問かどうかは不明です。";
    const details = element("details");
    const heading = element("summary");
    heading.append(title, element("span", [row.category || (row.category_unconfirmed ? "カテゴリ未確定" : ""),
      uncertain ? null : area, badge].filter(Boolean).join(" · ")),
      element("span", line));
    details.append(heading);
    const body = element("div");
    body.className = "location-detail";
    details.append(body);
    let loaded = false;
    details.addEventListener("toggle", async () => {
      if (!details.open || loaded || !session) return;
      for (const open of results.querySelectorAll("li > details[open]")) {
        if (open !== details) open.open = false;
      }
      const active = session;
      loaded = true;
      body.textContent = "訪問日と滞在時間を読み込み中…";
      try {
        const value = await call(active, "detail", JSON.stringify({...filters, place_key: row.place_key}));
        if (active !== session) return;
        if (!value.results[0]) throw new Error("LOCATION_PLACE_NOT_ELIGIBLE");
        body.replaceChildren();
        renderDetail(body, row, value.results[0]);
      } catch (error) {
        if (active !== session) return;
        loaded = false;
        body.textContent = errors[error.message] || "詳細を取得できません。いったん閉じて開き直してください。";
      }
    });
    item.append(details);
    return item;
  }
  function renderDetail(details, row, data) {
    const visitList = element("ul");
    for (const visit of data.visits || []) {
      const entry = element("li");
      const duration = Number.isFinite(visit.duration_seconds)
        ? (visit.duration_seconds < 60 ? "1分未満" : counts.format(Math.round(visit.duration_seconds / 60)) + "分")
        : "不明";
      const probability = visit.probability == null ? "" : " · 訪問推定 " + Math.round(visit.probability * 100) + "%";
      entry.append(element("span", visit.day + (visit.excluded ? "（除外中）" : "") + " · 滞在 " + duration + probability),
        button(visit.excluded ? "この訪問を復元" : "この訪問を除外", control =>
          void correct({action: visit.excluded ? "restore" : "exclude", target: visit.event_id}, control)));
      visitList.append(entry);
    }
    details.append(element("h3", "訪問日と滞在時間"), visitList);
    if (data.visits_truncated) details.append(element("p", "最新20件を表示。期間で絞り込めます。"));
    if (!data.visits.length) details.append(element("p", "この期間に表示できる訪問はありません。"));
    const options = element("details");
    options.append(element("summary", "施設名を修正"));
    const input = element("input");
    input.type = "text";
    input.maxLength = 120;
    input.value = ["owner", "known", "estimated"].includes(row.name_state) ? row.name : "";
    input.placeholder = "任意の表示名";
    input.autocomplete = "off";
    const label = element("label", "施設全体の名前");
    label.append(input);
    options.append(label, button("施設名を変更", control => {
      if (!input.value.trim()) { input.focus(); return; }
      void correct({action: "rename", target: row.place_key, name: input.value.trim()}, control);
    }));
    if (data.candidates?.length) {
      const select = element("select");
      for (const candidate of data.candidates) select.add(new Option(candidate.name, candidate.key));
      const candidateLabel = element("label", "自動推定の候補");
      candidateLabel.append(select);
      options.append(candidateLabel, button("候補を採用", control =>
        void correct({action: "select", target: row.place_key, candidate: select.value}, control)));
    }
    if (row.name_state === "owner") options.append(button("自動推定に戻す", control =>
      void correct({action: "reset_name", target: row.place_key}, control)));
    details.append(options);
  }
  async function runSearch(page = 1, useSubmitted = false) {
    if (!session || loading) return;
    const active = session, current = ++requestNumber;
    loading = true;
    const submit = search.querySelector("button[type=submit]");
    submit.disabled = previous.disabled = next.disabled = true;
    searchStatus.textContent = "訪問履歴を確認中…";
    if (!useSubmitted) {
      filters = Object.fromEntries(new FormData(search));
      filters.include_excluded = search.elements.include_excluded.checked;
    }
    try {
      const value = await call(active, "page", JSON.stringify({...filters, page}));
      if (active !== session || current !== requestNumber) return;
      results.replaceChildren(...value.results.map(renderPlace));
      currentPage = value.page;
      pagination.hidden = value.page_count < 2;
      pageNumber.textContent = value.page + " / " + value.page_count + " ページ";
      previous.disabled = value.page <= 1;
      next.disabled = value.page >= value.page_count;
      if (useSubmitted) listTitle.scrollIntoView({block: "start"});
      listTitle.textContent = ["query", "area", "category", "start", "end"].some(field => filters[field])
        ? "検索結果" : "最近の訪問場所";
      attribution.hidden = !value.results.some(row => row.name_state === "place_id");
      const credits = [...new Set(value.results.flatMap(row => row.attributions || []))];
      providers.textContent = credits.length ? " · " + credits.join(" · ") : "";
      summary.textContent = value.first_day
        ? "保存済み " + counts.format(value.events) + "イベント／訪問 " + counts.format(value.by_kind.visit)
          + "件／" + value.first_day + "〜" + value.last_day
        : "";
      searchStatus.textContent = value.status === "not_imported" ? "タイムラインはまだ取り込まれていません。"
        : value.lookup?.startsWith("LOCATION_PLACES") || value.lookup === "not_configured" ? "外部の施設照合を利用できません。保存済みの情報で検索しました。"
        : value.resolution === "limited" ? "施設名の照会上限に達しました。照合済みの情報とエリアを表示しています。"
        : value.resolution === "unavailable" ? "施設名の照会ができませんでした。エリアや保存済みの情報を表示しています。"
        : !value.results.length ? "このページに条件に合う訪問候補はありません。" : "";
    } catch (error) {
      if (active !== session || current !== requestNumber) return;
      results.replaceChildren();
      pagination.hidden = true;
      attribution.hidden = true;
      searchStatus.textContent = errors[error.message] || "訪問履歴を読み込めませんでした。もう一度お試しください。";
    } finally {
      loading = false;
      if (active === session) submit.disabled = false;
    }
  }
  doc.addEventListener("paruru:location-history-opened", () => {
    if (!summary.textContent) void runSearch();
  });
  previous.addEventListener("click", () => void runSearch(currentPage - 1, true));
  next.addEventListener("click", () => void runSearch(currentPage + 1, true));
  for (const form of forms) {
    const action = form.dataset.locationAction;
    const select = form.elements.category;
    if (select) {
      select.add(new Option(action === "search" ? "すべて" : "選択してください", ""));
      for (const category of categories) select.add(new Option(category, category));
    }
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!session) return;
      if (action === "search") { editStatus.textContent = ""; await runSearch(); return; }
      const active = session;
      const button = form.querySelector("button");
      const status = panel.querySelector('[data-location-status="' + action + '"]');
      button.disabled = true;
      status.textContent = "処理中…";
      try {
        if (action === "import") {
          const file = form.elements.file.files[0];
          if (!file?.size || file.size > maxSource) throw new Error("TIMELINE_SIZE_INVALID");
          let body = file;
          let type = "application/json";
          if (root.CompressionStream) {
            body = await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
            type = "application/gzip";
          }
          if (body.size > maxUpload) throw new Error("TIMELINE_SIZE_INVALID");
          const value = await call(active, action, body, type);
          if (active !== session) return;
          const range = value.first_day ? "／期間 " + value.first_day + "〜" + value.last_day : "";
          const skipped = (value.invalid_components || 0) + (value.unknown_segments || 0);
          status.textContent = (value.status === "already_imported" ? "このファイルは取り込み済み。" : "保存を確認しました。")
            + "追加 " + counts.format(value.added) + "件／更新 " + counts.format(value.updated)
            + "件／重複 " + counts.format(value.duplicates) + "件／全 " + counts.format(value.events) + "件" + range
            + (skipped ? "／対象外・読み取れない要素 " + counts.format(skipped) + "件" : "");
          await runSearch();
        }
      } catch (error) {
        if (active === session) status.textContent = errors[error.message] || "処理を確認できませんでした。通信とログイン状態を確認して再試行してください。";
      } finally {
        if (active === session) button.disabled = false;
      }
    });
  }
})(globalThis);
