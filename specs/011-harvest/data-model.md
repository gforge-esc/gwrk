# Data Model: 011 Harvest

**Feature**: 011-harvest
**Scope**: SQLite schema additions and Zod domain schemas

---

## SQLite Schema

### `compression` Table (NEW)

```sql
CREATE TABLE IF NOT EXISTS compression (
  feature_id          TEXT PRIMARY KEY,
  phase_id            TEXT,
  estimated_hours     REAL,
  actual_coding_hours REAL,
  estimated_days      REAL,
  actual_delivery_days REAL,
  point_compression   REAL,
  total_compression   REAL,
  dormancy_days       INTEGER,
  first_impl_commit   TEXT,
  merge_timestamp     TEXT,
  session_count       INTEGER,
  recorded_at         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (feature_id) REFERENCES projects(id)
);
```

### `runs` Table (MODIFY)

```sql
-- Phase 1 migration
ALTER TABLE runs ADD COLUMN status TEXT; -- 'running', 'completed', 'failed', 'merged'
ALTER TABLE runs ADD COLUMN merge_commit_sha TEXT;
```

---

## Zod Domain Schemas

### `HarvestPayload`

```typescript
import { z } from "zod";

export const HarvestPayloadSchema = z.object({
  featureId: z.string(),
  phaseId: z.string().optional(),
  prNumber: z.number(),
  mergeCommitSha: z.string(),
  mergedAt: z.string(), // ISO 8601
});

export type HarvestPayload = z.infer<typeof HarvestPayloadSchema>;
```

### `CompressionRecord`

```typescript
export const CompressionRecordSchema = z.object({
  featureId: z.string(),
  phaseId: z.string().optional(),
  estimatedHours: z.number(),
  actualCodingHours: z.number(),
  estimatedDays: z.number(),
  actualDeliveryDays: z.number(),
  pointCompression: z.number(),
  totalCompression: z.number(),
  dormancyDays: z.number(),
  firstImplCommit: z.string(),
  mergeTimestamp: z.string(),
  sessionCount: z.number(),
  recordedAt: z.string().optional(),
});

export type CompressionRecord = z.infer<typeof CompressionRecordSchema>;
```
