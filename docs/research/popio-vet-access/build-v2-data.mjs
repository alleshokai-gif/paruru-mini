import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DATE = "2026-08-24";
const ORIGIN = { latitude: 35.603158, longitude: 139.58553 };
const AREA_PREFIX = {
  miyamae: "神奈川県川崎市宮前区",
  takatsu: "神奈川県川崎市高津区",
  tama: "神奈川県川崎市多摩区",
  aoba: "神奈川県横浜市青葉区",
  tsuzuki: "神奈川県横浜市都筑区",
};
const AREA_LABEL = {
  miyamae: "川崎市宮前区",
  takatsu: "川崎市高津区",
  tama: "川崎市多摩区",
  aoba: "横浜市青葉区",
  tsuzuki: "横浜市都筑区",
  kawasaki_other: "川崎市（対象3区外）",
  yokohama_other: "横浜市（対象2区外）",
  tokyo: "東京都",
  other: "その他",
};
const SOURCE_URL = {
  kawasaki_vma: "https://www.k-vma.com/member-map/",
  yokohama_vma_aoba: "https://yvma.or.jp/hospital/index.html",
  yokohama_vma_tsuzuki: "https://yvma.or.jp/hospital/tsuzuki.html",
  yokohama_city: "https://www.city.yokohama.lg.jp/kurashi/sumai-kurashi/pet-dobutsu/aigo/kainushi/kyokenbyo.files/0062_20260401.pdf",
  ipet: "https://www.ipetclub.jp/vh/",
};

const existingData = JSON.parse(fs.readFileSync(path.join(HERE, "hospitals.json"), "utf8"));
const existing = {
  ...existingData,
  hospitals: existingData.hospitals.filter((hospital) => !hospital.hospital_id.startsWith("v2-")),
};
const source = JSON.parse(fs.readFileSync(path.join(HERE, "population-v2-source.json"), "utf8"));

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[・･\s「」『』【】()[\]（）"'’]/g, "")
    .replace(/(動物病院|どうぶつ病院|ペットクリニック|犬猫病院|獣医科病院|獣医科医院|獣医科|医院|クリニック|診療所)$/g, "");
}

const NAME_ALIAS = new Map([
  ["くらた動物病院フェレットメディカルセンター", "くらた動物病院"],
  ["たちばなペットクリニック", "橘動物病院"],
  ["ワタナベ獣医科", "ワタナベ獣医科病院"],
  ["ワタナベ獣医科医院", "ワタナベ獣医科病院"],
  ["動物病院川崎菅生ぺットウェルネスラボ", "上原どうぶつ病院"],
  ["動物病院川崎菅生ペットウェルネスラボ", "上原どうぶつ病院"],
  ["はるも動物病院", "村山動物病院"],
  ["jasmineどうぶつ総合医療センター", "ジャスミン どうぶつ総合医療センター"],
  ["石田ようこ犬と猫の歯科クリニック鷺沼院", "犬猫の歯医者さん 石田動物病院"],
  ["ルポ動物病院", "リーポス動物病院"],
  ["動物病院「和（なごみ）」-skincare@koaa", "動物病院「和（なごみ）」"],
  ["ペテモ動物病院キテラプラザ青葉台", "ペテモ動物病院 青葉台"],
  ["つきの木どうぶつ診療所", "つきの木動物病院"],
  ["アニマルセラピーハウスセンター南動物病院", "センター南動物病院"],
  ["コノハ動物病院", "このは動物病院"],
]);

function canonicalName(value) {
  const normalized = String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  for (const [from, to] of NAME_ALIAS) {
    if (normalized === from.normalize("NFKC").toLowerCase().replace(/\s+/g, "")) return to;
  }
  return value;
}

function key(value) {
  return normalizeName(canonicalName(value));
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (degrees) => degrees * Math.PI / 180;
  const earthKm = 6371.0088;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fnvId(value) {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function deriveArea(address = "") {
  if (address.includes("宮前区")) return "miyamae";
  if (address.includes("高津区")) return "takatsu";
  if (address.includes("多摩区")) return "tama";
  if (address.includes("青葉区")) return "aoba";
  if (address.includes("都筑区")) return "tsuzuki";
  if (address.includes("川崎市")) return "kawasaki_other";
  if (address.includes("横浜市")) return "yokohama_other";
  if (address.includes("東京都")) return "tokyo";
  return "other";
}

function fullAddress(row) {
  if (!row.address) return null;
  if (/^(神奈川県|東京都)/.test(row.address)) return row.address;
  return `${AREA_PREFIX[row.area] || ""}${row.address}`;
}

function band(distance) {
  if (distance == null) return "unknown";
  if (distance <= 1) return "0-1km";
  if (distance <= 3) return "1-3km";
  if (distance <= 5) return "3-5km";
  if (distance <= 7) return "5-7km";
  return "7km+";
}

function estimatedMinutes(distance) {
  return distance == null ? null : Math.max(3, Math.round(3 + distance * 3));
}

function triValue(value, unknown = 50) {
  return value === true ? 100 : value === false ? 0 : unknown;
}

function reputationScore(hospital) {
  const sources = [
    [hospital.google_rating, hospital.google_review_count],
    [hospital.caloo_rating, hospital.caloo_review_count],
  ].filter(([rating, count]) => Number.isFinite(rating) && Number.isFinite(count) && count > 0);
  if (!sources.length) return null;
  const priorMean = 4.2;
  const priorWeight = 20;
  let numerator = priorMean * priorWeight;
  let denominator = priorWeight;
  for (const [rating, count] of sources) {
    numerator += rating * count;
    denominator += count;
  }
  return Math.round(clamp((numerator / denominator - 3) / 2 * 100));
}

function reputationConfidence(hospital) {
  const googleCount = Number.isFinite(hospital.google_review_count) ? hospital.google_review_count : 0;
  const calooCount = Number.isFinite(hospital.caloo_review_count) ? hospital.caloo_review_count : 0;
  if (googleCount + calooCount === 0) return 0;
  const volume = Math.min(70, 70 * Math.log1p(googleCount + calooCount) / Math.log(151));
  const multiSource = googleCount > 0 && calooCount > 0 ? 15 : 0;
  const crossSource = (hospital.cross_source_signals || []).length ? 15 : 0;
  return Math.round(clamp(volume + multiSource + crossSource));
}

function accessibilityScore(hospital) {
  const minutes = hospital.travel_time?.value;
  const timeScore = minutes == null ? 50
    : minutes <= 5 ? 100
    : minutes <= 10 ? 92
    : minutes <= 15 ? 82
    : minutes <= 20 ? 70
    : minutes <= 30 ? 50
    : minutes <= 45 ? 30 : 10;
  const parkingScore = triValue(hospital.parking?.available);
  const weekendScore = (
    triValue(hospital.access?.sunday) + triValue(hospital.access?.public_holiday)
  ) / 2;
  return Math.round(timeScore * 0.75 + parkingScore * 0.15 + weekendScore * 0.1);
}

function weightedKnown(pairs, minimumKnown = 1) {
  const known = pairs.filter(([value]) => value === true || value === false);
  if (known.length < minimumKnown) return null;
  const numerator = pairs.reduce((sum, [value, weight]) => sum + triValue(value) * weight, 0);
  const denominator = pairs.reduce((sum, [, weight]) => sum + weight, 0);
  return Math.round(numerator / denominator);
}

function medicalScore(hospital) {
  const medical = hospital.medical || {};
  return weightedKnown([
    [medical.hospitalization, 2], [medical.surgery, 2], [medical.xray, 1],
    [medical.ultrasound, 1], [medical.ct, 2], [medical.mri, 2],
    [medical.referral?.officially_stated, 1],
  ], 3);
}

function dachshundScore(hospital) {
  const medical = hospital.medical || {};
  const hasCoreEvidence = [medical.orthopedics, medical.neurology, medical.ivdd]
    .some((value) => value === true || value === false);
  if (!hasCoreEvidence) return null;
  return weightedKnown([
    [medical.orthopedics, 2], [medical.neurology, 2], [medical.ivdd, 3],
    [medical.ct, 1], [medical.mri, 2], [medical.surgery, 1],
    [medical.rehabilitation, 1],
  ], 1);
}

function emergencyScore(hospital) {
  return weightedKnown([
    [hospital.emergency, 2], [hospital.night_service?.available, 3],
    [hospital.night_service?.admission, 2], [hospital.medical?.hospitalization, 2],
  ], 1);
}

function availabilityScore(hospital) {
  return Math.round(
    triValue(hospital.access?.saturday) * 0.25
    + triValue(hospital.access?.sunday) * 0.25
    + triValue(hospital.access?.public_holiday) * 0.2
    + triValue(hospital.access?.web_reservation) * 0.15
    + triValue(hospital.access?.same_day) * 0.15
  );
}

function applyScores(hospital) {
  hospital.negative_medical_signals = (hospital.negative_signals || []).filter((item) =>
    ["diagnosis", "treatment", "examination", "surgery", "emergency", "second_opinion", "unnecessary_care"].includes(item.category));
  hospital.negative_service_signals = (hospital.negative_signals || []).filter((item) =>
    ["waiting", "reservation", "phone", "reception", "crowding", "owner_handling"].includes(item.category));
  hospital.cross_source_signals = [
    ...(hospital.positive_signals || []), ...(hospital.negative_signals || []),
  ].filter((item) => item.replication === "cross_source");
  hospital.reputation_score = reputationScore(hospital);
  hospital.reputation_confidence = reputationConfidence(hospital);
  hospital.accessibility_score = accessibilityScore(hospital);
  hospital.medical_capability_score = medicalScore(hospital);
  hospital.dachshund_score = dachshundScore(hospital);
  hospital.emergency_score = emergencyScore(hospital);
  const insuranceScore = hospital.ipet_status === "window_settlement" ? 100
    : hospital.ipet_status === "non_window_settlement" ? 20 : 50;
  const reputation = hospital.reputation_score ?? 50;
  const basicMedical = weightedKnown([
    [hospital.medical?.vaccination, 1], [hospital.medical?.puppy_care, 1],
    [hospital.medical?.surgery, 1],
  ], 1) ?? 50;
  hospital.home_doctor_score = Math.round(
    reputation * 0.35 + hospital.accessibility_score * 0.35
    + availabilityScore(hospital) * 0.2 + insuranceScore * 0.05 + basicMedical * 0.05
  );
  hospital.overall_reference_score = Math.round(
    hospital.home_doctor_score * 0.3 + (hospital.medical_capability_score ?? 50) * 0.2
    + (hospital.dachshund_score ?? 50) * 0.15 + (hospital.emergency_score ?? 50) * 0.15
    + reputation * 0.15 + insuranceScore * 0.05
  );
  hospital.confidence = Math.round(
    hospital.reputation_confidence * 0.65
    + (hospital.medical_capability_score == null ? 0 : 20)
    + (hospital.travel_time?.method === "google_maps_driving_route" ? 15 : 5)
  );
  hospital.score_note = "v2式。核心証拠がない個別能力スコアはnull。部分確認できた能力スコア内の未知項目と、Overallのnull項目は中立50として算術処理する。iPetは総合5%、Home Doctor 5%の利便性加点で、医療能力には加点しない。";
  return hospital;
}

const existingCoordinateFix = {
  trva: [35.62598, 139.642883],
  "camic-jonan": [35.62598, 139.642883],
  "dvms-yokohama": [35.471062, 139.618607],
  "nvlu-amc": [35.701889, 139.546646],
  "utokyo-vmc": [35.716991, 139.760361],
};
const ipetNames = new Set(Object.values(source.ipet_inventories).flat().map(key));
const associationNames = {
  kawasaki_vma: new Set(["miyamae", "takatsu", "tama"].flatMap((area) => source.association_inventories[area] || []).map(key)),
  yokohama_vma: new Set(["aoba", "tsuzuki"].flatMap((area) => source.association_inventories[area] || []).map(key)),
};

const hospitals = existing.hospitals.map((original) => {
  const hospital = structuredClone(original);
  const fixed = existingCoordinateFix[hospital.hospital_id];
  if (fixed && (hospital.latitude == null || hospital.longitude == null)) {
    hospital.latitude = fixed[0];
    hospital.longitude = fixed[1];
    hospital.coordinate_precision = "address_block_level";
    hospital.source_urls.push({
      url: `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(hospital.address)}`,
      source_type: "official_government",
      checked_at: SNAPSHOT_DATE,
      supports: ["coordinates"],
      note: "国土地理院住所検索の街区代表点。入口位置・敷地中心とは限らない。",
    });
  }
  hospital.area = deriveArea(hospital.address);
  hospital.area_label = AREA_LABEL[hospital.area];
  hospital.classification = hospital.roles.some((role) => /advanced|secondary|emergency|orthopedic|neurology|imaging/.test(role))
    ? "special_provider" : "general";
  hospital.operational_status = hospital.hospital_id === "murayama" ? "active_with_planned_rename" : "active_verified";
  hospital.aliases = hospital.hospital_id === "murayama" ? ["はるも動物病院（2026-09-01改称予定）"] : [];
  if (hospital.hospital_id === "uehara") hospital.aliases.push("動物病院川崎菅生ペットウェルネスラボ（同一住所・関係要確認）");
  if (hospital.hospital_id === "watanabe") hospital.aliases.push("ワタナベ獣医科", "ワタナベ獣医科医院");
  const ipetMatched = ipetNames.has(key(hospital.name));
  hospital.ipet_status = hospital.ipet_supported === true || ipetMatched
    ? "window_settlement" : "needs_confirmation";
  hospital.ipet_supported = hospital.ipet_status === "window_settlement" ? true
    : hospital.ipet_status === "non_window_settlement" ? false : null;
  hospital.insurance = {
    ipet_status: hospital.ipet_status,
    ipet_checked_at: SNAPSHOT_DATE,
    other_insurance: [],
    note: hospital.ipet_note || "不明",
  };
  const straight = Number.isFinite(hospital.latitude) && Number.isFinite(hospital.longitude)
    ? round1(haversineKm(ORIGIN.latitude, ORIGIN.longitude, hospital.latitude, hospital.longitude))
    : null;
  hospital.geodesic_distance_km = straight;
  hospital.distance_band = band(hospital.distance?.value ?? straight);
  hospital.access_estimate_quality = hospital.travel_time?.method === "google_maps_driving_route"
    ? "route_snapshot" : "planning_only";
  const scopedMinutes = hospital.travel_time?.value ?? estimatedMinutes(straight);
  hospital.population_scope = hospital.classification === "special_provider"
    ? scopedMinutes != null && scopedMinutes <= 45
      ? "special_provider_30_45_min" : "retained_existing_special_over_45_min"
    : scopedMinutes <= 20
      ? "general_20_min" : "geographic_reference_over_20_min";
  hospital.discovery_sources = ["existing_v1"];
  if (associationNames.kawasaki_vma.has(key(hospital.name))) hospital.discovery_sources.push("kawasaki_vma");
  if (associationNames.yokohama_vma.has(key(hospital.name))) hospital.discovery_sources.push("yokohama_vma");
  if (ipetMatched) hospital.discovery_sources.push("ipet");
  if (ipetMatched && !hospital.source_urls.some((item) => item.source_type === "official_insurer")) {
    hospital.source_urls.push({
      url: SOURCE_URL.ipet,
      source_type: "official_insurer",
      checked_at: SNAPSHOT_DATE,
      supports: ["iPet_window_settlement"],
    });
  }
  hospital.experience = { visits: [], summary: null, last_updated_at: null };
  return applyScores(hospital);
});

const masterByKey = new Map(hospitals.map((hospital) => [key(hospital.name), hospital]));
const excludedMapNames = new Set(source.excluded_aliases
  .filter((item) => item.canonical_existing_id)
  .map((item) => key(item.observed_name)));

function sourceObjects(discovery, googleMapsUrl, area) {
  const items = [];
  if (discovery.includes("google_maps")) {
    items.push({
      url: googleMapsUrl, source_type: "google_maps", checked_at: SNAPSHOT_DATE,
      supports: ["existence_listing", "coordinates", "rating", "review_count"],
    });
  }
  for (const sourceName of discovery.filter((name) => !["google_maps", "ipet", "official_site"].includes(name))) {
    const url = sourceName === "yokohama_vma"
      ? (area === "tsuzuki" ? SOURCE_URL.yokohama_vma_tsuzuki : SOURCE_URL.yokohama_vma_aoba)
      : SOURCE_URL[sourceName];
    if (!url) continue;
    items.push({
      url,
      source_type: sourceName.includes("vma") ? "official_association"
        : sourceName === "yokohama_city" ? "official_government" : "official_hospital",
      checked_at: SNAPSHOT_DATE,
      supports: ["existence_listing", "address"],
    });
  }
  if (discovery.includes("ipet")) {
    items.push({
      url: SOURCE_URL.ipet, source_type: "official_insurer", checked_at: SNAPSHOT_DATE,
      supports: ["iPet_window_settlement"],
    });
  }
  return items;
}

function createNewHospital(row, supplemental = false) {
  const canonical = canonicalName(row.name);
  const area = row.area || deriveArea(row.address);
  const address = fullAddress({ ...row, area });
  const latitude = Number.isFinite(row.latitude) ? row.latitude : null;
  const longitude = Number.isFinite(row.longitude) ? row.longitude : null;
  const straight = latitude != null && longitude != null
    ? round1(haversineKm(ORIGIN.latitude, ORIGIN.longitude, latitude, longitude)) : null;
  const minutes = estimatedMinutes(straight);
  const googleMapsUrl = row.google_maps_url
    || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${canonical} ${address || ""}`)}`;
  const discovery = new Set(supplemental ? (row.discovery || []) : ["google_maps"]);
  if (associationNames.kawasaki_vma.has(key(canonical))) discovery.add("kawasaki_vma");
  if (associationNames.yokohama_vma.has(key(canonical))) discovery.add("yokohama_vma");
  if (ipetNames.has(key(canonical))) discovery.add("ipet");
  const ipetStatus = discovery.has("ipet") ? "window_settlement" : "needs_confirmation";
  const classification = row.classification || "general";
  const roles = classification === "specialty_only" ? ["specialty_candidate"] : ["general_candidate"];
  const hospital = {
    hospital_id: `v2-${area}-${fnvId(`${area}:${canonical}`)}`,
    name: canonical,
    roles,
    area,
    area_label: AREA_LABEL[area] || AREA_LABEL.other,
    classification,
    operational_status: discovery.has("official_site") || discovery.has("kawasaki_vma")
      || discovery.has("yokohama_vma") || discovery.has("yokohama_city")
      ? "listed_by_official_source" : "listed_on_google_maps",
    aliases: canonical === row.name ? [] : [row.name],
    address,
    latitude,
    longitude,
    coordinate_precision: supplemental ? "address_block_level" : "google_maps_pin",
    phone: row.phone || null,
    alternate_phone: null,
    website_url: row.website_url || null,
    google_maps_url: googleMapsUrl,
    ipet_supported: ipetStatus === "window_settlement" ? true
      : ipetStatus === "non_window_settlement" ? false : null,
    ipet_status: ipetStatus,
    ipet_note: ipetStatus === "window_settlement"
      ? "2026-08-24のiPet公式エリア検索に掲載。"
      : "iPet公式エリア検索との完全一致を確認できず。非対応とは断定しない。",
    insurance: {
      ipet_status: ipetStatus, ipet_checked_at: SNAPSHOT_DATE, other_insurance: [],
      note: "その他の保険情報は不明。",
    },
    distance: straight == null ? null : {
      value: straight, unit: "km", method: "haversine_straight_line", measured_at: SNAPSHOT_DATE,
    },
    geodesic_distance_km: straight,
    distance_band: band(straight),
    travel_time: minutes == null ? null : {
      value: minutes, unit: "minute", method: "planning_estimate_from_straight_line",
      traffic_note: "経路検索値ではない。直線距離×3分/km＋3分の計画用概算。実走・渋滞で変動する。",
      measured_at: SNAPSHOT_DATE,
    },
    access_estimate_quality: "planning_only",
    parking: { available: null, spaces: null, note: "不明" },
    opening_hours: { display: "不明", structured_status: "unknown", note: "今回の母集団抽出では未確認。" },
    holidays: "不明",
    access: {
      saturday: null, sunday: null, public_holiday: null, web_reservation: null,
      same_day: null, reservation_note: "不明",
    },
    emergency: null,
    night_service: { available: null, display: "不明", admission: null, call_first: null },
    medical: {
      veterinarian_count: null, veterinarian_count_note: "不明", specialties: [],
      hospitalization: null, surgery: null, xray: null, ultrasound: null, ct: null, mri: null,
      orthopedics: null, neurology: null, ivdd: null, rehabilitation: null, puppy_care: null,
      vaccination: null, neutering: null,
      referral: { officially_stated: null, destinations: [], note: "不明" },
      note: "母集団収録段階。医療属性は未深掘りのため推測していない。",
    },
    google_rating: Number.isFinite(row.google_rating) ? row.google_rating : null,
    google_review_count: Number.isFinite(row.google_review_count) ? row.google_review_count : null,
    caloo_rating: null,
    caloo_review_count: null,
    review_sources: Number.isFinite(row.google_rating) ? [{
      source: "Google Maps", rating: row.google_rating, review_count: row.google_review_count,
      url: googleMapsUrl, checked_at: SNAPSHOT_DATE, status: "verified",
      note: "公開表示値のスナップショット。口コミ本文分析は未実施。",
    }] : [],
    reputation_summary: Number.isFinite(row.google_rating)
      ? "Google Mapsの評価・件数のみ取得。本文、Caloo、医療品質／接遇の分類は未深掘りで、単一ソースの参考値。"
      : "口コミ情報は未確認。",
    positive_signals: [],
    negative_signals: [],
    negative_medical_signals: [],
    negative_service_signals: [],
    cross_source_signals: [],
    local_signals: [],
    experience: { visits: [], summary: null, last_updated_at: null },
    population_scope: classification === "specialty_only" ? "special_provider_30_45_min"
      : minutes != null && minutes <= 20 ? "general_20_min" : "geographic_reference_over_20_min",
    discovery_sources: [...discovery],
    home_doctor_score: null,
    emergency_score: null,
    dachshund_score: null,
    medical_capability_score: null,
    reputation_score: null,
    reputation_confidence: null,
    accessibility_score: null,
    overall_reference_score: null,
    confidence: null,
    score_note: "",
    uncertainties: ["診療時間", "日曜・祝日診療", "駐車場", "医療設備", "専門性", "入院・救急", "Caloo・口コミ本文"],
    last_verified_at: `${SNAPSHOT_DATE}T23:30:00+09:00`,
    source_urls: sourceObjects([...discovery], googleMapsUrl, area),
  };
  return applyScores(hospital);
}

for (const row of source.google_maps_candidates) {
  const rowKey = key(row.name);
  if (excludedMapNames.has(rowKey)) continue;
  const matched = masterByKey.get(rowKey);
  if (matched) {
    if (!matched.discovery_sources.includes("google_maps")) matched.discovery_sources.push("google_maps");
    continue;
  }
  const hospital = createNewHospital(row, false);
  hospitals.push(hospital);
  masterByKey.set(key(hospital.name), hospital);
}

for (const row of source.supplemental_candidates) {
  const rowKey = key(row.name);
  const matched = masterByKey.get(rowKey);
  if (matched) {
    for (const item of row.discovery || []) {
      if (!matched.discovery_sources.includes(item)) matched.discovery_sources.push(item);
    }
    continue;
  }
  const hospital = createNewHospital(row, true);
  hospitals.push(hospital);
  masterByKey.set(key(hospital.name), hospital);
}

const duplicateIds = hospitals.map((hospital) => hospital.hospital_id)
  .filter((id, index, all) => all.indexOf(id) !== index);
if (duplicateIds.length) throw new Error(`Duplicate hospital_id: ${duplicateIds.join(", ")}`);
const preservedIds = new Set(hospitals.map((hospital) => hospital.hospital_id));
const missingExisting = existing.hospitals.filter((hospital) => !preservedIds.has(hospital.hospital_id));
if (missingExisting.length) {
  throw new Error(`Existing hospitals lost: ${missingExisting.map((item) => item.hospital_id).join(", ")}`);
}

function countBy(getter) {
  const counts = {};
  for (const hospital of hospitals) {
    const value = getter(hospital);
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, "ja")));
}

const populationSummary = {
  total: hospitals.length,
  preserved_existing: existing.hospitals.length,
  newly_added: hospitals.length - existing.hospitals.length,
  by_area: countBy((hospital) => hospital.area),
  by_distance_band: countBy((hospital) => hospital.distance_band),
  by_ipet_status: countBy((hospital) => hospital.ipet_status),
  by_classification: countBy((hospital) => hospital.classification),
  with_coordinates: hospitals.filter((hospital) => Number.isFinite(hospital.latitude) && Number.isFinite(hospital.longitude)).length,
  with_route_snapshot: hospitals.filter((hospital) => hospital.travel_time?.method === "google_maps_driving_route").length,
  with_planning_estimate: hospitals.filter((hospital) => hospital.travel_time?.method === "planning_estimate_from_straight_line").length,
};

const output = {
  ...existing,
  schema_version: "2.0.0",
  generated_at: "2026-08-24T23:30:00+09:00",
  snapshot_date: SNAPSHOT_DATE,
  origin_coordinates: ORIGIN,
  population_methodology: {
    candidate_gate: "geography_first",
    ipet_used_for_candidate_extraction: false,
    main_areas: ["miyamae", "takatsu", "tama", "aoba", "tsuzuki"],
    source_file: "population-v2-source.json",
    general_scope: "approximately_20_min",
    special_provider_scope: "approximately_30_to_45_min; two existing university providers over 45 minutes are retained for continuity",
    unknown_policy: "null_or_needs_confirmation; never infer false from absence",
  },
  scoring_model: {
    version: "2.0.0",
    reputation: "Bayesian average: prior mean 4.2, prior weight 20; Google and Caloo counts are pooled when present.",
    home_doctor_weights: {
      reputation: 0.35, accessibility: 0.35, availability: 0.2,
      ipet_convenience: 0.05, basic_medical: 0.05,
    },
    overall_weights: {
      home_doctor: 0.3, medical_capability: 0.2, dachshund: 0.15,
      emergency: 0.15, reputation: 0.15, ipet_convenience: 0.05,
    },
    unknown_policy: "A component with no core evidence remains null. Within a partially evidenced component and within Overall arithmetic, unknown is neutral 50; confidence is shown separately.",
    ipet_separation: "iPet contributes only a 5% convenience term; it never contributes to Medical Capability or Dachshund Score.",
  },
  population_summary: populationSummary,
  map: {
    implementation: "Leaflet with OpenStreetMap tiles; list and map are rendered from the same embedded hospital array.",
    fallback: "If map tiles cannot load, the list, per-hospital Google Maps links, and My Maps CSV remain usable.",
    my_maps_csv: "popio-vet-map.csv",
  },
  hospitals,
  screened_out: existing.screened_out.map((item) => item.hospital_id === "ishida-dental"
    ? { ...item, reason: `${item.reason} v2では専門特化Providerとして病院配列へ昇格し、この履歴は監査用に保持。` }
    : item),
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
