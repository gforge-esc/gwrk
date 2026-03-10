---
type: specification
feature: 007-effort-compression
last_modified: "2026-03-06T10:00:00Z"
---

# Feature Specification: 007 Effort + Compression

**Feature Branch**: `007-effort-compression`
**Created**: 2026-02-27
**Revised**: 2026-03-10
**Status**: Settled
**Input**: SP-driven effort estimation engine and delivery speed compression measurement — story extraction, role bracketing, timestamp collection, active coding detection, Point/Total compression ratios, dormancy tracking, per-feature and cross-feature reports, leading indicators, and SQLite persistence.

---

## 2. User Scenarios & Testing

### US-001 - Effort Estimation for a Single Feature (Priority: P0)
As a Principal Engineer, I want to run `gwrk measure effort <feature>` so that an SP-driven effort estimate is generated from the spec's user stories, bracketed by role, with the standard 1.25× overhead factor applied, producing a markdown report I can hand to a client.

**Implements**: FR-001, FR-002, FR-003

**Independent Test**: Run `gwrk measure effort 001-cli-core` and verify a report is generated with the correct role breakdown.

**Acceptance Scenarios**:
1. **Given** a feature `001-cli-core` with a `spec.md` containing 10 user stories with SP values and role assignments, **When** the user runs `gwrk measure effort 001-cli-core`, **Then**:
   - `test -f docs/assessments/effort-001-cli-core-*.md` exits 0
   - `grep -q 'Total Story Points' docs/assessments/effort-001-cli-core-*.md` exits 0
   - `grep -q '1.25' docs/assessments/effort-001-cli-core-*.md` exits 0
2. **Given** a feature with stories assigned to `TS` (4h/SP) and `PE` (1.5h/SP) roles, **When** the report is generated, **Then**:
   - `grep -q 'TS / Fullstack Developer' docs/assessments/effort-001-cli-core-*.md` exits 0
   - `grep -q 'Principal Engineer' docs/assessments/effort-001-cli-core-*.md` exits 0

### US-002 - Effort Report Handles Missing Spec (Priority: P0)
As a user, I want `gwrk measure effort <feature>` to fail fast with a clear error if the spec.md is missing or contains no user stories, so that I know what to fix.

**Implements**: FR-004

**Independent Test**: Run `gwrk measure effort nonexistent-feature` and verify exit code 1 with meaningful stderr.

**Acceptance Scenarios**:
1. **Given** no `spec.md` exists for `nonexistent-feature`, **When** running `gwrk measure effort nonexistent-feature`, **Then**:
   - Command exits with code 1
   - `gwrk measure effort nonexistent-feature 2>&1 | grep -q 'spec.md not found'` exits 0
2. **Given** a `spec.md` with no user stories (no `US-` markers), **When** running `gwrk measure effort empty-feature`, **Then**:
   - Command exits with code 1
   - `gwrk measure effort empty-feature 2>&1 | grep -q 'No user stories found'` exits 0

### US-003 - Single Feature Compression Report (Priority: P0)
As a Principal Engineer, I want to run `gwrk measure compression <feature>` so that I see Point Compression and Total Compression ratios for a shipped feature, with full timeline breakdown including dormancy tracking.

**Implements**: FR-005, FR-006, FR-007, FR-008

**Independent Test**: Run `gwrk measure compression 001-cli-core` on a feature with merged commits and verify both ratios appear.

**Acceptance Scenarios**:
1. **Given** a feature `001-cli-core` with merged implementation commits, **When** running `gwrk measure compression 001-cli-core`, **Then**:
   - `gwrk measure compression 001-cli-core | grep -q 'Point Compression'` exits 0
   - `gwrk measure compression 001-cli-core | grep -q 'Total Compression'` exits 0
   - `gwrk measure compression 001-cli-core | grep -q 'Dormancy'` exits 0
2. **Given** a feature with spec.md created 30 days before first impl commit, **When** the compression report runs, **Then**:
   - `gwrk measure compression 001-cli-core | grep -qE 'Dormancy.*[0-9]+ days'` exits 0

### US-004 - Active Coding Detection via Commit Clustering (Priority: P0)
As the compression engine, I want actual coding time computed by clustering Git commits with a 30-minute gap threshold so that dormant periods and overnight waits are not counted as coding time.

**Implements**: FR-006

**Independent Test**: Given a commit log with two clusters separated by >30 min, verify the active coding time equals the sum of the two cluster durations, not the total elapsed time.

**Acceptance Scenarios**:
1. **Given** a feature with commits at T+0min, T+5min, T+10min, T+120min, T+125min (two sessions: 10min + 5min = 15min total), **When** the compression engine processes timestamps, **Then**:
   - `gwrk measure compression test-feature --json | jq '.actuals.activeCodingMinutes'` outputs a value ≤ 20 (not 125)

### US-005 - Cross-Feature Compression Summary (Priority: P1)
As a Principal Engineer, I want to run `gwrk measure compression --all` so that I see a summary table across all shipped features with trends and best/worst analysis.

**Implements**: FR-009

**Independent Test**: Run `gwrk measure compression --all` with multiple shipped features and verify the summary table appears.

**Acceptance Scenarios**:
1. **Given** at least 2 features with compression data, **When** running `gwrk measure compression --all`, **Then**:
   - `gwrk measure compression --all | grep -q 'COMPRESSION SUMMARY'` exits 0
   - `gwrk measure compression --all | grep -c '^  [0-9]' | test $(cat) -ge 2` exits 0
2. **Given** features with varying compression ratios, **When** the summary is generated, **Then**:
   - `gwrk measure compression --all | grep -q 'Best:'` exits 0
   - `gwrk measure compression --all | grep -q 'Trend:'` exits 0

### US-006 - Compression Handles Unshipped Features (Priority: P0)
As a user, I want `gwrk measure compression <feature>` to fail fast with a clear message if the feature has no implementation commits or no merged PRs, so I know compression can only be measured for shipped work.

**Implements**: FR-010

**Independent Test**: Run `gwrk measure compression` on a feature with only a spec.md and verify exit code 1.

**Acceptance Scenarios**:
1. **Given** a feature `draft-only` with spec.md but no implementation commits, **When** running `gwrk measure compression draft-only`, **Then**:
   - Command exits with code 1
   - `gwrk measure compression draft-only 2>&1 | grep -q 'No implementation commits found'` exits 0

### US-007 - JSON Output Mode (Priority: P1)
As an integrator (Slack App Home, GForge Integration), I want both `gwrk measure effort` and `gwrk measure compression` to support `--json` output so that structured data can be consumed programmatically.

**Implements**: FR-011

**Independent Test**: Run `gwrk measure effort 001-cli-core --json` and verify valid JSON output.

**Acceptance Scenarios**:
1. **Given** a valid feature, **When** running `gwrk measure effort 001-cli-core --json`, **Then**:
   - `gwrk measure effort 001-cli-core --json | jq '.totalSP'` exits 0
   - `gwrk measure effort 001-cli-core --json | jq '.roles | length'` returns ≥ 1
2. **Given** a shipped feature, **When** running `gwrk measure compression 001-cli-core --json`, **Then**:
   - `gwrk measure compression 001-cli-core --json | jq '.compression.pointCompression'` exits 0
   - `gwrk measure compression 001-cli-core --json | jq '.compression.totalCompression'` exits 0

### US-008 - Role Multiplier Configuration (Priority: P1)
As a developer, I want role multiplier defaults to come from `.gwrkrc.json` so that different teams can calibrate SP-to-hour ratios.

**Implements**: FR-012

**Independent Test**: Override the TS multiplier in `.gwrkrc.json` and verify the effort report uses the custom value.

**Acceptance Scenarios**:
1. **Given** `.gwrkrc.json` with `effort.roles.TS.hoursPerSP: 6`, **When** running `gwrk measure effort <feature>`, **Then**:
   - The TS role in the report uses 6h/SP instead of the default 4h/SP
   - `grep -q '6' docs/assessments/effort-*.md` exits 0

### US-009 - Persistent Compression History (Priority: P0)
As a Principal Engineer, I want compression results recorded in the SQLite execution ledger so that I can query historical performance across features without re-scanning the git log.

**Implements**: FR-013

**Independent Test**: Run `gwrk measure compression <feature>` and verify a record is inserted into the `compression` table.

**Acceptance Scenarios**:
1. **Given** a valid feature, **When** running `gwrk measure compression <feature>`, **Then**:
   - `gwrk db runs <feature>` shows the compression command.
   - `echo "SELECT count(*) FROM compression WHERE feature_id='<feature>';" | sqlite3 ~/.gwrk/gwrk.db` returns 1.

### US-010 - Leading Compression Indicators (Priority: P1)
As an Architect, I want to see leading indicators (convergence, density, spec quality) alongside compression ratios so that I can diagnose the root cause of low compression (e.g., poor spec quality leading to many retries).

**Implements**: FR-014, FR-015

**Independent Test**: Run `gwrk measure compression <feature>` and verify indicators appear in the report and JSON.

**Acceptance Scenarios**:
1. **Given** a feature with 3 failed attempts before success, **When** running `gwrk measure compression <feature>`, **Then**:
   - `gwrk measure compression <feature> | grep -q 'Convergence (Avg Attempts): 4'` exits 0
2. **Given** a feature with 500 LOC and 10 SP, **When** running `gwrk measure compression <feature> --json`, **Then**:
   - `gwrk measure compression <feature> --json | jq '.indicators.density.linesPerSP'` returns 50.

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: System MUST parse `spec.md` and extract all user stories (`US-###`) with their SP values and role assignments. Stories without explicit SP or role MUST be flagged in the report as `unestimated`. (Implements: US-001)
- **FR-002**: System MUST compute hours for each role using the formula: `Role Hours = SP × Hours/SP rate` then apply a 1.25× overhead factor to the total. Role rates default to: RE=6, TS=4, PM=2, PE=1.5, DE=5. (Implements: US-001)
- **FR-003**: System MUST generate a markdown report at `docs/assessments/effort-<feature>-YYYY-MM-DD.md` containing: executive summary, role breakdown table, per-story breakdown, and methodology section. (Implements: US-001)
- **FR-004**: System MUST exit with code 1 and a clear stderr message when `spec.md` is missing or contains no parseable user stories. (Implements: US-002)
- **FR-005**: System MUST collect timestamps from multiple sources: OS `createdAt` on `spec.md`, Git commit timestamps (first/last impl commit), PR merge time via `gh pr view`, and `.gwrk/history.jsonl` entries. (Implements: US-003)
- **FR-006**: System MUST detect active coding time by clustering Git commits with a configurable gap threshold (default: 30 minutes). Gaps larger than the threshold define session boundaries. Active coding time = sum of session durations. (Implements: US-003, US-004)
- **FR-007**: System MUST compute Point Compression = Estimated Coding Hours ÷ Actual Coding Time (from commit clustering). (Implements: US-003)
- **FR-008**: System MUST compute Total Compression = Estimated Elapsed Days ÷ Actual Elapsed Days (first impl commit → merge). (Implements: US-003)
- **FR-009**: System MUST provide `gwrk measure compression --all` that generates a summary table across all features with: SP, estimated hours, actual coding time, Point Compression, Total Compression, trend analysis, and best/worst identification. (Implements: US-005)
- **FR-010**: System MUST exit with code 1 and a clear stderr message when a feature has no implementation commits in the Git log. (Implements: US-006)
- **FR-011**: System MUST support `--json` flag on both `gwrk measure effort` and `gwrk measure compression` commands, outputting structured JSON to stdout. (Implements: US-007)
- **FR-012**: System MUST read role multiplier overrides from `.gwrkrc.json` at key `effort.roles.<CODE>.hoursPerSP`. If the key is absent, canonical defaults are used. (Implements: US-008)
- **FR-013**: System MUST record compression results in the global SQLite `compression` table. Records are keyed by `(feature_id, project_id)`. (Implements: US-009)
- **FR-014**: System MUST compute leading indicators from the `runs` table and filesystem:
  - **Convergence**: First-pass rate (count of T0xx tasks with attempt=1 / total tasks) and Avg attempts per task.
  - **Density**: Lines/SP, Files/SP, Tool Calls/SP.
  - **Spec Quality**: Contract count and Gate count. (Implements: US-010)
- **FR-015**: System MUST include leading indicators in the CLI output and JSON payload of the compression report. (Implements: US-010)

#### FR-004 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| spec.md not found | `spec.md not found for feature '<feature>'` | 1 |
| No user stories | `No user stories found in spec.md for '<feature>'` | 1 |

#### FR-010 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No impl commits | `No implementation commits found for feature '<feature>'` | 1 |
| Feature not found | `Feature directory not found: specs/<feature>` | 1 |
| Effort data missing | `Cannot compute compression — run 'gwrk measure effort <feature>' first` | 1 |

---

## 5. Data Model Requirements

### DM-001: Effort Report Data

```typescript
interface EffortReport {
  featureId: string;                // e.g. "001-cli-core"
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
  roleName: string;                 // "Rust / Engine Engineer"
  hoursPerSP: number;
  spAssigned: number;
  rawHours: number;                 // spAssigned * hoursPerSP
  withOverhead: number;             // rawHours * overheadFactor
  days: number;                     // withOverhead / 8
}

interface StoryEstimate {
  storyId: string;                  // "US-001"
  title: string;
  sp: number;
  roles: string[];                  // ["TS", "PE"]
  rawHours: number;
  withOverhead: number;
}
```

### DM-002: Compression Report Data (SQLite Aligned)

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
  specCreatedAt: string;            // ISO 8601 — OS file date or first git commit
  planApprovedAt?: string;          // ISO 8601 — last plan.md commit before impl
  firstImplCommit: string;          // ISO 8601
  lastImplCommit: string;           // ISO 8601
  prMergedAt?: string;              // ISO 8601 — from `gh pr view`
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
    firstPassRate: number;          // %
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

### DM-003: Compression Summary Data

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
  trend: string;                    // "improving" | "declining" | "stable"
}
```

---

## 6. Technical Constraints

- **TC-001**: Determinism — Given the same spec.md, Git log, and role multipliers, the effort report and compression ratios MUST be identical across runs. Engine functions MUST satisfy SHA256 stability invariants for input/output.
- **TC-002**: Air-Gapped — No external network calls at runtime. Git operations use local `.git` history. `gh pr view` is the only external call (GitHub CLI, local auth) and MUST degrade gracefully if `gh` is unavailable (use last impl commit as delivery endpoint).
- **TC-003**: Fail-Fast Config — Zod validation with no `.default()` calls for required fields. Missing config → `process.exit(1)`.
- **TC-004**: Session Gap Threshold — The 30-minute default for commit clustering MUST be configurable via `.gwrkrc.json` at `compression.sessionGapMinutes`. No hardcoded magic value.
- **TC-005**: Effort Engine is Deterministic from Artifacts — The effort engine reads spec.md and uses only the markdown parser, never an LLM. Role assignment comes from explicit markers in the spec, not inference.
- **TC-006**: Compression Depends on Effort — `gwrk measure compression <feature>` MUST fail if no effort data exists for the feature. Users must run `gwrk measure effort <feature>` first, or compression must internally invoke the effort engine.
- **TC-007**: Relational Fidelity — SQLite schema MUST strictly follow ADR-002. All floating point values MUST be stored with 2-decimal precision.

---

## 7. Testing Requirements

- **TR-001**: `src/engine/effort.test.ts` — Verify story extraction from spec.md with various formats (US-001 with SP, US-001 without SP, sub-stories US-001a). Vitest. (FR-001)
- **TR-002**: `src/engine/effort.test.ts` — Verify role hour calculation: 5 SP × TS(4h) = 20h raw, 25h with 1.25× overhead. Vitest. (FR-002)
- **TR-003**: `src/engine/effort.test.ts` — Verify report generation writes valid markdown to `docs/assessments/effort-<feature>-YYYY-MM-DD.md`. Vitest. (FR-003)
- **TR-004**: `src/engine/effort.test.ts` — Verify fail-fast on missing spec.md (exit 1, stderr contains "spec.md not found"). Vitest. (FR-004)
- **TR-005**: `src/engine/compression.test.ts` — Verify timestamp collection: extract spec creation date, first/last impl commit from Git log. Mock `git log` output. Vitest. (FR-005)
- **TR-006**: `src/engine/compression.test.ts` — Verify commit clustering: given timestamps [0, 5, 10, 120, 125] minutes, detect 2 sessions with 15 total active minutes. Vitest. (FR-006)
- **TR-007**: `src/engine/compression.test.ts` — Verify Point Compression calculation: 287.5h estimated ÷ 0.75h actual = 383× ratio. Vitest. (FR-007)
- **TR-008**: `src/engine/compression.test.ts` — Verify Total Compression calculation: 36 days estimated ÷ 0.73 days actual = 49× ratio. Vitest. (FR-008)
- **TR-009**: `src/engine/compression.test.ts` — Verify `--all` summary aggregation across multiple features with best/worst/trend. Vitest. (FR-009)
- **TR-010**: `src/engine/compression.test.ts` — Verify fail-fast on feature with no impl commits (exit 1). Vitest. (FR-010)
- **TR-011**: `src/commands/effort.test.ts` — Verify `--json` flag outputs valid JSON with correct schema. Vitest. (FR-011)
- **TR-012**: `src/commands/compression.test.ts` — Verify `--json` flag outputs valid JSON with `pointCompression` and `totalCompression` fields. Vitest. (FR-011)
- **TR-013**: `src/engine/effort.test.ts` — Verify role multiplier override from `.gwrkrc.json` takes precedence over defaults. Vitest. (FR-012)
- **TR-014**: `src/db/db.test.ts` — Verify SQLite persistence in `compression` table according to ADR-002 schema. (FR-013)
- **TR-015**: `src/engine/compression.test.ts` — Verify leading indicator calculation: first-pass rate, density (lines/SP), spec quality. (FR-014)

---

## 8. Success Criteria

- **SC-001**: `gwrk measure effort <feature>` generates a complete effort report from spec stories in under 30 seconds with zero network calls.
- **SC-002**: `gwrk measure compression <feature>` produces Point and Total Compression ratios that are mathematically correct given the Git log timestamps and effort forecast.
- **SC-003**: `gwrk measure compression --all` produces a summary table across all shipped features with trend analysis.
- **SC-004**: Compression ratios correctly exclude dormancy periods.
- **SC-005**: Compression data is successfully persisted to SQLite and reachable via `gwrk db`.

---

## 9. Verification Requirements

- **VR-001**: E2E test: create a mock spec.md with 3 stories → run `gwrk measure effort <feature>` → verify report file exists and contains correct role breakdown with 1.25× overhead applied.
- **VR-002**: E2E test: create a feature with known Git commit timestamps → run `gwrk measure compression <feature>` → verify Point and Total Compression ratios match hand-calculated expected values.
- **VR-003**: Negative test: `gwrk measure effort` with missing spec.md → verify exit 1 and stderr message.
- **VR-004**: Negative test: `gwrk measure compression` with no impl commits → verify exit 1 and stderr message.
- **VR-005**: Dormancy test: spec created 180 days before first impl commit → verify dormancy is reported but NOT counted in compression ratios.
- **VR-006**: SQLite test: run compression → verify record exists in global ledger with correct `point_compression` value.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-002, FR-003 | FR-001 | US-001 | TR-001 |
| US-001 | FR-001, FR-002, FR-003 | FR-002 | US-001 | TR-002 |
| US-001 | FR-001, FR-002, FR-003 | FR-003 | US-001 | TR-003 |
| US-002 | FR-004 | FR-004 | US-002 | TR-004 |
| US-003 | FR-005, FR-006, FR-007, FR-008 | FR-005 | US-003 | TR-005 |
| US-003, US-004 | FR-006 | FR-006 | US-003, US-004 | TR-006 |
| US-003 | FR-007 | FR-007 | US-003 | TR-007 |
| US-003 | FR-008 | FR-008 | US-003 | TR-008 |
| US-005 | FR-009 | FR-009 | US-005 | TR-009 |
| US-006 | FR-010 | FR-010 | US-006 | TR-010 |
| US-007 | FR-011 | FR-011 | US-007 | TR-011, TR-012 |
| US-008 | FR-012 | FR-012 | US-008 | TR-013 |
| US-009 | FR-013 | FR-013 | US-009 | TR-014 |
| US-010 | FR-014, FR-015 | FR-014 | US-010 | TR-015 |
| US-010 | FR-014, FR-015 | FR-015 | US-010 | TR-015 |
