---
type: contract
feature: 007-effort-compression
last_modified: "2026-03-05T11:12:20Z"
---

# Contract: Compression Engine

**Feature**: 007-effort-compression
**Scope**: Timestamp collection, commit clustering, compression ratio computation, cross-feature summary

---

## `collectTimestamps(featureDir: string): DeliveryActuals`

**Source**: `src/engine/git-timestamps.ts`
**Consumed by**: `src/engine/compression.ts`

Collects all relevant timestamps for a feature from multiple sources. Gracefully degrades if `gh` CLI is unavailable (uses last impl commit as delivery endpoint instead of PR merge time).

```typescript
function collectTimestamps(featureDir: string): DeliveryActuals
```

| Parameter | Type | Description |
|---|---|---|
| `featureDir` | `string` | Absolute path to `specs/<feature>/` |

### Timestamp Sources

| Timestamp | Source | Fallback |
|---|---|---|
| `specCreatedAt` | OS file `birthtime` on `spec.md`, or first Git commit touching `spec.md` | Git commit date |
| `planApprovedAt` | Last Git commit touching `plan.md` before first impl commit | `undefined` |
| `firstImplCommit` | `git log --reverse --format="%aI" -- <impl-paths>` | None (required) |
| `lastImplCommit` | `git log -1 --format="%aI" -- <impl-paths>` | None (required) |
| `prMergedAt` | `gh pr list --state merged --json mergedAt` | `lastImplCommit` |

**Returns**: `DeliveryActuals`
**Throws**: If no implementation commits found → stderr `No implementation commits found for feature '<feature>'`, exit 1

### Implementation Path Detection

Implementation commits are detected by looking for commits that touch files in `src/` directories but NOT in `specs/` directories (to separate definition work from implementation work). The feature branch naming convention (`feature/<feature>-*` or `phase/<feature>-*`) is used to scope the Git log query.

---

## `clusterCommits(timestamps: string[], gapMinutes: number): CommitCluster[]`

**Source**: `src/engine/commit-cluster.ts`
**Consumed by**: `src/engine/compression.ts`

Pure function. Groups commit timestamps into clusters separated by gaps larger than `gapMinutes`. Each cluster represents one active coding session.

```typescript
function clusterCommits(timestamps: string[], gapMinutes: number): CommitCluster[]
```

| Parameter | Type | Description |
|---|---|---|
| `timestamps` | `string[]` | ISO 8601 commit timestamps, sorted ascending |
| `gapMinutes` | `number` | Gap threshold (default: 30) |

```typescript
interface CommitCluster {
  startedAt: string;        // ISO 8601 — first commit in cluster
  endedAt: string;          // ISO 8601 — last commit in cluster
  commitCount: number;
  durationMinutes: number;  // endedAt - startedAt
}
```

**Returns**: `CommitCluster[]`
**Edge cases**:
- Single commit → 1 cluster with `durationMinutes: 0`
- All commits within gap → 1 cluster
- Empty array → empty array

---

## `computeCompression(featureId: string, forecast: EffortForecast, actuals: DeliveryActuals): CompressionReport`

**Source**: `src/engine/compression.ts`
**Consumed by**: `src/commands/compression.ts`

Orchestrates the computation of Point Compression, Total Compression, and Leading Indicators. Returns a full `CompressionReport` suitable for persistence and display.

```typescript
function computeCompression(
  featureId: string,
  forecast: EffortForecast,
  actuals: DeliveryActuals
): CompressionReport
```

### Formulas

```
Point Compression = forecast.estimatedHours / (actuals.activeCodingMinutes / 60)
Total Compression = forecast.estimatedDays / (actuals.deliveryWindowHours / 24)
```

**Returns**: `CompressionReport` (including `indicators: LeadingIndicators`)
**Edge cases**:
- `activeCodingMinutes = 0` → `pointCompression = Infinity` (report as "∞")
- `deliveryWindowHours = 0` → `totalCompression = Infinity` (report as "∞")

---

## `computeIndicators(featureId: string): LeadingIndicators`

**Source**: `src/engine/compression.ts`
**Consumed by**: `src/engine/compression.ts`

Queries the SQLite `runs` table and scans the filesystem to compute leading indicators of delivery quality.

| Indicator | Source | Computation |
|---|---|---|
| `firstPassRate` | `runs` table | `(tasks with attempt=1) / total tasks` |
| `avgAttempts` | `runs` table | `sum(attempts) / total tasks` |
| `linesPerSP` | git + forecast | `total LOC added / forecast.totalSP` |
| `filesPerSP` | git + forecast | `count(files modified) / forecast.totalSP` |
| `toolCallsPerSP`| `runs` + forecast| `sum(tool_calls) / forecast.totalSP` |
| `contractCount` | filesystem | `count(specs/<feature>/contracts/*.md)` |
| `gateCount` | filesystem | `count(specs/<feature>/gates/*.sh)` |

**Returns**: `LeadingIndicators`

---

## `generateSummary(reports: CompressionReport[]): CompressionSummary`

**Source**: `src/engine/compression.ts`
**Consumed by**: `src/commands/compression.ts`

Aggregates multiple `CompressionReport` objects into a single summary with totals, averages, best/worst identification, and trend analysis.

```typescript
function generateSummary(reports: CompressionReport[]): CompressionSummary
```

### Trend Calculation

Trend is determined by comparing the Point Compression of the 3 most recent features:
- All increasing or stable → `"improving"`
- All decreasing → `"declining"`
- Mixed → `"stable"`

**Returns**: `CompressionSummary`

---

## `compressionCommand(featureIdOrAll: string | undefined, options: { json?: boolean; all?: boolean }): void`

**Source**: `src/commands/compression.ts`
**Consumed by**: `src/cli.ts`

Commander command handler. For single feature: loads effort data, collects timestamps, clusters commits, computes ratios, formats output. For `--all`: iterates all features with compression data, generates summary.

```typescript
function compressionCommand(
  featureIdOrAll: string | undefined,
  options: { json?: boolean; all?: boolean }
): void
```

**Exit codes**:
| Condition | Exit code |
|---|---|
| Success | 0 |
| Feature dir not found | 1 |
| No impl commits | 1 |
| No effort data | 1 |
| No features for `--all` | 1 |
