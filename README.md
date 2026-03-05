# Luas & DART Real-Time Tracker

A real-time public transport tracking system for Dublin's Luas tram and DART rail networks. Built to learn full-stack development with real API integration, data pipelines, and time-series analytics.

## Project Overview

This is a learning project that tracks Luas and DART arrivals across Dublin. It demonstrates:

- **API Integration**: Consuming real-time data from the Luas AVL system and the Irish Rail real-time API
- **Data Pipeline**: Scheduled polling, data transformation, and storage
- **Time-Series Analytics**: Tracking forecast accuracy over time
- **Full-Stack Architecture**: Backend API, database, frontend integration
- **Microservices**: Separate DART service that runs independently of the Luas backend

## Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Python with FastAPI
- **DART Service**: Standalone Python FastAPI microservice
- **Database**: PostgreSQL (Amazon RDS) — separate databases for Luas and DART
- **Scheduling**: APScheduler for background polling
- **Async**: httpx for non-blocking API calls

## Project Structure

```
luas-tracker/
├── backend/          # Python FastAPI backend (deployed to AWS App Runner)
├── dart-service/     # Standalone DART microservice (independent of Luas backend)
├── frontend/         # Frontend app (deployed to AWS Amplify)
├── Dockerfile        # Backend container build
└── README.md
```

## Setup

### Prerequisites

- Python 3.9+
- PostgreSQL (or you can use SQLite for local development)
- pip

### Backend Installation

```bash
cd backend

python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

pip install -r requirements.txt

# Configure database
cp .env.example .env
nano .env  # Set DATABASE_URL

# Initialize database
python -c "from database import init_db; init_db()"

# Run server
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`

### DART Service Installation

The DART service is a separate microservice with its own database.

```bash
cd dart-service

python -m venv venv
source venv/bin/activate

pip install -r requirements.txt

# Configure database (optional — defaults to SQLite for local dev)
export DART_DATABASE_URL=postgresql://user:pass@host:5432/dart_db
# or leave unset to use SQLite: dart_tracker.db

# Run server
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

The DART API will be available at `http://localhost:8001`

### Frontend Installation

```bash
cd frontend

npm install

# Configure API URL (optional - defaults to Railway)
cp .env.example .env
nano .env  # Set VITE_API_URL to your backend URL

# Run dev server
npm run dev
```

The frontend will be available at `http://localhost:8080`

## API Endpoints

### Luas Backend

#### Get Next Arrivals
```
GET /arrivals/{stop_code}?limit=3
```
Returns the next N upcoming trams for any Luas stop (e.g. `/arrivals/cab?limit=5`).

#### Get All Stops
```
GET /stops
```
Returns all 67 Luas stops organised by line.

#### Get Forecast Accuracy
```
GET /accuracy/summary?stop_code=cab&hours=24
```
Forecast accuracy metrics for the last N hours.

#### Health Check
```
GET /health
```

### DART Service

#### Get DART Arrivals
```
GET /arrivals/{station_code}?limit=5
```
Returns the next DART arrivals at a station. Only DART services are returned — Intercity and Commuter trains are filtered out.

**Example:** `GET /arrivals/BROCK?limit=5`

**Example Response:**
```json
{
  "station_code": "BROCK",
  "station_name": "Blackrock",
  "last_updated": "2024-01-15T14:30:45",
  "next_arrivals": [
    {
      "train_code": "E123",
      "origin": "Greystones",
      "destination": "Malahide",
      "direction": "Northbound",
      "due_in_minutes": 3,
      "minutes_late": 0,
      "expected_arrival": "14:33",
      "status": "En Route",
      "last_location": "Seapoint"
    }
  ]
}
```

#### Get All DART Stations
```
GET /stations
```
Returns all DART stations grouped by zone (south / city / north).

#### DART Forecast Accuracy
```
GET /accuracy/summary?station_code=BROCK&hours=24
```

#### DART Health Check
```
GET /health
```

The Luas backend also exposes a proxy to the DART service at `/dart/arrivals/{station_code}` and `/dart/stations`, so the frontend only needs to talk to one backend.

## How It Works

### Luas
1. **Polling Loop**: Every 30 seconds, the backend polls 12 Luas stops across both lines
2. **Data Storage**: Raw forecast snapshots are stored in PostgreSQL
3. **API Serving**: The frontend calls `/arrivals/{stop_code}` to get the latest forecasts
4. **Accuracy Tracking**: Forecast transitions (e.g. 3→2→1→0 minutes) are used to measure accuracy

### DART
1. **Polling Loop**: Every 60 seconds, the DART service polls 20 stations via the Irish Rail real-time API
2. **Filtering**: Non-DART services (Intercity, Commuter) are discarded at parse time
3. **Train Tracking**: Trains are tracked by `train_code` + arrival bucket across polls, enabling accuracy measurement
4. **Proxy**: The Luas backend proxies DART requests directly to the Irish Rail API for live data

## Database Schema

### Luas

#### luas_snapshots
Stores raw API responses at each poll interval. Each record = one forecast at one point in time.

#### luas_accuracy
Stores calculated accuracy metrics from forecast progression comparisons.

### DART

#### dart_snapshots
Stores raw Irish Rail API responses filtered to DART trains only. Fields include `train_code`, `origin`, `destination`, `direction`, `due_in_minutes`, `minutes_late`, `expected_arrival`, `status`, `last_location`.

#### dart_accuracy
Stores accuracy deltas calculated by tracking the same train across successive polls. Uses `train_code` + arrival time bucket as the grouping key (more reliable than Luas since Irish Rail provides actual train codes).

## Development Notes

- The Luas API has rate limits and may have IP-based restrictions
- The backend acts as a proxy to work around CORS restrictions on the frontend
- Times are stored as UTC in the database; convert to local timezone in the frontend
- The polling job runs in a background thread managed by APScheduler

## Deployment

### AWS App Runner (Recommended)

App Runner is the simplest AWS option for this app — it handles containers, scaling, and HTTPS automatically.

1. **Create a PostgreSQL database** (e.g. Amazon RDS, or a free tier on [Neon](https://neon.tech) / [Supabase](https://supabase.com))
2. Go to the [App Runner console](https://console.aws.amazon.com/apprunner)
3. Click **Create service**
4. Choose **Source code repository** and connect your GitHub repo
5. Under **Deployment settings**, select **Automatic** (deploys on every push)
6. Under **Configure build**:
   - Runtime: **Docker**
   - The Dockerfile in this repo will be used automatically
7. Under **Service settings**:
   - Port: `8080`
8. Under **Environment variables**, add:
   - `DATABASE_URL` = your PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/dbname`)
9. Click **Create & deploy**

The health check endpoint at `/health` can be used for App Runner's health check configuration.

### AWS Amplify (Frontend)

1. Go to the [Amplify console](https://console.aws.amazon.com/amplify)
2. Click **Create new app** and connect your GitHub repo
3. Set the **App root** to `frontend`
4. Build settings (Amplify should auto-detect Vite):
   - Build command: `npm run build`
   - Output directory: `dist`
5. Under **Environment variables**, add:
   - `VITE_API_URL` = your App Runner backend URL (e.g. `https://abc123.eu-west-1.awsapprunner.com`)
6. Deploy

### Railway

1. Connect your GitHub repo to Railway
2. Add a PostgreSQL database service
3. Set `DATABASE_URL` environment variable (Railway does this automatically when you link the database)
4. Deploy

### Render

1. Create a new Web Service
2. Point to your repo
3. Set environment variables
4. Deploy

### Docker (any platform)

```bash
docker build -t luas-tracker .
docker run -p 8080:8080 -e DATABASE_URL=postgresql://user:pass@host:5432/dbname luas-tracker
```

## Next Steps / Future Features

- WebSocket support for live updates
- Predictive analytics
- Mobile app via Capacitor
- Irish Rail Commuter/Intercity tracking

## Learning Resources

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [SQLAlchemy ORM](https://docs.sqlalchemy.org/)
- [APScheduler](https://apscheduler.readthedocs.io/)
- [Dublin Open Data - Luas API](https://data.gov.ie)
- [Irish Rail Real-Time API](https://api.irishrail.ie/realtime/)
