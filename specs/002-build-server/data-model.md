# Data Model: 002 Build Server

## SQLite Schema Additions

```sql
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feature_id TEXT NOT NULL,
  phase_id TEXT NOT NULL,
  agent_backend TEXT NOT NULL,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  exit_code INTEGER,
  log_file TEXT,
  duration_s REAL
);
```

## Zod Types

```typescript
import { z } from "zod";

export const ServerStatusSchema = z.object({
  status: z.enum(["ok", "degraded", "offline"]),
  lifecycle: z.enum(["ready", "sleeping", "starting", "stopping"]),
  pid: z.number().nullable(),
  port: z.number()
});

export const SystemResourcesSchema = z.object({
  cpuPercent: z.number().min(0).max(100),
  memPercent: z.number().min(0).max(100),
  diskFreeGb: z.number().min(0)
});

export const NetworkStatusSchema = z.object({
  status: z.enum(["online", "offline"])
});

export const DispatchStatsSchema = z.object({
  queueDepth: z.number().int().min(0),
  activeCount: z.number().int().min(0)
});

export const StatusResponseSchema = z.object({
  server: ServerStatusSchema,
  system: SystemResourcesSchema,
  network: NetworkStatusSchema,
  dispatch: DispatchStatsSchema
});

export const RunRecordSchema = z.object({
  feature_id: z.string(),
  phase_id: z.string(),
  agent_backend: z.string(),
  started_at: z.string().datetime().optional(),
  finished_at: z.string().datetime().optional(),
  exit_code: z.number().int().nullable(),
  log_file: z.string().nullable(),
  duration_s: z.number().nullable()
});
```
