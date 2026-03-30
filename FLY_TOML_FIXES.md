# Fly.io Configuration Fixes

**Status:** ✅ Implemented  
**Date:** March 30, 2026  
**Files Modified:** `fly.toml` (Luas backend), `fly.toml` (DART service - no changes needed)

---

## Summary of Changes

### Luas Backend (`fly.toml`)

**Changed:** 3 critical settings to ensure APScheduler polling runs continuously

| Setting | Before | After | Reason |
|---------|--------|-------|--------|
| `primary_region` | `iad` (Virginia) | `dub` (Dublin) | Reduce latency for Dublin users |
| `auto_stop_machines` | `'stop'` | `false` | Keep scheduler running 24/7 |
| `min_machines_running` | 0 | 1 | Always maintain at least 1 instance |

**Also Added:**
- Health check endpoint configuration (runs every 30s)
- Enhanced comments explaining why settings matter for APScheduler

---

## Before & After Comparison

### BEFORE (Problematic):
```toml
app = 'luas-tracker'
primary_region = 'iad'  # ❌ Virginia — adds 100+ ms latency

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'stop'    # ❌ Scheduler stops when idle!
  auto_start_machines = true
  min_machines_running = 0        # ❌ Can spin down to zero
  processes = ['app']
```

### AFTER (Fixed):
```toml
app = 'luas-tracker'
primary_region = 'dub'  # ✅ Dublin — ~20 ms latency

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false     # ✅ Scheduler always runs
  auto_start_machines = true
  min_machines_running = 1        # ✅ Always one instance warm
  processes = ['app']
  
  [[http_service.checks]]         # ✅ New: Health monitoring
    path = "/health"
    interval = "30s"
    timeout = "5s"
```

---

## Impact Analysis

### 1. Region Change: `iad` → `dub`

**Latency Improvement:**
- **Before:** Virginia to Dublin = ~100-150 ms round-trip
- **After:** Dublin to Dublin = ~5-20 ms round-trip
- **Improvement:** ~80-130 ms faster for all API calls

**User Experience:**
- Frontend loads faster
- API responses return quicker
- Better user experience for Irish users

### 2. Auto-Stop Machines: `'stop'` → `false`

**Problem Solved:**
```
BEFORE: 
  User idle 30+ minutes 
    → Fly.io spins down machine 
    → APScheduler polling PAUSES 
    → 30-60 minute data gap 
    → Forecast data stale when user returns

AFTER:
  User idle 30+ minutes 
    → Machine stays warm 
    → APScheduler polls every 30-60s CONTINUOUSLY
    → Fresh data always available
```

**Cost Trade-off:**
- 1 GB shared machine in Dublin runs 24/7
- Fly.io cost: ~$0.015/hour = ~$0.36/day = ~$11/month
- Trade-off: Worth it for continuous data collection

### 3. Min Machines: `0` → `1`

**Reliability:**
- Before: Could spin down to zero (cold start = 30-60s startup latency)
- After: Always one instance warm and ready
- Better for scheduled background jobs

---

## API Health Checks Configuration

**New Addition:**
```toml
[[http_service.checks]]
  path = "/health"
  interval = "30s"
  timeout = "5s"
```

**What This Does:**
- Fly.io pings `/health` endpoint every 30 seconds
- If no response within 5s, considers instance unhealthy
- Automatically restarts unhealthy instances
- Ensures continuous polling operation

**Verification:**
The backend already has the health endpoint:
```python
@app.get("/health")
async def health_check():
    return {"status": "ok"}
```

---

## DART Service Configuration

**Status:** ✅ Already Correct

The DART service `dart-service/fly.toml` was already properly configured:
- ✅ Region: `dub` (Dublin)
- ✅ auto_stop_machines: `false`
- ✅ min_machines_running: 1
- ✅ Health checks configured

No changes needed to DART service.

---

## Deployment Instructions

### To Deploy Updated Configuration

```bash
# From project root
cd c:\Users\joreilly\joe-luas\luas-tracker

# Deploy Luas backend with new configuration
fly deploy

# Confirm deployment
fly status
fly logs --lines=50
```

### Verify Settings

```bash
# Check if running in DUB region
fly status

# Expected output:
# App Name     = luas-tracker
# Owner        = your-org
# Deployed     = ~now
# Status       = running
# Platform     = machines
# 
# Instances
# ID       PROCESS VERSION REGION DESIRED STATUS  HEALTH CHECKS      RESTARTS CREATED
# abc123   app     123     dub    run     running 1 passing          0        5m ago
```

---

## Monitoring Schedule Changes

After deployment, monitoring this schedule:

**Luas Polling (should run continuously now):**
- Every 30s: Polls 12 Luas stops
- Every 1m: Calculates accuracy metrics
- ✅ Should work 24/7 with no gaps

**DART Polling (no changes, already working):**
- Every 60s: Polls 20 DART stations
- Every 2m: Calculates accuracy metrics
- ✅ Already in Dublin region

---

## Before/After Behavior Example

### Scenario: User Returns After 1 Hour Idle

**BEFORE (Broken):**
```
Time 0:00 - User closes app
  Machine: Runs normally
  Polling: ✅ Active (12 stops/min, 20 stations/min)

Time 0:30 - No HTTP requests for 30 minutes
  Fly.io: "No activity detected, scaling down..."
  Machine: STOPS
  Polling: ❌ PAUSES

Time 1:00 - User opens app
  Fly.io: "Wake up! Cold start..."
  Machine: Starting (takes 30-60 seconds)
  Polling: Still paused...
  Data Shown: 60-minute old forecasts! 😞

Time 1:01 - Machine fully started
  Polling: ✅ Resumes normally
```

**AFTER (Fixed):**
```
Time 0:00 - User closes app
  Machine: Running (min_machines_running = 1)
  Polling: ✅ Active every 30-60s

Time 0:30 - No HTTP requests for 30 minutes
  Fly.io: "auto_stop_machines=false, keep running"
  Machine: Still warm
  Polling: ✅ CONTINUES (38 polls collected)

Time 1:00 - User opens app
  Fly.io: "Request incoming..."
  Machine: Already warm (no startup delay)
  Polling: ✅ Already running, fresh data!
  Data Shown: Current forecasts (< 1 min old) 😊

Time 1:01 - API responds
  Total load time: < 1 second
```

---

## Cost Implications

### Current Costs (Estimated)

**Fly.io Compute:**
- Luas backend: 1 GB machine × 24 hours × $0.015/hour = $0.36/day
- DART service: 256 MB machine × 24 hours × $0.01/hour = $0.24/day
- **Total: ~$0.60/day = ~$18/month**

**Databases (Neon):**
- Free tier (with usage limits)
- Cost when exceeded: ~$0.15 per 1M stored bytes

**Bandwidth:**
- Typically free for US/EU egress
- Slight increase due to health checks (negligible)

**Overall:** Very affordable for a personal/learning project

---

## Checklist

- [x] Changed `primary_region` from `iad` to `dub`
- [x] Changed `auto_stop_machines` from `'stop'` to `false`
- [x] Changed `min_machines_running` from `0` to `1`
- [x] Added health check configuration
- [x] Added explanatory comments
- [x] Verified DART service was already correct
- [x] Ready to deploy

## Next Steps

1. **Review changes** — confirm fly.toml looks good
2. **Deploy** — `fly deploy` from project root
3. **Verify** — Check `fly status` shows DUB region, running state
4. **Monitor** — Watch logs for 5-10 minutes to ensure health checks pass
5. **Test** — Close your app for 30+ minutes, then reopen and verify fresh data

---

## Rollback Plan (if needed)

If something goes wrong, you can rollback quickly:

```bash
# Revert to previous deployment
fly releases
#   v123    Deploy (current)
#   v122    Earlier deployment

fly releases rollback 122
```

Or manually revert the fly.toml and deploy again.

---

## References

- [Fly.io Machine Configuration](https://fly.io/docs/reference/configuration/)
- [Auto Scaling & Standby Machines](https://fly.io/docs/machines/guides/auto-start-stop/)
- [Health Checks Configuration](https://fly.io/docs/reference/configuration/#http-service-checks)
- [Billing & Cost](https://fly.io/docs/about/pricing/)

---

*Updated: March 30, 2026 | Ready to Deploy*
