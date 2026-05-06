# Data Model: 006 Pulse

This document defines the core data structures and configuration schemas for the Pulse productivity dashboard.

## 1. PulseSnapshot (DM-001)

The core output data structure for all Pulse operations. It captures the state of a single repository at a specific point in time.

```typescript
interface PulseSnapshot {
  repoPath: string;              // Absolute path to the repository
  repoName: string;              // Basename of the repo directory
  defaultBranch: string;         // Auto-detected: main, master, trunk, etc.
  scannedAt: string;             // ISO 8601 timestamp of scan
  mainLoc: number;               // Total LOC on the default branch (HEAD)
  draftLoc: number;              // Total LOC on non-default branches (sum of unique lines)
  weeklyBuckets: WeeklyBucket[];  // Time series, oldest first
}

interface WeeklyBucket {
  weekStart: string;             // ISO 8601 date (Monday of the week)
  totalMain: number;             // Cumulative LOC on default branch at week end
  totalDrafts: number;           // Cumulative LOC on draft branches at week end
  added: number;                 // Lines added during this week (all branches)
  deleted: number;               // Lines deleted during this week (all branches)
}
```

## 2. PulseReport (DM-002)

The aggregated report structure for multi-repo Pulse snapshots.

```typescript
interface PulseReport {
  generatedAt: string;           // ISO 8601 timestamp
  repositories: PulseSnapshot[]; // One per tracked repo
  specProgress: SpecProgress;    // Definitional work summary
}

interface SpecProgress {
  totalSpecs: number;            // Count of specs/*/spec.md
  totalPlans: number;            // Count of specs/*/plan.md
}
```

## 3. Configuration Extension (DM-003)

Pulse configuration resides in `.gwrkrc.json` under the `pulse` key.

```json
{
  "pulse": {
    "repos": [
      "/absolute/path/to/repo1",
      "/absolute/path/to/repo2"
    ]
  }
}
```

### Zod Schema

```typescript
const PulseConfigSchema = z.object({
  repos: z.array(z.string().min(1)).min(1, "At least one repository must be tracked for Pulse.")
});
```

## 4. Derived Metrics

| Metric | Formula | Description |
|---|---|---|
| **Net Velocity** | `added - deleted` | The total LOC change in a given week. |
| **Draft Ratio** | `draftLoc / (mainLoc + draftLoc)` | Percentage of work-in-progress relative to shipped code. |
| **Spec-to-Code Ratio**| `totalSpecs / totalRepos` | Rough measure of architectural coverage across the workspace. |
