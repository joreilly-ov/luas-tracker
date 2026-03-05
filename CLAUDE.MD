# CLAUDE.MD - Luas & DART Tracker Project Guide

This document provides comprehensive context about the Luas & DART Real-Time Tracker project for AI assistance.

## Project Overview

A full-stack learning project that tracks real-time arrivals for Dublin's Luas tram and DART rail networks. The system polls both the Luas API and the Irish Rail real-time API, stores forecast data, calculates accuracy metrics, and serves this through a REST API.

**Primary Goals:**
- Learn full-stack development with real API integration
- Track how Luas and DART arrival forecasts change over time
- Measure forecast accuracy by comparing predictions to actual arrivals
- Provide a clean API for frontend consumption
- Experiment with a microservice architecture (separate DART service)

## Tech Stack

- **Backend (Luas)**: Python 3.9+ with FastAPI
- **Backend (DART)**: Python 3.9+ with FastAPI — standalone microservice
- **Database**: PostgreSQL (production) / SQLite (development) — separate DBs for each service
- **ORM**: SQLAlchemy 2.0
- **Scheduling**: APScheduler (background jobs)
- **HTTP Client**: httpx (async)
- **Testing**: pytest with pytest-asyncio
- **ASGI Server**: uvicorn

## Project Structure

```
luas-tracker/
├── backend/
│   ├── main.py              # FastAPI app entry point, CORS, lifespan management
│   ├── database.py          # SQLAlchemy models (LuasSnapshot, LuasAccuracy), engine setup
│   ├── routes.py            # API endpoints (arrivals, accuracy, debug, DART proxy)
│   ├── luas_client.py       # Luas API client, XML parsing
│   ├── scheduler.py         # Background jobs (polling, accuracy calculation)
│   ├── requirements.txt     # Python dependencies
│   ├── .env.example         # Environment variable template
│   ├── test_luas_tracker.py # Test suite
│   ├── pytest.ini           # pytest configuration
│   └── TESTING.md           # Testing documentation
├── dart-service/            # Standalone DART microservice
│   ├── main.py              # FastAPI app entry point for DART service
│   ├── database.py          # SQLAlchemy models (DartSnapshot, DartAccuracy)
│   ├── routes.py            # DART API endpoints (arrivals, stations, accuracy, debug)
│   ├── dart_client.py       # Irish Rail API client, XML parsing, DART filtering
│   ├── scheduler.py         # DART background jobs (polling every 60s, accuracy every 2m)
│   └── requirements.txt     # Python dependencies
├── frontend/                # React frontend (deployed to AWS Amplify)
├── Dockerfile               # Backend container build (used by App Runner)
├── .dockerignore            # Docker build exclusions
├── CLAUDE.MD                # Project guide for AI assistance
└── README.md                # User-facing documentation
```

## Architecture & Data Flow

### Luas Service

#### 1. Background Polling (backend/scheduler.py)

**Job: `poll_luas_and_store`** (runs every 30 seconds)
- Polls 12 stops across both Luas lines (Green and Red)
- Calls `fetch_luas_forecast()` for each stop
- Stores raw forecast data in `luas_snapshots` table
- Handles API errors gracefully and logs failures

**Stops monitored:**
- Green Line: Broombridge, Cabra, St. Stephen's Green, Ranelagh, Sandyford, Brides Glen
- Red Line: Tallaght, Red Cow, Heuston, Jervis, Connolly, The Point

#### 2. Luas API Integration (backend/luas_client.py)

**Endpoint:** `https://luasforecasts.rpa.ie/xml/get.ashx`

**XML Structure:**
```xml
<stopInfo>
  <direction name="Inbound">
    <tram dueMins="5" destination="Broombridge"/>
    <tram dueMins="DUE" destination="Phibsborough"/>
  </direction>
  <direction name="Outbound">
    <tram dueMins="12" destination="Brides Glen"/>
  </direction>
</stopInfo>
```

**Key Functions:**
- `fetch_luas_forecast(stop_code)`: Fetches and parses forecast data
- `parse_luas_xml(xml_content)`: Parses XML to Python dicts
- Handles "DUE" (0 minutes) and numeric values
- Filters out "No trams forecast" entries

#### 3. Accuracy Calculation (backend/scheduler.py)

**Job: `calculate_accuracy_from_snapshots`** (runs every 1 minute)

**Algorithm:**
1. Groups last 2 hours of snapshots by (stop, direction, destination)
2. Looks for forecast transitions that indicate arrival:
   - **1→0** (imminent arrival) - most reliable
   - **2→1** (near arrival) - fairly reliable
   - **3→2** (approaching) - less reliable but useful
3. Calculates accuracy delta: `actual_minutes - forecasted_minutes`
   - Negative = arrived early
   - Positive = arrived late
   - Zero = on time
4. Stores results in `luas_accuracy` table

**Important Notes:**
- Without unique tram IDs, only small transitions (1-3 minutes) are reliable
- Large transitions (e.g., 12→0) likely represent different trams
- Polls must be within 2 minutes of each other to be valid
- Deduplicates records within 2-minute windows

### DART Service

#### 1. Background Polling (dart-service/scheduler.py)

**Job: `poll_dart_and_store`** (runs every 60 seconds)
- Polls 20 DART stations from Greystones to Malahide/Howth
- Calls `fetch_dart_arrivals()` for each station
- Filters out non-DART services (Intercity, Commuter) at parse time
- Stores raw data in `dart_snapshots` table

**Stations monitored (south → north):**
- South: Greystones, Killiney, Dalkey, Dún Laoghaire, Blackrock, Booterstown, Sandymount
- City: Lansdowne Road, Grand Canal Dock, Pearse, Tara Street, Connolly
- North: Clontarf Road, Raheny, Bayside, Howth Junction, Sutton, Howth, Portmarnock, Malahide

#### 2. Irish Rail API Integration (dart-service/dart_client.py)

**Endpoint:** `https://api.irishrail.ie/realtime/realtime.asmx/getStationDataByCodeXML`

**XML Namespace:** `http://api.irishrail.ie/realtime/`

**XML Structure:**
```xml
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
</ArrayOfObjStationData>
```

**Key Functions:**
- `fetch_dart_arrivals(station_code)`: Fetches and parses Irish Rail real-time data
- `parse_dart_xml(xml_content, station_code)`: Parses namespaced XML, filters to DART only
- Handles missing or empty fields gracefully

#### 3. Accuracy Calculation (dart-service/scheduler.py)

**Job: `calculate_accuracy_from_snapshots`** (runs every 2 minutes)

**Algorithm:**
1. Loads last 2 hours of `dart_snapshots`
2. Groups by `(station_code, train_code, destination, direction, arrival_bucket)` — 5-minute buckets used to match the same physical train across polls
3. Looks for forecast decrements: **3→2**, **2→1**, **1→0**
4. Skips poll pairs more than 3 minutes apart (DART polls are 60s so this allows for missed cycles)
5. Calculates `accuracy_delta = estimated_actual_minutes - forecasted_minutes`
6. Deduplicates within 3-minute windows

**Key difference from Luas:** DART provides unique `train_code` values (e.g. `E123`), making it possible to definitively track the same train across polls. This makes accuracy calculations more reliable.

#### 4. DART Proxy in Luas Backend (backend/routes.py)

The Luas backend exposes pass-through proxy routes so the frontend only needs one backend URL:

- `GET /dart/arrivals/{station_code}` — fetches live data direct from Irish Rail, no DB
- `GET /dart/stations` — returns static station list

These proxy routes call the Irish Rail API directly (no persistence), unlike the DART service which stores snapshots in its own database.

## Database Schema

### Luas Database (`DATABASE_URL`)

### Table: `luas_snapshots`

Stores raw API poll data. Each record = one forecast at one point in time.

```python
id                       INTEGER PRIMARY KEY
stop_code                STRING (index)      # "cab", "tal", etc.
tram_id                  STRING              # Not provided by API (nullable)
direction                STRING              # "Inbound" or "Outbound"
destination              STRING              # "Broombridge", "Brides Glen", etc.
forecast_arrival_minutes INTEGER             # Minutes until arrival
forecast_arrival_time    DATETIME            # Calculated arrival time
recorded_at              DATETIME (index)    # When we polled the API
```

**Usage:**
- Serves current forecasts to frontend
- Source data for accuracy calculations
- Historical trending analysis

### Table: `luas_accuracy`

Stores calculated accuracy metrics by comparing forecast progression.

```python
id                  INTEGER PRIMARY KEY
stop_code           STRING (index)
tram_id             STRING              # Nullable (not available)
direction           STRING
destination         STRING
forecasted_minutes  INTEGER             # Original forecast (1-3 minutes)
actual_minutes      INTEGER             # Estimated actual arrival time
accuracy_delta      INTEGER             # Difference (negative=early, positive=late)
calculated_at       DATETIME (index)    # When we calculated this
```

**Usage:**
- Measures forecast quality over time
- Identifies patterns (routes/times with poor accuracy)
- Powers analytics and metrics endpoints

### DART Database (`DART_DATABASE_URL`)

### Table: `dart_snapshots`

One record per DART train per station per poll. Non-DART trains are never stored.

```python
id               INTEGER PRIMARY KEY
station_code     STRING (index)    # "BROCK", "CNLLY", etc.
train_code       STRING (index)    # Irish Rail ID e.g. "E123"
origin           STRING            # Train's origin station
destination      STRING            # Train's final destination
direction        STRING            # "Northbound" or "Southbound"
due_in_minutes   INTEGER           # Minutes until arrival
minutes_late     INTEGER           # How late (0 = on time)
expected_arrival STRING            # "HH:MM" string from API
status           STRING            # "En Route", "No Information", etc.
last_location    STRING (nullable) # Last known location
recorded_at      DATETIME (index)  # When we polled the API
```

### Table: `dart_accuracy`

Accuracy measurements derived from tracking trains across polls.

```python
id                      INTEGER PRIMARY KEY
station_code            STRING (index)
train_code              STRING            # Irish Rail train ID
origin                  STRING
destination             STRING
direction               STRING
forecasted_minutes      INTEGER           # Forecast at measurement time (1-3)
actual_minutes          INTEGER           # Estimated actual elapsed time
accuracy_delta          INTEGER           # Negative=early, positive=late
minutes_late_reported   INTEGER           # What the API said at forecast time
calculated_at           DATETIME (index)
```

## API Endpoints

### Luas Backend Endpoints

**`GET /arrivals/{stop_code}?limit=3`**
- Returns next N arrivals for any stop
- Uses most recent snapshot from database
- Example: `/arrivals/cab?limit=5`

**`GET /arrivals/cabra?limit=3`**
- Legacy endpoint (backwards compatible)
- Redirects to `/arrivals/cab`

**`GET /stops`**
- Returns all 67 Luas stops organized by line
- Includes stop codes, names, and line assignment

**`GET /accuracy/summary?stop_code=cab&hours=24`**
- Accuracy metrics grouped by destination/direction
- Average delta, min/max, measurement count
- Defaults to Cabra stop, last 24 hours

**`GET /metrics/accuracy?stop_code=cab&hours=24`**
- Detailed accuracy metrics with trends
- Overall stats, by-destination breakdown, hourly trend data
- Includes on-time/early/late percentages

**`GET /dart/arrivals/{station_code}`** *(proxy)*
- Passes through to Irish Rail real-time API
- Filters to DART-only, returns JSON
- No persistence — live data only

**`GET /dart/stations`** *(proxy)*
- Returns static DART station list

### Luas Debug Endpoints

**`GET /debug/accuracy/count`** — record counts and samples

**`GET /debug/accuracy/by-stop`** — accuracy grouped by stop

**`GET /debug/accuracy/stops-summary`** — quick breakdown by line

**`GET /debug/snapshots/transitions?stop_code=cab&minutes=30`** — forecast transitions for diagnosis

**`GET /debug/data-collection`** — checks if polling is active (healthy if polled within 90s)

**`GET /debug/database`** — DB connectivity and record counts

**`GET /health`** — returns `{"status": "ok"}`

### DART Service Endpoints

**`GET /arrivals/{station_code}?limit=5`**
- Next DART arrivals from most recent DB snapshot
- DART-only (Intercity/Commuter already filtered at store time)
- Example: `/arrivals/BROCK?limit=5`

**`GET /stations`**
- All 27 DART stations grouped by zone (south / city / north)
- Includes Irish Rail station codes

**`GET /accuracy/summary?station_code=BROCK&hours=24`**
- Accuracy metrics by destination/direction
- `hours` param is optional — omit for all-time data

**`GET /debug/data-collection`**
- Last poll timestamp and health status
- Healthy if polled within 180s (3× the 60s interval)

**`GET /health`** — returns `{"status": "ok", "service": "dart-tracker"}`

## Common Development Patterns

### 1. Database Sessions

Always use dependency injection for database access:

```python
@router.get("/endpoint")
async def endpoint(db: Session = Depends(get_db)):
    # db is automatically provided and closed after request
    records = db.query(Model).all()
    return records
```

### 2. Error Handling

The codebase uses structured logging and graceful degradation:

```python
try:
    # operation
except SpecificError as e:
    logger.error(f"Context: {e}")
    # graceful fallback or re-raise as HTTPException
```

### 3. Async vs Sync

- API endpoints: async (FastAPI best practice)
- Background jobs: sync (APScheduler context)
- HTTP calls: async with httpx
- Database: sync with SQLAlchemy (uses thread pool)

### 4. Time Handling

- All database times are UTC (`datetime.utcnow()`)
- Frontend should convert to local timezone
- Accuracy calculations use timedelta for comparisons

## Running the Application

### Local Development

```bash
# Setup
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Configure database
cp .env.example .env
# Edit .env with DATABASE_URL

# Initialize database
python -c "from database import init_db; init_db()"

# Run server
uvicorn main:app --reload
```

### DART Service Local Development

```bash
cd dart-service
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Optional — defaults to SQLite (dart_tracker.db)
export DART_DATABASE_URL=postgresql://user:pass@host:5432/dart_db

uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

### Environment Variables

**Luas backend:**
```bash
DATABASE_URL=sqlite:///./luas_tracker.db  # or postgresql://...
```

**DART service:**
```bash
DART_DATABASE_URL=sqlite:///./dart_tracker.db  # or postgresql://...
```

Both services auto-convert `postgres://` to `postgresql://` for compatibility. The two services use completely separate databases and never share state.

## Testing

```bash
# Run all tests
pytest

# With coverage
pytest --cov=. --cov-report=html

# Specific test
pytest test_luas_tracker.py::test_name -v
```

See `TESTING.md` for detailed testing documentation.

## Debugging Tips

### Issue: No accuracy data appearing

1. Check if polling is running: `GET /debug/data-collection`
2. Verify snapshots are being stored: `GET /debug/database`
3. Check for transitions: `GET /debug/snapshots/transitions?stop_code=cab`
4. Look at accuracy logs: Check server logs for "GREEN LINE ANALYSIS"
5. Verify accuracy job is scheduled: Check startup logs for "✓ Accuracy calculation job scheduled"

### Issue: Empty arrival responses

1. Check last poll time: `GET /debug/data-collection`
2. Verify stop code is valid: `GET /stops`
3. Check if API is returning data: Look for "API Response" in logs
4. Verify snapshots exist: `GET /debug/database`

### Issue: API returning 500 errors

1. Check logs for exceptions
2. Verify database connectivity: `GET /debug/database`
3. Check if tables exist: `python -c "from database import init_db; init_db()"`
4. Look for SQL errors in logs

## Known Issues & Limitations

### Luas

1. **No unique tram IDs**: The Luas API doesn't provide tram identifiers, making it impossible to definitively track the same tram across polls. Accuracy calculations use small forecast transitions (1-3 minutes) as a proxy.

2. **Accuracy timing assumptions**: Assumes trams arrive at the midpoint between polls for X→(X-1) transitions. With 30-second polling, this is reasonably accurate.

3. **API rate limits**: The Luas API may have undocumented rate limits or IP restrictions. Current 30-second polling across 12 stops (24 req/min) seems safe.

4. **CORS**: Backend acts as a proxy to work around CORS restrictions on the Luas API.

5. **Green Line vs Red Line data**: Historically, Green Line has had less accuracy data than Red Line. This may be due to route patterns, API response differences, or forecast stability.

### DART

6. **DART service not containerised separately**: The `dart-service/` doesn't yet have its own Dockerfile or App Runner config. It runs as a standalone process; deployment requires manual setup.

7. **Irish Rail API availability**: The Irish Rail API is generally reliable but occasionally returns empty or malformed responses. The DART client logs and skips bad responses gracefully.

8. **Accuracy at low-frequency off-peak times**: DART trains run every 20-30 minutes off-peak. With 60-second polling, there are many polls per train which is fine, but accuracy data volume will be lower than during peak hours.

## Recent Changes & Context

- **Added DART microservice** (`dart-service/`): Standalone FastAPI service that polls 20 DART stations via the Irish Rail real-time API, stores snapshots in its own DB, and calculates forecast accuracy using `train_code` as the tracking key
- **Added DART proxy routes** to Luas backend (`/dart/arrivals/`, `/dart/stations`): pass-through to Irish Rail API so the frontend only needs one backend URL
- **Added DART frontend page**: Accessible via the nav, shows live DART arrivals by station
- Added comprehensive debug endpoints to diagnose accuracy calculation issues
- Implemented multi-stop polling (12 stops across both Luas lines)
- Enhanced accuracy calculation with detailed logging and transition analysis
- Added stop validation and comprehensive stop list (67 total Luas stops)
- Improved error handling and graceful degradation

## Contributing Guidelines

When making changes:

1. **Preserve existing patterns**: Follow the established sync/async patterns
2. **Add logging**: Use `logger.info()` for significant events, `logger.error()` for failures
3. **Update tests**: Add/update tests in `test_luas_tracker.py`
4. **Document API changes**: Update README.md and CLAUDE.MD
5. **Handle errors gracefully**: Don't let one stop failure break entire polling cycle
6. **Use UTC for database times**: Always use `datetime.utcnow()` for timestamps

## Useful Commands

```bash
# --- Luas ---

# Test Luas arrivals
curl http://localhost:8000/arrivals/cab

# Check Luas scheduler status
curl http://localhost:8000/debug/data-collection

# Manual Luas DB query
python -c "from database import SessionLocal, LuasSnapshot; db = SessionLocal(); print(db.query(LuasSnapshot).count())"

# Reset Luas database
rm luas_tracker.db && python -c "from database import init_db; init_db()"

# --- DART ---

# Test DART arrivals (via DART service)
curl http://localhost:8001/arrivals/BROCK

# Test DART arrivals (via Luas backend proxy)
curl http://localhost:8000/dart/arrivals/BROCK

# List all DART stations
curl http://localhost:8001/stations

# Check DART scheduler status
curl http://localhost:8001/debug/data-collection

# Manual DART DB query (from dart-service dir)
python -c "from database import SessionLocal, DartSnapshot; db = SessionLocal(); print(db.query(DartSnapshot).count())"

# Reset DART database
rm dart_tracker.db && python -c "from database import init_db; init_db()"
```

## Quick Reference: File Purposes

| File | Purpose |
|------|---------|
| `backend/main.py` | FastAPI app initialization, CORS, scheduler lifecycle |
| `backend/database.py` | SQLAlchemy models (LuasSnapshot, LuasAccuracy) and DB connection |
| `backend/routes.py` | All HTTP endpoints (arrivals, accuracy, debug, DART proxy) |
| `backend/luas_client.py` | Luas API client and XML parsing |
| `backend/scheduler.py` | Background jobs (Luas polling every 30s, accuracy every 1m) |
| `backend/test_luas_tracker.py` | Test suite covering all major functionality |
| `dart-service/main.py` | DART service FastAPI app initialization |
| `dart-service/database.py` | SQLAlchemy models (DartSnapshot, DartAccuracy) and DB connection |
| `dart-service/routes.py` | DART endpoints (arrivals, stations, accuracy, debug) |
| `dart-service/dart_client.py` | Irish Rail API client, XML parsing, DART filtering |
| `dart-service/scheduler.py` | DART background jobs (polling every 60s, accuracy every 2m) |
| `Dockerfile` | Container build for Luas backend (used by AWS App Runner) |

## Learning Notes

This is a learning project demonstrating:

- **Real-time data pipelines**: Scheduled polling, transformation, storage
- **Time-series analytics**: Tracking how forecasts evolve over time
- **API design**: RESTful endpoints with proper error handling
- **Background jobs**: APScheduler integration with FastAPI
- **Database modeling**: Proper schema design for time-series data
- **Testing**: pytest with async support and mocking
- **Production patterns**: Logging, error handling, graceful degradation

The codebase prioritizes clarity and learning over optimization. It's designed to be readable and educational.
