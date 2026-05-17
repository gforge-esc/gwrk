# Contract: Status Endpoint

**Feature**: 002-build-server

## `GET /api/status`

**Consumed by**: CLI `gwrk status`.

**Returns**:
```json
{
  "server": {
    "status": "ok",
    "lifecycle": "ready",
    "pid": 12345,
    "port": 18790
  },
  "system": {
    "cpuPercent": 15,
    "memPercent": 45,
    "diskFreeGb": 120
  },
  "network": {
    "status": "online"
  },
  "dispatch": {
    "queueDepth": 0,
    "activeCount": 1
  }
}
```
