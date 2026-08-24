import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(here, name), "utf8");
const data = JSON.parse(read("hospitals.json"));
const schema = JSON.parse(read("hospitals.schema.json"));
const source = JSON.parse(read("population-v2-source.json"));
const html = read("index.html");
const webSource = read("web-data.js").trim();
const csv = read("popio-vet-map.csv");
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function stable(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

function countBy(items, getter) {
  const result = {};
  for (const item of items) {
    const key = getter(item);
    result[key] = (result[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b, "ja")));
}

check(data.schema_version === "2.0.0", "schema_version must be 2.0.0");
check(schema.properties.schema_version.const === "2.0.0", "schema const must be 2.0.0");
check(data.population_methodology.candidate_gate === "geography_first", "candidate gate must be geography_first");
check(data.population_methodology.ipet_used_for_candidate_extraction === false, "iPet must not be extraction gate");
check(data.hospitals.length === 135, "hospital total must be 135");
check(data.population_summary.total === data.hospitals.length, "population total mismatch");
check(data.population_summary.preserved_existing === 25, "existing 25 must be preserved");
check(data.population_summary.newly_added === 110, "new hospital count must be 110");
check(source.google_maps_candidates.length === 89, "Google Maps raw count must be 89");
check(source.supplemental_candidates.length === 39, "supplemental raw count must be 39");

const expectedExistingIds = [
  "uehara", "takada", "yuimaru", "miyamaedaira", "root", "suzuki", "mullk", "murayama",
  "mominoki", "rika", "tachibana", "kurata", "tayama", "mizonokuchi", "watanabe",
  "jarmec-kawasaki", "kawasaki-night", "amc", "yokohama-aoba", "aoba-amc", "trva",
  "camic-jonan", "dvms-yokohama", "nvlu-amc", "utokyo-vmc",
];
const ids = data.hospitals.map(hospital => hospital.hospital_id);
const idSet = new Set(ids);
check(idSet.size === ids.length, "hospital_id must be unique");
for (const id of expectedExistingIds) check(idSet.has(id), `existing hospital missing: ${id}`);
check(data.hospitals.filter(hospital => hospital.hospital_id.startsWith("v2-")).length === 110, "v2 id count must be 110");

const requiredHospitalFields = [
  "hospital_id", "name", "area", "classification", "address", "latitude", "longitude",
  "ipet_status", "distance_band", "travel_time", "access", "medical", "google_rating",
  "home_doctor_score", "emergency_score", "dachshund_score", "medical_capability_score",
  "reputation_score", "reputation_confidence", "accessibility_score", "overall_reference_score",
  "experience", "last_verified_at", "source_urls",
];
for (const hospital of data.hospitals) {
  for (const field of requiredHospitalFields) {
    check(Object.hasOwn(hospital, field), `${hospital.hospital_id}: missing ${field}`);
  }
  check(Number.isFinite(hospital.latitude) && Number.isFinite(hospital.longitude), `${hospital.hospital_id}: coordinates missing`);
  check(["window_settlement", "non_window_settlement", "needs_confirmation"].includes(hospital.ipet_status), `${hospital.hospital_id}: invalid ipet_status`);
  if (hospital.ipet_status === "window_settlement") check(hospital.ipet_supported === true, `${hospital.hospital_id}: iPet true mismatch`);
  if (hospital.ipet_status === "needs_confirmation") check(hospital.ipet_supported === null, `${hospital.hospital_id}: unknown iPet must be null`);
  if (hospital.ipet_status === "non_window_settlement") check(hospital.ipet_supported === false, `${hospital.hospital_id}: non-window iPet must be false`);
  for (const field of ["home_doctor_score", "emergency_score", "dachshund_score", "medical_capability_score", "reputation_score", "reputation_confidence", "accessibility_score", "overall_reference_score", "confidence"]) {
    const value = hospital[field];
    check(value == null || (Number.isInteger(value) && value >= 0 && value <= 100), `${hospital.hospital_id}: invalid ${field}`);
  }
  const hasDachshundCoreEvidence = [
    hospital.medical.orthopedics, hospital.medical.neurology, hospital.medical.ivdd,
  ].some(value => value === true || value === false);
  check(
    hasDachshundCoreEvidence ? hospital.dachshund_score != null : hospital.dachshund_score == null,
    `${hospital.hospital_id}: Dachshund Score must require orthopedics, neurology, or IVDD evidence`
  );
  check(/^https:\/\//.test(hospital.google_maps_url), `${hospital.hospital_id}: invalid Google Maps URL`);
  check(hospital.source_urls.length > 0, `${hospital.hospital_id}: source_urls empty`);
  if (hospital.population_scope === "special_provider_30_45_min") {
    check(hospital.travel_time.value <= 45, `${hospital.hospital_id}: special 30-45 scope exceeds 45 minutes`);
  }
  if (hospital.population_scope === "retained_existing_special_over_45_min") {
    check(!hospital.hospital_id.startsWith("v2-") && hospital.travel_time.value > 45, `${hospital.hospital_id}: invalid retained over-45 scope`);
  }
}

check(stable(countBy(data.hospitals, hospital => hospital.area)) === stable(data.population_summary.by_area), "area summary mismatch");
check(stable(countBy(data.hospitals, hospital => hospital.distance_band)) === stable(data.population_summary.by_distance_band), "distance band summary mismatch");
check(stable(countBy(data.hospitals, hospital => hospital.ipet_status)) === stable(data.population_summary.by_ipet_status), "iPet summary mismatch");
check(data.hospitals.filter(hospital => hospital.ipet_status === "window_settlement").length === 81, "iPet window count must be 81");
check(data.hospitals.filter(hospital => hospital.ipet_status === "needs_confirmation").length === 54, "iPet confirmation count must be 54");
check(data.hospitals.filter(hospital => hospital.travel_time.method === "google_maps_driving_route").length === 25, "route snapshot count must be 25");
check(data.hospitals.filter(hospital => hospital.travel_time.method === "planning_estimate_from_straight_line").length === 110, "planning estimate count must be 110");

check(webSource.startsWith("window.POPIO_VET_DATA=") && webSource.endsWith(";"), "web-data.js wrapper invalid");
const webData = JSON.parse(webSource.slice("window.POPIO_VET_DATA=".length, -1));
check(webData.hospitals.length === data.hospitals.length, "web data count mismatch");
check(webData.hospitals.every(hospital => idSet.has(hospital.id)), "web data contains unknown id");
check(csv.split(/\r?\n/).filter(Boolean).length === data.hospitals.length + 1, "CSV row count mismatch");

for (const token of [
  'data-ipet="window_settlement"', 'data-filter="within10"', 'data-filter="within20"',
  'data-filter="sunday"', 'data-filter="holiday"', 'data-filter="night"',
  'data-filter="orthoNeuro"', 'data-filter="ivdd"', 'data-filter="advanced"',
  'value="overall"', 'value="distance"', 'value="minutes"', 'value="google"',
  'value="confidence"', 'value="home"', 'value="dachshund"', 'value="emergency"',
  'data-view="map"', 'popio-vet-map.csv', 'web-data.js',
]) {
  check(html.includes(token), `index.html missing UI token: ${token}`);
}

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).filter(script => script.trim());
check(inlineScripts.length === 1, "expected one inline app script");
for (const script of inlineScripts) {
  try {
    new vm.Script(script, { filename: "index-inline.js" });
  } catch (error) {
    failures.push(`inline JavaScript syntax: ${error.message}`);
  }
}

const generated = spawnSync(process.execPath, [path.join(here, "build-v2-data.mjs")], {
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
});
check(generated.status === 0, `data generator failed: ${generated.stderr}`);
check(generated.stdout.trimEnd() === read("hospitals.json").trimEnd(), "hospitals.json is not reproducible from build-v2-data.mjs");

const generatedWeb = spawnSync(process.execPath, [path.join(here, "build-v2-web-data.mjs")], {
  encoding: "utf8",
  maxBuffer: 2 * 1024 * 1024,
});
const generatedCsv = spawnSync(process.execPath, [path.join(here, "build-v2-web-data.mjs"), "csv"], {
  encoding: "utf8",
  maxBuffer: 2 * 1024 * 1024,
});
check(generatedWeb.status === 0, `web data generator failed: ${generatedWeb.stderr}`);
check(generatedCsv.status === 0, `CSV generator failed: ${generatedCsv.stderr}`);
check(generatedWeb.stdout.trimEnd() === read("web-data.js").trimEnd(), "web-data.js is not reproducible");
check(
  generatedCsv.stdout.replaceAll("\r\n", "\n").trimEnd()
    === read("popio-vet-map.csv").replaceAll("\r\n", "\n").trimEnd(),
  "popio-vet-map.csv is not reproducible"
);

if (failures.length) {
  console.error(`FAIL (${failures.length})`);
  failures.forEach(message => console.error(`- ${message}`));
  process.exit(1);
}

console.log("PASS: v2 population, preservation, scores, filters, map payload, CSV, and generator reproducibility");
console.log(JSON.stringify(data.population_summary, null, 2));
