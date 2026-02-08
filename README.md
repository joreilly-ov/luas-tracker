# Luas Real-Time Tracker

A real-time public transport tracking system for Dublin's Luas tram network. Built to learn full-stack development with real API integration, data pipelines, and time-series analytics.

## Project Overview

This is a learning project that tracks Luas arrivals at the Cabra stop on the Green Line. It demonstrates:

- **API Integration**: Consuming real-time data from Dublin's Luas Automatic Vehicle Location System
- **Data Pipeline**: Scheduled polling, data transformation, and storage
- **Time-Series Analytics**: Tracking forecast accuracy over time
- **Full-Stack Architecture**: Backend API, database, frontend integration

## Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Python with FastAPI
- **Database**: PostgreSQL (Amazon RDS)
- **Scheduling**: APScheduler for background polling
- **Async**: httpx for non-blocking API calls

## Project Structure

```
luas-tracker/
├── backend/          # Python FastAPI backend (deployed to AWS App Runner)
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

### Get Next Arrivals
```
GET /arrivals/cabra?limit=3
```
Returns the next 3 upcoming trams for Cabra stop.

**Example Response:**
```json
{
  "stop_code": "cab",
  "last_updated": "2024-01-15T14:30:45.123456",
  "next_arrivals": [
    {
      "destination": "The Point",
      "direction": "Inbound",
      "due_minutes": 3,
      "due_time": "2024-01-15T14:33:45.123456"
    },
    {
      "destination": "Tallaght",
      "direction": "Outbound",
      "due_minutes": 7,
      "due_time": "2024-01-15T14:37:45.123456"
    }
  ]
}
```

### Get Forecast Accuracy
```
GET /accuracy/summary?hours=24
```
Get forecast accuracy metrics for the last N hours (default 24).

### Health Check
```
GET /health
```
Simple health check endpoint.

### Stats
```
GET /stats
```
Get general system statistics.

## How It Works

1. **Polling Loop**: Every 30 seconds, the backend calls the Luas API
2. **Data Storage**: Raw forecast snapshots are stored in PostgreSQL
3. **API Serving**: The frontend calls `/arrivals/cabra` to get the latest forecasts
4. **Accuracy Tracking**: As new forecasts come in, we compare them to old ones to measure accuracy

## Database Schema

### luas_snapshots
Stores raw API responses at each poll interval. Useful for:
- Serving current forecasts
- Calculating accuracy over time
- Trending analysis

### luas_accuracy
Stores calculated accuracy metrics. Useful for:
- Understanding forecast quality
- Identifying problem routes/times
- Time-series analysis

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

## Learning Resources

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [SQLAlchemy ORM](https://docs.sqlalchemy.org/)
- [APScheduler](https://apscheduler.readthedocs.io/)
- [Dublin Open Data - Luas API](https://data.gov.ie)
