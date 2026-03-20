"""
Tests for the DART microservice.

Covers:
  - dart_client.py  — XML parsing helpers and fetch_dart_arrivals HTTP client
  - routes.py       — all API endpoints via FastAPI TestClient + in-memory SQLite
  - scheduler.py    — accuracy calculation algorithm and poll_dart_and_store
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db, DartSnapshot, DartAccuracy
from dart_client import parse_dart_xml, _tag, _get_text, fetch_dart_arrivals, DartAPIError
from routes import router
from scheduler import calculate_accuracy_from_snapshots, poll_dart_and_store

# ---------------------------------------------------------------------------
# Test database
# ---------------------------------------------------------------------------

_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


def _override_get_db():
    db = _TestingSession()
    try:
        yield db
    finally:
        db.close()


_app = FastAPI()
_app.include_router(router)
_app.dependency_overrides[get_db] = _override_get_db


@pytest.fixture(autouse=True)
def reset_db():
    Base.metadata.create_all(bind=_engine)
    yield
    Base.metadata.drop_all(bind=_engine)


@pytest.fixture()
def client():
    return TestClient(_app)


@pytest.fixture()
def db():
    session = _TestingSession()
    try:
        yield session
    finally:
        session.close()


# ---------------------------------------------------------------------------
# XML fixture data
# ---------------------------------------------------------------------------

_NS = "http://api.irishrail.ie/realtime/"

_SAMPLE_XML = f"""<?xml version="1.0" encoding="utf-8"?>
<ArrayOfObjStationData xmlns="{_NS}">
  <objStationData>
    <Traincode>E101</Traincode>
    <Origin>Greystones</Origin>
    <Destination>Malahide</Destination>
    <Direction>Northbound</Direction>
    <Duein>5</Duein>
    <Late>0</Late>
    <Exparrival>10:30</Exparrival>
    <Status>En Route</Status>
    <Lastlocation>Seapoint</Lastlocation>
    <Traintype>DART</Traintype>
  </objStationData>
  <objStationData>
    <Traincode>IC999</Traincode>
    <Origin>Heuston</Origin>
    <Destination>Cork</Destination>
    <Direction>Southbound</Direction>
    <Duein>20</Duein>
    <Late>5</Late>
    <Exparrival>10:50</Exparrival>
    <Status>En Route</Status>
    <Lastlocation>Kildare</Lastlocation>
    <Traintype>Intercity</Traintype>
  </objStationData>
</ArrayOfObjStationData>"""

_EMPTY_XML = f"""<?xml version="1.0" encoding="utf-8"?>
<ArrayOfObjStationData xmlns="{_NS}">
</ArrayOfObjStationData>"""

_MULTI_DART_XML = f"""<?xml version="1.0" encoding="utf-8"?>
<ArrayOfObjStationData xmlns="{_NS}">
  <objStationData>
    <Traincode>E101</Traincode><Origin>Greystones</Origin><Destination>Malahide</Destination>
    <Direction>Northbound</Direction><Duein>3</Duein><Late>0</Late>
    <Exparrival>10:03</Exparrival><Status>En Route</Status>
    <Lastlocation>X</Lastlocation><Traintype>DART</Traintype>
  </objStationData>
  <objStationData>
    <Traincode>E202</Traincode><Origin>Malahide</Origin><Destination>Greystones</Destination>
    <Direction>Southbound</Direction><Duein>12</Duein><Late>2</Late>
    <Exparrival>10:12</Exparrival><Status>En Route</Status>
    <Lastlocation>Y</Lastlocation><Traintype>DART</Traintype>
  </objStationData>
</ArrayOfObjStationData>"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _dart_snap(db, station_code="BROCK", train_code="E101",
               direction="Northbound", destination="Malahide",
               due_minutes=5, minutes_late=0, recorded_at=None):
    ts = recorded_at or datetime.utcnow()
    s = DartSnapshot(
        station_code=station_code,
        train_code=train_code,
        origin="Greystones",
        destination=destination,
        direction=direction,
        due_in_minutes=due_minutes,
        minutes_late=minutes_late,
        expected_arrival="10:00",
        status="En Route",
        last_location="Seapoint",
        recorded_at=ts,
    )
    db.add(s)
    db.commit()
    return s


def _dart_acc(db, station_code="BROCK", train_code="E101",
              direction="Northbound", destination="Malahide",
              forecasted=3, actual=3, delta=0, minutes_late=0,
              calculated_at=None):
    r = DartAccuracy(
        station_code=station_code,
        train_code=train_code,
        origin="Greystones",
        destination=destination,
        direction=direction,
        forecasted_minutes=forecasted,
        actual_minutes=actual,
        accuracy_delta=delta,
        minutes_late_reported=minutes_late,
        calculated_at=calculated_at or datetime.utcnow(),
    )
    db.add(r)
    db.commit()
    return r


# ===========================================================================
# PART 1: dart_client.py
# ===========================================================================

class TestTagHelper:
    def test_returns_namespaced_tag(self):
        result = _tag("Traincode")
        assert result == f"{{{_NS}}}Traincode"


class TestGetTextHelper:
    def test_returns_element_text(self):
        import xml.etree.ElementTree as ET
        xml = f'<root xmlns="{_NS}"><Traincode>E101</Traincode></root>'
        root = ET.fromstring(xml)
        assert _get_text(root, "Traincode") == "E101"

    def test_returns_default_when_missing(self):
        import xml.etree.ElementTree as ET
        xml = f'<root xmlns="{_NS}"></root>'
        root = ET.fromstring(xml)
        assert _get_text(root, "Traincode", "N/A") == "N/A"

    def test_strips_whitespace(self):
        import xml.etree.ElementTree as ET
        xml = f'<root xmlns="{_NS}"><Traincode>  E101  </Traincode></root>'
        root = ET.fromstring(xml)
        assert _get_text(root, "Traincode") == "E101"


class TestParseDartXml:
    def test_filters_out_non_dart_trains(self):
        result = parse_dart_xml(_SAMPLE_XML, "BROCK")
        assert len(result) == 1
        assert result[0]["train_code"] == "E101"

    def test_returns_all_dart_fields(self):
        result = parse_dart_xml(_SAMPLE_XML, "BROCK")
        a = result[0]
        assert a["train_code"] == "E101"
        assert a["origin"] == "Greystones"
        assert a["destination"] == "Malahide"
        assert a["direction"] == "Northbound"
        assert a["due_in_minutes"] == 5
        assert a["minutes_late"] == 0
        assert a["expected_arrival"] == "10:30"
        assert a["status"] == "En Route"
        assert a["last_location"] == "Seapoint"

    def test_empty_xml_returns_empty_list(self):
        assert parse_dart_xml(_EMPTY_XML, "BROCK") == []

    def test_multiple_dart_trains(self):
        result = parse_dart_xml(_MULTI_DART_XML, "BROCK")
        assert len(result) == 2

    def test_invalid_xml_raises_dart_api_error(self):
        with pytest.raises(DartAPIError):
            parse_dart_xml("<bad xml<<", "BROCK")

    def test_invalid_duein_defaults_to_zero(self):
        xml = f"""<?xml version="1.0" encoding="utf-8"?>
<ArrayOfObjStationData xmlns="{_NS}">
  <objStationData>
    <Traincode>E1</Traincode><Origin>G</Origin><Destination>M</Destination>
    <Direction>Northbound</Direction><Duein>NOTANUMBER</Duein><Late>0</Late>
    <Exparrival>10:00</Exparrival><Status>En Route</Status>
    <Lastlocation>X</Lastlocation><Traintype>DART</Traintype>
  </objStationData>
</ArrayOfObjStationData>"""
        result = parse_dart_xml(xml, "BROCK")
        assert result[0]["due_in_minutes"] == 0

    def test_minutes_late_parsed_correctly(self):
        result = parse_dart_xml(_MULTI_DART_XML, "BROCK")
        southbound = next(r for r in result if r["direction"] == "Southbound")
        assert southbound["minutes_late"] == 2

    def test_due_in_minutes_is_integer(self):
        result = parse_dart_xml(_SAMPLE_XML, "BROCK")
        assert isinstance(result[0]["due_in_minutes"], int)

    def test_case_insensitive_dart_filter(self):
        xml = f"""<?xml version="1.0" encoding="utf-8"?>
<ArrayOfObjStationData xmlns="{_NS}">
  <objStationData>
    <Traincode>E1</Traincode><Origin>G</Origin><Destination>M</Destination>
    <Direction>Northbound</Direction><Duein>5</Duein><Late>0</Late>
    <Exparrival>10:05</Exparrival><Status>En Route</Status>
    <Lastlocation>X</Lastlocation><Traintype>dart</Traintype>
  </objStationData>
</ArrayOfObjStationData>"""
        result = parse_dart_xml(xml, "BROCK")
        assert len(result) == 1


class TestFetchDartArrivals:
    async def test_success_returns_dart_arrivals(self):
        with patch("dart_client.httpx.AsyncClient") as mock_cls:
            mock_response = MagicMock()
            mock_response.text = _SAMPLE_XML
            mock_response.raise_for_status = MagicMock()
            mock_http = MagicMock()
            mock_http.get = AsyncMock(return_value=mock_response)
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=None)
            mock_cls.return_value = mock_http

            result = await fetch_dart_arrivals("BROCK")

        assert len(result) == 1
        assert result[0]["train_code"] == "E101"

    async def test_http_error_raises_dart_api_error(self):
        import httpx
        with patch("dart_client.httpx.AsyncClient") as mock_cls:
            mock_http = MagicMock()
            mock_http.get = AsyncMock(side_effect=httpx.HTTPError("timeout"))
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=None)
            mock_cls.return_value = mock_http

            with pytest.raises(DartAPIError):
                await fetch_dart_arrivals("BROCK")

    async def test_passes_station_code_in_params(self):
        with patch("dart_client.httpx.AsyncClient") as mock_cls:
            mock_response = MagicMock()
            mock_response.text = _EMPTY_XML
            mock_response.raise_for_status = MagicMock()
            mock_http = MagicMock()
            mock_http.get = AsyncMock(return_value=mock_response)
            mock_http.__aenter__ = AsyncMock(return_value=mock_http)
            mock_http.__aexit__ = AsyncMock(return_value=None)
            mock_cls.return_value = mock_http

            await fetch_dart_arrivals("CNLLY")

            call_kwargs = mock_http.get.call_args
            assert call_kwargs[1]["params"]["StationCode"] == "CNLLY"


# ===========================================================================
# PART 2: routes.py
# ===========================================================================

class TestHealth:
    def test_health_check(self, client):
        # Health is on the main app, not the router — just verify router doesn't 404
        r = client.get("/stations")   # proxy to check router is working
        assert r.status_code == 200


class TestGetStations:
    def test_returns_200(self, client):
        assert client.get("/stations").status_code == 200

    def test_has_south_city_north_zones(self, client):
        zones = client.get("/stations").json()["stations"]
        assert "south" in zones
        assert "city" in zones
        assert "north" in zones

    def test_stations_have_required_fields(self, client):
        data = client.get("/stations").json()["stations"]
        for zone_stations in data.values():
            for s in zone_stations:
                assert "code" in s
                assert "name" in s
                assert "zone" in s

    def test_brock_in_south_zone(self, client):
        south = client.get("/stations").json()["stations"]["south"]
        codes = [s["code"] for s in south]
        assert "BROCK" in codes

    def test_connolly_in_city_zone(self, client):
        city = client.get("/stations").json()["stations"]["city"]
        codes = [s["code"] for s in city]
        assert "CNLLY" in codes


class TestGetArrivals:
    def test_unknown_station_returns_400(self, client):
        r = client.get("/arrivals/ZZZZZ")
        assert r.status_code == 400
        assert "Unknown station" in r.json()["detail"]

    def test_empty_db_returns_empty_list(self, client):
        r = client.get("/arrivals/BROCK")
        assert r.status_code == 200
        body = r.json()
        assert body["next_arrivals"] == []
        assert body["station_code"] == "BROCK"
        assert body["total_dart_trains"] == 0

    def test_returns_most_recent_poll(self, client, db):
        old = datetime.utcnow() - timedelta(minutes=5)
        now = datetime.utcnow()
        _dart_snap(db, due_minutes=20, recorded_at=old)
        _dart_snap(db, due_minutes=3,  recorded_at=now)

        arrivals = client.get("/arrivals/BROCK").json()["next_arrivals"]
        assert len(arrivals) == 1
        assert arrivals[0]["due_in_minutes"] == 3

    def test_normalises_station_code_to_uppercase(self, client, db):
        _dart_snap(db, station_code="BROCK")
        body = client.get("/arrivals/brock").json()
        assert body["station_code"] == "BROCK"

    def test_respects_limit_param(self, client, db):
        now = datetime.utcnow()
        for mins in [2, 5, 10, 15]:
            _dart_snap(db, train_code=f"E{mins}", due_minutes=mins, recorded_at=now)

        arrivals = client.get("/arrivals/BROCK?limit=2").json()["next_arrivals"]
        assert len(arrivals) == 2

    def test_has_any_service_true_when_recent_data_exists(self, client, db):
        _dart_snap(db, recorded_at=datetime.utcnow())
        body = client.get("/arrivals/BROCK").json()
        assert body["has_any_service"] is True

    def test_has_any_service_false_when_data_stale(self, client, db):
        old = datetime.utcnow() - timedelta(minutes=10)
        _dart_snap(db, station_code="CNLLY", recorded_at=old)
        body = client.get("/arrivals/BROCK").json()
        assert body["has_any_service"] is False

    def test_arrival_response_contains_all_fields(self, client, db):
        _dart_snap(db)
        arrival = client.get("/arrivals/BROCK").json()["next_arrivals"][0]
        for field in ("train_code", "origin", "destination", "direction",
                      "due_in_minutes", "minutes_late", "expected_arrival",
                      "status", "last_location"):
            assert field in arrival

    def test_station_name_in_response(self, client):
        body = client.get("/arrivals/BROCK").json()
        assert body["station_name"] == "Blackrock"


class TestAccuracySummary:
    def test_no_data_returns_empty(self, client):
        r = client.get("/accuracy/summary?station_code=BROCK")
        assert r.status_code == 200
        body = r.json()
        assert body["data"] == []
        assert "message" in body

    def test_returns_grouped_rows(self, client, db):
        for _ in range(3):
            _dart_acc(db, destination="Malahide", direction="Northbound", delta=0)
        for _ in range(2):
            _dart_acc(db, destination="Greystones", direction="Southbound", delta=1)

        rows = client.get("/accuracy/summary?station_code=BROCK").json()["data"]
        dests = {r["destination"] for r in rows}
        assert "Malahide" in dests
        assert "Greystones" in dests

    def test_hours_filter_excludes_old_records(self, client, db):
        _dart_acc(db, calculated_at=datetime.utcnow() - timedelta(hours=48))
        rows = client.get("/accuracy/summary?station_code=BROCK&hours=24").json()["data"]
        assert rows == []

    def test_hours_filter_includes_recent_records(self, client, db):
        _dart_acc(db)
        rows = client.get("/accuracy/summary?station_code=BROCK&hours=24").json()["data"]
        assert len(rows) == 1

    def test_aggregation_fields_present(self, client, db):
        _dart_acc(db, delta=-1)
        _dart_acc(db, delta=0)
        _dart_acc(db, delta=1)

        row = client.get("/accuracy/summary?station_code=BROCK").json()["data"][0]
        assert row["measurements"] == 3
        assert row["best_case_minutes"] == -1
        assert row["worst_case_minutes"] == 1
        assert "avg_accuracy_minutes" in row
        assert "avg_late_reported" in row

    def test_station_code_uppercased(self, client, db):
        _dart_acc(db)
        # lowercase input should be uppercased and still match
        rows = client.get("/accuracy/summary?station_code=brock").json()["data"]
        assert len(rows) == 1


class TestDebugDataCollection:
    def test_no_data_is_unhealthy(self, client):
        body = client.get("/debug/data-collection").json()
        assert body["status"] == "no_data"
        assert body["healthy"] is False

    def test_recent_data_is_healthy(self, client, db):
        _dart_snap(db, recorded_at=datetime.utcnow())
        body = client.get("/debug/data-collection").json()
        assert body["healthy"] is True
        assert body["status"] == "healthy"

    def test_stale_data_is_unhealthy(self, client, db):
        _dart_snap(db, recorded_at=datetime.utcnow() - timedelta(minutes=10))
        body = client.get("/debug/data-collection").json()
        assert body["healthy"] is False
        assert body["status"] == "stale"

    def test_response_includes_seconds_ago(self, client, db):
        _dart_snap(db)
        body = client.get("/debug/data-collection").json()
        assert "seconds_ago" in body


# ===========================================================================
# PART 3: scheduler.py
# ===========================================================================

class TestDartAccuracyAlgorithm:
    """Tests for DART calculate_accuracy_from_snapshots()."""

    def _run(self):
        with patch("scheduler.SessionLocal", _TestingSession):
            calculate_accuracy_from_snapshots()

    def _count(self):
        db = _TestingSession()
        n = db.query(DartAccuracy).count()
        db.close()
        return n

    def _records(self):
        db = _TestingSession()
        recs = db.query(DartAccuracy).all()
        db.close()
        return recs

    def test_no_snapshots_records_nothing(self):
        self._run()
        assert self._count() == 0

    def test_1_to_0_transition_recorded(self):
        db = _TestingSession()
        now = datetime.utcnow()
        _dart_snap(db, due_minutes=1, recorded_at=now - timedelta(seconds=40))
        _dart_snap(db, due_minutes=0, recorded_at=now - timedelta(seconds=10))
        db.close()

        self._run()
        assert self._count() == 1

    def test_2_to_1_transition_recorded(self):
        db = _TestingSession()
        now = datetime.utcnow()
        _dart_snap(db, due_minutes=2, recorded_at=now - timedelta(seconds=40))
        _dart_snap(db, due_minutes=1, recorded_at=now - timedelta(seconds=10))
        db.close()

        self._run()
        assert self._count() == 1

    def test_3_to_2_transition_recorded(self):
        db = _TestingSession()
        now = datetime.utcnow()
        _dart_snap(db, due_minutes=3, recorded_at=now - timedelta(seconds=40))
        _dart_snap(db, due_minutes=2, recorded_at=now - timedelta(seconds=10))
        db.close()

        self._run()
        assert self._count() == 1

    def test_polls_more_than_3min_apart_skipped(self):
        db = _TestingSession()
        now = datetime.utcnow()
        # 4 minutes apart — exceeds the 3-minute DART threshold
        _dart_snap(db, due_minutes=1, recorded_at=now - timedelta(seconds=250))
        _dart_snap(db, due_minutes=0, recorded_at=now - timedelta(seconds=10))
        db.close()

        self._run()
        assert self._count() == 0

    def test_large_transition_not_recorded(self):
        db = _TestingSession()
        now = datetime.utcnow()
        _dart_snap(db, due_minutes=15, recorded_at=now - timedelta(seconds=40))
        _dart_snap(db, due_minutes=0,  recorded_at=now - timedelta(seconds=10))
        db.close()

        self._run()
        assert self._count() == 0

    def test_accuracy_delta_within_dart_bounds(self):
        db = _TestingSession()
        now = datetime.utcnow()
        _dart_snap(db, due_minutes=1, recorded_at=now - timedelta(seconds=40))
        _dart_snap(db, due_minutes=0, recorded_at=now - timedelta(seconds=10))
        db.close()

        self._run()
        recs = self._records()
        assert abs(recs[0].accuracy_delta) <= 3

    def test_accuracy_record_captures_minutes_late(self):
        db = _TestingSession()
        now = datetime.utcnow()
        _dart_snap(db, due_minutes=1, minutes_late=2, recorded_at=now - timedelta(seconds=40))
        _dart_snap(db, due_minutes=0, minutes_late=2, recorded_at=now - timedelta(seconds=10))
        db.close()

        self._run()
        recs = self._records()
        assert recs[0].minutes_late_reported == 2

    def test_snapshots_older_than_2_hours_excluded(self):
        db = _TestingSession()
        old = datetime.utcnow() - timedelta(hours=3)
        _dart_snap(db, due_minutes=1, recorded_at=old)
        _dart_snap(db, due_minutes=0, recorded_at=old + timedelta(seconds=40))
        db.close()

        self._run()
        assert self._count() == 0

    def test_different_train_codes_tracked_independently(self):
        db = _TestingSession()
        now = datetime.utcnow()
        for code in ("E101", "E202"):
            _dart_snap(db, train_code=code, due_minutes=1, recorded_at=now - timedelta(seconds=40))
            _dart_snap(db, train_code=code, due_minutes=0, recorded_at=now - timedelta(seconds=10))
        db.close()

        self._run()
        assert self._count() == 2


class TestPollDartAndStore:
    """Tests for poll_dart_and_store() in scheduler.py."""

    def _count(self):
        db = _TestingSession()
        n = db.query(DartSnapshot).count()
        db.close()
        return n

    def test_stores_arrivals_for_all_stations(self):
        mock_arrival = [{
            "train_code": "E101", "origin": "Greystones", "destination": "Malahide",
            "direction": "Northbound", "due_in_minutes": 5, "minutes_late": 0,
            "expected_arrival": "10:00", "status": "En Route", "last_location": "X",
        }]
        with patch("scheduler.SessionLocal", _TestingSession), \
             patch("scheduler.fetch_dart_arrivals", AsyncMock(return_value=mock_arrival)):
            poll_dart_and_store()

        # 20 stations × 1 arrival each = 20
        assert self._count() == 20

    def test_api_error_does_not_crash(self):
        with patch("scheduler.SessionLocal", _TestingSession), \
             patch("scheduler.fetch_dart_arrivals", AsyncMock(side_effect=DartAPIError("timeout"))):
            poll_dart_and_store()

        assert self._count() == 0

    def test_partial_failure_stores_successful_stations(self):
        call_count = 0

        async def side_effect(station_code):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise DartAPIError("first station fails")
            return [{
                "train_code": "E101", "origin": "Greystones", "destination": "Malahide",
                "direction": "Northbound", "due_in_minutes": 5, "minutes_late": 0,
                "expected_arrival": "10:00", "status": "En Route", "last_location": "X",
            }]

        with patch("scheduler.SessionLocal", _TestingSession), \
             patch("scheduler.fetch_dart_arrivals", side_effect=side_effect):
            poll_dart_and_store()

        # 19 out of 20 stations succeeded
        assert self._count() == 19

    def test_snapshot_fields_stored_correctly(self):
        mock_arrival = [{
            "train_code": "E202", "origin": "Malahide", "destination": "Greystones",
            "direction": "Southbound", "due_in_minutes": 8, "minutes_late": 1,
            "expected_arrival": "10:08", "status": "En Route", "last_location": "Howth Jct",
        }]
        with patch("scheduler.SessionLocal", _TestingSession), \
             patch("scheduler.fetch_dart_arrivals", AsyncMock(return_value=mock_arrival)):
            poll_dart_and_store()

        db = _TestingSession()
        snap = db.query(DartSnapshot).first()
        assert snap.train_code == "E202"
        assert snap.direction == "Southbound"
        assert snap.due_in_minutes == 8
        assert snap.minutes_late == 1
        db.close()
