# Feature Specification: 006 Pulse

**Feature Branch**: `006-pulse`
**Created**: 2026-02-27
**Status**: Draft
**Input**: Pulse productivity dashboard — git log scanner, PulseSnapshot model, historical scan of any repo, multi-repo aggregation, weekly LOC buckets with published/draft separation

---

## 2. User Scenarios & Testing

### US-001 - Current Pulse Snapshot (Priority: P0)
As a Principal Engineer, I want to run `gwrk pulse` so that I see a productivity snapshot across all tracked repositories — published LOC on main, draft LOC on feature/dev branches, weekly velocity trends — without leaving my terminal.

**Implements**: FR-001, FR-003

**Independent Test**: Add two repos to `.gwrkrc.json`, run `gwrk pulse`, verify output contains both repo summaries.

**Acceptance Scenarios**:
1. **Given** a `.gwrkrc.json` with two tracked repos that contain git history, **When** the user runs `gwrk pulse`, **Then**:
   - `gwrk pulse --json | jq '.repositories | length'` outputs `2`
   - `gwrk pulse --json | jq '.repositories[0].mainLoc'` outputs a number > 0
2. **Given** a `.gwrkrc.json` with zero tracked repos, **When** the user runs `gwrk pulse`, **Then**:
   - `gwrk pulse 2>&1 | grep -q 'No repositories tracked'` exits 0

### US-002 - Historical Scan (Priority: P0)
As a Principal Engineer, I want to run `gwrk pulse scan [path]` on any existing git repository so that I get a full historical productivity snapshot with weekly LOC buckets back to the repo's creation — without any gwrk-specific setup in that repo.

**Implements**: FR-002, FR-004

**Independent Test**: Run `gwrk pulse scan` against a known repo and verify weekly buckets are generated.

**Acceptance Scenarios**:
1. **Given** a git repository at `/tmp/test-repo` with commits spanning 4 weeks, **When** the user runs `gwrk pulse scan /tmp/test-repo`, **Then**:
   - `gwrk pulse scan /tmp/test-repo --json | jq '.snapshot.weeklyBuckets | length'` outputs `4` or more
   - `gwrk pulse scan /tmp/test-repo --json | jq '.snapshot.mainLoc'` outputs a number ≥ 0
2. **Given** a path `/tmp/not-a-repo` that is not a git repo, **When** the user runs `gwrk pulse scan /tmp/not-a-repo`, **Then**:
   - `gwrk pulse scan /tmp/not-a-repo 2>&1 | grep -q 'Not a git repository'` exits 0
   - Command exits with code 1

### US-003 - Published vs Draft Separation (Priority: P0)
As a Principal Engineer, I want the Pulse snapshot to separate main-branch LOC (published) from feature/draft-branch LOC so that I can distinguish shipped work from work-in-progress.

**Implements**: FR-003

**Independent Test**: Create a repo with commits on both `main` and a feature branch, verify the snapshot separates them.

**Acceptance Scenarios**:
1. **Given** a repo with 100 LOC on `main` and 50 LOC on `feature/foo`, **When** running `gwrk pulse scan <path> --json`, **Then**:
   - `jq '.snapshot.mainLoc'` outputs `100`
   - `jq '.snapshot.draftLoc'` outputs `50`

### US-004 - Weekly LOC Buckets (Priority: P0)
As a Principal Engineer, I want Pulse to bucket LOC changes by week (added/deleted/total) so that I can see velocity trends over time.

**Implements**: FR-004

**Independent Test**: Create a repo with commits in three different weeks, verify three weekly buckets.

**Acceptance Scenarios**:
1. **Given** a repo with commits in weeks W1, W2, W3, **When** running `gwrk pulse scan <path> --json`, **Then**:
   - `jq '.snapshot.weeklyBuckets | length'` outputs `3` or more
   - `jq '.snapshot.weeklyBuckets[0] | keys'` contains `weekStart`, `totalMain`, `added`, `deleted`

### US-005 - Spec Progress in Pulse (Priority: P1)
As a Principal Engineer, I want Pulse to include a summary of specification progress (specs defined, plans approved) so that I see definitional work alongside code output.

**Implements**: FR-005

**Independent Test**: Create a project with `specs/` containing some specs, run `gwrk pulse`, verify spec counts appear.

**Acceptance Scenarios**:
1. **Given** a project with `specs/001-cli-core/spec.md` and `specs/002-build-server/spec.md`, **When** running `gwrk pulse --json`, **Then**:
   - `jq '.specProgress.totalSpecs'` outputs `2`

### US-006 - JSON Output Mode (Priority: P0)
As a downstream consumer (future dashboard, Telegram bot, Compression engine), I want all Pulse commands to support `--json` output so that structured data is available for programmatic consumption.

**Implements**: FR-006

**Independent Test**: Run `gwrk pulse --json` and verify valid JSON is returned.

**Acceptance Scenarios**:
1. **Given** a tracked repo, **When** running `gwrk pulse --json`, **Then**:
   - `gwrk pulse --json | jq -e '.' > /dev/null 2>&1` exits 0 (valid JSON)
2. **Given** a repo path, **When** running `gwrk pulse scan <path> --json`, **Then**:
   - `gwrk pulse scan <path> --json | jq -e '.snapshot'` exits 0

### US-007 - Performance on Large Repos (Priority: P1)
As a Principal Engineer, I want `gwrk pulse scan` to complete within 60 seconds for repositories with up to 50,000 commits so that it remains practical for real-world projects.

**Implements**: FR-007

**Independent Test**: Generate a synthetic repo with 50K commits, measure scan time.

**Acceptance Scenarios**:
1. **Given** a git repo with 50,000 commits, **When** running `gwrk pulse scan <path>`, **Then**:
   - Execution completes in under 60 seconds (wall-clock)

### US-008 - Default Branch Detection (Priority: P0)
As a user, I want `gwrk pulse scan` to automatically detect the repository's default branch (main, master, trunk, etc.) so that I don't have to specify it manually.

**Implements**: FR-008

**Independent Test**: Create repos with `main` and `master` as default branches, verify both are auto-detected.

**Acceptance Scenarios**:
1. **Given** a repo where the default branch is `master`, **When** running `gwrk pulse scan <path> --json`, **Then**:
   - `jq -r '.snapshot.defaultBranch'` outputs `master`
2. **Given** a repo where the default branch is `main`, **When** running `gwrk pulse scan <path> --json`, **Then**:
   - `jq -r '.snapshot.defaultBranch'` outputs `main`

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: System MUST provide a `gwrk pulse` command that generates a PulseSnapshot across all repositories listed in `.gwrkrc.json` under `pulse.repos` and renders it as a formatted terminal table. (Implements: US-001)
- **FR-002**: System MUST provide a `gwrk pulse scan [path]` command that walks the git log of any repository at the given path and generates a PulseSnapshot with weekly LOC buckets from the first commit to HEAD. No gwrk-specific setup required in the target repo. (Implements: US-002)
- **FR-003**: System MUST separate LOC into `mainLoc` (commits reachable from the default branch) and `draftLoc` (commits only reachable from non-default branches) in every PulseSnapshot. (Implements: US-001, US-003)
- **FR-004**: System MUST bucket LOC changes by ISO week, recording `weekStart`, `totalMain`, `totalDrafts`, `added`, and `deleted` for each bucket. (Implements: US-002, US-004)
- **FR-005**: System MUST scan `specs/*/spec.md` and `specs/*/plan.md` in the current project to report spec/plan counts in the Pulse output under `specProgress`. (Implements: US-005)
- **FR-006**: System MUST support a `--json` flag on both `gwrk pulse` and `gwrk pulse scan` that outputs the full PulseSnapshot as structured JSON to stdout, with no terminal formatting. (Implements: US-006)
- **FR-007**: System MUST complete a `gwrk pulse scan` of a repository with ≤ 50,000 commits in under 60 seconds. (Implements: US-007)
- **FR-008**: System MUST auto-detect the repository's default branch using `git symbolic-ref refs/remotes/origin/HEAD` with fallback to checking for `main`, `master`, or `trunk` branches. (Implements: US-008)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No repos configured in `.gwrkrc.json` | `No repositories tracked. Add repos to .gwrkrc.json pulse.repos` | 1 |
| Repo path does not exist | `Repository path not found: <path>` | 1 |

#### FR-002 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Path is not a git repository | `Not a git repository: <path>` | 1 |
| Path does not exist | `Path not found: <path>` | 1 |
| Git not installed | `git executable not found` | 1 |

#### FR-008 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No default branch detected | `Cannot detect default branch for <path>. Use --branch <name>` | 1 |

---

## 5. Data Model Requirements

### DM-001: PulseSnapshot

The core output data structure for all Pulse operations.

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

### DM-002: PulseReport (Multi-Repo Aggregation)

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

### DM-003: Configuration Extension (`.gwrkrc.json`)

Extends the base GwrkConfig with Pulse-specific settings:

```typescript
// Added to existing GwrkConfig
interface PulseConfig {
  repos: string[];               // Absolute paths to tracked repositories
}
// Usage: config.pulse.repos
```

---

## 6. Technical Constraints

- **TC-001**: Determinism — Given the same git history, `gwrk pulse scan` MUST produce identical `weeklyBuckets` and LOC counts.
- **TC-002**: Air-Gapped — Pulse performs no network calls. All data derived from the local git log (`git log`, `git rev-list`, `git diff --stat`). No GitHub API calls.
- **TC-003**: Fail-Fast Config — Zod validation for `pulse.repos` in `.gwrkrc.json`. Missing or invalid entries → `process.exit(1)`.
- **TC-004**: Performance — Git log parsing MUST use `git log --numstat --format=...` for efficient single-pass extraction. No `git diff` per-commit.
- **TC-005**: Branch Heuristic — Default branch detection: `git symbolic-ref refs/remotes/origin/HEAD` → fallback `main` → fallback `master` → fallback `trunk` → error.

---

## 7. Testing Requirements

- **TR-001**: `src/engine/pulse.test.ts` — Unit test the git log parser: given a mock `git log --numstat` output string, verify correct extraction of weekly buckets, LOC counts, and add/delete sums. Vitest. (FR-002, FR-004)
- **TR-002**: `src/engine/pulse.test.ts` — Unit test the published/draft branch separation logic: given a mock branch listing and commit ancestry, verify `mainLoc` and `draftLoc` are computed correctly. Vitest. (FR-003)
- **TR-003**: `src/engine/pulse.test.ts` — Unit test default branch detection: mock `git symbolic-ref` output for `main`, `master`, and failure cases. Verify fallback chain. Vitest. (FR-008)
- **TR-004**: `src/commands/pulse.test.ts` — Unit test `gwrk pulse` command: mock the engine, verify it reads `pulse.repos` from config and invokes the scanner for each repo. Vitest. (FR-001)
- **TR-005**: `src/commands/pulse.test.ts` — Unit test `gwrk pulse scan` command: verify it validates the path argument, calls the engine, and outputs JSON when `--json` is passed. Vitest. (FR-002, FR-006)
- **TR-006**: `src/commands/pulse.test.ts` — Unit test error cases: non-existent path, non-git-repo path, missing config. Verify stderr messages and exit codes match FR error state tables. Vitest. (FR-001, FR-002)
- **TR-007**: Integration test — Create a real git repo in `/tmp/` with known commits across 3 weeks, run the pulse engine against it, verify weekly bucket counts and LOC totals match expected values. Vitest. (FR-002, FR-004, FR-007)
- **TR-008**: `src/engine/pulse.test.ts` — Unit test spec progress scanning: given a mock `specs/` directory structure, verify correct counts of `spec.md` and `plan.md` files. Vitest. (FR-005)

---

## 8. Success Criteria

- **SC-001**: `gwrk pulse scan <any-git-repo>` generates a valid PulseSnapshot JSON with no prior gwrk setup in the target repo.
- **SC-002**: `gwrk pulse` aggregates across multiple repos and displays a terminal table matching the PRD §14 example format.
- **SC-003**: Weekly buckets are deterministic — same repo, same history, same output every time.
- **SC-004**: Performance: ≤ 60 seconds for a 50K-commit repo.

---

## 9. Verification Requirements

- **VR-001**: E2E test: create a temp git repo with commits on `main` and a feature branch across 3 weeks → run `gwrk pulse scan <path> --json` → verify JSON has correct `mainLoc`, `draftLoc`, and 3+ weekly buckets.
- **VR-002**: Negative test: run `gwrk pulse scan /tmp/not-a-repo` → verify exit code 1 and stderr contains `Not a git repository`.
- **VR-003**: Config test: remove `pulse.repos` from `.gwrkrc.json` → run `gwrk pulse` → verify exit code 1 and stderr contains configuration error.
- **VR-004**: Determinism test: run `gwrk pulse scan <path> --json` twice → `diff` the outputs → they MUST be identical.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-003 | FR-001 | US-001 | TR-004 |
| US-002 | FR-002, FR-004 | FR-002 | US-002 | TR-005, TR-007 |
| US-003 | FR-003 | FR-003 | US-001, US-003 | TR-002 |
| US-004 | FR-004 | FR-004 | US-002, US-004 | TR-001, TR-007 |
| US-005 | FR-005 | FR-005 | US-005 | TR-008 |
| US-006 | FR-006 | FR-006 | US-006 | TR-005 |
| US-007 | FR-007 | FR-007 | US-007 | TR-007 |
| US-008 | FR-008 | FR-008 | US-008 | TR-003 |
