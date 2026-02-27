# Feature Specification: 007 Effort + Compression

**Feature Branch**: `007-effort-compression`
**Created**: 2026-02-27
**Status**: Draft
**Input**: SP-driven effort estimation engine and delivery speed compression measurement — story extraction, role bracketing, timestamp collection, active coding detection, Point/Total compression ratios, dormancy tracking, per-feature and cross-feature reports

---

## 2. User Scenarios & Testing

### US-001 - Effort Estimation for a Single Feature (Priority: P0)
As a Principal Engineer, I want to run `gwrk effort <feature>` so that an SP-driven effort estimate is generated from the spec's user stories, bracketed by role, with the standard 1.25× overhead factor applied, producing a markdown report I can hand to a client.

**Implements**: FR-001, FR-002, FR-003

**Independent Test**: Run `gwrk effort 001-cli-core` and verify a report is generated with the correct role breakdown.

**Acceptance Scenarios**:
1. **Given** a feature `001-cli-core` with a `spec.md` containing 10 user stories with SP values and role assignments, **When** the user runs `gwrk effort 001-cli-core`, **Then**:
   - `test -f docs/assessments/effort-001-cli-core-*.md` exits 0
   - `grep -q 'Total Story Points' docs/assessments/effort-001-cli-core-*.md` exits 0
   - `grep -q '1.25' docs/assessments/effort-001-cli-core-*.md` exits 0
2. **Given** a feature with stories assigned to `TS` (4h/SP) and `PE` (1.5h/SP) roles, **When** the report is generated, **Then**:
   - `grep -q 'TS / Fullstack Developer' docs/assessments/effort-001-cli-core-*.md` exits 0
   - `grep -q 'Principal Engineer' docs/assessments/effort-001-cli-core-*.md` exits 0

### US-002 - Effort Report Handles Missing Spec (Priority: P0)
As a user, I want `gwrk effort <feature>` to fail fast with a clear error if the spec.md is missing or contains no user stories, so that I know what to fix.

**Implements**: FR-004

**Independent Test**: Run `gwrk effort nonexistent-feature` and verify exit code 1 with meaningful stderr.

**Acceptance Scenarios**:
1. **Given** no `spec.md` exists for `nonexistent-feature`, **When** running `gwrk effort nonexistent-feature`, **Then**:
   - Command exits with code 1
   - `gwrk effort nonexistent-feature 2>&1 | grep -q 'spec.md not found'` exits 0
2. **Given** a `spec.md` with no user stories (no `US-` markers), **When** running `gwrk effort empty-feature`, **Then**:
   - Command exits with code 1
   - `gwrk effort empty-feature 2>&1 | grep -q 'No user stories found'` exits 0

### US-003 - Single Feature Compression Report (Priority: P0)
As a Principal Engineer, I want to run `gwrk compression <feature>` so that I see Point Compression and Total Compression ratios for a shipped feature, with full timeline breakdown including dormancy tracking.

**Implements**: FR-005, FR-006, FR-007, FR-008

**Independent Test**: Run `gwrk compression 001-cli-core` on a feature with merged commits and verify both ratios appear.

**Acceptance Scenarios**:
1. **Given** a feature `001-cli-core` with merged implementation commits, **When** running `gwrk compression 001-cli-core`, **Then**:
   - `gwrk compression 001-cli-core | grep -q 'Point Compression'` exits 0
   - `gwrk compression 001-cli-core | grep -q 'Total Compression'` exits 0
   - `gwrk compression 001-cli-core | grep -q 'Dormancy'` exits 0
2. **Given** a feature with spec.md created 30 days before first impl commit, **When** the compression report runs, **Then**:
   - `gwrk compression 001-cli-core | grep -qE 'Dormancy.*[0-9]+ days'` exits 0

### US-004 - Active Coding Detection via Commit Clustering (Priority: P0)
As the compression engine, I want actual coding time computed by clustering Git commits with a 30-minute gap threshold so that dormant periods and overnight waits are not counted as coding time.

**Implements**: FR-006

**Independent Test**: Given a commit log with two clusters separated by >30 min, verify the active coding time equals the sum of the two cluster durations, not the total elapsed time.

**Acceptance Scenarios**:
1. **Given** a feature with commits at T+0min, T+5min, T+10min, T+120min, T+125min (two sessions: 10min + 5min = 15min total), **When** the compression engine processes timestamps, **Then**:
   - `gwrk compression test-feature --json | jq '.activeCodingMinutes'` outputs a value ≤ 20 (not 125)

### US-005 - Cross-Feature Compression Summary (Priority: P1)
As a Principal Engineer, I want to run `gwrk compression --all` so that I see a summary table across all shipped features with trends and best/worst analysis.

**Implements**: FR-009

**Independent Test**: Run `gwrk compression --all` with multiple shipped features and verify the summary table appears.

**Acceptance Scenarios**:
1. **Given** at least 2 features with compression data, **When** running `gwrk compression --all`, **Then**:
   - `gwrk compression --all | grep -q 'COMPRESSION SUMMARY'` exits 0
   - `gwrk compression --all | grep -c '^  [0-9]' | test $(cat) -ge 2` exits 0
2. **Given** features with varying compression ratios, **When** the summary is generated, **Then**:
   - `gwrk compression --all | grep -q 'Best:'` exits 0
   - `gwrk compression --all | grep -q 'Trend:'` exits 0

### US-006 - Compression Handles Unshipped Features (Priority: P0)
As a user, I want `gwrk compression <feature>` to fail fast with a clear message if the feature has no implementation commits or no merged PRs, so I know compression can only be measured for shipped work.

**Implements**: FR-010

**Independent Test**: Run `gwrk compression` on a feature with only a spec.md and verify exit code 1.

**Acceptance Scenarios**:
1. **Given** a feature `draft-only` with spec.md but no implementation commits, **When** running `gwrk compression draft-only`, **Then**:
   - Command exits with code 1
   - `gwrk compression draft-only 2>&1 | grep -q 'No implementation commits found'` exits 0

### US-007 - JSON Output Mode (Priority: P1)
As an integrator (Glass Dashboard, Telegram bot), I want both `gwrk effort` and `gwrk compression` to support `--json` output so that structured data can be consumed programmatically.

**Implements**: FR-011

**Independent Test**: Run `gwrk effort 001-cli-core --json` and verify valid JSON output.

**Acceptance Scenarios**:
1. **Given** a valid feature, **When** running `gwrk effort 001-cli-core --json`, **Then**:
   - `gwrk effort 001-cli-core --json | jq '.totalSP'` exits 0
   - `gwrk effort 001-cli-core --json | jq '.roles | length'` returns ≥ 1
2. **Given** a shipped feature, **When** running `gwrk compression 001-cli-core --json`, **Then**:
   - `gwrk compression 001-cli-core --json | jq '.pointCompression'` exits 0
   - `gwrk compression 001-cli-core --json | jq '.totalCompression'` exits 0

### US-008 - Role Multiplier Configuration (Priority: P1)
As a developer, I want role multiplier defaults to come from `.gwrkrc.json` (or use the canonical defaults from the `/effort` workflow) so that different teams can calibrate SP-to-hour ratios.

**Implements**: FR-012

**Independent Test**: Override the TS multiplier in `.gwrkrc.json` and verify the effort report uses the custom value.

**Acceptance Scenarios**:
1. **Given** `.gwrkrc.json` with `effort.roles.TS.hoursPerSP: 6`, **When** running `gwrk effort <feature>`, **Then**:
   - The TS role in the report uses 6h/SP instead of the default 4h/SP
   - `grep -q '6' docs/assessments/effort-*.md` exits 0

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
- **FR-009**: System MUST provide `gwrk compression --all` that generates a summary table across all features with: SP, estimated hours, actual coding time, Point Compression, Total Compression, trend analysis, and best/worst identification. (Implements: US-005)
- **FR-010**: System MUST exit with code 1 and a clear stderr message when a feature has no implementation commits in the Git log. (Implements: US-006)
- **FR-011**: System MUST support `--json` flag on both `gwrk effort` and `gwrk compression` commands, outputting structured JSON to stdout. (Implements: US-007)
- **FR-012**: System MUST read role multiplier overrides from `.gwrkrc.json` at key `effort.roles.<CODE>.hoursPerSP`. If the key is absent, canonical defaults are used. (Implements: US-008)

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
| Effort data missing | `Cannot compute compression — run 'gwrk effort <feature>' first` | 1 |

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

### DM-002: Compression Report Data

```typescript
interface CompressionReport {
  featureId: string;
  generatedAt: string;              // ISO 8601
  forecast: EffortForecast;
  actuals: DeliveryActuals;
  compression: CompressionRatios;
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
  };
  best: { featureId: string; pointCompression: number };
  worst: { featureId: string; pointCompression: number };
  trend: string;                    // "improving" | "declining" | "stable"
}
```

---

## 6. Technical Constraints

- **TC-001**: Determinism — Given the same spec.md, Git log, and role multipliers, the effort report and compression ratios MUST be identical across runs.
- **TC-002**: Air-Gapped — No external network calls at runtime. Git operations use local `.git` history. `gh pr view` is the only external call (GitHub CLI, local auth) and MUST degrade gracefully if `gh` is unavailable (use last impl commit as delivery endpoint).
- **TC-003**: Fail-Fast Config — Zod validation with no `.default()` calls for required fields. Missing config → `process.exit(1)`.
- **TC-004**: Session Gap Threshold — The 30-minute default for commit clustering MUST be configurable via `.gwrkrc.json` at `compression.sessionGapMinutes`. No hardcoded magic value.
- **TC-005**: Effort Engine is Deterministic from Artifacts — The effort engine reads spec.md and uses only the markdown parser, never an LLM. Role assignment comes from explicit markers in the spec, not inference.
- **TC-006**: Compression Depends on Effort — `gwrk compression <feature>` MUST fail if no effort data exists for the feature. Users must run `gwrk effort <feature>` first, or compression must internally invoke the effort engine.

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

---

## 8. Success Criteria

- **SC-001**: `gwrk effort <feature>` generates a complete effort report from spec stories in under 30 seconds with zero network calls.
- **SC-002**: `gwrk compression <feature>` produces Point and Total Compression ratios that are mathematically correct given the Git log timestamps and effort forecast.
- **SC-003**: `gwrk compression --all` produces a summary table across all shipped features with trend analysis.
- **SC-004**: Compression ratios correctly exclude dormancy periods — a feature that sits dormant for 6 months then ships in 45 minutes shows high compression, not low.

---

## 9. Verification Requirements

- **VR-001**: E2E test: create a mock spec.md with 3 stories → run `gwrk effort <feature>` → verify report file exists and contains correct role breakdown with 1.25× overhead applied.
- **VR-002**: E2E test: create a feature with known Git commit timestamps → run `gwrk compression <feature>` → verify Point and Total Compression ratios match hand-calculated expected values.
- **VR-003**: Negative test: `gwrk effort` with missing spec.md → verify exit 1 and stderr message.
- **VR-004**: Negative test: `gwrk compression` with no impl commits → verify exit 1 and stderr message.
- **VR-005**: Dormancy test: spec created 180 days before first impl commit → verify dormancy is reported but NOT counted in compression ratios.
- **VR-006**: Clustering test: given commits with gaps of 5min, 5min, 120min, 5min → verify two sessions detected and active time ≈ 15min (not 135min).

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
