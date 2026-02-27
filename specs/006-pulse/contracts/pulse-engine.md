# Contract: Pulse Engine

**Feature**: 006-pulse
**Scope**: Git log scanning, PulseSnapshot generation, multi-repo aggregation

---

## `scanRepository(repoPath: string): PulseSnapshot`

**Source**: `src/engine/pulse.ts`
**Consumed by**: `src/commands/pulse.ts`

Scans a single git repository and produces a `PulseSnapshot` with weekly LOC buckets, mainLoc/draftLoc separation, and default branch detection. This is the core entry point for both `gwrk pulse scan` and per-repo scanning in `gwrk pulse`.

```typescript
function scanRepository(repoPath: string): PulseSnapshot
```

| Parameter | Type | Description |
|---|---|---|
| `repoPath` | `string` | Absolute path to the git repository root |

**Returns**: `PulseSnapshot` (Zod-validated)

**Error states**:
| Condition | stderr | Exit code |
|---|---|---|
| Not a git repository | `Not a git repository: <path>` | 1 |
| Path does not exist | `Path not found: <path>` | 1 |

---

## `detectDefaultBranch(repoPath: string): string`

**Source**: `src/utils/git.ts`
**Consumed by**: `src/engine/pulse.ts`

Detects the default branch of a git repository. Fallback chain: `git symbolic-ref refs/remotes/origin/HEAD` → check for `main` → check for `master` → check for `trunk` → throw error.

```typescript
function detectDefaultBranch(repoPath: string): string
```

**Returns**: Branch name string (e.g. `"main"`, `"master"`)
**Throws**: `Cannot detect default branch for <path>. Use --branch <name>`

---

## `parseGitLog(raw: string): ParsedCommit[]`

**Source**: `src/engine/pulse.ts`
**Consumed by**: `scanRepository()`

Parses the raw output of `git log --numstat --format=...` into structured commit data with timestamps, branch info, and per-file add/delete counts.

```typescript
interface ParsedCommit {
  hash: string;
  timestamp: string;       // ISO 8601
  files: { added: number; deleted: number; path: string }[];
}

function parseGitLog(raw: string): ParsedCommit[]
```

---

## `bucketByWeek(commits: ParsedCommit[], defaultBranch: string): WeeklyBucket[]`

**Source**: `src/engine/pulse.ts`
**Consumed by**: `scanRepository()`

Groups parsed commits into ISO-week buckets and computes cumulative LOC totals, weekly adds/deletes.

```typescript
function bucketByWeek(commits: ParsedCommit[], defaultBranch: string): WeeklyBucket[]
```

**Returns**: Array of `WeeklyBucket`, sorted oldest-first.

---

## `generatePulseReport(config: GwrkConfig): PulseReport`

**Source**: `src/engine/pulse.ts`
**Consumed by**: `src/commands/pulse.ts`

Iterates over `config.pulse.repos`, calls `scanRepository()` for each, and assembles a `PulseReport` with aggregated metrics and spec progress.

```typescript
function generatePulseReport(config: GwrkConfig): PulseReport
```

**Returns**: `PulseReport`
**Throws**: If `config.pulse.repos` is empty or undefined → `No repositories tracked`

---

## `scanSpecProgress(projectRoot: string): SpecProgress`

**Source**: `src/engine/pulse.ts`
**Consumed by**: `generatePulseReport()`

Scans `specs/*/spec.md` and `specs/*/plan.md` in the current project directory and returns counts.

```typescript
function scanSpecProgress(projectRoot: string): SpecProgress
```

**Returns**: `{ totalSpecs: number; totalPlans: number }`
