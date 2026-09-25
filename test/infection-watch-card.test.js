const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../features/infection-watch/card.js"), "utf8");
const serviceWorkerSource = fs.readFileSync(path.join(__dirname, "../sw.js"), "utf8");

function makeCard() {
  const classList = () => ({ add() {}, remove() {}, toggle() {} });
  const elements = Object.fromEntries(["infectionWatchCard", "infectionWatchStatus", "infectionWatchContent", "infectionWatchDetails", "infectionWatchRetry"].map(id => [id, {
    hidden: true, href: "", textContent: "", innerHTML: "", classList: classList(), addEventListener() {}
  }]));
  const window = { fetch: async () => { throw new Error("unexpected fetch"); } };
  vm.runInNewContext(source, { window, document: { getElementById: id => elements[id] }, URL, URLSearchParams, Date, Number, Array, Object, Math });
  return { api: window.PALURUInfectionWatchCard, elements };
}

function snapshot(sourceStatus = "ok", lastKnownGood = false) {
  const periodEnd = "2026-09-23";
  const dates = [];
  for (let delta = -13; delta <= 0; delta += 1) {
    const date = new Date(`${periodEnd}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + delta);
    dates.push(date.toISOString().slice(0, 10));
  }
  const daily = dates.flatMap((date, index) => ["flu_a", "flu_b", "flu_unknown"].map(series => ({
    date, series, districts: { "宮前区:向丘地区": series === "flu_a" ? (index > 6 ? 2 : 1) : 0 }
  })));
  return {
    schema_version: 1, generated_at: "2026-09-24T00:00:00Z",
    sources: [
      { id: "realtime", status: sourceStatus, data_available: true, data_is_last_known_good: lastKnownGood },
      { id: "closures", status: "ok", data_available: true, data_is_last_known_good: false }
    ],
    data: {
      realtime: { periodEnd, daily, districts: [{ id: "宮前区:向丘地区", ward: "宮前区" }] },
      closures: { rows: [
        { ward: "宮前区", school_name: "学校A", start_date: "2026-09-20", end_date: "2026-09-25" },
        { ward: "宮前区", school_name: "学校A", start_date: "2026-09-22", end_date: "2026-09-25" },
        { ward: "宮前区", school_name: "学校B", start_date: "2026-09-26", end_date: "2026-09-27" },
        { ward: "多摩区", school_name: "学校C", start_date: "2026-09-20", end_date: "2026-09-24" }
      ] }
    }
  };
}

function jsonResponse(value, status = 200) {
  return { status, ok: status >= 200 && status < 300, json: async () => value };
}

test("card uses only public filter values in canonical Watch deep link", () => {
  const { api } = makeCard();
  const url = new URL(api.deepLink());
  assert.equal(url.origin, "https://kawasaki-infection-watch.pages.dev");
  assert.equal(url.searchParams.get("disease"), "influenza");
  assert.equal(url.searchParams.get("ward"), "宮前区");
  assert.equal(url.searchParams.get("district"), "宮前区:向丘地区");
  assert.match(url.searchParams.get("schoolDate"), /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual([...url.searchParams.keys()].sort(), ["disease", "district", "schoolDate", "ward"]);
  assert.equal(url.searchParams.has("home"), false);
});

test("card script joins the versioned network-first app shell for PWA updates", () => {
  assert.match(serviceWorkerSource, /features\/infection-watch\/card\.js/);
  assert.match(serviceWorkerSource, /infection-watch-card-v1/);
});

test("card summarizes exact 7-day counts and previous period without storing a cache", async () => {
  const { api, elements } = makeCard();
  const state = await api.load(async (url, options) => {
    assert.match(url, /\/v1\/snapshot$/);
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "omit");
    return jsonResponse(snapshot());
  });
  assert.equal(state.kind, "summary");
  assert.equal(state.summary.current, 14);
  assert.equal(state.summary.previous, 7);
  assert.match(elements.infectionWatchContent.innerHTML, /直近7日 14件/);
  assert.match(elements.infectionWatchContent.innerHTML, /前7日比 \+100%/);
  assert.match(elements.infectionWatchContent.innerHTML, /宮前区内の学校休業 1校/);
});

test("API failure and incomplete publication render a card-local non-zero status", async () => {
  const { api, elements } = makeCard();
  const error = await api.load(async () => { throw new Error("private exception text"); });
  assert.equal(error.kind, "error");
  assert.equal(elements.infectionWatchStatus.textContent, "感染症情報を取得できませんでした");
  assert.doesNotMatch(elements.infectionWatchContent.innerHTML, /private exception text|0件/);

  const pending = await api.load(async url => url.endsWith("/v1/snapshot")
    ? jsonResponse({ error: { code: "SNAPSHOT_INCOMPLETE" } }, 503)
    : jsonResponse({ sources: [{ id: "preschool", status: "publication_pending" }] }));
  assert.equal(pending.kind, "pending");
  assert.equal(elements.infectionWatchStatus.textContent, "一部の情報は公表待ちです");
});

test("failed + LKG and stale status are shown as such instead of presenting fresh data", async () => {
  const { api, elements } = makeCard();
  await api.load(async () => jsonResponse(snapshot("collection_failed", true)));
  assert.equal(elements.infectionWatchStatus.textContent, "前回確認データ");
  await api.load(async () => jsonResponse(snapshot("stale", true)));
  assert.equal(elements.infectionWatchStatus.textContent, "前回確認データ");
  const closuresLkg = snapshot();
  closuresLkg.sources.find(source => source.id === "closures").status = "collection_failed";
  closuresLkg.sources.find(source => source.id === "closures").data_is_last_known_good = true;
  await api.load(async () => jsonResponse(closuresLkg));
  assert.equal(elements.infectionWatchStatus.textContent, "前回確認データ");
});

test("closures publication pending remains visible when closure rows are unavailable", async () => {
  const { api, elements } = makeCard();
  const value = snapshot();
  const closures = value.sources.find(source => source.id === "closures");
  closures.status = "publication_pending";
  closures.data_available = false;
  value.data.closures.rows = [];
  const state = await api.load(async () => jsonResponse(value));
  assert.equal(state.kind, "summary");
  assert.equal(state.summary.sourceStatus, "publication_pending");
  assert.equal(elements.infectionWatchStatus.textContent, "公表待ち");
  assert.match(elements.infectionWatchContent.innerHTML, /学校休業情報は確認できません/);
});

test("missing target district data fails closed and does not show fabricated zero", () => {
  const { api } = makeCard();
  const invalid = snapshot();
  invalid.data.realtime.districts = [];
  assert.equal(api.summarize(invalid), null);
});
