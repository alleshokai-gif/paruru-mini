"""Synthetic tests only. No ODPT token/network/live fixtures are used."""
import contextlib
import csv
import datetime as dt
import io
import json
import unittest
from unittest.mock import patch
import zipfile

from google.transit import gtfs_realtime_pb2 as pb
import validate_odpt as v


DAY = dt.date(2026, 9, 7)


def synthetic_static():
    tables = {
        "agency": [{"agency_timezone": "Asia/Tokyo"}],
        "stops": [
            {"stop_id": "H1", "stop_name": "神木本町", "platform_code": "1", "parent_station": ""},
            {"stop_id": "H2", "stop_name": "神木本町", "platform_code": "2", "parent_station": ""},
            {"stop_id": "N", "stop_name": "登戸駅", "platform_code": "", "parent_station": ""},
            {"stop_id": "M", "stop_name": "溝口駅南口", "platform_code": "3", "parent_station": ""}],
        "routes": [{"route_id": "R", "route_short_name": "TEST"}],
        "trips": [{"trip_id": t, "route_id": "R", "service_id": "DAILY"} for t in ("HN", "HM", "NH", "MH", "CALL")],
        "stop_times": [],
        "calendar": [{"service_id": "DAILY", "start_date": "20260901", "end_date": "20261001",
                      **{day: "1" for day in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")}}],
    }
    for trip, ids in (("HN", ["H2", "N"]), ("HM", ["H1", "M"]), ("NH", ["N", "H1"]), ("MH", ["M", "H1"]), ("CALL", ["H2", "N"])):
        for i, sid in enumerate(ids):
            tables["stop_times"].append({"trip_id": trip, "stop_id": sid, "stop_sequence": str((i + 1) * 10),
                "arrival_time": f"08:{i * 10:02}:00", "departure_time": f"08:{i * 10:02}:00",
                "pickup_type": "2" if trip == "CALL" else "0", "drop_off_type": "0"})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        for name, rows in tables.items():
            text = io.StringIO(newline="")
            writer = csv.DictWriter(text, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
            archive.writestr(name + ".txt", text.getvalue().encode("utf-8-sig"))
    return v.parse_static(buf.getvalue())


class ObservationTests(unittest.TestCase):
    def test_platforms_are_kept_separate_and_pairs_are_directional(self):
        s = synthetic_static()
        self.assertEqual(s["groups"]["home"], {"H1", "H2"})
        for direction, tid in zip(v.DIRECTIONS, ("HN", "HM", "NH", "MH")):
            self.assertEqual(set(s["matches"][direction]), {tid})
        self.assertEqual(s["excludedPermissions"]["home_to_noborito"], 1)

    def test_service_exceptions_and_after_midnight(self):
        s = synthetic_static()
        self.assertTrue(v.active_service(s, "DAILY", DAY))
        s["tables"]["calendar_dates"] = [{"service_id": "DAILY", "date": "20260907", "exception_type": "2"}]
        self.assertFalse(v.active_service(s, "DAILY", DAY))
        self.assertEqual(v.iso(v.scheduled_epoch("25:10:00", DAY)), "2026-09-08T01:10:00+09:00")

    def test_next_scheduled_excludes_past_and_preserves_boarding_platform(self):
        s = synthetic_static()
        before = v.static_summary(s, {}, v.scheduled_epoch("07:59:00", DAY))
        after = v.static_summary(s, {}, v.scheduled_epoch("08:01:00", DAY))
        for direction in v.DIRECTIONS:
            self.assertEqual(before["directions"][direction]["nextScheduled"][0]["serviceDate"], "20260907")
            self.assertEqual(after["directions"][direction]["nextScheduled"][0]["serviceDate"], "20260908")
        self.assertEqual(before["directions"]["home_to_noborito"]["nextScheduled"][0]["platform"], "2")

    def test_missing_zero_and_time_priority_are_distinct(self):
        event = pb.TripUpdate.StopTimeEvent()
        self.assertIsNone(v.event_summary(event, 1000, 900)["estimated"])
        event.delay = 0
        self.assertEqual(v.event_summary(event, 1000, 900)["reportedDelaySeconds"], 0)
        self.assertEqual(v.event_summary(event, 1000, 900)["delaySeconds"], 0)
        event.time = 1180
        result = v.event_summary(event, 1000, 900)
        self.assertEqual(result["delaySeconds"], 180)
        self.assertFalse(result["delayCheck"])
        self.assertEqual(result["etaMinutes"], 5)

    def test_delay_only_and_past_event(self):
        event = pb.TripUpdate.StopTimeEvent(delay=180)
        self.assertEqual(v.event_summary(event, 1000, 1200)["pastEvent"], True)
        self.assertIsNone(v.event_summary(event, 1000, 1200)["etaMinutes"])
        self.assertIsNone(v.event_summary(event, None, 900)["estimated"])

    def test_status_gap_and_default_semantics(self):
        chain = [{"stop_id": sid, "stop_sequence": str(seq)} for sid, seq in (("A", 10), ("B", 20), ("C", 50))]
        vehicle = pb.VehiclePosition(current_stop_sequence=50, stop_id="C")
        transit = v.vehicle_location(chain, 2, vehicle)
        self.assertEqual(transit["rawSequenceDelta"], 0)
        self.assertEqual(transit["stopsAway"], 1)
        self.assertFalse(transit["statusExplicit"])
        self.assertEqual(transit["previousStopId"], "B")
        vehicle.current_status = pb.VehiclePosition.STOPPED_AT
        self.assertEqual(v.vehicle_location(chain, 2, vehicle)["stopsAway"], 0)
        vehicle.current_stop_sequence = 20
        vehicle.stop_id = "B"
        self.assertEqual(v.vehicle_location(chain, 2, vehicle)["stopsAway"], 1)
        vehicle.current_status = pb.VehiclePosition.INCOMING_AT
        self.assertEqual(v.vehicle_location(chain, 2, vehicle)["stopsAway"], 2)
        self.assertIsNone(v.vehicle_location(chain, 2, vehicle, True)["stopsAway"])

    def test_conflicting_sequence_missing_and_passed(self):
        chain = [{"stop_id": "A", "stop_sequence": "10"}, {"stop_id": "B", "stop_sequence": "20"}]
        vehicle = pb.VehiclePosition(current_stop_sequence=20, stop_id="B")
        self.assertTrue(v.vehicle_location(chain, 0, vehicle)["targetPassed"])
        vehicle.stop_id = "A"
        self.assertIsNone(v.vehicle_location(chain, 1, vehicle)["stopsAway"])
        vehicle.ClearField("current_stop_sequence")
        self.assertEqual(v.vehicle_location(chain, 1, vehicle)["reason"], "CURRENT_SEQUENCE_MISSING")

    def test_repeat_stop_requires_sequence(self):
        chain = [{"stop_id": "A", "stop_sequence": "10"}, {"stop_id": "A", "stop_sequence": "20"}]
        update = pb.TripUpdate.StopTimeUpdate(stop_id="A")
        self.assertIsNone(v.resolve_stop(chain, update))
        update.stop_sequence = 20
        self.assertEqual(v.resolve_stop(chain, update), 1)

    def test_real_protobuf_roundtrip_and_separate_arrival_departure(self):
        s = synthetic_static()
        scheduled = v.scheduled_epoch("08:00:00", DAY)
        tu_feed = pb.FeedMessage(header=pb.FeedHeader(gtfs_realtime_version="2.0", timestamp=scheduled - 60))
        tu = tu_feed.entity.add(id="unrelated-entity-id").trip_update
        tu.trip.trip_id = "HN"
        tu.trip.start_date = "20260907"
        stu = tu.stop_time_update.add(stop_sequence=10, stop_id="H2")
        stu.arrival.time = scheduled + 60
        stu.departure.delay = 120
        vp_feed = pb.FeedMessage(header=pb.FeedHeader(gtfs_realtime_version="2.0", timestamp=scheduled - 60))
        vp = vp_feed.entity.add(id="different-entity-id").vehicle
        vp.trip.trip_id = "HN"
        vp.current_stop_sequence = 10
        vp.stop_id = "H2"
        vp.current_status = pb.VehiclePosition.STOPPED_AT
        out = v.realtime_summary(s, v.parse_rt(tu_feed.SerializeToString()), vp_feed, scheduled - 60)
        sample = out["home_to_noborito"]["examples"][0]
        self.assertEqual(sample["arrival"]["delaySeconds"], 60)
        self.assertEqual(sample["departure"]["delaySeconds"], 120)
        self.assertEqual(sample["vehicle"]["stopsAway"], 0)
        self.assertTrue(sample["futureDepartureCandidate"])
        vp.trip.start_date = "20260908"
        out = v.realtime_summary(s, tu_feed, vp_feed, scheduled - 60)
        self.assertNotIn("vehicle", out["home_to_noborito"]["examples"][0])
        tu.trip.ClearField("start_date")
        out = v.realtime_summary(s, tu_feed, vp_feed, scheduled - 60)
        self.assertFalse(out["home_to_noborito"]["examples"][0]["futureDepartureCandidate"])

    def test_secret_never_appears_in_output_or_network_error(self):
        secret = "SYNTHETIC_TEST_SECRET&=?/"
        output = io.StringIO()
        with patch.object(v, "SECRET", secret), contextlib.redirect_stdout(output):
            v.emit({"echo": secret, "encoded": v.urllib.parse.quote_plus(secret)})
        self.assertNotIn(secret, output.getvalue())
        self.assertNotIn(v.urllib.parse.quote_plus(secret), output.getvalue())
        url = "https://api.odpt.org/?acl:consumerKey=" + secret
        with patch.object(v.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = v.urllib.error.HTTPError(url, 403, secret, {}, None)
            with self.assertRaises(v.ObservationError) as caught:
                v.fetch("vehicle", secret, "20260828")
        self.assertEqual(str(caught.exception), "UPSTREAM_HTTP_403")

    def test_redirect_is_rejected_without_forwarding_secret(self):
        with self.assertRaises(v.ObservationError):
            v.NoRedirect().redirect_request(None, None, 302, None, {}, "https://example.invalid/")


if __name__ == "__main__":
    unittest.main()
