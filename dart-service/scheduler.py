import asyncio
import logging
from datetime import datetime, timedelta
from collections import defaultdict
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session

from dart_client import fetch_dart_arrivals, DartAPIError
from database import SessionLocal, DartSnapshot, DartAccuracy

logger = logging.getLogger(__name__)

# All DART station codes to poll.
# Trains run every 10-15 min peak / 20-30 min off-peak, so 60-second polling
# gives good resolution without hammering the Irish Rail API.
DART_STATIONS_TO_POLL = [
    "GRYST",   # Greystones
    "KLNY",    # Killiney
    "DLKEY",   # Dalkey
    "DLGRE",   # Dún Laoghaire
    "BROCK",   # Blackrock
    "BTSTN",   # Booterstown
    "SDMNT",   # Sandymount
    "LNDN",    # Lansdowne Road
    "GCDK",    # Grand Canal Dock
    "PERSE",   # Pearse
    "TARA",    # Tara Street
    "CNLLY",   # Connolly
    "CNTRF",   # Clontarf Road
    "RAHNY",   # Raheny
    "BYSDE",   # Bayside
    "HWTHJ",   # Howth Junction & Donaghmede
    "SUTT",    # Sutton
    "HWTH",    # Howth
    "PMRCK",   # Portmarnock
    "MHIDE",   # Malahide
]


def poll_dart_and_store():
    """
    Background job that runs every 60 seconds.
    Fetches the latest DART arrivals for all configured stations and stores them.
    """
    total_stored = 0

    for station_code in DART_STATIONS_TO_POLL:
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            arrivals = loop.run_until_complete(fetch_dart_arrivals(station_code))
            loop.close()

            db = SessionLocal()
            try:
                for arrival in arrivals:
                    snapshot = DartSnapshot(
                        station_code=station_code,
                        train_code=arrival["train_code"],
                        origin=arrival["origin"],
                        destination=arrival["destination"],
                        direction=arrival["direction"],
                        due_in_minutes=arrival["due_in_minutes"],
                        minutes_late=arrival["minutes_late"],
                        expected_arrival=arrival["expected_arrival"],
                        status=arrival["status"],
                        last_location=arrival["last_location"],
                        recorded_at=datetime.utcnow(),
                    )
                    db.add(snapshot)

                db.commit()
                total_stored += len(arrivals)
                logger.info(f"Stored {len(arrivals)} DART arrivals for {station_code}")

            except Exception as e:
                db.rollback()
                logger.error(f"Error storing arrivals for {station_code}: {e}")
            finally:
                db.close()

        except DartAPIError as e:
            logger.error(f"DART API error for {station_code}: {e}")
        except Exception as e:
            logger.error(f"Unexpected error polling {station_code}: {e}")

    if total_stored > 0:
        logger.info(f"DART polling cycle complete: stored {total_stored} total arrivals")


def calculate_accuracy_from_snapshots():
    """
    Accuracy calculation job that runs every 2 minutes.

    Tracks individual trains across polls using train_code + station as the key.
    When a forecast decrements by 1 (e.g. 3→2, 2→1, 1→0), we record the delta
    between the forecast and the elapsed real time.

    DART trains are less frequent than Luas trams so we use a looser 3-minute
    gap threshold between polls (vs 2 minutes for Luas).
    """
    logger.info("=== DART ACCURACY CALCULATION STARTED ===")
    try:
        db = SessionLocal()
        two_hours_ago = datetime.utcnow() - timedelta(hours=2)

        recent_snapshots = db.query(DartSnapshot).filter(
            DartSnapshot.recorded_at >= two_hours_ago
        ).all()

        logger.info(f"Accuracy calc: {len(recent_snapshots)} snapshots from last 2 hours")

        if not recent_snapshots:
            db.close()
            return

        # Group by (station, train_code, destination, direction) + 5-min arrival bucket
        train_history = defaultdict(list)
        for snap in recent_snapshots:
            # Bucket arrival time to 5-minute windows to group the same physical train
            arrival_estimate = snap.recorded_at + timedelta(minutes=snap.due_in_minutes)
            arrival_estimate = arrival_estimate.replace(second=0, microsecond=0)
            bucket_minute = (arrival_estimate.minute // 5) * 5
            arrival_estimate = arrival_estimate.replace(minute=bucket_minute)

            key = (snap.station_code, snap.train_code, snap.destination, snap.direction, arrival_estimate)
            train_history[key].append(snap)

        logger.info(f"Grouped into {len(train_history)} unique train instances")

        accuracy_count = 0

        for (station_code, train_code, destination, direction, _), polls in train_history.items():
            polls.sort(key=lambda x: x.recorded_at)

            if len(polls) < 2:
                continue

            for i in range(1, len(polls)):
                prev = polls[i - 1]
                curr = polls[i]

                time_between_polls = (curr.recorded_at - prev.recorded_at).total_seconds() / 60

                # Skip if polls are too far apart — likely missed polls, not same train window
                if time_between_polls > 3:
                    continue

                # Track small forecast decrements (same logic as Luas scheduler)
                is_arrival = False
                if prev.due_in_minutes == 1 and curr.due_in_minutes == 0:
                    is_arrival = True
                elif prev.due_in_minutes == 2 and curr.due_in_minutes == 1:
                    is_arrival = True
                elif prev.due_in_minutes == 3 and curr.due_in_minutes == 2:
                    is_arrival = True

                if not is_arrival:
                    continue

                estimated_actual_minutes = time_between_polls / 2
                accuracy_delta = int(round(estimated_actual_minutes - prev.due_in_minutes))

                if abs(accuracy_delta) > 3:
                    continue

                # Avoid duplicates within the last 3 minutes
                existing = db.query(DartAccuracy).filter(
                    DartAccuracy.station_code == station_code,
                    DartAccuracy.train_code == train_code,
                    DartAccuracy.direction == direction,
                    DartAccuracy.destination == destination,
                    DartAccuracy.forecasted_minutes == prev.due_in_minutes,
                    DartAccuracy.calculated_at >= datetime.utcnow() - timedelta(minutes=3),
                ).first()

                if existing:
                    continue

                accuracy_record = DartAccuracy(
                    station_code=station_code,
                    train_code=train_code,
                    origin=prev.origin,
                    destination=destination,
                    direction=direction,
                    forecasted_minutes=prev.due_in_minutes,
                    actual_minutes=int(round(estimated_actual_minutes)),
                    accuracy_delta=accuracy_delta,
                    minutes_late_reported=prev.minutes_late,
                    calculated_at=datetime.utcnow(),
                )
                db.add(accuracy_record)
                accuracy_count += 1

                status = "on time" if accuracy_delta == 0 else f"{abs(accuracy_delta)}m {'early' if accuracy_delta < 0 else 'late'}"
                logger.info(
                    f"DART accuracy: {train_code} {destination} ({direction}) at {station_code} "
                    f"forecast {prev.due_in_minutes}m, actual ~{int(round(estimated_actual_minutes))}m ({status})"
                )

        if accuracy_count > 0:
            db.commit()
            logger.info(f"Committed {accuracy_count} DART accuracy records")
        else:
            logger.info("No new accuracy records this cycle")

        db.close()
        logger.info("=== DART ACCURACY CALCULATION COMPLETE ===")

    except Exception as e:
        logger.error(f"DART accuracy calculation failed: {type(e).__name__}: {e}", exc_info=True)
        if "db" in locals():
            try:
                db.rollback()
                db.close()
            except Exception:
                pass


def start_dart_polling(scheduler: BackgroundScheduler):
    """Register DART background jobs with the scheduler."""
    logger.info("=" * 60)
    logger.info("DART SCHEDULER STARTUP")
    logger.info("=" * 60)

    scheduler.add_job(
        poll_dart_and_store,
        "interval",
        seconds=60,
        id="dart_polling",
        name="Poll Irish Rail API for DART arrivals",
        replace_existing=True,
    )
    logger.info("DART polling job scheduled (every 60 seconds)")

    scheduler.add_job(
        calculate_accuracy_from_snapshots,
        "interval",
        minutes=2,
        id="dart_accuracy",
        name="Calculate DART forecast accuracy",
        replace_existing=True,
    )
    logger.info("DART accuracy job scheduled (every 2 minutes)")

    for job in scheduler.get_jobs():
        logger.info(f"  Registered: {job.id} — next run: {job.next_run_time}")

    logger.info("=" * 60)
