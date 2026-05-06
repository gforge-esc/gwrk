---
type: data_model
feature: 002-build-server
last_modified: "2026-03-11T14:30:00Z"
---

# Data Model: 002 Build Server

**Feature**: 002-build-server
**Date**: 2026-03-11

---

## DM-001: SQLite Execution Ledger (`~/.gwrk/gwrk.db`)

The build server is the primary writer for dispatch-related telemetry. It uses the `runs` and `history` tables defined in `001-cli-core`.

**Table: `runs`** (Key fields used by server):
- `feature_id`: string
- `phase_id`: string
- `command`: "dispatch"
- `agent_backend`: string
- `started_at`: ISO8601
- `finished_at`: ISO8601 (optional)
- `exit_code`: integer (optional)
- `log_file`: string (path to sandbox logs)

**Table: `history`** (Key fields used by server):
- `feature_id`: string
- `from_status`: string (e.g., "queued")
- `to_status`: string (e.g., "running")
- `run_id`: foreign key to `runs.id`

---

## DM-002: Server Config Extension (`.gwrkrc.json`)

Extends the `GwrkConfigSchema` from 001-cli-core. All fields MUST be explicit — no `.default()`.

```typescript
import { z } from 'zod';

const GwrkServerConfigSchema = z.object({
  server: z.object({
    port: z.number().int().min(1024).max(65535),
    host: z.string(),
    networkCheckIntervalMs: z.number().int().positive(),
    heartbeatIntervalMs: z.number().int().positive(),
  }),
  parallelism: z.object({
    local: z.object({
      maxClones: z.number().int().positive(),
      maxConcurrentSandboxes: z.number().int().positive(),
      maxCpu: z.number().min(1).max(100),
      maxMem: z.number().min(1).max(100),
      minDiskGb: z.number().positive(),
    }),
    cloud: z.object({
      maxConcurrent: z.number().int().positive(),
    }),
  }),
});
```

---

## DM-003: System Status & Sandbox Info

Runtime-only data models (not persisted). Returned by `GET /api/status` and `/health`.

```typescript
const SandboxInfoSchema = z.object({
  containerId: z.string(),
  featureId: z.string(),
  phaseId: z.string(),
  backend: z.string(),
  status: z.enum(['creating', 'running', 'paused', 'stopping', 'destroyed']),
  startedAt: z.string().datetime(),
});

const SystemStatusSchema = z.object({
  server: z.object({
    status: z.enum(['running', 'stopped']),
    lifecycle: z.enum(['starting', 'ready', 'sleeping', 'degraded', 'stopping']),
    pid: z.number().int().optional(),
    uptime: z.number().optional(),
  }),
  network: z.object({
    status: z.enum(['online', 'offline']),
  }),
  system: z.object({
    cpuPercent: z.number(),
    memPercent: z.number(),
    diskFreeGb: z.number(),
  }),
  dispatch: z.object({
    queueDepth: z.number().int(),
    activeCount: z.number().int(),
    throttled: z.boolean(),
    paused: z.boolean(),
  }),
  sandboxes: z.array(SandboxInfoSchema),
});

type SystemStatus = z.infer<typeof SystemStatusSchema>;
type SandboxInfo = z.infer<typeof SandboxInfoSchema>;
```
