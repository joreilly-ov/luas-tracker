"""
Integration tests for Luas backend API routes.
Uses FastAPI TestClient with an in-memory SQLite database — no real DB or scheduler needed.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db, LuasSnapshot, LuasAccuracy
from routes import router, _parse_irish_rail_xml

# ---------------------------------------------------------------------------
# Test database — in-memory SQLite with StaticPool so all sessions share the
# same connection (required for cross-session visibility in tests).
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


# Minimal FastAPI app — no scheduler / lifespan
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
# Helpers
# ---------------------------------------------------------------------------

def _snap(db, stop_code="cab", direction="Inbound", destination="Broombridge",
          due_minutes=5, recorded_at=None):
    ts = recorded_at or datetime.utcnow()
    s = LuasSnapshot(
        stop_code=stop_code,
        direction=direction,
        destination=destination,
        forecast_arrival_minutes=due_minutes,
        forecast_arrival_time=ts + timedelta(minutes=due_minutes),
        recorded_at=ts,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def _acc(db, stop_code="cab", direction="Inbound", destination="Broombridge",
         forecasted=3, actual=3, delta=0, calculated_at=None):
    r = LuasAccuracy(
        stop_code=stop_code,
        direction=direction,
        destination=destination,
        forecasted_minutes=forecasted,
        actual_minutes=actual,
        accuracy_delta=delta,
        calculated_at=calculated_at or datetime.utcnow(),
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


# ---------------------------------------------------------------------------
# GET /stops
# ---------------------------------------------------------------------------

class TestGetStops:
    def test_returns_200(self, client):
        assert client.get("/stops").status_code == 200

    def test_has_green_and_red_keys(self, client):
        data = client.get("/stops").json()
        assert "green" in data["stops"]
        assert "red" in data["stops"]

    def test_stop_entries_have_required_fields(self, client):
        data = client.get("/stops").json()
        for stop in data["stops"]["green"] + data["stops"]["red"]:
            assert "code" in stop
            assert "name" in stop
            assert "line" in stop

    def test_cabra_in_green_line(self, client):
        codes = [s["code"] for s in client.get("/stops").json()["stops"]["green"]]
        assert "cab" in codes

    def test_the_point_in_red_line(self, client):
        codes = [s["code"] for s in client.get("/stops").json()["stops"]["red"]]
        assert "tpt" in codes

    def test_all_stops_count(self, client):
        data = client.get("/stops").json()
        total = len(data["stops"]["green"]) + len(data["stops"]["red"])
        assert total == 67


# ---------------------------------------------------------------------------
# GET /arrivals/{stop_code}
# ---------------------------------------------------------------------------

class TestGetArrivals:
    def test_invalid_stop_returns_400(self, client):
        r = client.get("/arrivals/zzz")
        assert r.status_code == 400
        assert "Unknown stop code" in r.json()["detail"]

    def test_empty_db_returns_empty_list(self, client):
        r = client.get("/arrivals/cab")
        assert r.status_code == 200
        assert r.json()["next_arrivals"] == []
        assert r.json()["stop_code"] == "cab"

    def test_returns_most_recent_poll(self, client, db):
        old = datetime.utcnow() - timedelta(minutes=5)
        now = datetime.utcnow()
        _snap(db, due_minutes=20, recorded_at=old)
        _snap(db, due_minutes=3,  recorded_at=now)

        arrivals = client.get("/arrivals/cab").json()["next_arrivals"]
        assert len(arrivals) == 1
        assert arrivals[0]["due_minutes"] == 3

    def test_respects_limit_parameter(self, client, db):
        now = datetime.utcnow()
        for mins in [2, 5, 10, 15]:
            _snap(db, due_minutes=mins, recorded_at=now)

        assert len(client.get("/arrivals/cab?limit=2").json()["next_arrivals"]) == 2

    def test_arrivals_ordered_by_due_minutes(self, client, db):
        now = datetime.utcnow()
        _snap(db, due_minutes=10, recorded_at=now, destination="Far Away")
        _snap(db, due_minutes=2,  recorded_at=now, destination="Close")

        arrivals = client.get("/arrivals/cab").json()["next_arrivals"]
        assert arrivals[0]["due_minutes"] <= arrivals[1]["due_minutes"]

    def test_stop_code_normalised_to_lowercase(self, client, db):
        _snap(db, stop_code="cab")
        assert client.get("/arrivals/CAB").json()["stop_code"] == "cab"

    def test_arrival_has_all_required_fields(self, client, db):
        _snap(db)
        arrival = client.get("/arrivals/cab").json()["next_arrivals"][0]
        for key in ("destination", "direction", "due_minutes", "due_time"):
            assert key in arrival

    def test_multiple_stops_isolated(self, client, db):
        now = datetime.utcnow()
        _snap(db, stop_code="cab", due_minutes=5, recorded_at=now)
        _snap(db, stop_code="tal", due_minutes=7, recorded_at=now)

        cab = client.get("/arrivals/cab").json()["next_arrivals"]
        tal = client.get("/arrivals/tal").json()["next_arrivals"]
        assert len(cab) == 1
        assert len(tal) == 1
        assert cab[0]["due_minutes"] == 5
        assert tal[0]["due_minutes"] == 7


# ---------------------------------------------------------------------------
# GET /arrivals/cabra  (backwards-compat alias)
# ---------------------------------------------------------------------------

class TestCabraAlias:
    def test_returns_200_on_empty_db(self, client):
        r = client.get("/arrivals/cabra")
        assert r.status_code == 200
        assert r.json()["next_arrivals"] == []

    def test_returns_cab_data(self, client, db):
        _snap(db, stop_code="cab", due_minutes=4)
        data = client.get("/arrivals/cabra").json()
        assert data["stop_code"] == "cab"
        assert data["next_arrivals"][0]["due_minutes"] == 4


# ---------------------------------------------------------------------------
# GET /accuracy/summary
# ---------------------------------------------------------------------------

class TestAccuracySummary:
    def test_no_data_returns_empty_data_list(self, client):
        r = client.get("/accuracy/summary?stop_code=cab")
        assert r.status_code == 200
        body = r.json()
        assert body["stop_code"] == "cab"
        assert body["data"] == []
        assert "message" in body

    def test_returns_grouped_rows(self, client, db):
        for _ in range(3):
            _acc(db, destination="Broombridge", direction="Inbound",  delta=0)
        for _ in range(2):
            _acc(db, destination="Sandyford",   direction="Outbound", delta=1)

        rows = client.get("/accuracy/summary?stop_code=cab").json()["data"]
        dests = {r["destination"] for r in rows}
        assert "Broombridge" in dests
        assert "Sandyford" in dests

    def test_hours_filter_excludes_old_records(self, client, db):
        _acc(db, calculated_at=datetime.utcnow() - timedelta(hours=48))
        rows = client.get("/accuracy/summary?stop_code=cab&hours=24").json()["data"]
        assert rows == []

    def test_hours_filter_includes_recent_records(self, client, db):
        _acc(db, calculated_at=datetime.utcnow())
        rows = client.get("/accuracy/summary?stop_code=cab&hours=24").json()["data"]
        assert len(rows) == 1

    def test_isolated_by_stop_code(self, client, db):
        _acc(db, stop_code="tal")
        rows = client.get("/accuracy/summary?stop_code=cab").json()["data"]
        assert rows == []

    def test_aggregation_values(self, client, db):
        _acc(db, delta=-1)
        _acc(db, delta=0)
        _acc(db, delta=1)

        row = client.get("/accuracy/summary?stop_code=cab").json()["data"][0]
        assert row["measurements"] == 3
        assert row["best_case_minutes"] == -1
        assert row["worst_case_minutes"] == 1
        assert row["avg_accuracy_minutes"] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# POST /accuracy/calculate
# ---------------------------------------------------------------------------

class TestCalculateAccuracy:
    def test_no_snapshots_returns_zero(self, client):
        r = client.post("/accuracy/calculate")
        assert r.status_code == 200
        assert r.json()["calculated"] == 0

    def test_detects_1_to_0_transition(self, client, db):
        now = datetime.utcnow()
        t1 = now - timedelta(seconds=35)
        t2 = now
        arrival = now + timedelta(minutes=1)

        db.add(LuasSnapshot(
            stop_code="cab", direction="Inbound", destination="Broombridge",
            forecast_arrival_minutes=1, forecast_arrival_time=arrival, recorded_at=t1,
        ))
        db.add(LuasSnapshot(
            stop_code="cab", direction="Inbound", destination="Broombridge",
            forecast_arrival_minutes=0, forecast_arrival_time=arrival, recorded_at=t2,
        ))
        db.commit()

        r = client.post("/accuracy/calculate")
        assert r.status_code == 200
        assert r.json()["calculated"] >= 1

    def test_returns_message_and_calculated_fields(self, client):
        r = client.post("/accuracy/calculate")
        body = r.json()
        assert "message" in body
        assert "calculated" in body


# ---------------------------------------------------------------------------
# GET /debug/accuracy/count
# ---------------------------------------------------------------------------

class TestDebugAccuracyCount:
    def test_empty_db_shows_zero(self, client):
        data = client.get("/debug/accuracy/count").json()
        assert data["luas_accuracy_table"]["total_records"] == 0
        assert data["luas_snapshots_table"]["total_records"] == 0

    def test_counts_reflect_inserted_records(self, client, db):
        _acc(db)
        _snap(db)
        data = client.get("/debug/accuracy/count").json()
        assert data["luas_accuracy_table"]["total_records"] == 1
        assert data["luas_snapshots_table"]["total_records"] == 1


# ---------------------------------------------------------------------------
# GET /debug/accuracy/stops-summary
# ---------------------------------------------------------------------------

class TestDebugAccuracyStopsSummary:
    def test_returns_all_three_buckets(self, client):
        data = client.get("/debug/accuracy/stops-summary").json()
        assert "green_line" in data
        assert "red_line" in data
        assert "other" in data

    def test_green_stop_in_green_bucket(self, client, db):
        _acc(db, stop_code="cab")
        data = client.get("/debug/accuracy/stops-summary").json()
        assert "cab" in data["green_line"]

    def test_red_stop_in_red_bucket(self, client, db):
        _acc(db, stop_code="tal")
        data = client.get("/debug/accuracy/stops-summary").json()
        assert "tal" in data["red_line"]


# ---------------------------------------------------------------------------
# GET /debug/snapshots/transitions
# ---------------------------------------------------------------------------

class TestDebugSnapshotTransitions:
    def test_returns_expected_structure(self, client):
        r = client.get("/debug/snapshots/transitions?stop_code=cab&minutes=30")
        assert r.status_code == 200
        body = r.json()
        assert "stop_code" in body
        assert "total_snapshots" in body
        assert "routes" in body
        assert "unique_routes" in body

    def test_counts_snapshots_correctly(self, client, db):
        now = datetime.utcnow()
        _snap(db, due_minutes=10, recorded_at=now - timedelta(minutes=5))
        _snap(db, due_minutes=5,  recorded_at=now)

        data = client.get("/debug/snapshots/transitions?stop_code=cab&minutes=30").json()
        assert data["total_snapshots"] == 2

    def test_respects_minutes_param(self, client, db):
        old = datetime.utcnow() - timedelta(hours=2)
        _snap(db, recorded_at=old)

        data = client.get("/debug/snapshots/transitions?stop_code=cab&minutes=30").json()
        assert data["total_snapshots"] == 0


# ---------------------------------------------------------------------------
# GET /debug/data-collection
# ---------------------------------------------------------------------------

class TestDebugDataCollection:
    def test_no_data_is_unhealthy(self, client):
        r = client.get("/debug/data-collection")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "no_data"
        assert body["healthy"] is False

    def test_recent_snapshot_is_healthy(self, client, db):
        _snap(db, recorded_at=datetime.utcnow())
        body = client.get("/debug/data-collection").json()
        assert body["healthy"] is True
        assert body["status"] == "healthy"

    def test_old_snapshot_is_stale(self, client, db):
        _snap(db, recorded_at=datetime.utcnow() - timedelta(minutes=10))
        body = client.get("/debug/data-collection").json()
        assert body["healthy"] is False
        assert body["status"] == "stale"

    def test_response_includes_seconds_ago(self, client, db):
        _snap(db)
        body = client.get("/debug/data-collection").json()
        assert "seconds_ago" in body
        assert isinstance(body["seconds_ago"], int)


# ---------------------------------------------------------------------------
# GET /debug/database
# ---------------------------------------------------------------------------

class TestDebugDatabase:
    def test_empty_db_is_degraded(self, client):
        body = client.get("/debug/database").json()
        assert body["healthy"] is False
        assert body["status"] == "degraded"

    def test_with_recent_data_is_healthy(self, client, db):
        _snap(db, recorded_at=datetime.utcnow())
        body = client.get("/debug/database").json()
        assert body["healthy"] is True
        assert body["connection"] == "ok"

    def test_returns_counts(self, client, db):
        _snap(db)
        _acc(db)
        body = client.get("/debug/database").json()
        assert body["total_snapshots"] >= 1
        assert body["total_accuracy_records"] >= 1


# ---------------------------------------------------------------------------
# GET /metrics/accuracy
# ---------------------------------------------------------------------------

class TestMetricsAccuracy:
    def test_no_data_returns_null_overall(self, client):
        r = client.get("/metrics/accuracy?stop_code=cab&hours=24")
        assert r.status_code == 200
        body = r.json()
        assert body["overall"] is None
        assert body["by_destination"] == []
        assert body["trend"] == []

    def test_returns_correct_measurement_count(self, client, db):
        for delta in [-1, 0, 1]:
            _acc(db, delta=delta)

        body = client.get("/metrics/accuracy?stop_code=cab&hours=24").json()
        assert body["total_measurements"] == 3

    def test_overall_percentages_sum_to_100(self, client, db):
        for delta in [-1, 0, 1]:
            _acc(db, delta=delta)

        overall = client.get("/metrics/accuracy?stop_code=cab&hours=24").json()["overall"]
        total = overall["on_time_pct"] + overall["early_pct"] + overall["late_pct"]
        assert total == pytest.approx(100.0, abs=0.2)

    def test_on_time_interpretation(self, client, db):
        for _ in range(3):
            _acc(db, delta=0)
        interp = client.get("/metrics/accuracy?stop_code=cab&hours=24").json()["overall"]["interpretation"]
        assert "On time" in interp

    def test_late_interpretation(self, client, db):
        for _ in range(3):
            _acc(db, delta=2)
        interp = client.get("/metrics/accuracy?stop_code=cab&hours=24").json()["overall"]["interpretation"]
        assert "late" in interp.lower()

    def test_by_destination_sorted_by_measurements(self, client, db):
        for _ in range(5):
            _acc(db, destination="Broombridge")
        for _ in range(2):
            _acc(db, destination="Sandyford")

        by_dest = client.get("/metrics/accuracy?stop_code=cab&hours=24").json()["by_destination"]
        assert by_dest[0]["destination"] == "Broombridge"
        assert by_dest[0]["measurements"] == 5

    def test_hours_param_filters_old_data(self, client, db):
        _acc(db, calculated_at=datetime.utcnow() - timedelta(hours=48))
        body = client.get("/metrics/accuracy?stop_code=cab&hours=24").json()
        assert body["overall"] is None


# ---------------------------------------------------------------------------
# GET /dart/stations
# ---------------------------------------------------------------------------

class TestDartStations:
    def test_returns_200(self, client):
        assert client.get("/dart/stations").status_code == 200

    def test_returns_list_of_stations(self, client):
        stations = client.get("/dart/stations").json()["stations"]
        assert isinstance(stations, list)
        assert len(stations) > 0

    def test_stations_have_code_and_name(self, client):
        for s in client.get("/dart/stations").json()["stations"]:
            assert "code" in s
            assert "name" in s

    def test_brock_present(self, client):
        codes = [s["code"] for s in client.get("/dart/stations").json()["stations"]]
        assert "BROCK" in codes


# ---------------------------------------------------------------------------
# GET /dart/arrivals/{station_code}
# ---------------------------------------------------------------------------

_SAMPLE_IR_XML = """<?xml version="1.0" encoding="utf-8"?>
<ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/">
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
    <Traincode>D202</Traincode>
    <Origin>Heuston</Origin>
    <Destination>Cork</Destination>
    <Direction>Southbound</Direction>
    <Duein>12</Duein>
    <Late>3</Late>
    <Exparrival>10:42</Exparrival>
    <Status>En Route</Status>
    <Lastlocation>Kildare</Lastlocation>
    <Traintype>Intercity</Traintype>
  </objStationData>
</ArrayOfObjStationData>"""

_EMPTY_IR_XML = """<?xml version="1.0" encoding="utf-8"?>
<ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/">
</ArrayOfObjStationData>"""


def _mock_ir_client(xml_text):
    """Return a context-manager mock that yields a client whose .get() returns xml_text."""
    mock_response = MagicMock()
    mock_response.text = xml_text
    mock_response.raise_for_status = MagicMock()

    mock_http = MagicMock()
    mock_http.get = AsyncMock(return_value=mock_response)
    mock_http.__aenter__ = AsyncMock(return_value=mock_http)
    mock_http.__aexit__ = AsyncMock(return_value=None)
    return mock_http


class TestDartArrivalsProxy:
    def test_unknown_station_returns_400(self, client):
        assert client.get("/dart/arrivals/ZZZZZ").status_code == 400

    @patch("routes.httpx.AsyncClient")
    def test_filters_out_non_dart_trains(self, mock_cls, client):
        mock_cls.return_value = _mock_ir_client(_SAMPLE_IR_XML)
        data = client.get("/dart/arrivals/BROCK").json()
        assert data["total_dart_trains"] == 1
        assert data["next_arrivals"][0]["train_code"] == "E101"

    @patch("routes.httpx.AsyncClient")
    def test_has_any_service_true_when_trains_present(self, mock_cls, client):
        mock_cls.return_value = _mock_ir_client(_SAMPLE_IR_XML)
        assert client.get("/dart/arrivals/BROCK").json()["has_any_service"] is True

    @patch("routes.httpx.AsyncClient")
    def test_has_any_service_false_on_empty_response(self, mock_cls, client):
        # Both the primary station and the CNLLY fallback return empty XML
        mock_cls.return_value = _mock_ir_client(_EMPTY_IR_XML)
        assert client.get("/dart/arrivals/BROCK").json()["has_any_service"] is False

    @patch("routes.httpx.AsyncClient")
    def test_has_any_service_true_when_fallback_station_has_trains(self, mock_cls, client):
        # Primary station (BROCK) empty → triggers fallback check against CNLLY
        # CNLLY has trains → has_any_service elevated to True
        mock_cls.side_effect = [
            _mock_ir_client(_EMPTY_IR_XML),   # BROCK call: no trains
            _mock_ir_client(_SAMPLE_IR_XML),  # CNLLY fallback: has trains
        ]
        data = client.get("/dart/arrivals/BROCK").json()
        assert data["has_any_service"] is True
        assert data["total_dart_trains"] == 0   # BROCK still shows no trains

    @patch("routes.httpx.AsyncClient")
    def test_arrivals_sorted_by_due_in_minutes(self, mock_cls, client):
        xml = """<?xml version="1.0" encoding="utf-8"?>
<ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/">
  <objStationData>
    <Traincode>E2</Traincode><Origin>G</Origin><Destination>M</Destination>
    <Direction>Northbound</Direction><Duein>15</Duein><Late>0</Late>
    <Exparrival>10:15</Exparrival><Status>En Route</Status>
    <Lastlocation>X</Lastlocation><Traintype>DART</Traintype>
  </objStationData>
  <objStationData>
    <Traincode>E1</Traincode><Origin>G</Origin><Destination>M</Destination>
    <Direction>Northbound</Direction><Duein>3</Duein><Late>0</Late>
    <Exparrival>10:03</Exparrival><Status>En Route</Status>
    <Lastlocation>Y</Lastlocation><Traintype>DART</Traintype>
  </objStationData>
</ArrayOfObjStationData>"""
        mock_cls.return_value = _mock_ir_client(xml)
        arrivals = client.get("/dart/arrivals/BROCK").json()["next_arrivals"]
        assert arrivals[0]["due_in_minutes"] <= arrivals[1]["due_in_minutes"]

    @patch("routes.httpx.AsyncClient")
    def test_respects_limit_param(self, mock_cls, client):
        xml = """<?xml version="1.0" encoding="utf-8"?>
<ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/">
  <objStationData>
    <Traincode>E1</Traincode><Origin>G</Origin><Destination>M</Destination>
    <Direction>Northbound</Direction><Duein>2</Duein><Late>0</Late>
    <Exparrival>10:02</Exparrival><Status>En Route</Status>
    <Lastlocation>X</Lastlocation><Traintype>DART</Traintype>
  </objStationData>
  <objStationData>
    <Traincode>E2</Traincode><Origin>G</Origin><Destination>M</Destination>
    <Direction>Northbound</Direction><Duein>15</Duein><Late>0</Late>
    <Exparrival>10:15</Exparrival><Status>En Route</Status>
    <Lastlocation>X</Lastlocation><Traintype>DART</Traintype>
  </objStationData>
  <objStationData>
    <Traincode>E3</Traincode><Origin>G</Origin><Destination>M</Destination>
    <Direction>Northbound</Direction><Duein>30</Duein><Late>0</Late>
    <Exparrival>10:30</Exparrival><Status>En Route</Status>
    <Lastlocation>X</Lastlocation><Traintype>DART</Traintype>
  </objStationData>
</ArrayOfObjStationData>"""
        mock_cls.return_value = _mock_ir_client(xml)
        arrivals = client.get("/dart/arrivals/BROCK?limit=2").json()["next_arrivals"]
        assert len(arrivals) == 2

    @patch("routes.httpx.AsyncClient")
    def test_irish_rail_http_error_returns_502(self, mock_cls, client):
        import httpx
        mock_http = MagicMock()
        mock_http.get = AsyncMock(side_effect=httpx.HTTPError("timeout"))
        mock_http.__aenter__ = AsyncMock(return_value=mock_http)
        mock_http.__aexit__ = AsyncMock(return_value=None)
        mock_cls.return_value = mock_http
        assert client.get("/dart/arrivals/BROCK").status_code == 502

    @patch("routes.httpx.AsyncClient")
    def test_response_contains_station_name(self, mock_cls, client):
        mock_cls.return_value = _mock_ir_client(_EMPTY_IR_XML)
        data = client.get("/dart/arrivals/BROCK").json()
        assert data["station_name"] == "Blackrock"


# ---------------------------------------------------------------------------
# _parse_irish_rail_xml (unit tests — no HTTP involved)
# ---------------------------------------------------------------------------

class TestParseIrishRailXml:
    def test_filters_out_non_dart_trains(self):
        arrivals, _ = _parse_irish_rail_xml(_SAMPLE_IR_XML, "BROCK")
        assert len(arrivals) == 1
        assert arrivals[0]["train_code"] == "E101"

    def test_has_any_service_true_when_any_train_present(self):
        _, has_service = _parse_irish_rail_xml(_SAMPLE_IR_XML, "BROCK")
        assert has_service is True

    def test_has_any_service_false_on_empty_xml(self):
        _, has_service = _parse_irish_rail_xml(_EMPTY_IR_XML, "BROCK")
        assert has_service is False

    def test_invalid_xml_raises_502_http_exception(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            _parse_irish_rail_xml("<bad xml<<", "BROCK")
        assert exc.value.status_code == 502

    def test_all_arrival_fields_populated(self):
        arrivals, _ = _parse_irish_rail_xml(_SAMPLE_IR_XML, "BROCK")
        a = arrivals[0]
        assert a["train_code"] == "E101"
        assert a["origin"] == "Greystones"
        assert a["destination"] == "Malahide"
        assert a["direction"] == "Northbound"
        assert a["due_in_minutes"] == 5
        assert a["minutes_late"] == 0
        assert a["expected_arrival"] == "10:30"
        assert a["status"] == "En Route"
        assert a["last_location"] == "Seapoint"

    def test_intercity_train_counted_in_has_any_service(self):
        # The Intercity train should still count for has_any_service even though it's filtered
        _, has_service = _parse_irish_rail_xml(_SAMPLE_IR_XML, "BROCK")
        # 2 total trains → has_any_service is True
        assert has_service is True

    def test_multiple_dart_trains_all_included(self):
        xml = """<?xml version="1.0" encoding="utf-8"?>
<ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/">
  <objStationData>
    <Traincode>E1</Traincode><Origin>G</Origin><Destination>M</Destination>
    <Direction>Northbound</Direction><Duein>3</Duein><Late>0</Late>
    <Exparrival>10:03</Exparrival><Status>En Route</Status>
    <Lastlocation>X</Lastlocation><Traintype>DART</Traintype>
  </objStationData>
  <objStationData>
    <Traincode>E2</Traincode><Origin>M</Origin><Destination>G</Destination>
    <Direction>Southbound</Direction><Duein>10</Duein><Late>2</Late>
    <Exparrival>10:10</Exparrival><Status>En Route</Status>
    <Lastlocation>Y</Lastlocation><Traintype>DART</Traintype>
  </objStationData>
</ArrayOfObjStationData>"""
        arrivals, _ = _parse_irish_rail_xml(xml, "BROCK")
        assert len(arrivals) == 2
        assert arrivals[1]["minutes_late"] == 2
