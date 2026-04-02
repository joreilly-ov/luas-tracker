# User Documentation (Generated)

This file is generated from executable code and test runs, not handwritten notes.

- Generated at (UTC): 2026-04-02T14:17:58Z
- Git commit: 62d2f8b

## Frontend Routes

- **/** -> Index
- **/hours** -> OperatingHours
- **/metrics** -> Metrics
- **/tetris** -> Tetris
- **/dart** -> Dart
- **\*** -> NotFound

## Luas Backend API

- API title: Generated API
- API version: generated

### Endpoints

- **POST /accuracy/calculate** - Calculate Accuracy
- **GET /accuracy/summary** - Get Accuracy Summary
  - param stop_code (query, optional)
  - param hours (query, optional)
- **GET /arrivals/{stop_code}** - Get Arrivals
  - param stop_code (path, required)
  - param limit (query, optional)
- **GET /arrivals/cabra** - Get Cabra Arrivals
  - param limit (query, optional)
- **GET /dart/arrivals/{station_code}** - Dart Arrivals
  - param station_code (path, required)
  - param limit (query, optional)
- **GET /dart/stations** - Dart Stations
- **GET /debug/accuracy/by-stop** - Debug Accuracy By Stop
- **GET /debug/accuracy/count** - Debug Accuracy Count
- **GET /debug/accuracy/stops-summary** - Debug Accuracy Stops Summary
- **GET /debug/database** - Debug Database
- **GET /debug/data-collection** - Debug Data Collection
- **GET /debug/snapshots/transitions** - Debug Snapshot Transitions
  - param stop_code (query, optional)
  - param minutes (query, optional)
- **GET /metrics/accuracy** - Get Accuracy Metrics
  - param stop_code (query, optional)
  - param hours (query, optional)
- **GET /stops** - Get Stops

## DART Service API

- API title: Generated API
- API version: generated

### Endpoints

- **GET /accuracy/summary** - Get Accuracy Summary
  - param station_code (query, optional)
  - param hours (query, optional)
- **GET /arrivals/{station_code}** - Get Arrivals
  - param station_code (path, required)
  - param limit (query, optional)
- **GET /debug/data-collection** - Debug Data Collection
- **GET /stations** - Get Stations

## Test Verification

- **Backend pytest:** FAIL (exit code: 2)
  - Log: docs/generated/backend-tests.txt
- **DART service pytest:** FAIL (exit code: 2)
  - Log: docs/generated/dart-service-tests.txt
- **Frontend vitest:** PASS (exit code: 0)
  - Log: docs/generated/frontend-tests.txt

## Notes

- Source of truth for APIs: OpenAPI generated from FastAPI app objects.
- Source of truth for UI routes: parsed from frontend/src/App.tsx.
- Source of truth for behavior checks: test command exit codes and logs.

