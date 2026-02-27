# Data Model: 002 Build Server

**Feature**: 002-build-server
**Date**: 2026-02-27

---

## DM-001: Dispatch Record (`dispatches.jsonl`)

Append-only JSONL, one entry per dispatch lifecycle event. Persisted at `.gwrk/dispatches.jsonl`.

```typescript
import { z } from 'zod';

const AgentBackendSchema = z.enum(['gemini', 'claude', 'codex', 'codex-cloud']);

const DispatchAttemptSchema = z.object({
  attemptNumber: z.number().int().positive(),
  backend: AgentBackendSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  exitCode: z.number().int().optional(),
  stderr: z.string().optional(),
});

const DispatchStatusSchema = z.enum([
  'queued', 'running', 'completed', 'failed', 'retrying'
]);

const DispatchRecordSchema = z.object({
  id: z.string().uuid(),
  featureId: z.string(),
  phaseId: z.string(),
  backend: AgentBackendSchema,
  status: DispatchStatusSchema,
  containerId: z.string().optional(),
  branchName: z.string(),
  attempts: z.array(DispatchAttemptSchema),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});

type DispatchRecord = z.infer<typeof DispatchRecordSchema>;
type DispatchAttempt = z.infer<typeof DispatchAttemptSchema>;
type DispatchStatus = z.infer<typeof DispatchStatusSchema>;
```

---

## DM-002: Server Config Extension (`.gwrkrc.json`)

Extends the `GwrkConfigSchema` from 001-cli-core. All fields MUST be explicit — no `.default()`.

```typescript
const GwrkServerConfigSchema = z.object({
  server: z.object({
    port: z.number().int().min(1024).max(65535),
    host: z.string(),
  }),
  parallelism: z.object({
    local: z.object({
      maxClones: z.number().int().positive(),
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

**Example `.gwrkrc.json` addition:**

```json
{
  "server": {
    "port": 18790,
    "host": "127.0.0.1"
  },
  "parallelism": {
    "local": {
      "maxClones": 3,
      "maxCpu": 80,
      "maxMem": 70,
      "minDiskGb": 10
    },
    "cloud": {
      "maxConcurrent": 10
    }
  }
}
```

---

## DM-003: System Status

Runtime-only data model (not persisted). Returned by `GET /api/status`.

```typescript
const SandboxInfoSchema = z.object({
  containerId: z.string(),
  featureId: z.string(),
  phaseId: z.string(),
  backend: AgentBackendSchema,
  status: z.enum(['creating', 'running', 'stopping', 'destroyed']),
  startedAt: z.string().datetime(),
  cpuPercent: z.number().optional(),
  memMb: z.number().optional(),
});

const SystemStatusSchema = z.object({
  server: z.object({
    status: z.enum(['running', 'stopped']),
    pid: z.number().int().optional(),
    uptime: z.number().optional(),
    port: z.number().int().optional(),
  }),
  system: z.object({
    cpuPercent: z.number(),
    memPercent: z.number(),
    diskFreeGb: z.number(),
  }),
  dispatch: z.object({
    queueDepth: z.number().int(),
    activeCount: z.number().int(),
    completedCount: z.number().int(),
    failedCount: z.number().int(),
  }),
  sandboxes: z.array(SandboxInfoSchema),
});

type SystemStatus = z.infer<typeof SystemStatusSchema>;
type SandboxInfo = z.infer<typeof SandboxInfoSchema>;
```
