"""Bounded ODPT observation. No raw feeds, URLs with credentials, or vehicle IDs are saved.

This is an investigation tool, not the production Provider/Core. Output is a small
allowlisted JSON summary. Incomplete/ambiguous data stays unknown for human review.
"""
import argparse
import collections
import csv
import datetime as dt
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

BUS = Path(__file__).resolve().parent
JST = dt.timezone(dt.timedelta(hours=9), "Asia/Tokyo")  # No DST in target area.
API_ROOT = "https://api.odpt.org/api/v4/"
STATIC_PATH = "files/odpt/TransportationBureau_CityOfKawasaki/AllLines.zip"
RT_PREFIX = "gtfs/realtime/odpt_TransportationBureau_CityOfKawasaki_AllLines_"
STATIC_DELIVERY_HOST = "dataodpt.blob.core.windows.net"
STATIC_DELIVERY_PREFIX = "/files-dc-public/odpt/TransportationBureau_CityOfKawasaki/AllLines-"
USER_AGENT = "PALURU-Bus-P0-validation/1"
MAX_BYTES = 32 * 1024 * 1024
MAX_EXPANDED_BYTES = 200 * 1024 * 1024
MAX_EXAMPLES = 3
ALIASES = {
    "home": {"神木本町"},
    "noborito": {"登戸", "登戸駅", "登戸駅（生田緑地口）", "登戸駅(生田緑地口)"},
    "mizonokuchi": {"溝口駅南口", "溝の口駅南口"},
}
DIRECTIONS = {
    "home_to_noborito": ("home", "noborito"),
    "home_to_mizonokuchi": ("home", "mizonokuchi"),
    "noborito_to_home": ("noborito", "home"),
    "mizonokuchi_to_home": ("mizonokuchi", "home"),
}
SECRET = ""


class ObservationError(Exception):
    """Arguments are fixed error codes only; never upstream exception messages."""


def emit(value):
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if SECRET:
        for secret_form in {SECRET, urllib.parse.quote(SECRET, safe=""),
                            urllib.parse.quote_plus(SECRET),
                            json.dumps(SECRET, ensure_ascii=False)[1:-1]}:
            encoded = encoded.replace(secret_form, "[REDACTED]")
    print(encoded, flush=True)


def read_token():
    ignored = subprocess.run(["git", "-C", str(BUS.parent), "check-ignore", "--quiet",
                              "bus/.dev.vars"], capture_output=True).returncode == 0
    tracked = subprocess.run(["git", "-C", str(BUS.parent), "ls-files", "--error-unmatch",
                              "bus/.dev.vars"], capture_output=True).returncode == 0
    if not ignored or tracked:
        raise ObservationError("SECRET_FILE_NOT_IGNORED_OR_TRACKED")
    env_token = os.environ.get("ODPT_ACCESS_TOKEN", "").strip()
    local_token = ""
    path = BUS / ".dev.vars"
    if path.exists():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            name, sep, value = line.partition("=")
            if sep and name.strip() == "ODPT_ACCESS_TOKEN":
                if local_token:
                    raise ObservationError("DUPLICATE_SECRET_SETTING")
                local_token = value.strip().strip("\"'")
    if env_token and local_token and env_token != local_token:
        raise ObservationError("SECRET_SOURCES_CONFLICT")
    token = env_token or local_token
    if not token or token in {"<local secret>", "YOUR_ACCESS_TOKEN"}:
        raise ObservationError("ODPT_ACCESS_TOKEN_MISSING")
    if any(c.isspace() for c in token):
        raise ObservationError("SECRET_FORMAT_INVALID")
    return token


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ObservationError("UPSTREAM_REDIRECT_REJECTED")


class StaticDeliveryRedirect(NoRedirect):
    """ODPT's observed static-file delivery only. Never forward the ODPT key."""
    def __init__(self, static_date):
        self.expected_path = STATIC_DELIVERY_PREFIX + static_date + ".zip"
        self.followed = False

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        query_names = set(urllib.parse.parse_qs(parsed.query))
        if (self.followed or code not in {302, 303, 307, 308} or
                parsed.scheme != "https" or parsed.hostname != STATIC_DELIVERY_HOST or
                parsed.port is not None or parsed.username or parsed.password or parsed.fragment or
                parsed.path != self.expected_path or
                not query_names <= {"se", "sig", "sp", "sr", "st", "sv"} or "sig" not in query_names):
            raise ObservationError("UPSTREAM_REDIRECT_REJECTED")
        self.followed = True
        # Use exactly the server's signed URL; copy no original query or auth headers.
        return urllib.request.Request(newurl, headers={"User-Agent": USER_AGENT})


def fetch(kind, token, static_date):
    paths = {"static": STATIC_PATH, "trip_update": RT_PREFIX + "trip_update",
             "vehicle": RT_PREFIX + "vehicle"}
    query = {"acl:consumerKey": token}
    if kind == "static":
        query["date"] = static_date
    url = API_ROOT + paths[kind] + "?" + urllib.parse.urlencode(query)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    redirect = StaticDeliveryRedirect(static_date) if kind == "static" else NoRedirect()
    start = time.monotonic()
    try:
        with urllib.request.build_opener(redirect).open(request, timeout=25) as response:
            data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise ObservationError("UPSTREAM_SIZE_LIMIT")
    except urllib.error.HTTPError as exc:
        raise ObservationError("UPSTREAM_HTTP_" + str(exc.code)) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise ObservationError("UPSTREAM_NETWORK_FAILURE") from None
    return data, {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                  "staticDeliveryRedirect": isinstance(redirect, StaticDeliveryRedirect) and redirect.followed,
                  "elapsedMs": round((time.monotonic() - start) * 1000),
                  "fetchedAt": dt.datetime.now(JST).isoformat(timespec="seconds")}


def csv_rows(archive, name, required=False):
    paths = [p for p in archive.namelist() if p.rsplit("/", 1)[-1] == name]
    if len(paths) > 1 or (required and not paths):
        raise ObservationError("STATIC_TABLE_MISSING_OR_AMBIGUOUS")
    if not paths:
        return []
    with archive.open(paths[0]) as entry:
        return list(csv.DictReader(io.TextIOWrapper(entry, encoding="utf-8-sig", newline="")))


def index_unique(rows, key):
    result = {row[key]: row for row in rows}
    if len(result) != len(rows) or "" in result:
        raise ObservationError("STATIC_DUPLICATE_OR_EMPTY_ID")
    return result


def parse_static(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if sum(i.file_size for i in archive.infolist()) > MAX_EXPANDED_BYTES:
            raise ObservationError("STATIC_EXPANSION_LIMIT")
        tables = {name: csv_rows(archive, name + ".txt", name in
                  {"stops", "routes", "trips", "stop_times", "agency"}) for name in
                  ("stops", "routes", "trips", "stop_times", "agency", "calendar",
                   "calendar_dates", "feed_info", "frequencies")}
    if any(row.get("agency_timezone") != "Asia/Tokyo" for row in tables["agency"]):
        raise ObservationError("UNSUPPORTED_AGENCY_TIMEZONE")
    if not tables["calendar"] and not tables["calendar_dates"]:
        raise ObservationError("STATIC_SERVICE_DATES_MISSING")
    stops = index_unique(tables["stops"], "stop_id")
    trips = index_unique(tables["trips"], "trip_id")
    routes = index_unique(tables["routes"], "route_id")
    chains = collections.defaultdict(list)
    for row in tables["stop_times"]:
        chains[row["trip_id"]].append(row)
    for trip_id, chain in chains.items():
        chain.sort(key=lambda row: int(row["stop_sequence"]))
        if len({int(row["stop_sequence"]) for row in chain}) != len(chain):
            raise ObservationError("STATIC_DUPLICATE_SEQUENCE")
        if trip_id not in trips or any(row["stop_id"] not in stops for row in chain):
            raise ObservationError("STATIC_REFERENCE_INVALID")
    # Names only discover candidates. Ordered trip membership, permission, parent,
    # coordinates and platform evidence must all be reviewed before fixing config IDs.
    groups = {}
    for group, names in ALIASES.items():
        initial = {sid for sid, row in stops.items() if row["stop_name"] in names}
        groups[group] = initial | {sid for sid, row in stops.items()
                                   if row.get("parent_station") in initial}
    matches = {direction: {} for direction in DIRECTIONS}
    excluded_permissions = collections.Counter()
    for direction, (origin, destination) in DIRECTIONS.items():
        for tid, chain in chains.items():
            pairs = []
            for i, row in enumerate(chain):
                if row["stop_id"] not in groups[origin]:
                    continue
                for j in range(i + 1, len(chain)):
                    end = chain[j]
                    if end["stop_id"] not in groups[destination]:
                        continue
                    if row.get("pickup_type", "") not in {"", "0"} or end.get("drop_off_type", "") not in {"", "0"}:
                        excluded_permissions[direction] += 1
                        continue
                    pairs.append((i, j))
            if pairs:
                matches[direction][tid] = pairs
    return {"tables": tables, "stops": stops, "trips": trips, "routes": routes,
            "chains": chains, "groups": groups, "matches": matches,
            "excludedPermissions": dict(excluded_permissions),
            "frequencyTrips": {r["trip_id"] for r in tables["frequencies"]}}


def active_service(static, service_id, day):
    date_key = day.strftime("%Y%m%d")
    exceptions = [r for r in static["tables"]["calendar_dates"]
                  if r["service_id"] == service_id and r["date"] == date_key]
    if len(exceptions) > 1:
        raise ObservationError("SERVICE_EXCEPTION_AMBIGUOUS")
    if exceptions:
        return exceptions[0]["exception_type"] == "1"
    weekdays = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
    return any(r["service_id"] == service_id and r["start_date"] <= date_key <= r["end_date"]
               and r[weekdays[day.weekday()]] == "1" for r in static["tables"]["calendar"])


def scheduled_epoch(value, day):
    if not value:
        return None
    h, m, s = map(int, value.split(":"))
    if h < 0 or not 0 <= m < 60 or not 0 <= s < 60:
        raise ObservationError("STATIC_TIME_INVALID")
    return int((dt.datetime.combine(day, dt.time(), JST) + dt.timedelta(hours=h, minutes=m, seconds=s)).timestamp())


def iso(epoch):
    return dt.datetime.fromtimestamp(epoch, JST).isoformat() if epoch is not None else None


def optional(message, field):
    return getattr(message, field) if message.HasField(field) else None


def enum_name(message, field):
    value = optional(message, field)
    if value is None:
        return None
    return message.DESCRIPTOR.fields_by_name[field].enum_type.values_by_number[value].name


def event_summary(event, scheduled, now):
    reported_time, reported_delay = optional(event, "time"), optional(event, "delay")
    estimated = reported_time if reported_time is not None else (
        scheduled + reported_delay if scheduled is not None and reported_delay is not None else None)
    calculated_delay = estimated - scheduled if estimated is not None and scheduled is not None else None
    return {"scheduled": iso(scheduled), "reportedTime": iso(reported_time),
            "reportedDelaySeconds": reported_delay, "estimated": iso(estimated),
            "estimateSource": "time" if reported_time is not None else (
                "scheduled_plus_delay" if estimated is not None else None),
            "delaySeconds": calculated_delay,
            "delayCheck": None if calculated_delay is None or reported_delay is None else calculated_delay == reported_delay,
            "etaMinutes": math.ceil((estimated - now) / 60) if estimated is not None and estimated >= now else None,
            "pastEvent": estimated < now if estimated is not None else None}


def resolve_stop(chain, message):
    seq, sid = optional(message, "stop_sequence"), optional(message, "stop_id")
    indices = [i for i, row in enumerate(chain) if
               (seq is None or int(row["stop_sequence"]) == seq) and
               (sid is None or row["stop_id"] == sid)]
    return indices[0] if (seq is not None or sid is not None) and len(indices) == 1 else None


def vehicle_location(chain, target_index, vehicle, unsafe_sequence=False):
    seq = optional(vehicle, "current_stop_sequence")
    sid = optional(vehicle, "stop_id")
    raw_status = enum_name(vehicle, "current_status")
    result = {"currentStopSequence": seq, "stopId": sid, "currentStatus": raw_status,
              "statusExplicit": raw_status is not None, "stopsAway": None,
              "rawSequenceDelta": None, "previousStopId": None, "nextStopId": None,
              "currentStopId": None, "targetPassed": None, "reason": None}
    if seq is None:
        result["reason"] = "CURRENT_SEQUENCE_MISSING"
        return result
    indices = [i for i, row in enumerate(chain) if int(row["stop_sequence"]) == seq
               and (sid is None or row["stop_id"] == sid)]
    if len(indices) != 1 or unsafe_sequence:
        result["reason"] = "SEQUENCE_JOIN_UNRESOLVED_OR_SKIPPED"
        return result
    i = indices[0]
    status = raw_status or "IN_TRANSIT_TO"  # Spec default; explicit presence retained above.
    result["effectiveStatus"] = status
    result["rawSequenceDelta"] = int(chain[target_index]["stop_sequence"]) - seq
    result["targetPassed"] = i > target_index
    if i > target_index:
        result["reason"] = "TARGET_PASSED"
    elif status == "STOPPED_AT":
        result.update(stopsAway=target_index - i, currentStopId=chain[i]["stop_id"])
    elif status in {"IN_TRANSIT_TO", "INCOMING_AT"}:
        result["nextStopId"] = chain[i]["stop_id"]
        if i == 0:
            result["reason"] = "BEFORE_FIRST_STOP_NO_PREVIOUS_STOP"
        else:
            result.update(stopsAway=target_index - (i - 1), previousStopId=chain[i - 1]["stop_id"])
    else:
        result["reason"] = "STATUS_UNSUPPORTED"
    return result


def kawasaki_location_for_observation(chain, target_index, vehicle, unsafe_sequence=False):
    result = vehicle_location(chain, target_index, vehicle, unsafe_sequence)
    # 2026-09-10: STOPPED_AT(seq 9) -> IN_TRANSIT_TO(seq 9) was observed
    # with forward movement. Do not assert the spec's inbound segment as fact.
    if result.get("effectiveStatus") == "IN_TRANSIT_TO" and not result["targetPassed"]:
        result["unverifiedSpecStopsAway"] = result["stopsAway"]
        result.update(stopsAway=None, previousStopId=None, nextStopId=None,
                      reason="KAWASAKI_TRANSIT_SEQUENCE_MEANING_UNVERIFIED")
    return result


def static_summary(static, meta, now):
    stops = static["stops"]
    stop_fields = ("stop_id", "stop_name", "stop_code", "platform_code", "parent_station", "location_type", "stop_lat", "stop_lon", "stop_desc")
    result = {"phase": "static", **meta, "tableRows": {k: len(v) for k, v in static["tables"].items()},
              "feedInfo": [{k: r.get(k) for k in ("feed_version", "feed_start_date", "feed_end_date")}
                           for r in static["tables"]["feed_info"]],
              "stopCandidates": {g: [{k: stops[sid].get(k) or None for k in stop_fields}
                                     for sid in sorted(ids)] for g, ids in static["groups"].items()},
              "unmatchedNearbyNames": sorted({r["stop_name"] for r in stops.values()
                 if any(term in r["stop_name"] for term in ("神木本町", "登戸", "溝口駅", "溝の口駅"))
                 and not any(r["stop_id"] in ids for ids in static["groups"].values())})[:30],
              "directions": {}}
    today = dt.datetime.fromtimestamp(now, JST).date()
    for direction, trips in static["matches"].items():
        combinations, examples, upcoming = set(), [], []
        for tid, pairs in trips.items():
            trip = static["trips"][tid]
            route = static["routes"][trip["route_id"]]
            chain = static["chains"][tid]
            for i, j in pairs:
                combinations.add((chain[i]["stop_id"], chain[j]["stop_id"], trip["route_id"], route.get("route_short_name", "")))
                example = {"tripId": tid, "routeId": trip["route_id"], "routeLabel": route.get("route_short_name"),
                           "headsign": trip.get("trip_headsign"), "stopHeadsign": chain[i].get("stop_headsign"),
                           "lastStopName": stops[chain[-1]["stop_id"]]["stop_name"], "boardingStopId": chain[i]["stop_id"],
                           "alightingStopId": chain[j]["stop_id"], "boardingSequence": int(chain[i]["stop_sequence"]),
                           "alightingSequence": int(chain[j]["stop_sequence"]), "platform": stops[chain[i]["stop_id"]].get("platform_code") or None}
                if len(examples) < MAX_EXAMPLES:
                    examples.append(example)
                if tid in static["frequencyTrips"]:
                    continue
                for offset in (-1, 0, 1):
                    day = today + dt.timedelta(days=offset)
                    if active_service(static, trip["service_id"], day):
                        departure = scheduled_epoch(chain[i].get("departure_time"), day)
                        if departure is not None and departure >= now:
                            upcoming.append((departure, {**example, "serviceDate": day.strftime("%Y%m%d"),
                                                         "scheduled": iso(departure)}))
        upcoming.sort(key=lambda item: (item[0], item[1]["tripId"], item[1]["boardingSequence"]))
        result["directions"][direction] = {"staticTripCount": len(trips), "pairCount": sum(map(len, trips.values())),
            "idCombinations": [dict(zip(("boardingStopId", "alightingStopId", "routeId", "routeLabel"), v))
                               for v in sorted(combinations)[:80]], "idCombinationsTruncated": len(combinations) > 80,
            "examples": examples, "nextScheduled": [v for _, v in upcoming[:MAX_EXAMPLES]],
            "frequencyTripsExcluded": len(set(trips) & static["frequencyTrips"]),
            "permissionPairsExcluded": static["excludedPermissions"].get(direction, 0)}
    return result


def parse_rt(data):
    from google.transit import gtfs_realtime_pb2 as pb
    feed = pb.FeedMessage()
    feed.ParseFromString(data)
    if not feed.IsInitialized():
        raise ObservationError("REALTIME_REQUIRED_FIELDS_MISSING")
    return feed


def descriptor(message):
    return {k: optional(message, k) for k in ("trip_id", "start_date", "start_time", "route_id")}


def field_counts(messages, fields):
    return {f: sum(m.HasField(f) for m in messages) for f in fields}


def choose_coherent_snapshot(feeds):
    candidates = [(name, feed) for name, feed in feeds.items()
                  if feed.header.incrementality == 0 and
                  all(any(e.HasField(kind) for e in feed.entity) for kind in ("trip_update", "vehicle"))]
    if not candidates:
        raise ObservationError("COMBINED_SNAPSHOT_UNAVAILABLE")
    name, feed = max(candidates, key=lambda item: optional(item[1].header, "timestamp") or 0)
    return name, feed


def realtime_summary(static, tu_feed, vp_feed, now):
    # Only FULL_DATASET snapshots are joinable in this bounded observer.
    if tu_feed.header.incrementality != 0 or vp_feed.header.incrementality != 0:
        return {"reason": "DIFFERENTIAL_UNSUPPORTED"}
    tus = [e.trip_update for e in tu_feed.entity if e.HasField("trip_update") and not e.is_deleted]
    vehicles = [e.vehicle for e in vp_feed.entity if e.HasField("vehicle") and not e.is_deleted]
    result = {}
    for direction, targets in static["matches"].items():
        target_tus = [tu for tu in tus if tu.trip.trip_id in targets]
        target_vps = [vp for vp in vehicles if vp.HasField("trip") and vp.trip.trip_id in targets]
        updates = [stu for tu in target_tus for stu in tu.stop_time_update]
        counts = collections.Counter()
        samples = []
        for tu in target_tus:
            tid = tu.trip.trip_id
            chain, trip = static["chains"][tid], static["trips"][tid]
            relationship = enum_name(tu.trip, "schedule_relationship") or "SCHEDULED"
            for i, j in targets[tid]:
                counts["boardingOccurrences"] += 1
                row = chain[i]
                direct = [stu for stu in tu.stop_time_update if resolve_stop(chain, stu) == i]
                sample = {"trip": descriptor(tu.trip), "tripRelationship": relationship,
                          "boardingStopId": row["stop_id"], "boardingSequence": int(row["stop_sequence"]),
                          "stopHeadsign": row.get("stop_headsign"), "lastStopName": static["stops"][chain[-1]["stop_id"]]["stop_name"],
                          "alightingStopId": chain[j]["stop_id"], "tripUpdateTimestamp": iso(optional(tu, "timestamp")),
                          "tripLevelDelaySeconds": optional(tu, "delay"), "issues": []}
                day = None
                if tu.trip.HasField("start_date"):
                    day = dt.datetime.strptime(tu.trip.start_date, "%Y%m%d").date()
                if relationship != "SCHEDULED" or tid in static["frequencyTrips"]:
                    sample["issues"].append("NON_SCHEDULED_OR_FREQUENCY_UNSUPPORTED")
                elif not day:
                    sample["issues"].append("SERVICE_DATE_MISSING_NO_GUESS")
                elif not active_service(static, trip["service_id"], day):
                    sample["issues"].append("SERVICE_DATE_INACTIVE")
                elif tu.trip.route_id and tu.trip.route_id != trip["route_id"]:
                    sample["issues"].append("ROUTE_ID_CONFLICT")
                if sample["issues"]:
                    day = None
                usable_direct = False
                if len(direct) == 1:
                    stu = direct[0]
                    sample["stopUpdate"] = {"stopId": optional(stu, "stop_id"), "stopSequence": optional(stu, "stop_sequence"),
                                            "relationship": enum_name(stu, "schedule_relationship") or "SCHEDULED"}
                    usable_direct = stu.schedule_relationship == 0
                    counts["directBoardingUpdates"] += 1
                    for event in ("arrival", "departure"):
                        scheduled = scheduled_epoch(row.get(event + "_time"), day) if day else None
                        if stu.HasField(event):
                            sample[event] = event_summary(getattr(stu, event), scheduled, now)
                            counts[event + "Present"] += 1
                            counts[event + ".delayCheckMismatch"] += int(sample[event]["delayCheck"] is False)
                            for f in ("time", "delay"):
                                counts[event + "." + f] += int(getattr(stu, event).HasField(f))
                        else:
                            sample[event] = {"scheduled": iso(scheduled), "estimated": None, "reason": "EVENT_MISSING"}
                    if not usable_direct:
                        sample["issues"].append("STOP_UPDATE_NOT_SCHEDULED")
                else:
                    sample["issues"].append("DIRECT_UPDATE_MISSING_OR_AMBIGUOUS")
                    # Delay propagation is recorded as a gap, never silently manufactured.
                same_tus = [other for other in tus if other.trip.trip_id == tid]
                vp_candidates = [vp for vp in target_vps if vp.trip.trip_id == tid and all(
                    not getattr(vp.trip, f) or not getattr(tu.trip, f) or getattr(vp.trip, f) == getattr(tu.trip, f)
                    for f in ("start_date", "start_time", "route_id"))]
                if day and len(same_tus) == 1 and len(vp_candidates) == 1:
                    vp = vp_candidates[0]
                    counts["uniqueVehicleJoin"] += 1
                    unsafe = any(stu.schedule_relationship != 0 for stu in tu.stop_time_update)
                    location = kawasaki_location_for_observation(chain, i, vp, unsafe)
                    for prefix in ("previous", "next", "current"):
                        sid = location.get(prefix + "StopId")
                        location[prefix + "StopName"] = static["stops"][sid]["stop_name"] if sid else None
                    sample["vehicle"] = {"trip": descriptor(vp.trip), "timestamp": iso(optional(vp, "timestamp")),
                        "timestampAgeSeconds": now - vp.timestamp if vp.HasField("timestamp") else None,
                        "latitude": optional(vp.position, "latitude") if vp.HasField("position") else None,
                        "longitude": optional(vp.position, "longitude") if vp.HasField("position") else None,
                        **location}
                    counts["stopsAwayReconstructed"] += int(location["stopsAway"] is not None)
                    if len(direct) != 1:
                        counts["directUpdateMissingPassed" if location["targetPassed"] else "directUpdateMissingNotPassed"] += 1
                else:
                    sample["issues"].append("VEHICLE_JOIN_MISSING_OR_AMBIGUOUS")
                event = sample.get("departure", {})
                passed = sample.get("vehicle", {}).get("targetPassed") is True
                candidate = bool(usable_direct and day and not passed and event.get("estimated") and not event.get("pastEvent"))
                sample["futureDepartureCandidate"] = candidate
                counts["futureDepartureReconstructed"] += int(candidate)
                samples.append(sample)
        samples.sort(key=lambda s: (not s["futureDepartureCandidate"], s.get("departure", {}).get("estimated") or "", s["trip"]["trip_id"]))
        result[direction] = {"tripUpdateCount": len(target_tus), "vehicleCount": len(target_vps),
            "freshnessGate": "NOT_EVALUATED_OBSERVATION_ONLY",
            "tripDescriptorPresence": field_counts([tu.trip for tu in target_tus], ("trip_id", "start_date", "start_time", "route_id")),
            "allStopUpdatesOfTargetTrips": {"count": len(updates), **field_counts(updates, ("stop_id", "stop_sequence", "arrival", "departure"))},
            "vehicleFieldPresence": field_counts(target_vps, ("trip", "current_stop_sequence", "current_status", "stop_id", "position", "timestamp")),
            "vehicleCoordinatePresence": {f: sum(vp.HasField("position") and vp.position.HasField(f) for vp in target_vps) for f in ("latitude", "longitude")},
            "vehicleStatuses": dict(collections.Counter(enum_name(vp, "current_status") or "ABSENT" for vp in target_vps)),
            "counts": dict(counts), "examples": samples[:MAX_EXAMPLES], "examplesTruncated": len(samples) > MAX_EXAMPLES}
    return result


def run():
    global SECRET
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--static-date", default="20260828", help="Catalog version verified for this observation; not a production pin")
    parser.add_argument("--samples", type=int, choices=range(1, 7), default=4)
    parser.add_argument("--interval", type=int, choices=range(15, 61), default=20)
    parser.add_argument("--check-config", action="store_true", help="Check secret availability safely; make no HTTP requests")
    args = parser.parse_args()
    if not re.fullmatch(r"\d{8}", args.static_date):
        raise ObservationError("STATIC_DATE_INVALID")
    SECRET = read_token()
    emit({"phase": "config", "secretAvailable": True, "secretFileIgnored": True})
    if args.check_config:
        return
    data, meta = fetch("static", SECRET, args.static_date)
    static = parse_static(data)
    del data
    emit(static_summary(static, {**meta, "catalogDate": args.static_date}, time.time()))
    histories = {kind: [] for kind in ("trip_update", "vehicle")}
    for index in range(args.samples):
        started = time.monotonic()
        feeds, info = {}, {}
        for kind in histories:
            try:
                data, meta = fetch(kind, SECRET, args.static_date)
                feed = parse_rt(data)
                del data
                feeds[kind] = feed
                stamp = optional(feed.header, "timestamp")
                info[kind] = {**meta, "feedTimestamp": iso(stamp), "feedAgeSeconds": round(time.time() - stamp) if stamp is not None else None,
                    "incrementality": enum_name(feed.header, "incrementality") or "FULL_DATASET",
                    "entities": len(feed.entity), "entityTypes": {f: sum(e.HasField(f) for e in feed.entity) for f in ("trip_update", "vehicle", "alert")}}
                histories[kind].append({"timestamp": stamp, "hash": meta["sha256"], "fetchedAt": meta["fetchedAt"]})
            except ObservationError as exc:
                info[kind] = {"error": exc.args[0]}
                break
        summary, source = None, None
        if len(feeds) == 2:
            source, coherent = choose_coherent_snapshot(feeds)
            summary = realtime_summary(static, coherent, coherent, time.time())
        emit({"phase": "realtime", "sample": index + 1, "feeds": info,
              "joinSnapshotSource": source, "directions": summary})
        if any(info[kind].get("error") for kind in info):
            emit({"phase": "stopped", "reason": "UPSTREAM_ERROR_NO_AUTOMATIC_RETRY"})
            raise ObservationError("UPSTREAM_SAMPLE_FAILED")
        if index + 1 < args.samples:
            time.sleep(max(0, args.interval - (time.monotonic() - started)))
    cadence = {}
    for kind, history in histories.items():
        cadence[kind] = {"successfulSamples": len(history), "observedTimestampDeltasSeconds": [
            b["timestamp"] - a["timestamp"] for a, b in zip(history, history[1:])
            if a["timestamp"] is not None and b["timestamp"] is not None],
            "payloadChanges": sum(a["hash"] != b["hash"] for a, b in zip(history, history[1:]))}
    emit({"phase": "cadence", "feeds": cadence, "note": "短時間の観測値。配信周期・4方向の安定稼働の保証ではない。"})


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        run()
    except ObservationError as exc:
        emit({"phase": "blocked", "error": exc.args[0]})
        sys.exit(2)
    except KeyboardInterrupt:
        emit({"phase": "stopped", "reason": "INTERRUPTED"})
        sys.exit(130)
    except Exception as exc:
        # Never serialize exception text/traceback: urllib messages can include the key.
        emit({"phase": "blocked", "error": "VALIDATION_FAILED", "errorType": type(exc).__name__})
        sys.exit(3)
