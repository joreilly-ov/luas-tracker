from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from datetime import datetime, timedelta
from typing import List, Optional
from pydantic import BaseModel
import logging

from database import get_db, DartSnapshot, DartAccuracy

logger = logging.getLogger(__name__)

router = APIRouter()

# All DART stations in route order: Greystones ↔ Malahide / Howth
# Station codes are Irish Rail codes as used in their real-time API.
# The line splits at Howth Junction — northbound services go to either Malahide or Howth.
DART_STATIONS = {
    # --- Greystones branch (southernmost) ---
    "GRYST":  {"name": "Greystones",              "zone": "south"},
    "SNKLL":  {"name": "Shankill",                "zone": "south"},
    "KLNY":   {"name": "Killiney",                "zone": "south"},
    "DLKEY":  {"name": "Dalkey",                  "zone": "south"},
    "SDCVE":  {"name": "Sandycove & Glasthule",   "zone": "south"},
    "GLNGY":  {"name": "Glenageary",              "zone": "south"},
    "DLGRE":  {"name": "Dún Laoghaire",           "zone": "south"},
    "SLTH":   {"name": "Salthill & Monkstown",    "zone": "south"},
    "SEAPT":  {"name": "Seapoint",                "zone": "south"},
    "BROCK":  {"name": "Blackrock",               "zone": "south"},
    "BTSTN":  {"name": "Booterstown",             "zone": "south"},
    "SYDPRD": {"name": "Sydney Parade",           "zone": "south"},
    "SDMNT":  {"name": "Sandymount",              "zone": "south"},
    # --- City centre ---
    "LNDN":   {"name": "Lansdowne Road",          "zone": "city"},
    "GCDK":   {"name": "Grand Canal Dock",        "zone": "city"},
    "PERSE":  {"name": "Pearse",                  "zone": "city"},
    "TARA":   {"name": "Tara Street",             "zone": "city"},
    "CNLLY":  {"name": "Connolly",                "zone": "city"},
    # --- North Dublin ---
    "CNTRF":  {"name": "Clontarf Road",           "zone": "north"},
    "KILBK":  {"name": "Kilbarrack",              "zone": "north"},
    "RAHNY":  {"name": "Raheny",                  "zone": "north"},
    "HRMST":  {"name": "Harmonstown",             "zone": "north"},
    "BYSDE":  {"name": "Bayside",                 "zone": "north"},
    # --- Junction: splits to Howth and Malahide ---
    "HWTHJ":  {"name": "Howth Junction & Donaghmede", "zone": "north"},
    # Howth branch
    "SUTT":   {"name": "Sutton",                  "zone": "north"},
    "HWTH":   {"name": "Howth",                   "zone": "north"},
    # Malahide branch
    "PMRCK":  {"name": "Portmarnock",             "zone": "north"},
    "MHIDE":  {"name": "Malahide",                "zone": "north"},
}


class ArrivalResponse(BaseModel):
    train_code: str
    origin: str
    destination: str
    direction: str
    due_in_minutes: int
    minutes_late: int
    expected_arrival: str
    status: str
    last_location: str

    class Config:
        from_attributes = True


class StationArrivalsResponse(BaseModel):
    station_code: str
    station_name: str
    last_updated: str
    next_arrivals: List[ArrivalResponse]


@router.get("/stations")
async def get_stations():
    """
    Return all DART stations grouped by zone (south / city / north).
    """
    by_zone: dict = {"south": [], "city": [], "north": []}
    for code, info in DART_STATIONS.items():
        by_zone[info["zone"]].append({"code": code, "name": info["name"], "zone": info["zone"]})
    return {"stations": by_zone}


@router.get("/arrivals/{station_code}", response_model=StationArrivalsResponse)
async def get_arrivals(station_code: str, db: Session = Depends(get_db), limit: int = 5):
    """
    Return the next DART arrivals at a station from the most recent poll.

    Parameters:
    - station_code: Irish Rail station code (e.g. BROCK, CNTRF, CNLLY)
    - limit: Number of arrivals to return (default 5)
    """
    station_code = station_code.upper()

    if station_code not in DART_STATIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown station code: {station_code}. See /stations for valid codes."
        )

    try:
        latest_recorded_at = db.query(func.max(DartSnapshot.recorded_at)).filter(
            DartSnapshot.station_code == station_code
        ).scalar()

        if not latest_recorded_at:
            return StationArrivalsResponse(
                station_code=station_code,
                station_name=DART_STATIONS[station_code]["name"],
                last_updated=datetime.utcnow().isoformat(),
                next_arrivals=[]
            )

        snapshots = db.query(DartSnapshot).filter(
            DartSnapshot.station_code == station_code,
            DartSnapshot.recorded_at >= latest_recorded_at - timedelta(seconds=1),
            DartSnapshot.recorded_at <= latest_recorded_at + timedelta(seconds=1),
        ).order_by(DartSnapshot.due_in_minutes).limit(limit).all()

        arrivals = [
            ArrivalResponse(
                train_code=s.train_code,
                origin=s.origin,
                destination=s.destination,
                direction=s.direction,
                due_in_minutes=s.due_in_minutes,
                minutes_late=s.minutes_late,
                expected_arrival=s.expected_arrival,
                status=s.status,
                last_location=s.last_location or "",
            )
            for s in snapshots
        ]

        return StationArrivalsResponse(
            station_code=station_code,
            station_name=DART_STATIONS[station_code]["name"],
            last_updated=latest_recorded_at.isoformat(),
            next_arrivals=arrivals
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/accuracy/summary")
async def get_accuracy_summary(
    db: Session = Depends(get_db),
    station_code: str = "BROCK",
    hours: Optional[int] = None
):
    """
    Forecast accuracy metrics for a station.

    Parameters:
    - station_code: Station code (default BROCK for Blackrock)
    - hours: Hours to look back (omit for all-time data)
    """
    station_code = station_code.upper()

    try:
        cutoff = datetime.utcnow() - timedelta(hours=hours) if hours is not None else None

        base_query = db.query(
            DartAccuracy.destination,
            DartAccuracy.direction,
            func.count(DartAccuracy.id).label("count"),
            func.avg(DartAccuracy.accuracy_delta).label("avg_delta"),
            func.min(DartAccuracy.accuracy_delta).label("min_delta"),
            func.max(DartAccuracy.accuracy_delta).label("max_delta"),
            func.avg(DartAccuracy.minutes_late_reported).label("avg_late_reported"),
        ).filter(DartAccuracy.station_code == station_code)

        if cutoff:
            base_query = base_query.filter(DartAccuracy.calculated_at >= cutoff)

        rows = base_query.group_by(DartAccuracy.destination, DartAccuracy.direction).all()

        if not rows:
            return {
                "station_code": station_code,
                "period_hours": hours,
                "message": f"No accuracy data for {station_code} yet",
                "data": []
            }

        return {
            "station_code": station_code,
            "period_hours": hours,
            "data": [
                {
                    "destination": row.destination,
                    "direction": row.direction,
                    "measurements": row.count,
                    "avg_accuracy_minutes": round(row.avg_delta, 2),
                    "best_case_minutes": row.min_delta,
                    "worst_case_minutes": row.max_delta,
                    "avg_late_reported": round(row.avg_late_reported, 2),
                }
                for row in rows
            ]
        }

    except Exception as e:
        logger.error(f"Error in accuracy/summary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/debug/data-collection")
async def debug_data_collection(db: Session = Depends(get_db)):
    """Check whether background polling is active and writing data."""
    try:
        latest = db.query(DartSnapshot).order_by(desc(DartSnapshot.recorded_at)).first()

        if not latest:
            return {
                "status": "no_data",
                "healthy": False,
                "message": "No data collected yet — polling may not have started",
                "last_poll": None,
                "seconds_ago": None,
            }

        seconds_ago = (datetime.utcnow() - latest.recorded_at).total_seconds()
        is_healthy = seconds_ago < 180  # poll interval is 60s; allow 3× slack

        return {
            "status": "healthy" if is_healthy else "stale",
            "healthy": is_healthy,
            "message": "Data collection active" if is_healthy else f"Last poll was {int(seconds_ago)}s ago",
            "last_poll": latest.recorded_at.isoformat(),
            "seconds_ago": int(seconds_ago),
            "last_station_polled": latest.station_code,
            "polling_interval_seconds": 60,
        }

    except Exception as e:
        return {"status": "error", "healthy": False, "message": str(e)}
