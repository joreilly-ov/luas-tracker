import httpx
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
import logging
from typing import List, Dict

logger = logging.getLogger(__name__)

IRISH_RAIL_API_URL = "https://api.irishrail.ie/realtime/realtime.asmx/getStationDataByCodeXML"

# XML namespace used by the Irish Rail API in all response documents
IRISHRAIL_NS = "http://api.irishrail.ie/realtime/"


class DartAPIError(Exception):
    """Raised when the Irish Rail API call fails or returns unexpected data."""
    pass


async def fetch_dart_arrivals(station_code: str) -> List[Dict]:
    """
    Fetch real-time DART arrivals for a given station from the Irish Rail API.

    Filters out all non-DART services (Intercity, Commuter, etc.) so only
    DART trains are returned.

    Returns a list of dicts with:
    - train_code:        Irish Rail train identifier (e.g. "E123")
    - origin:            Train's starting station
    - destination:       Train's final destination
    - direction:         "Northbound" or "Southbound"
    - due_in_minutes:    Minutes until arrival (0 = due now)
    - minutes_late:      How many minutes late (0 = on time)
    - expected_arrival:  Expected arrival time string "HH:MM"
    - status:            Train status e.g. "En Route"
    - last_location:     Last known location of the train
    """
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(
                IRISH_RAIL_API_URL,
                params={"StationCode": station_code}
            )
            response.raise_for_status()
            return parse_dart_xml(response.text, station_code)

    except httpx.HTTPError as e:
        logger.error(f"HTTP error fetching DART data for {station_code}: {e}")
        raise DartAPIError(f"Failed to fetch Irish Rail API for {station_code}: {e}")
    except Exception as e:
        logger.error(f"Unexpected error fetching DART data for {station_code}: {e}")
        raise DartAPIError(f"Unexpected error: {e}")


def _tag(name: str) -> str:
    """Build a namespaced tag string for ElementTree queries."""
    return f"{{{IRISHRAIL_NS}}}{name}"


def _get_text(element, tag: str, default: str = "") -> str:
    """Safely extract text content from a namespaced child element."""
    child = element.find(_tag(tag))
    if child is not None and child.text:
        return child.text.strip()
    return default


def parse_dart_xml(xml_content: str, station_code: str) -> List[Dict]:
    """
    Parse XML response from the Irish Rail real-time API.

    Expected structure (with namespace http://api.irishrail.ie/realtime/):
    <ArrayOfObjStationData>
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
        ...
      </objStationData>
    </ArrayOfObjStationData>

    Only entries with Traintype == "DART" are included.
    """
    arrivals = []

    try:
        root = ET.fromstring(xml_content)
        logger.info(f"Parsing Irish Rail XML for {station_code}, root tag: {root.tag}")

        train_elements = root.findall(_tag("objStationData"))
        logger.info(f"Found {len(train_elements)} train entries for {station_code}")

        for idx, train_elem in enumerate(train_elements):
            try:
                traintype = _get_text(train_elem, "Traintype")

                # Only process DART services — skip Intercity, Commuter, etc.
                if traintype.upper() != "DART":
                    logger.debug(f"Skipping non-DART train (type={traintype}) at {station_code}")
                    continue

                train_code = _get_text(train_elem, "Traincode")
                origin = _get_text(train_elem, "Origin")
                destination = _get_text(train_elem, "Destination")
                direction = _get_text(train_elem, "Direction")
                due_in_str = _get_text(train_elem, "Duein", "0")
                late_str = _get_text(train_elem, "Late", "0")
                expected_arrival = _get_text(train_elem, "Exparrival")
                status = _get_text(train_elem, "Status")
                last_location = _get_text(train_elem, "Lastlocation")

                try:
                    due_in_minutes = int(due_in_str)
                except ValueError:
                    logger.warning(f"Invalid Duein value '{due_in_str}' for train {train_code}, defaulting to 0")
                    due_in_minutes = 0

                try:
                    minutes_late = int(late_str)
                except ValueError:
                    minutes_late = 0

                arrivals.append({
                    "train_code": train_code,
                    "origin": origin,
                    "destination": destination,
                    "direction": direction,
                    "due_in_minutes": due_in_minutes,
                    "minutes_late": minutes_late,
                    "expected_arrival": expected_arrival,
                    "status": status,
                    "last_location": last_location,
                })

                logger.info(
                    f"DART train {train_code}: {origin} → {destination} "
                    f"({direction}) due in {due_in_minutes}m"
                    + (f", {minutes_late}m late" if minutes_late else "")
                )

            except Exception as e:
                logger.warning(f"Failed to parse train element {idx} at {station_code}: {e}")
                continue

        logger.info(f"Parsed {len(arrivals)} DART arrivals for {station_code}")
        return arrivals

    except ET.ParseError as e:
        logger.error(f"XML parse error for {station_code}: {e}")
        logger.error(f"Raw content (first 200 chars): {xml_content[:200]}")
        raise DartAPIError(f"Invalid XML from Irish Rail API for {station_code}: {e}")
