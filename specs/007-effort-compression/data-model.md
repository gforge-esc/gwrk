# Data Model: 007 Effort + Compression

**Feature**: 007-effort-compression
**Scope**: SQLite schema and domain types for estimation and compression

---

## SQLite Schema

The compression engine records results in the global execution ledger at `~/.gwrk/gwrk.db`.

### Table: `compression`

Records final compression ratios and leading indicators for a feature upon completion.

```sql
CREATE TABLE IF NOT EXISTS compression (
  feature_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  generated_at TEXT NOT NULL,        -- ISO 8601
  total_sp REAL NOT NULL,
  estimated_hours REAL NOT NULL,
  actual_coding_minutes INTEGER NOT NULL,
  point_compression REAL NOT NULL,
  total_compression REAL NOT NULL,
  dormancy_days REAL NOT NULL,
  first_pass_rate REAL NOT NULL,     -- 0.0 to 1.0
  avg_attempts REAL NOT NULL,
  lines_per_sp REAL NOT NULL,
  files_per_sp REAL NOT NULL,
  tool_calls_per_sp REAL NOT NULL,
  contract_count INTEGER NOT NULL,
  gate_count INTEGER NOT NULL,
  PRIMARY KEY (feature_id, project_id)
);
```

---

## Domain Types

### Effort Estimation Types

```typescript
interface EffortReport {
  featureId: string;
  generatedAt: string;              // ISO 8601
  totalSP: number;
  overheadFactor: number;           // 1.25
  roles: RoleBreakdown[];
  stories: StoryEstimate[];
  totalRawHours: number;
  totalWithOverhead: number;
  totalDays: number;                // totalWithOverhead / 8
}

interface RoleBreakdown {
  role: string;                     // "RE" | "TS" | "PM" | "PE" | "DE"
  roleName: string;                 // e.g., "TS / Fullstack Developer"
  hoursPerSP: number;
  spAssigned: number;
  rawHours: number;                 // spAssigned * hoursPerSP
  withOverhead: number;             // rawHours * overheadFactor
  days: number;                     // withOverhead / 8
}

interface StoryEstimate {
  storyId: string;                  // "US-###"
  title: string;
  sp: number;
  roles: string[];                  // ["TS", "PE"]
  rawHours: number;
  withOverhead: number;
  unestimated?: boolean;            // true if no SP found
}
```

### Compression Analysis Types

```typescript
interface CompressionReport {
  featureId: string;
  projectId: string;
  generatedAt: string;              // ISO 8601
  forecast: EffortForecast;
  actuals: DeliveryActuals;
  compression: CompressionRatios;
  indicators: LeadingIndicators;
}

interface EffortForecast {
  totalSP: number;
  roles: { role: string; sp: number }[];
  estimatedHours: number;           // with overhead
  estimatedDays: number;            // estimatedHours / 8
}

interface DeliveryActuals {
  specCreatedAt: string;            // ISO 8601
  planApprovedAt?: string;          // ISO 8601
  firstImplCommit: string;          // ISO 8601
  lastImplCommit: string;           // ISO 8601
  prMergedAt?: string;              // ISO 8601
  dormancyDays: number;             // specCreatedAt → firstImplCommit
  activeCodingMinutes: number;      // sum of session durations
  sessionCount: number;             // number of commit clusters
  deliveryWindowHours: number;      // firstImplCommit → prMergedAt (or lastImplCommit)
}

interface CompressionRatios {
  pointCompression: number;         // estimatedHours / (activeCodingMinutes / 60)
  totalCompression: number;         // estimatedDays / (deliveryWindowHours / 24)
  dormancyDays: number;
}

interface LeadingIndicators {
  convergence: {
    firstPassRate: number;          // 0.0 - 1.0
    avgAttempts: number;
  };
  density: {
    linesPerSP: number;
    filesPerSP: number;
    toolCallsPerSP: number;
  };
  specQuality: {
    contractCount: number;
    gateCount: number;
  };
}
```

### Aggregate Types

```typescript
interface CompressionSummary {
  projectName: string;
  generatedAt: string;
  features: CompressionReport[];
  totals: {
    totalSP: number;
    totalEstimatedHours: number;
    totalActualCodingHours: number;
    avgPointCompression: number;
    avgTotalCompression: number;
    avgFirstPassRate: number;
  };
  best: { featureId: string; pointCompression: number };
  worst: { featureId: string; pointCompression: number };
  trend: "improving" | "declining" | "stable";
}
```
