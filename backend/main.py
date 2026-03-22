from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from apscheduler.schedulers.background import BackgroundScheduler
from pathlib import Path
import logging
import os

from database import init_db
from routes import router
from scheduler import start_luas_polling

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting up...")
    init_db()
    scheduler.start()
    start_luas_polling(scheduler)
    logger.info("Luas polling scheduler started")
    yield
    # Shutdown
    logger.info("Shutting down...")
    scheduler.shutdown()

app = FastAPI(
    title="Luas Tracker API",
    description="Real-time Luas arrival tracking for Cabra stop",
    lifespan=lifespan
)

# CORS is only needed during local development — in production the React
# frontend is served from the same origin as the API, so no CORS applies.
# Set ALLOWED_ORIGINS to a comma-separated list of permitted origins.
# allow_credentials is intentionally omitted: this API uses no cookies or
# auth headers, and browsers reject the * + credentials combination anyway.
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:8080,http://localhost:5173")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(router)

@app.get("/health")
async def health_check():
    return {"status": "ok"}


# Serve React frontend (production build)
_static_dir = Path(__file__).parent / "static"
if _static_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(_static_dir / "assets")), name="assets")

    _static_dir_resolved = _static_dir.resolve()

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        file_path = (_static_dir / full_path).resolve()
        if str(file_path).startswith(str(_static_dir_resolved)) and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(_static_dir / "index.html"))
