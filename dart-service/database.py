from sqlalchemy import create_engine, Column, Integer, String, DateTime, Float
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import os
from dotenv import load_dotenv

load_dotenv()

# Separate database from Luas — never share state between services
DATABASE_URL = os.getenv("DART_DATABASE_URL", "sqlite:///./dart_tracker.db")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if "sqlite" in DATABASE_URL:
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


class DartSnapshot(Base):
    """
    Raw snapshot of Irish Rail real-time data for DART trains, captured at a point in time.
    Filters out all non-DART services (Intercity, Commuter, etc.) at parse time.
    """
    __tablename__ = "dart_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    station_code = Column(String, index=True)       # e.g. "BROCK" for Blackrock
    train_code = Column(String, index=True)          # Irish Rail train code e.g. "E123"
    origin = Column(String)                          # Train's origin station
    destination = Column(String)                     # Train's final destination
    direction = Column(String)                       # "Northbound" or "Southbound"
    due_in_minutes = Column(Integer)                 # Minutes until arrival at this station
    minutes_late = Column(Integer, default=0)        # How late (0 = on time)
    expected_arrival = Column(String)                # Expected arrival time "HH:MM"
    status = Column(String)                          # e.g. "En Route", "No Information"
    last_location = Column(String, nullable=True)    # Last known location of train
    recorded_at = Column(DateTime, default=datetime.utcnow, index=True)

    def __repr__(self):
        return f"<DartSnapshot station={self.station_code} train={self.train_code} due={self.due_in_minutes}m>"


class DartAccuracy(Base):
    """
    Calculated accuracy metrics for DART forecasts.
    Mirrors the Luas accuracy approach: compare past forecasts to estimated actual arrivals.
    """
    __tablename__ = "dart_accuracy"

    id = Column(Integer, primary_key=True, index=True)
    station_code = Column(String, index=True)
    train_code = Column(String)
    origin = Column(String)
    destination = Column(String)
    direction = Column(String)
    forecasted_minutes = Column(Integer)
    actual_minutes = Column(Integer)
    accuracy_delta = Column(Integer)    # Negative = early, positive = late
    minutes_late_reported = Column(Integer, default=0)  # What the API said at forecast time
    calculated_at = Column(DateTime, default=datetime.utcnow, index=True)

    def __repr__(self):
        status = "early" if self.accuracy_delta < 0 else "late" if self.accuracy_delta > 0 else "on time"
        return f"<DartAccuracy {self.destination} was {abs(self.accuracy_delta)}m {status}>"


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
