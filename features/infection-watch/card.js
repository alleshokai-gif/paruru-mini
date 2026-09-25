(function (global) {
  "use strict";

  const API_BASE = "https://infection-watch-api-poc-fm3omcovva-an.a.run.app";
  const WATCH_BASE = "https://kawasaki-infection-watch.pages.dev/";
  const HOME_WARD = "宮前区";
  const HOME_DISTRICT = "宮前区:向丘地区";
  const FLU_SERIES = ["flu_a", "flu_b", "flu_unknown"];
  const card = document.getElementById("infectionWatchCard");
  const statusNode = document.getElementById("infectionWatchStatus");
  const contentNode = document.getElementById("infectionWatchContent");
  const linkNode = document.getElementById("infectionWatchDetails");
  const retryNode = document.getElementById("infectionWatchRetry");
  let requested = false;

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function shiftDate(value, days) {
    const date = new Date(`${value}T00:00:00Z`);
    if (!validDate(value) || !Number.isFinite(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function sumSevenDays(daily, endDate, firstOffset) {
    let total = 0;
    for (let offset = firstOffset; offset < firstOffset + 7; offset += 1) {
      const date = shiftDate(endDate, offset);
      if (!date) return null;
      for (const series of FLU_SERIES) {
        const row = daily.find(item => item.date === date && item.series === series);
        const value = row?.districts?.[HOME_DISTRICT];
        if (!Number.isSafeInteger(value) || value < 0) return null;
        total += value;
      }
    }
    return total;
  }

  function todayInTokyo() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function schoolClosureCount(snapshot, targetDate) {
    const source = snapshot.sources.find(item => item?.id === "closures");
    const rows = snapshot.data?.closures?.rows;
    if (!source || !["ok", "publication_pending", "collection_failed", "stale"].includes(source.status) ||
        source.data_available !== true || !Array.isArray(rows) ||
        !validDate(targetDate) ||
        rows.some(row => !row || typeof row.ward !== "string" || typeof row.school_name !== "string" ||
          !validDate(row.start_date) || !validDate(row.end_date) || row.start_date > row.end_date)) return null;
    const schools = new Set(rows.filter(row => row.ward === HOME_WARD && row.start_date <= targetDate && row.end_date >= targetDate)
      .map(row => `${row.ward}:${row.school_name}`));
    return schools.size;
  }

  function summarize(snapshot, targetDate = todayInTokyo()) {
    if (!snapshot || snapshot.schema_version !== 1 || !Array.isArray(snapshot.sources)) return null;
    const realtimeStatus = snapshot.sources.find(source => source?.id === "realtime");
    const closuresStatus = snapshot.sources.find(source => source?.id === "closures");
    const realtime = snapshot.data?.realtime;
    if (!realtimeStatus || !["ok", "publication_pending", "collection_failed", "stale"].includes(realtimeStatus.status) ||
        realtimeStatus.data_available !== true || !realtime ||
        !Array.isArray(realtime.daily) || !Array.isArray(realtime.districts) ||
        !realtime.districts.some(district => district.id === HOME_DISTRICT && district.ward === HOME_WARD) ||
        !validDate(realtime.periodEnd || "")) return null;
    const current = sumSevenDays(realtime.daily, realtime.periodEnd, -6);
    const previous = sumSevenDays(realtime.daily, realtime.periodEnd, -13);
    if (current === null || previous === null) return null;
    const closureCount = schoolClosureCount(snapshot, targetDate);
    const statusSources = closureCount === null ? [realtimeStatus] : [realtimeStatus, closuresStatus].filter(Boolean);
    const effectiveStatus = statusSources.find(source => source.status !== "ok")?.status || "ok";
    return {
      current,
      previous,
      closureCount,
      closureDate: targetDate,
      periodEnd: realtime.periodEnd,
      lastKnownGood: statusSources.some(source => source.data_is_last_known_good === true),
      sourceStatus: effectiveStatus
    };
  }

  function deepLink() {
    const url = new URL(WATCH_BASE);
    url.search = new URLSearchParams({ disease: "influenza", ward: HOME_WARD, district: HOME_DISTRICT }).toString();
    return url.href;
  }

  function statusText(source) {
    if (source?.status === "publication_pending") return "公表待ち";
    if (source?.status === "collection_failed") return source.data_is_last_known_good ? "前回確認データ" : "更新に失敗";
    if (source?.status === "stale") return "更新が遅れています";
    if (source?.data_is_last_known_good) return "前回確認データ";
    return "更新確認済み";
  }

  function renderMessage(text, warning) {
    if (statusNode) {
      statusNode.textContent = text;
      statusNode.classList.toggle("is-warning", !!warning);
    }
    if (contentNode) contentNode.innerHTML = "<p>感染症情報を確認できませんでした。</p>";
    if (retryNode) retryNode.hidden = false;
  }

  function renderSummary(summary) {
    if (!summary || !statusNode || !contentNode) return false;
    statusNode.textContent = summary.lastKnownGood ? "前回確認データ" : statusText({ status: summary.sourceStatus });
    statusNode.classList.toggle("is-warning", summary.lastKnownGood || summary.sourceStatus !== "ok");
    const change = summary.previous === 0
      ? (summary.current > 0 ? "前7日 0件から報告" : "前7日と同数")
      : `前7日比 ${summary.current > summary.previous ? "+" : ""}${Math.round((summary.current - summary.previous) / summary.previous * 100)}%`;
    const safeCurrent = Number.isSafeInteger(summary.current) ? summary.current : null;
    const safePrevious = Number.isSafeInteger(summary.previous) ? summary.previous : null;
    if (safeCurrent === null || safePrevious === null) return false;
    const closures = Number.isSafeInteger(summary.closureCount)
      ? `<p class="infection-watch-meta">${HOME_WARD}内の学校休業 ${summary.closureCount}校 · ${summary.closureDate}時点（区単位）</p>`
      : `<p class="infection-watch-meta">学校休業情報は確認できません</p>`;
    contentNode.innerHTML = `<div class="infection-watch-summary"><strong>インフルエンザ</strong><span>直近7日 ${safeCurrent}件</span><span>${change}</span></div><p class="infection-watch-meta">${HOME_WARD}・向丘地区 · ${summary.periodEnd}までの医療報告件数</p>${closures}`;
    if (retryNode) retryNode.hidden = true;
    return true;
  }

  async function readState(fetchImpl) {
    try {
      const response = await fetchImpl(`${API_BASE}/v1/snapshot`, {
        method: "GET", credentials: "omit", cache: "default", headers: { Accept: "application/json" }
      });
      if (response.status === 503) {
        const problem = await response.json();
        if (problem?.error?.code === "SNAPSHOT_INCOMPLETE") {
          const statusResponse = await fetchImpl(`${API_BASE}/v1/status`, {
            method: "GET", credentials: "omit", cache: "default", headers: { Accept: "application/json" }
          });
          if (statusResponse.ok) {
            const status = await statusResponse.json();
            const sources = Array.isArray(status.sources) ? status.sources : [];
            if (sources.some(source => source?.status === "publication_pending")) return { kind: "pending" };
            if (sources.some(source => source?.status === "collection_failed")) return { kind: "failed" };
            if (sources.some(source => source?.status === "stale")) return { kind: "stale" };
          }
          return { kind: "incomplete" };
        }
        return { kind: "error" };
      }
      if (!response.ok) return { kind: "error" };
      const summary = summarize(await response.json());
      return summary ? { kind: "summary", summary } : { kind: "invalid" };
    } catch {
      return { kind: "error" };
    }
  }

  async function load(fetchImpl) {
    if (!card) return { kind: "unavailable" };
    if (statusNode) statusNode.textContent = "確認中";
    if (retryNode) retryNode.hidden = true;
    const state = await readState(fetchImpl || global.fetch.bind(global));
    if (state.kind === "summary") {
      if (!renderSummary(state.summary)) renderMessage("データ形式を確認できません", true);
    } else if (state.kind === "pending") renderMessage("一部の情報は公表待ちです", true);
    else if (state.kind === "failed") renderMessage("感染症情報の更新に失敗しています", true);
    else if (state.kind === "stale") renderMessage("感染症情報の更新が遅れています", true);
    else if (state.kind === "incomplete") renderMessage("データ準備中です", true);
    else renderMessage("感染症情報を取得できませんでした", true);
    return state;
  }

  function setVisible(visible) {
    if (!card) return;
    card.hidden = !visible;
    if (!visible) {
      requested = false;
      return;
    }
    if (linkNode) linkNode.href = deepLink();
    if (!requested) {
      requested = true;
      void load();
    }
  }

  retryNode?.addEventListener("click", () => { void load(); });
  global.PALURUInfectionWatchCard = { deepLink, load, readState, setVisible, summarize };
})(window);
