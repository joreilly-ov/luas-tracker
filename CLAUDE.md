# CLAUDE.md — Luas & DART Tracker Project Guide

Comprehensive context for AI assistance on this project.

## Project Overview

A full-stack learning project that tracks real-time arrivals for Dublin's Luas tram and DART rail networks. The system polls both the Luas AVL API and the Irish Rail real-time API, stores forecast data, calculates accuracy metrics, and serves everything through a REST API.

**Primary Goals:**
- Track how Luas and DART arrival forecasts change over time
- Measure forecast accuracy by comparing predictions to actual arrivals
- Provide a clean API for frontend consumption
- Experiment with a microservice architecture (separate DART service)

## Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui
- **Backend (Luas)**: Python 3.9+ with FastAPI — also serves the React frontend as static files
- **Backend (DART)**: Python 3.9+ with FastAPI — standalone microservice
- **Database**: PostgreSQL via [Neon](https://neon.tech) (serverless, free tier) — separate DBs for each service
- **ORM**: SQLAlchemy 2.0
- **Scheduling**: APScheduler (background jobs)
- **HTTP Client**: httpx (async)
- **Testing**: pytest with pytest-asyncio
- **ASGI Server**: uvicorn
- **Deployment**: Fly.io (both services, Dublin `dub` region)

## Deployment Architecture

```
https://<app>.fly.dev/         ← React frontend (static, served by FastAPI)
https://<app>.fly.dev/api/*    ← Luas backend API
https://<app>.fly.dev/dart/*   ← DART proxy routes (live passthrough to Irish Rail)

https://<dart-app>.fly.dev/    ← DART microservice (data collection + accuracy)
```

The React frontend is **built into the Luas backend Docker image** via a multi-stage build:
1. Stage 1: `node:20-slim` builds the React app (`npm run build`)
2. Stage 2: `python:3.11-slim` copies the built `dist/` into `/app/static`
3. FastAPI serves `/app/static` as static files and catches all unmatched routes with `index.html` for client-side routing

`VITE_API_URL` is set to `""` at build time so the frontend uses relative URLs — it always talks to the same origin it was served from.

## Project Structure

```
luas-tracker/
├── backend/
│   ├── main.py              # FastAPI app, CORS, lifespan, static file serving
│   ├── database.py          # SQLAlchemy models (LuasSnapshot, LuasAccuracy), engine
│   ├── routes.py            # API endpoints (arrivals, accuracy, debug, DART proxy)
│   ├── luas_client.py       # Luas API client and XML parsing
│   ├── scheduler.py         # Background jobs (polling every 30s, accuracy every 1m)
│   ├── requirements.txt
│   ├── .env.example
│   ├── test_luas_tracker.py
│   ├── pytest.ini
│   └── TESTING.md
├── dart-service/            # Standalone DART microservice
│   ├── main.py              # FastAPI app for DART service
│   ├── database.py          # SQLAlchemy models (DartSnapshot, DartAccuracy)
│   ├── routes.py            # DART endpoints (arrivals, stations, accuracy, debug)
│   ├── dart_client.py       # Irish Rail API client, XML parsing, DART filtering
│   ├── scheduler.py         # DART background jobs (polling every 60s, accuracy every 2m)
│   ├── requirements.txt
│   ├── Dockerfile           # Container build for Fly.io
│   └── fly.toml             # Fly.io config for DART service
├── frontend/                # React frontend source (built into backend image)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Index.tsx    # Luas arrivals page
│   │   │   └── Dart.tsx     # DART arrivals page
│   │   └── ...
│   └── ...
├── Dockerfile               # Multi-stage build: React → Python, served by FastAPI
├── .dockerignore
├── fly.toml                 # Fly.io config for Luas backend (+ frontend)
├── CLAUDE.md                # This file
└── README.md
```

## Architecture & Data Flow

### Luas Service

#### Background Polling (`backend/scheduler.py`)

**Job: `poll_luas_and_store`** — runs every 30 seconds
- Polls 12 stops across both lines (Green and Red)
- Calls `fetch_luas_forecast()` for each stop
- Stores raw forecast data in `luas_snapshots`

**Job: `calculate_accuracy_from_snapshots`** — runs every 1 minute
- Loads last 2 hours of snapshots
- Looks for forecast transitions (3→2, 2→1, 1→0) indicating an arrival
- Stores accuracy deltas in `luas_accuracy`

#### Luas API (`backend/luas_client.py`)

**Endpoint:** `https://luasforecasts.rpa.ie/xml/get.ashx`

```xml
<stopInfo>
  <direction name="Inbound">
    <tram dueMins="5" destination="Broombridge"/>
    <tram dueMins="DUE" destination="Phibsborough"/>
  </direction>
</stopInfo>
```

### DART Service

#### Background Polling (`dart-service/scheduler.py`)

**Job: `poll_dart_and_store`** — runs every 60 seconds
- Polls 20 DART stations, Greystones ↔ Malahide/Howth
- Filters to DART-only at parse time (discards Intercity, Commuter)
- Stores in `dart_snapshots`

**Job: `calculate_accuracy_from_snapshots`** — runs every 2 minutes
- Groups by `(station_code, train_code, destination, direction, arrival_bucket)`
- 5-minute arrival buckets to match the same physical train across polls
- Skips poll pairs > 3 minutes apart
- Stores accuracy deltas in `dart_accuracy`

#### Irish Rail API (`dart-service/dart_client.py`)

**Endpoint:** `https://api.irishrail.ie/realtime/realtime.asmx/getStationDataByCodeXML`
**XML Namespace:** `http://api.irishrail.ie/realtime/`

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

#### DART Proxy in Luas Backend (`backend/routes.py`)

The Luas backend exposes live pass-through routes so the frontend only needs one origin:

- `GET /dart/arrivals/{station_code}?limit=N` — fetches live from Irish Rail (90-min window), no DB
- `GET /dart/stations` — returns static station list

**Important:** these proxy routes call Irish Rail directly and return live data. They do NOT use the DART service's database. The DART service database is used only for accuracy tracking — the frontend DART page exclusively uses the proxy routes.

The `has_any_service` field in the proxy response is `True` if Irish Rail returned any train records for that station in the 90-minute window. The frontend uses a network-wide check across all displayed stations (if either station has trains, DART is considered running) to avoid false disruption warnings during schedule gaps.

## Database Schema

### Luas (`DATABASE_URL`)

**`luas_snapshots`** — one row per forecast per poll
```
id, stop_code, direction, destination,
forecast_arrival_minutes, forecast_arrival_time, recorded_at
```

**`luas_accuracy`** — one row per measured arrival transition
```
id, stop_code, direction, destination,
forecasted_minutes, actual_minutes, accuracy_delta, calculated_at
```

### DART (`DART_DATABASE_URL`)

**`dart_snapshots`** — one row per DART train per station per poll
```
id, station_code, train_code, origin, destination, direction,
due_in_minutes, minutes_late, expected_arrival, status, last_location, recorded_at
```

**`dart_accuracy`** — one row per measured arrival transition
```
id, station_code, train_code, origin, destination, direction,
forecasted_minutes, actual_minutes, accuracy_delta, minutes_late_reported, calculated_at
```

## API Endpoints

### Luas Backend

| Endpoint | Description |
|----------|-------------|
| `GET /arrivals/{stop_code}?limit=3` | Next N arrivals for a stop |
| `GET /stops` | All 67 Luas stops by line |
| `GET /accuracy/summary?stop_code=cab&hours=24` | Accuracy metrics |
| `GET /dart/arrivals/{station_code}?limit=6` | Live DART data (proxy) |
| `GET /dart/stations` | DART station list (proxy) |
| `GET /health` | Health check |
| `GET /debug/data-collection` | Polling status |
| `GET /debug/database` | DB connectivity + record counts |
| `GET /debug/snapshots/transitions?stop_code=cab&minutes=30` | Forecast transitions |

### DART Service

| Endpoint | Description |
|----------|-------------|
| `GET /arrivals/{station_code}?limit=5` | DART arrivals from DB |
| `GET /stations` | All stations grouped by zone |
| `GET /accuracy/summary?station_code=BROCK&hours=24` | Accuracy metrics |
| `GET /debug/data-collection` | Polling status |
| `GET /health` | Health check |

## Environment Variables

**Luas backend** (`backend/.env`):
```
DATABASE_URL=postgresql://user:pass@host/luas_tracker?sslmode=require
```

**DART service** (`dart-service/.env` or secrets):
```
DART_DATABASE_URL=postgresql://user:pass@host/dart_tracker?sslmode=require
```

Both services auto-convert `postgres://` to `postgresql://` for SQLAlchemy compatibility.

## Local Development

```bash
# Luas backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # set DATABASE_URL
python -c "from database import init_db; init_db()"
uvicorn main:app --reload
# → http://localhost:8000

# DART service
cd dart-service
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
export DART_DATABASE_URL=postgresql://...   # or leave unset for SQLite
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
# → http://localhost:8001

# Frontend
cd frontend
npm install
npm run dev
# → http://localhost:8080
# Set VITE_API_URL=http://localhost:8000 in frontend/.env for local API
```

## Deployment

Both services deploy to Fly.io (Dublin region, `dub`). `auto_stop_machines = false` keeps APScheduler alive.

```bash
# Luas backend + frontend (repo root)
fly apps create luas-tracker
fly secrets set DATABASE_URL="postgresql://..." -a luas-tracker
fly deploy

# DART service (from dart-service/)
cd dart-service
fly apps create luas-tracker-dart
fly secrets set DART_DATABASE_URL="postgresql://..." -a luas-tracker-dart
fly deploy
```

Update the `app` name in each `fly.toml` to match what you created.

## Common Development Patterns

### Database sessions (dependency injection)
```python
@router.get("/endpoint")
async def endpoint(db: Session = Depends(get_db)):
    records = db.query(Model).all()
    return records
```

### Async vs sync
- API endpoints: `async def` (FastAPI)
- Background jobs: `def` (APScheduler runs in a thread pool)
- HTTP calls: `async` with httpx
- Database: sync SQLAlchemy (thread pool)

### Time handling
- All DB timestamps are UTC (`datetime.utcnow()`)
- Convert to local timezone in the frontend

## Known Issues & Limitations

### Luas
- **No unique tram IDs**: The Luas API doesn't provide tram identifiers. Accuracy uses small forecast transitions (1-3 min) as a proxy for a tram arriving.
- **Poll timing assumptions**: Assumes trams arrive at the midpoint between polls (30s polling → ~15s error bound).
- **CORS**: Backend proxies Luas API calls to avoid browser CORS restrictions.

### DART
- **Schedule gaps vs disruptions**: DART runs every 20-30 minutes off-peak, so a 90-minute API window can occasionally be empty at a station even when service is running. The frontend uses cross-station checks (if either displayed station has trains, the network is considered healthy) to avoid false disruption warnings.
- **Irish Rail API reliability**: Occasionally returns empty or malformed responses. The DART client logs and skips bad responses gracefully.
- **Accuracy data volume**: Lower off-peak due to fewer trains per hour.

## File Quick Reference

| File | Purpose |
|------|---------|
| `backend/main.py` | FastAPI app init, CORS, lifespan, static file serving |
| `backend/database.py` | LuasSnapshot, LuasAccuracy models + DB connection |
| `backend/routes.py` | All HTTP endpoints incl. DART proxy |
| `backend/luas_client.py` | Luas API client and XML parsing |
| `backend/scheduler.py` | Luas polling (30s) and accuracy (1m) jobs |
| `dart-service/main.py` | DART service FastAPI app |
| `dart-service/database.py` | DartSnapshot, DartAccuracy models |
| `dart-service/routes.py` | DART endpoints |
| `dart-service/dart_client.py` | Irish Rail API client, XML parsing, DART filtering |
| `dart-service/scheduler.py` | DART polling (60s) and accuracy (2m) jobs |
| `Dockerfile` | Multi-stage: builds React, embeds in Python image |
| `fly.toml` | Fly.io config for Luas backend + frontend |
| `dart-service/fly.toml` | Fly.io config for DART service |

## Useful Commands

```bash
# Test arrivals
curl http://localhost:8000/arrivals/cab
curl http://localhost:8000/dart/arrivals/BROCK
curl http://localhost:8001/arrivals/BROCK   # direct to DART service

# Check scheduler health
curl http://localhost:8000/debug/data-collection
curl http://localhost:8001/debug/data-collection

# List stations
curl http://localhost:8000/stops
curl http://localhost:8001/stations

# DB record counts
python -c "from database import SessionLocal, LuasSnapshot; db=SessionLocal(); print(db.query(LuasSnapshot).count())"
# (from dart-service/)
python -c "from database import SessionLocal, DartSnapshot; db=SessionLocal(); print(db.query(DartSnapshot).count())"

# Reset local DBs
rm luas_tracker.db && python -c "from database import init_db; init_db()"
rm dart_tracker.db && python -c "from database import init_db; init_db()"

# Run tests
cd backend && pytest
```
