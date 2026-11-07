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
  function reset() {
    session?.abort.abort();
    session = null;
    owner = null;
    panel.hidden = true;
    panel.open = false;
    results.replaceChildren();
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
    panel.hidden = false;
    if (resumed && panel.open) void runSearch();
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
    const title = element("strong", row.name + (row.category ? "（" + row.category + "）" : ""));
    const badge = {estimated: "施設名の推定", nearby: "周辺の施設への訪問候補", unresolved: "施設名未確定", owner: "本人が修正"}[row.name_state];
    const confidence = row.max_probability == null ? "" : "／推定確率の最大 " + Math.round(row.max_probability * 100) + "%";
    const line = row.visit_count ? "訪問候補 " + row.visit_count + "回／最終 " + row.last_visit_day + confidence
      : "該当期間に記録なし。未訪問かどうかは不明です。";
    item.append(title, element("p", [badge, line].filter(Boolean).join("。")));
    const details = element("details");
    details.append(element("summary", "訪問日・修正"));
    const input = element("input");
    input.type = "text";
    input.maxLength = 120;
    input.value = row.name_state === "unresolved" || row.name_state === "nearby" ? "" : row.name;
    input.autocomplete = "off";
    const label = element("label", "施設全体の名前");
    label.append(input);
    details.append(label, button("施設名を変更", control => {
      if (!input.value.trim()) { input.focus(); return; }
      void correct({action: "rename", target: row.place_key, name: input.value.trim()}, control);
    }));
    if (row.candidates?.length) {
      const select = element("select");
      for (const candidate of row.candidates) select.add(new Option(candidate.name, candidate.key));
      const candidateLabel = element("label", "自動推定の候補");
      candidateLabel.append(select);
      details.append(candidateLabel, button("候補を採用", control =>
        void correct({action: "select", target: row.place_key, candidate: select.value}, control)));
    }
    if (row.name_state === "owner") details.append(button("自動推定に戻す", control =>
      void correct({action: "reset_name", target: row.place_key}, control)));
    const visits = element("ul");
    for (const visit of row.visits || []) {
      const entry = element("li");
      entry.append(element("span", visit.day + (visit.excluded ? "（除外中）" : "")),
        button(visit.excluded ? "この訪問を復元" : "この訪問を除外", control =>
          void correct({action: visit.excluded ? "restore" : "exclude", target: visit.event_id}, control)));
      visits.append(entry);
    }
    details.append(visits);
    if (row.visits_truncated) details.append(element("p", "最新20件を表示。期間で絞り込めます。"));
    item.append(details);
    return item;
  }
  async function runSearch() {
    if (!session) return;
    const active = session, current = ++requestNumber;
    searchStatus.textContent = "訪問履歴を確認中…";
    const data = Object.fromEntries(new FormData(search));
    data.include_excluded = search.elements.include_excluded.checked;
    try {
      const value = await call(active, "history", JSON.stringify(data));
      if (active !== session || current !== requestNumber) return;
      results.replaceChildren(...value.results.map(renderPlace));
      summary.textContent = value.first_day
        ? "保存済み " + counts.format(value.events) + "イベント／訪問 " + counts.format(value.by_kind.visit)
          + "件／" + value.first_day + "〜" + value.last_day
        : "";
      searchStatus.textContent = value.status === "not_imported" ? "タイムラインはまだ取り込まれていません。"
        : value.lookup?.startsWith("LOCATION_PLACES") || value.lookup === "not_configured" ? "外部の施設照合を利用できません。保存済みの情報で検索しました。"
        : !value.results.length ? "条件に合う訪問候補はありません。"
        : value.truncated ? "最新の候補を表示しています。施設名や期間で絞れます。" : "";
    } catch (error) {
      if (active !== session || current !== requestNumber) return;
      results.replaceChildren();
      searchStatus.textContent = errors[error.message] || "訪問履歴を読み込めませんでした。もう一度お試しください。";
    }
  }
  panel.addEventListener("toggle", () => { if (panel.open && !summary.textContent) void runSearch(); });
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
