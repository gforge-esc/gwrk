# Contract: Health Endpoint

**Feature**: 002-build-server

## `GET /health`

**Consumed by**: CLI `gwrk server start` status check.

**Returns**:
```json
{
  "status": "ok",
  "components": {
    "server": "ok",
    "slack": "ok",
    "network": "ok"
  }
}
```
