# API Contract: POST /api/notify

Endpoint for external tools (like `agent-run.sh` or CI scripts) to trigger Slack notifications via the Build Server.

## Request

**Method**: `POST`
**Path**: `/api/notify`
**Content-Type**: `application/json`

### Body Schema

```typescript
interface NotifyPayload {
  type: "phase_start" | "phase_complete" | "phase_fail" | "ci_result" | "review_ready" | "done_done";
  feature: string;            // Feature ID (e.g., 001-cli-core)
  phase?: string;              // Phase ID (e.g., phase-01)
  backend?: string;            // Agent backend used
  branch?: string;             // Git branch name
  error?: string;              // Error message (for phase_fail or ci_result)
  gateResults?: string;        // Summary of gate results (for ci_result)
  prUrl?: string;              // Pull Request URL
  prNumber?: number;           // Pull Request number
  opsOnly?: boolean;           // If true, route only to the OPS/Master channel
}
```

## Response

### Success (200 OK)

```json
{
  "ok": true
}
```

### Validation Error (400 Bad Request)

Returned if `type` or `feature` is missing, or if `type` is unknown.

```json
{
  "ok": false,
  "error": "Missing required fields: type and feature are required"
}
```

### Server Error (500 Internal Server Error)

Returned if notification dispatch fails.

```json
{
  "ok": false,
  "error": "Failed to dispatch notification: <error message>"
}
```

## Implementation Notes

1. **Pillar Alignment**: This endpoint supports the **Throughput** (Ship) pillar by providing real-time visibility into autonomous implementation loops.
2. **Channel Routing**:
   - By default, notifications are routed to the project-specific channel configured in `.gwrkrc.json`.
   - If `opsOnly: true` or `type: "done_done"`, the notification is routed to the Master/Ops channel.
3. **Presence Awareness**: The build server may delay delivery if the user is away, batching multiple events for when they return.
