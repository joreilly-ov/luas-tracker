"""
Integration tests for API routes and scheduler logic.

Uses a SQLite in-memory database so no real DB connection is needed.
The FastAPI app's get_db dependency is overridden to use the test DB.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock, AsyncMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# ---------------------------------------------------------------------------
# Test database setup
# Use StaticPool so all connections (test setup + app) share the same
# in-memory SQLite instance.
# ---------------------------------------------------------------------------

TEST_DATABASE_URL = "sqlite:///:memory:"

test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# App fixture — import after engine is ready so models can be created
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def client():
    from database import Base, get_db
    import main as app_module

    Base.metadata.create_all(bind=test_engine)
    app_module.app.dependency_overrides[get_db] = override_get_db
    with TestClient(app_module.app) as c:
        yield c
    app_module.app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture(autouse=True)
def clean_tables():
    """Wipe rows between tests so each test starts with a fresh state."""
    from database import Base
    db = TestSessionLocal()
    for table in reversed(Base.metadata.sorted_tables):
        db.execute(table.delete())
    db.commit()
    db.close()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _make_snapshot(db, stop_code="cab", direction="Inbound", destination="Broombridge",
                   forecast_minutes=5, recorded_at=None):
    from database import LuasSnapshot
    if recorded_at is None:
        recorded_at = datetime.utcnow()
    snap = LuasSnapshot(
        stop_code=stop_code,
        direction=direction,
        destination=destination,
        forecast_arrival_minutes=forecast_minutes,
        forecast_arrival_time=recorded_at + timedelta(minutes=forecast_minutes),
        recorded_at=recorded_at,
    )
    db.add(snap)
    db.commit()
    db.refresh(snap)
    return snap


# ===========================================================================
# /health
# ===========================================================================

class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


# ===========================================================================
# /stops
# ===========================================================================

class TestStopsEndpoint:
    def test_stops_returns_both_lines(self, client):
        resp = client.get("/stops")
        assert resp.status_code == 200
        data = resp.json()
        assert "stops" in data
        assert "green" in data["stops"]
        assert "red" in data["stops"]

    def test_stops_each_item_has_required_fields(self, client):
        resp = client.get("/stops")
        for stop in resp.json()["stops"]["green"]:
            assert "code" in stop
            assert "name" in stop
            assert "line" in stop

    def test_green_line_contains_cabra(self, client):
        resp = client.get("/stops")
        codes = [s["code"] for s in resp.json()["stops"]["green"]]
        assert "cab" in codes


# ===========================================================================
# /arrivals/{stop_code}
# ===========================================================================

class TestArrivalsEndpoint:
    def test_unknown_stop_returns_400(self, client):
        resp = client.get("/arrivals/XXXBAD")
        assert resp.status_code == 400

    def test_valid_stop_no_data_returns_empty_list(self, client):
        resp = client.get("/arrivals/cab")
        assert resp.status_code == 200
        data = resp.json()
        assert data["stop_code"] == "cab"
        assert data["next_arrivals"] == []

    def test_valid_stop_returns_snapshots(self, client):
        db = TestSessionLocal()
        _make_snapshot(db, stop_code="cab", destination="Broombridge", forecast_minutes=5)
        _make_snapshot(db, stop_code="cab", destination="Sandyford", forecast_minutes=10)
        db.close()

        resp = client.get("/arrivals/cab?limit=5")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["next_arrivals"]) == 2

    def test_limit_parameter_is_respected(self, client):
        db = TestSessionLocal()
        for i in range(5):
            _make_snapshot(db, stop_code="cab", destination=f"Dest{i}", forecast_minutes=i + 1)
        db.close()

        resp = client.get("/arrivals/cab?limit=2")
        assert resp.status_code == 200
        assert len(resp.json()["next_arrivals"]) == 2

    def test_stop_code_is_case_insensitive(self, client):
        resp = client.get("/arrivals/CAB")
        assert resp.status_code == 200
        assert resp.json()["stop_code"] == "cab"

    def test_arrivals_sorted_by_due_minutes(self, client):
        db = TestSessionLocal()
        now = datetime.utcnow()
        _make_snapshot(db, stop_code="cab", destination="Far", forecast_minutes=10, recorded_at=now)
        _make_snapshot(db, stop_code="cab", destination="Near", forecast_minutes=2, recorded_at=now)
        db.close()

        resp = client.get("/arrivals/cab?limit=5")
        arrivals = resp.json()["next_arrivals"]
        assert arrivals[0]["due_minutes"] <= arrivals[1]["due_minutes"]

    def test_response_schema_shape(self, client):
        db = TestSessionLocal()
        _make_snapshot(db, stop_code="cab")
        db.close()

        resp = client.get("/arrivals/cab")
        assert resp.status_code == 200
        data = resp.json()
        assert "stop_code" in data
        assert "last_updated" in data
        assert "next_arrivals" in data
        arrival = data["next_arrivals"][0]
        assert "destination" in arrival
        assert "direction" in arrival
        assert "due_minutes" in arrival
        assert "due_time" in arrival


# ===========================================================================
# /accuracy/summary
# ===========================================================================

class TestAccuracySummaryEndpoint:
    def test_no_data_returns_empty_data_list(self, client):
        resp = client.get("/accuracy/summary?stop_code=cab")
        assert resp.status_code == 200
        data = resp.json()
        assert data["data"] == []

    def test_with_accuracy_records(self, client):
        from database import LuasAccuracy
        db = TestSessionLocal()
        for delta in [-1, 0, 1]:
            db.add(LuasAccuracy(
                stop_code="cab",
                direction="Inbound",
                destination="Broombridge",
                forecasted_minutes=2,
                actual_minutes=2 + delta,
                accuracy_delta=delta,
                calculated_at=datetime.utcnow(),
            ))
        db.commit()
        db.close()

        resp = client.get("/accuracy/summary?stop_code=cab")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["data"]) == 1
        row = data["data"][0]
        assert row["measurements"] == 3
        assert row["destination"] == "Broombridge"

    def test_hours_filter_excludes_old_records(self, client):
        from database import LuasAccuracy
        db = TestSessionLocal()
        db.add(LuasAccuracy(
            stop_code="cab",
            direction="Inbound",
            destination="Broombridge",
            forecasted_minutes=2,
            actual_minutes=2,
            accuracy_delta=0,
            calculated_at=datetime.utcnow() - timedelta(hours=48),
        ))
        db.commit()
        db.close()

        resp = client.get("/accuracy/summary?stop_code=cab&hours=24")
        assert resp.status_code == 200
        assert resp.json()["data"] == []

    def test_unknown_stop_returns_empty_not_error(self, client):
        resp = client.get("/accuracy/summary?stop_code=zzz")
        assert resp.status_code == 200
        assert resp.json()["data"] == []


# ===========================================================================
# /dart/stations
# ===========================================================================

class TestDartStationsEndpoint:
    def test_returns_station_list(self, client):
        resp = client.get("/dart/stations")
        assert resp.status_code == 200
        data = resp.json()
        assert "stations" in data
        assert len(data["stations"]) > 0

    def test_connolly_is_present(self, client):
        resp = client.get("/dart/stations")
        codes = [s["code"] for s in resp.json()["stations"]]
        assert "CNLLY" in codes


# ===========================================================================
# /dart/arrivals/{station_code}
# ===========================================================================

class TestDartArrivalsEndpoint:
    def test_unknown_station_returns_400(self, client):
        resp = client.get("/dart/arrivals/XXXBAD")
        assert resp.status_code == 400

    def test_valid_station_proxies_irish_rail(self, client):
        xml = """<?xml version="1.0"?>
        <ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/">
          <objStationData>
            <Traincode>E123</Traincode>
            <Origin>Greystones</Origin>
            <Destination>Malahide</Destination>
            <Direction>Northbound</Direction>
            <Duein>5</Duein>
            <Late>0</Late>
            <Exparrival>12:05</Exparrival>
            <Status>En Route</Status>
            <Lastlocation>Seapoint</Lastlocation>
            <Traintype>DART</Traintype>
          </objStationData>
        </ArrayOfObjStationData>"""

        mock_response = MagicMock()
        mock_response.text = xml
        mock_response.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("routes.httpx.AsyncClient", return_value=mock_client):
            resp = client.get("/dart/arrivals/BROCK")

        assert resp.status_code == 200
        data = resp.json()
        assert data["station_code"] == "BROCK"
        assert len(data["next_arrivals"]) == 1
        assert data["next_arrivals"][0]["train_code"] == "E123"

    def test_non_dart_trains_are_filtered_out(self, client):
        xml = """<?xml version="1.0"?>
        <ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/">
          <objStationData>
            <Traincode>IC99</Traincode>
            <Origin>Cork</Origin>
            <Destination>Dublin Heuston</Destination>
            <Direction>Northbound</Direction>
            <Duein>10</Duein>
            <Late>0</Late>
            <Exparrival>12:10</Exparrival>
            <Status>En Route</Status>
            <Lastlocation>Kildare</Lastlocation>
            <Traintype>Intercity</Traintype>
          </objStationData>
        </ArrayOfObjStationData>"""

        mock_response = MagicMock()
        mock_response.text = xml
        mock_response.raise_for_status = MagicMock()
        mock_client = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("routes.httpx.AsyncClient", return_value=mock_client):
            resp = client.get("/dart/arrivals/BROCK")

        assert resp.status_code == 200
        assert resp.json()["next_arrivals"] == []

    def test_station_code_uppercased(self, client):
        xml = "<ArrayOfObjStationData xmlns=\"http://api.irishrail.ie/realtime/\"></ArrayOfObjStationData>"
        mock_response = MagicMock()
        mock_response.text = xml
        mock_response.raise_for_status = MagicMock()
        mock_client = MagicMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        with patch("routes.httpx.AsyncClient", return_value=mock_client):
            resp = client.get("/dart/arrivals/brock")

        assert resp.status_code == 200
        assert resp.json()["station_code"] == "BROCK"


# ===========================================================================
# Scheduler: calculate_accuracy_from_snapshots
# ===========================================================================

class TestCalculateAccuracyFromSnapshots:
    """Unit tests for the accuracy calculation logic in scheduler.py."""

    def _run_accuracy(self):
        """Helper: call the function with the test DB session."""
        from database import LuasAccuracy
        import scheduler

        with patch("scheduler.SessionLocal", TestSessionLocal):
            scheduler.calculate_accuracy_from_snapshots()

        db = TestSessionLocal()
        records = db.query(LuasAccuracy).all()
        db.close()
        return records

    def test_no_snapshots_produces_no_accuracy_records(self):
        records = self._run_accuracy()
        assert records == []

    def test_1_to_0_transition_creates_accuracy_record(self):
        db = TestSessionLocal()
        now = datetime.utcnow()
        # Two polls 30s apart: forecast goes 1 → 0 (imminent arrival)
        _make_snapshot(db, stop_code="cab", destination="Broombridge",
                       direction="Inbound", forecast_minutes=1,
                       recorded_at=now - timedelta(seconds=30))
        _make_snapshot(db, stop_code="cab", destination="Broombridge",
                       direction="Inbound", forecast_minutes=0,
                       recorded_at=now)
        db.close()

        records = self._run_accuracy()
        assert len(records) == 1
        assert records[0].stop_code == "cab"
        assert records[0].forecasted_minutes == 1

    def test_2_to_1_transition_creates_accuracy_record(self):
        db = TestSessionLocal()
        now = datetime.utcnow()
        _make_snapshot(db, stop_code="cab", destination="Broombridge",
                       direction="Inbound", forecast_minutes=2,
                       recorded_at=now - timedelta(seconds=30))
        _make_snapshot(db, stop_code="cab", destination="Broombridge",
                       direction="Inbound", forecast_minutes=1,
                       recorded_at=now)
        db.close()

        records = self._run_accuracy()
        assert len(records) == 1
        assert records[0].forecasted_minutes == 2

    def test_3_to_2_transition_creates_accuracy_record(self):
        # The scheduler filters out records with |accuracy_delta| > 2.
        # For a 3→2 transition the delta = round(time_between/2 - 3).
        # A 2-minute poll gap gives delta = round(1 - 3) = -2, which just
        # passes the filter.  Pin forecast_arrival_time so both polls share
        # the same 5-minute bucket regardless of when the test runs.
        from database import LuasSnapshot
        now = datetime.utcnow()
        shared_arrival = now + timedelta(minutes=10)

        db = TestSessionLocal()
        for minutes_ago, fcast in [(2, 3), (0, 2)]:
            snap = LuasSnapshot(
                stop_code="cab",
                direction="Inbound",
                destination="Broombridge",
                forecast_arrival_minutes=fcast,
                forecast_arrival_time=shared_arrival,
                recorded_at=now - timedelta(minutes=minutes_ago),
            )
            db.add(snap)
        db.commit()
        db.close()

        records = self._run_accuracy()
        assert len(records) == 1
        assert records[0].forecasted_minutes == 3

    def test_polls_more_than_2min_apart_are_skipped(self):
        db = TestSessionLocal()
        now = datetime.utcnow()
        _make_snapshot(db, stop_code="cab", destination="Broombridge",
                       direction="Inbound", forecast_minutes=1,
                       recorded_at=now - timedelta(minutes=5))
        _make_snapshot(db, stop_code="cab", destination="Broombridge",
                       direction="Inbound", forecast_minutes=0,
                       recorded_at=now)
        db.close()

        records = self._run_accuracy()
        assert records == []

    def test_large_jump_eg_10_to_0_produces_no_record(self):
        """A jump like 10→0 likely means a different tram; the algorithm ignores it."""
        db = TestSessionLocal()
        now = datetime.utcnow()
        _make_snapshot(db, stop_code="cab", destination="Broombridge",
                       direction="Inbound", forecast_minutes=10,
                       recorded_at=now - timedelta(seconds=30))
        _make_snapshot(db, stop_code="cab", destination="Broombridge",
                       direction="Inbound", forecast_minutes=0,
                       recorded_at=now)
        db.close()

        records = self._run_accuracy()
        assert records == []

    def test_different_stops_tracked_independently(self):
        db = TestSessionLocal()
        now = datetime.utcnow()
        for stop in ("cab", "jer"):
            _make_snapshot(db, stop_code=stop, destination="Broombridge",
                           direction="Inbound", forecast_minutes=1,
                           recorded_at=now - timedelta(seconds=30))
            _make_snapshot(db, stop_code=stop, destination="Broombridge",
                           direction="Inbound", forecast_minutes=0,
                           recorded_at=now)
        db.close()

        records = self._run_accuracy()
        stop_codes = {r.stop_code for r in records}
        assert "cab" in stop_codes
        assert "jer" in stop_codes


# ===========================================================================
# Scheduler: poll_luas_and_store
# ===========================================================================

class TestPollLuasAndStore:
    """Unit tests for the polling job in scheduler.py."""

    def _run_poll(self, forecasts):
        from database import LuasSnapshot
        import scheduler

        with patch("scheduler.SessionLocal", TestSessionLocal), \
             patch("scheduler.fetch_luas_forecast", new_callable=AsyncMock,
                   return_value=forecasts):
            scheduler.poll_luas_and_store()

        db = TestSessionLocal()
        records = db.query(LuasSnapshot).all()
        db.close()
        return records

    def test_forecasts_are_stored_in_db(self):
        forecasts = [
            {
                "destination": "Broombridge",
                "direction": "Inbound",
                "due_minutes": 5,
                "due_time": (datetime.utcnow() + timedelta(minutes=5)).isoformat(),
            }
        ]
        records = self._run_poll(forecasts)
        assert len(records) >= 1
        destinations = {r.destination for r in records}
        assert "Broombridge" in destinations

    def test_multiple_forecasts_all_stored(self):
        forecasts = [
            {
                "destination": f"Dest{i}",
                "direction": "Inbound",
                "due_minutes": i + 1,
                "due_time": (datetime.utcnow() + timedelta(minutes=i + 1)).isoformat(),
            }
            for i in range(3)
        ]
        records = self._run_poll(forecasts)
        stored_destinations = {r.destination for r in records}
        for i in range(3):
            assert f"Dest{i}" in stored_destinations

    def test_api_error_does_not_crash_job(self):
        from luas_client import LuasAPIError
        import scheduler

        with patch("scheduler.SessionLocal", TestSessionLocal), \
             patch("scheduler.fetch_luas_forecast",
                   side_effect=LuasAPIError("API down")):
            # Should not raise
            scheduler.poll_luas_and_store()

    def test_empty_forecasts_stores_nothing(self):
        records = self._run_poll([])
        assert records == []
