from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from apscheduler.schedulers.background import BackgroundScheduler
import logging

from database import init_db
from routes import router
from scheduler import start_dart_polling

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("DART service starting up...")
    init_db()
    scheduler.start()
    start_dart_polling(scheduler)
    logger.info("DART polling scheduler started")
    yield
    logger.info("DART service shutting down...")
    scheduler.shutdown()


app = FastAPI(
    title="DART Tracker API",
    description=(
        "Real-time DART arrival tracking using the Irish Rail API. "
        "Covers all stations from Greystones to Malahide/Howth. "
        "Only DART services are returned — Intercity and Commuter trains are filtered out."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "dart-tracker"}
