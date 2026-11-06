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
  function reset() {
    session?.abort.abort();
    session = null;
    panel.hidden = true;
    panel.open = false;
    results.replaceChildren();
    for (const form of forms) {
      form.reset();
      form.querySelector("button").disabled = false;
      panel.querySelector('[data-location-status="' + form.dataset.locationAction + '"]').textContent = "";
    }
  }
  doc.addEventListener("kaz-os:locked", reset);
  doc.addEventListener("paruru:authenticated", event => {
    reset();
    if (event.detail?.context?.role === "admin" && typeof event.detail.getLocationHistoryAuth === "function") {
      session = { auth: event.detail.getLocationHistoryAuth, abort: new AbortController() };
      panel.hidden = false;
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
        } else {
          const data = Object.fromEntries(new FormData(form));
          if (action === "places") data.public_venue = form.elements.public_venue.checked;
          if (action === "search") results.replaceChildren();
          const value = await call(active, action, JSON.stringify(data));
          if (active !== session) return;
          if (action === "places") {
            status.textContent = "施設名を保存しました。上の検索から確認できます。";
            return;
          }
          for (const row of value.results) {
            const item = doc.createElement("li");
            const confidence = row.max_probability == null ? "" : "／推定確率の最大 " + Math.round(row.max_probability * 100) + "%";
            item.textContent = row.name + "（" + row.category + "）: "
              + (row.visit_count ? "訪問候補 " + row.visit_count + "回／最終 " + row.last_visit_day + confidence : "該当期間に記録なし。未訪問かどうかは不明です。");
            results.append(item);
          }
          status.textContent = value.status === "not_imported" ? "タイムラインはまだ取り込まれていません。"
            : !value.results.length ? "検索条件に一致する記録はありません。未登録の施設名も検索には出ません。"
            : value.truncated ? "最新の50施設を表示しています。期間や施設名で絞れます。" : "";
        }
      } catch (error) {
        if (active === session) status.textContent = errors[error.message] || "処理を確認できませんでした。通信とログイン状態を確認して再試行してください。";
      } finally {
        if (active === session) button.disabled = false;
      }
    });
  }
})(globalThis);
