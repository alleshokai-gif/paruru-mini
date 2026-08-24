import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.join(here, "hospitals.json"), "utf8"));

const recommendationRoles = {
  miyamaedaira: "ホームドクター試行候補",
  suzuki: "最寄りホーム候補",
  root: "近隣の整形・IVDD補完",
  "aoba-amc": "整形・神経バックアップ",
  "kawasaki-night": "夜間初期救急",
  amc: "24時間・入院補完",
  "jarmec-kawasaki": "高度医療・二次診療",
};

const topIds = [
  "miyamaedaira",
  "suzuki",
  "root",
  "aoba-amc",
  "yokohama-aoba",
  "jarmec-kawasaki",
  "kawasaki-night",
  "amc",
];

function signalText(items) {
  return (items || []).map((item) => item.assessment).filter(Boolean);
}

function knownStrengths(hospital) {
  const strengths = signalText(hospital.positive_signals);
  if (hospital.medical?.ivdd === true) strengths.push("IVDD／椎間板疾患を公式情報で確認");
  if (hospital.medical?.neurology === true) strengths.push("神経診療を公式情報で確認");
  if (hospital.medical?.orthopedics === true) strengths.push("整形外科を公式情報で確認");
  if (hospital.night_service?.available === true) strengths.push("夜間対応あり");
  if (hospital.ipet_status === "window_settlement") strengths.push("iPet窓口精算");
  if (!strengths.length && hospital.google_rating != null) {
    strengths.push(`Google ${hospital.google_rating}（${hospital.google_review_count ?? "?"}件）`);
  }
  return [...new Set(strengths)].slice(0, 3);
}

function knownConcerns(hospital) {
  const concerns = [
    ...signalText(hospital.negative_medical_signals),
    ...signalText(hospital.negative_service_signals),
  ];
  if (hospital.access_estimate_quality === "planning_only") concerns.push("車時間は経路検索ではなく計画用概算");
  if (hospital.medical_capability_score == null) concerns.push("医療設備・能力は未深掘り");
  if (hospital.ipet_status === "needs_confirmation") concerns.push("iPet窓口精算は要確認");
  return [...new Set(concerns)].slice(0, 3);
}

function compact(hospital) {
  return {
    id: hospital.hospital_id,
    name: hospital.name,
    role: recommendationRoles[hospital.hospital_id]
      || (hospital.classification === "specialty_only" ? "専門特化Provider"
        : hospital.classification === "special_provider" ? "専門・高度Provider" : "一般診療候補"),
    roles: hospital.roles,
    area: hospital.area,
    areaLabel: hospital.area_label,
    classification: hospital.classification,
    populationScope: hospital.population_scope,
    operationalStatus: hospital.operational_status,
    aliases: hospital.aliases,
    address: hospital.address,
    lat: hospital.latitude,
    lng: hospital.longitude,
    phone: hospital.phone,
    website: hospital.website_url,
    maps: hospital.google_maps_url,
    ipet: hospital.ipet_status,
    distance: hospital.distance?.value ?? hospital.geodesic_distance_km,
    distanceMethod: hospital.distance?.method ?? "unknown",
    distanceBand: hospital.distance_band,
    minutes: hospital.travel_time?.value ?? null,
    travelMethod: hospital.travel_time?.method ?? "unknown",
    parking: hospital.parking?.available ?? null,
    hours: hospital.opening_hours?.display ?? "不明",
    holidays: hospital.holidays ?? "不明",
    saturday: hospital.access?.saturday ?? null,
    sunday: hospital.access?.sunday ?? null,
    publicHoliday: hospital.access?.public_holiday ?? null,
    webReservation: hospital.access?.web_reservation ?? null,
    sameDay: hospital.access?.same_day ?? null,
    emergency: hospital.emergency ?? null,
    night: hospital.night_service?.available ?? null,
    admission: hospital.medical?.hospitalization ?? hospital.night_service?.admission ?? null,
    orthopedics: hospital.medical?.orthopedics ?? null,
    neurology: hospital.medical?.neurology ?? null,
    ivdd: hospital.medical?.ivdd ?? null,
    ct: hospital.medical?.ct ?? null,
    mri: hospital.medical?.mri ?? null,
    rehabilitation: hospital.medical?.rehabilitation ?? null,
    referral: hospital.medical?.referral?.officially_stated ?? null,
    googleRating: hospital.google_rating,
    googleCount: hospital.google_review_count,
    calooRating: hospital.caloo_rating,
    calooCount: hospital.caloo_review_count,
    overall: hospital.overall_reference_score,
    home: hospital.home_doctor_score,
    medical: hospital.medical_capability_score,
    dachshund: hospital.dachshund_score,
    emergencyScore: hospital.emergency_score,
    reputation: hospital.reputation_score,
    accessibility: hospital.accessibility_score,
    confidence: hospital.reputation_confidence,
    dataConfidence: hospital.confidence,
    reputationSummary: hospital.reputation_summary,
    positive: signalText(hospital.positive_signals),
    negativeMedical: signalText(hospital.negative_medical_signals),
    negativeService: signalText(hospital.negative_service_signals),
    crossSource: signalText(hospital.cross_source_signals),
    localSignals: (hospital.local_signals || []).map((item) => item.claim),
    strengths: knownStrengths(hospital),
    concerns: knownConcerns(hospital),
    uncertainties: hospital.uncertainties,
    sources: hospital.source_urls.map((item) => ({
      url: item.url,
      type: item.source_type,
      checkedAt: item.checked_at,
    })),
    lastVerifiedAt: hospital.last_verified_at,
  };
}

const webData = {
  snapshotDate: data.snapshot_date,
  generatedAt: data.generated_at,
  origin: {
    label: data.routing_origin.label,
    lat: data.origin_coordinates.latitude,
    lng: data.origin_coordinates.longitude,
  },
  population: data.population_summary,
  scoring: data.scoring_model,
  recommendations: Object.entries(recommendationRoles).map(([id, role]) => ({ id, role })),
  topIds,
  hospitals: data.hospitals.map(compact),
};

const csvCell = (value) => {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

function csv() {
  const headers = [
    "hospital_id", "name", "role", "area", "address", "latitude", "longitude",
    "ipet_status", "distance_km", "distance_method", "travel_minutes", "travel_method",
    "overall_score", "home_doctor_score", "dachshund_score", "emergency_score",
    "google_rating", "google_review_count", "phone", "google_maps_url", "website_url",
  ];
  const rows = webData.hospitals.map((hospital) => [
    hospital.id, hospital.name, hospital.role, hospital.areaLabel, hospital.address,
    hospital.lat, hospital.lng, hospital.ipet, hospital.distance, hospital.distanceMethod,
    hospital.minutes, hospital.travelMethod, hospital.overall, hospital.home,
    hospital.dachshund, hospital.emergencyScore, hospital.googleRating, hospital.googleCount,
    hospital.phone, hospital.maps, hospital.website,
  ]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const mode = process.argv[2] || "js";
if (mode === "csv") {
  process.stdout.write(csv());
} else if (mode === "json") {
  process.stdout.write(`${JSON.stringify(webData, null, 2)}\n`);
} else {
  process.stdout.write(`window.POPIO_VET_DATA=${JSON.stringify(webData)};\n`);
}
