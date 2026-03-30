import httpx
import defusedxml.ElementTree as ET
from datetime import datetime, timedelta
import logging
from typing import List, Dict, Optional
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    retry_if_result,
)

logger = logging.getLogger(__name__)

LUAS_API_URL = "https://luasforecasts.rpa.ie/xml/get.ashx"
CABRA_STOP_CODE = "cab"

# Retry configuration: max 3 attempts with exponential backoff (1s, 2s, 4s)
_RETRY_ATTEMPTS = 3
_RETRY_MULTIPLIER = 1  # Base delay in seconds
_RETRY_MAX_WAIT = 8    # Max wait time between retries


class LuasAPIError(Exception):
    """Raised when Luas API call fails."""
    pass


def _should_retry_exception(exception: Exception) -> bool:
    """
    Determine if we should retry based on exception type.
    
    Retry on:
    - Connection errors (network issues)
    - Timeout errors
    - 5xx server errors
    
    Don't retry on:
    - 4xx client errors (invalid request, not found, etc.)
    """
    if isinstance(exception, httpx.HTTPStatusError):
        # Don't retry 4xx errors (client's fault)
        return exception.response.status_code >= 500
    
    # Retry on connection/timeout errors
    return isinstance(
        exception,
        (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError),
    )


@retry(
    stop=stop_after_attempt(_RETRY_ATTEMPTS),
    wait=wait_exponential(multiplier=_RETRY_MULTIPLIER, max=_RETRY_MAX_WAIT),
    retry=retry_if_exception_type((
        httpx.ConnectError,
        httpx.TimeoutException,
        httpx.NetworkError,
    )),
    reraise=True,
)
async def fetch_luas_forecast(stop_code: str = CABRA_STOP_CODE) -> List[Dict]:
    """
    Fetch real-time Luas forecasts for a given stop.
    
    Automatically retries up to 3 times with exponential backoff (1s, 2s, 4s max)
    on temporary network errors. Does not retry on 4xx client errors.
    
    Returns a list of dicts with:
    - destination: Final destination
    - direction: Inbound/Outbound
    - due_minutes: Minutes until arrival
    - due_time: Calculated arrival time (ISO format)
    """
    try:
        # Use follow_redirects=True to handle 301 redirects from HTTP to HTTPS
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            # Note: We're making the request from backend to work around CORS
            # The API may have IP/origin restrictions
            response = await client.get(
                LUAS_API_URL,
                params={
                    "action": "forecast",
                    "stop": stop_code,
                    "encrypt": "false"
                }
            )
            response.raise_for_status()
            
            logger.debug(f"Successfully fetched Luas forecast for stop {stop_code}")
            return parse_luas_xml(response.text)
    
    except (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError) as e:
        # These will trigger retries automatically
        logger.warning(f"Temporary error fetching Luas for {stop_code} (will retry): {type(e).__name__}: {e}")
        raise
    
    except httpx.HTTPStatusError as e:
        if e.response.status_code >= 500:
            # Server error - will retry
            logger.warning(f"Server error fetching Luas for {stop_code} ({e.response.status_code}, will retry): {e}")
            raise
        else:
            # Client error - don't retry
            logger.error(f"Client error fetching Luas for {stop_code} ({e.response.status_code}): {e}")
            raise LuasAPIError(f"Failed to fetch Luas API: {e}")
    
    except httpx.HTTPError as e:
        logger.error(f"HTTP error fetching Luas data: {e}")
        raise LuasAPIError(f"Failed to fetch Luas API: {e}")
    
    except Exception as e:
        logger.error(f"Unexpected error fetching Luas data: {e}")
        raise LuasAPIError(f"Unexpected error: {e}")


def parse_luas_xml(xml_content: str) -> List[Dict]:
    """
    Parse XML response from Luas API.
    
    Expected structure:
    <root>
      <message>
        <tram>
          <destination>...</destination>
          <direction>Inbound/Outbound</direction>
          <dueMinutes>X</dueMinutes>
          <dueTime>HH:MM</dueTime>
        </tram>
      </message>
    </root>
    """
    forecasts = []
    
    try:
        root = ET.fromstring(xml_content)
        
        # Debug: Always log raw XML for debugging
        logger.info(f"API Response (first 300 chars): {xml_content[:300]}")
        logger.info(f"Root tag: {root.tag}")
        
        # Navigate the XML structure - trams are inside <direction> elements
        # <stopInfo><direction name="Inbound"><tram dueMins="10" destination="Destination" /></direction></stopInfo>
        direction_count = len(root.findall("direction"))
        logger.info(f"Found {direction_count} direction elements")
        
        for direction_elem in root.findall("direction"):
            direction_name = direction_elem.get("name", "Unknown")
            tram_count_in_direction = len(direction_elem.findall("tram"))
            logger.info(f"Direction '{direction_name}' has {tram_count_in_direction} trams")
            
            for idx, tram in enumerate(direction_elem.findall("tram")):
                try:
                    # Get attributes from tram element
                    destination = tram.get("destination", "Unknown")
                    due_minutes_str = tram.get("dueMins", "0")
                    
                    logger.debug(f"Tram {idx+1} in {direction_name}: dest='{destination}', dueMins='{due_minutes_str}'")
                    
                    # Skip "No trams forecast" entries
                    if destination == "No trams forecast" or not destination or destination == "Unknown":
                        logger.debug(f"Skipping tram {idx+1}: destination is invalid")
                        continue
                    
                    # Handle dueMins - can be "DUE", a number, or empty
                    if due_minutes_str and due_minutes_str.upper() == "DUE":
                        due_minutes = 0
                    elif due_minutes_str:
                        try:
                            due_minutes = int(due_minutes_str)
                        except ValueError:
                            logger.warning(f"Invalid dueMins value: {due_minutes_str}, skipping tram")
                            continue
                    else:
                        due_minutes = 0
                    
                    # Calculate due time
                    due_time = datetime.now() + timedelta(minutes=due_minutes)
                    
                    forecasts.append({
                        "destination": destination,
                        "direction": direction_name,
                        "due_minutes": due_minutes,
                        "due_time": due_time.isoformat()
                    })
                    logger.info(f"✓ Parsed tram: {destination} ({direction_name}) in {due_minutes}m")
            
                except (ValueError, AttributeError) as e:
                    logger.warning(f"Failed to parse tram element {idx+1}: {e}")
                    continue
        
        logger.info(f"Total forecasts parsed: {len(forecasts)}")
        
        return forecasts
    
    except ET.ParseError as e:
        logger.error(f"XML parse error: {e}")
        logger.error(f"Attempted to parse: {xml_content[:200]}")
        raise LuasAPIError(f"Invalid XML response from Luas API: {e}")
