# Data Model: 011 Harvest

## SQLite Schema Additions

```sql
-- src/db/migrations/008-issues.sql
CREATE TABLE IF NOT EXISTS issues (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_number    INTEGER NOT NULL,
  feature_id      TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  state           TEXT NOT NULL, -- 'open' or 'closed'
  author          TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at       TEXT,
  UNIQUE(issue_number)
);

CREATE INDEX IF NOT EXISTS idx_issues_feature_id ON issues(feature_id);
```

## Zod Schemas

```typescript
// src/db/issues.ts
import { z } from "zod";

export const IssueSchema = z.object({
  id: z.number().optional(),
  issue_number: z.number(),
  feature_id: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.enum(["open", "closed"]),
  author: z.string().nullable(),
  created_at: z.string(),
  closed_at: z.string().nullable(),
});

export type Issue = z.infer<typeof IssueSchema>;
```
