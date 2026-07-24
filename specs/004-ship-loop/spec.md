---
type: specification
feature: 004-ship-loop
last_modified: "2026-06-19T11:00:00Z"
revision: 2
---

# Feature Specification: 004 Ship Loop (Reworked)

**Feature Branch**: `develop`
**Created**: 2026-03-05
**Revised**: 2026-06-19 (Rework v2 - Profile-aware Build/Test Skipping & Schema-compliant Agent Init)
**Status**: Active
**Input**: Rework ship-orchestrator and toolchain-mapper to support non-TypeScript projects by allowing skipping of BUILD_CHECK and TEST_GATE, adding toolchain build/test config, and fixing Zod agent validation issues from gwrk init.

---

## 2. User Scenarios & Testing

### US-001 - Ship Single Phase completes lifecycle (Priority: P0)
As a Principal Engineer, I want to run `gwrk ship` for a single phase and have the entire branch -> implement -> review -> PR -> CI lifecycle execute successfully.

**Implements**: FR-001, FR-002, FR-004, FR-005, FR-011, FR-015, FR-019, FR-020, FR-021

**Independent Test**: Run `gwrk ship 004-ship-loop phase-01` in a sandbox project.

**Acceptance Scenarios**:
1. **Given** a valid feature branch, **When** running a single phase, **Then**:
   - `gwrk ship 004-ship-loop phase-01 --non-interactive` exits 0
   - `git branch --list | grep -q 'feat/004-ship-loop'` exits 0
   - `gwrk tasks list 004-ship-loop --json | jq -e '.tasks[] | select(.id=="T001").status == "completed"'` exits 0

---

### US-002 - Pre-flight tasks.json gate checks (Priority: P0)
As a ship engine, I want tasks that already pass their gate script to be skipped during implementation to prevent redundant work.

**Implements**: FR-003

**Independent Test**: Mock task gate as passing, run ship loop, verify skip message in logs.

**Acceptance Scenarios**:
1. **Given** task `T001` gate script exits 0, **When** running `gwrk ship`, **Then**:
   - `gwrk ship 004-ship-loop phase-01 2>&1 | grep -q 'pre-flight PASS'` exits 0

---

### US-003 - Ship All Phases sequentially (Priority: P0)
As a PE, I want to omit the phase argument in `gwrk ship` to ship all phases in the feature sequentially.

**Implements**: FR-001, FR-013

**Independent Test**: Run `gwrk ship 004-ship-loop` with multiple open phases.

**Acceptance Scenarios**:
1. **Given** multiple open phases, **When** running `gwrk ship` without a phase argument, **Then**:
   - `gwrk ship 004-ship-loop --non-interactive` exits 0

---

### US-004 - Circuit Breaker (Priority: P0)
As a developer, I want the shipping loop to terminate if implementing takes more than `MAX_ITERATIONS` to prevent infinite loops.

**Implements**: FR-007

**Independent Test**: Set `MAX_ITERATIONS=1`, fail review twice, assert loop terminates.

**Acceptance Scenarios**:
1. **Given** `MAX_ITERATIONS=1` and failing review, **When** running `gwrk ship`, **Then**:
   - `gwrk ship 004-ship-loop phase-01 --non-interactive` exits 1
   - `gwrk ship 004-ship-loop phase-01 2>&1 | grep -q 'CIRCUIT_BREAK'` exits 0

---

### US-005 - Crash Recovery (Priority: P0)
As a developer, I want the shipping loop to save its state before every stage transition and resume from that stage if interrupted.

**Implements**: FR-008

**Independent Test**: Kill `gwrk ship` during implementation, resume, assert state loaded.

**Acceptance Scenarios**:
1. **Given** a saved state file under `.runs/`, **When** running `gwrk ship` again, **Then**:
   - `gwrk ship 004-ship-loop phase-01 --non-interactive` exits 0
   - `gwrk ship 004-ship-loop phase-01 2>&1 | grep -q 'Resuming from stage'` exits 0

---

### US-006 - PR Creation & CI Gate (Priority: P0)
As a ship engine, I want to push code to GitHub, create a PR to develop, and wait for CI check statuses to pass before marking the phase complete.

**Implements**: FR-006

**Independent Test**: Mock GitHub CLI responses and PR status checks.

**Acceptance Scenarios**:
1. **Given** successful review state, **When** running PR_CI stage, **Then**:
   - `gwrk ship 004-ship-loop phase-01 2>&1 | grep -q 'PR created'` exits 0
   - `gwrk ship 004-ship-loop phase-01 2>&1 | grep -q 'CI checks passed'` exits 0

---

### US-007 - Execution Manifest with Log Digest (Priority: P0)
As a PE, I want a structured execution manifest and log digest committed to the repo on success to keep analytical records.

**Implements**: FR-010, FR-012, FR-017

**Independent Test**: Assert run manifest and logs exist in `.gwrk/runs/`.

**Acceptance Scenarios**:
1. **Given** a successful phase run, **When** finished, **Then**:
   - `ls specs/004-ship-loop/.gwrk/runs/*.json` exits 0
   - `cat specs/004-ship-loop/.gwrk/runs/*.json | jq -e '.digest'` exits 0

---

### US-008 - Agent Backend Config resolution (Priority: P0)
As a PE, I want the ship loop to resolve agent backends hierarchically (CLI flags > `.gwrkrc.json` > system defaults).

**Implements**: FR-009

**Independent Test**: Pass `--agent claude` and assert Claude backend is dispatched.

**Acceptance Scenarios**:
1. **Given** `.gwrkrc.json` defines backend `gemini`, **When** running with `--agent claude`, **Then**:
   - `gwrk ship 004-ship-loop phase-01 --agent claude 2>&1 | grep -q 'dispatching to claude'` exits 0

---

### US-009 - Phase-Skip for Completed Phases (Priority: P0)
As a ship engine, I want to skip phases where all tasks are already complete to avoid wasting execution resources.

**Implements**: FR-014

**Independent Test**: Set all tasks in a phase to `completed`, verify phase is skipped.

**Acceptance Scenarios**:
1. **Given** all tasks completed in `phase-01`, **When** shipping the feature, **Then**:
   - `gwrk ship 004-ship-loop phase-01 2>&1 | grep -q 'skipping completed phase'` exits 0

---

### US-010 - Staging Validation (Priority: P0)
As a PE, I want a validation script to run before push to assert that no files outside the build plan/scope are modified.

**Implements**: FR-016

**Independent Test**: Modify `package.json` in a task not planning it, assert validation rejection.

**Acceptance Scenarios**:
1. **Given** out-of-scope files staged, **When** implementing task, **Then**:
   - `gwrk ship 004-ship-loop phase-01 2>&1 | grep -q 'Staging validation failed'` exits 0

---

### US-011 - Structured failureContext on CIRCUIT_BREAK (Priority: P0)
As a developer, I want a structured `failureContext` JSON written to the state file on circuit break so that debugging is straightforward.

**Implements**: FR-018

**Independent Test**: Trigger circuit break, read the state file, assert JSON format.

**Acceptance Scenarios**:
1. **Given** a circuit broken run, **When** reading the state file, **Then**:
   - `cat .runs/004-ship-loop.state.json | jq -e '.failureContext'` exits 0

---

### US-012 - Profile-Aware Build & Test Skip (Priority: P0) ⭐ **REWORK**
As a PE, I want `gwrk ship` to skip `BUILD_CHECK` and/or `TEST_GATE` when build or test toolchains are not configured or are set to `null`, so that the shipping loop does not fail on non-TypeScript, polyglot, or zero-build projects.

**Implements**: FR-022, FR-023, FR-024

**Independent Test**: Configure `toolchain.build = null` and `toolchain.test = null` in `.gwrkrc.json`, run `gwrk ship`.

**Acceptance Scenarios**:
1. **Given** a project with `toolchain.build = null` in `.gwrkrc.json`, **When** running the shipping loop, **Then**:
   - `gwrk ship 004-ship-loop phase-01 2>&1 | grep -q '✓ build skipped (no build toolchain)'` exits 0
2. **Given** a project with `toolchain.test = null` in `.gwrkrc.json`, **When** running the shipping loop, **Then**:
   - `gwrk ship 004-ship-loop phase-01 2>&1 | grep -q '✓ tests skipped (no test toolchain)'` exits 0

---

### US-013 - Schema-Compliant Agent Initialization (Priority: P0) ⭐ **REWORK**
As a developer, I want `gwrk init` to generate a `.gwrkrc.json` with a schema-compliant `agents` block (containing `define`, `implement`, `registry`, and `fallbackOrder` fields) so that Zod validation does not fail on projects initialized via `gwrk init`.

**Implements**: FR-025

**Independent Test**: Run `gwrk init --non-interactive` in a clean directory, then run `gwrk project info`.

**Acceptance Scenarios**:
1. **Given** a clean directory, **When** running `gwrk init --non-interactive`, **Then**:
   - `gwrk init --non-interactive` exits 0
   - `cat .gwrkrc.json | jq -e '.agents.define'` exits 0
   - `cat .gwrkrc.json | jq -e '.agents.implement'` exits 0
   - `cat .gwrkrc.json | jq -e '.agents.registry'` exits 0
   - `cat .gwrkrc.json | jq -e '.agents.fallbackOrder'` exits 0
   - `gwrk project info` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: System MUST delegate shipping execution to `ShipOrchestrator` state machine. (Implements: US-001, US-003)
- **FR-002**: System MUST check for dirty working trees and reject execution if unstaged changes exist. (Implements: US-001)
- **FR-003**: System MUST execute a task's gate script before dispatching implementation, skipping the task if it already passes. (Implements: US-002)
- **FR-004**: System MUST transition feature state correctly from BRANCH_SETUP to IMPLEMENT to CODE_REVIEW/UAT_REVIEW to PR_CI to DONE. (Implements: US-001)
- **FR-005**: System MUST dispatch human/agent reviews, executing loops back to IMPLEMENT on NO-GO decisions. (Implements: US-001)
- **FR-006**: System MUST push branches to the remote repository, create a PR to develop, and block completion until remote CI checks succeed. (Implements: US-006)
- **FR-007**: System MUST trip the circuit breaker and abort execution if reviews fail continuously exceeding `MAX_ITERATIONS`. (Implements: US-004)
- **FR-008**: System MUST persist execution state to a machine-local file before every stage transition to support recovery. (Implements: US-005)
- **FR-009**: System MUST resolve agent configuration hierarchically by checking CLI parameters, `.gwrkrc.json` configs, and fallback systems. (Implements: US-008)
- **FR-010**: System MUST store timestamped logs of agent and toolchain output under `.runs/`. (Implements: US-007)
- **FR-011**: System MUST record shipping runs in the SQLite runs analytical ledger database. (Implements: US-001)
- **FR-012**: System MUST commit a structured run manifest JSON to the repository under `specs/<feature>/.gwrk/runs/`. (Implements: US-007)
- **FR-013**: System MUST ship all open phases sequentially if a phase argument is omitted. (Implements: US-003)
- **FR-014**: System MUST skip phases where all tasks are already completed. (Implements: US-009)
- **FR-015**: System MUST append the Agent-Native operational signal wrapper `[exit:N | Xs]` to all output streams. (Implements: US-001)
- **FR-016**: System MUST run validation script assertions on staged files before pushing changes. (Implements: US-010)
- **FR-017**: System MUST support 3-tier logging (raw logs, digest array inside the manifest, SQLite runs history). (Implements: US-007)
- **FR-018**: System MUST write a structured `failureContext` JSON block to the state file on circuit break. (Implements: US-011)
- **FR-019**: System MUST encapsulate agent interaction within a single `dispatchToAgent()` function. (Implements: US-001)
- **FR-020**: System MUST normalize agent CLI exit codes to standard gwrk exit codes. (Implements: US-001)
- **FR-021**: System MUST deliver agent prompt context via standard input piping. (Implements: US-001)
- **FR-022**: System MUST map a project's build command from the `ProjectProfile` using `getBuildCommand()`, skipping compilation with a standard message if the command is `null`. (Implements: US-012)
- **FR-023**: System MUST execute and assert tests using the mapped test command, skipping execution with a standard message if the mapped test command is `null`. (Implements: US-012)
- **FR-024**: System MUST extend `GwrkConfigSchema` to validate `project.toolchain` (and per-workspace `workspaces[].toolchain`): `build` (optional, nullable string — `null` skips build), `test` (optional, nullable **harness enum** — `null` skips tests), `testCommand` (optional free-form string; wins over `test`), and `testExtension`/`sourceExtension` (optional strings). Validation MUST reject wrong types (`ZodError`, exit 1). (Implements: US-012; amended by ADR-005 §11 — `test` is a harness enum, not a free string, so the mapper can select per-harness invocation syntax; the free-form escape hatch is `testCommand`.)
- **FR-025**: System MUST generate a schema-compliant `agents` block inside `.gwrkrc.json` during `gwrk init` containing correct Zod properties. (Implements: US-013)

#### FR-002 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Dirty git tree detected at startup | Dirty working tree | 1 |

#### FR-007 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Max iterations exceeded | CIRCUIT_BREAK | 1 |

#### FR-008 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| State file is corrupted and cannot be parsed | State recovery failed | 1 |

#### FR-016 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Out-of-scope files staged | Staging validation failed | 1 |

#### FR-022 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Mapped build command execution fails | build FAILED | 1 |

#### FR-023 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Mapped test command execution fails | TEST_GATE: new failure | 1 |

#### FR-024 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Configuration fails schema validation | ZodError | 1 |

---

## 5. Data Model Requirements

- **DM-001**: `ShipState` state file schema:
  ```typescript
  interface WudState {
    featureId: string;
    phaseId: string;
    stage: ShipStage;
    iteration: number;
    testBaseline?: number;
    failureContext?: {
      openTasks: string[];
      lastVerdict?: string;
      digest: string[];
    };
  }
  ```
- **DM-003**: `.gwrkrc.json` configuration Zod schema updated to support `project.toolchain` (amended by ADR-005 §11 — `test` is a harness enum so `toolchain-mapper` can pick per-harness flag syntax; `testCommand` is the free-form escape hatch for e.g. `make test:auth`):
  ```typescript
  const TEST_HARNESSES = ["vitest","jest","pytest","cargo-test","go-test","node-test"] as const;
  const ToolchainConfigSchema = z.object({
    primary: z.enum(["biome","eslint","ruff"]).optional(),
    formatter: z.enum(["prettier","biome","black"]).optional(),
    test: z.enum(TEST_HARNESSES).nullable().optional(),   // null = skip; undefined = infer
    testCommand: z.string().optional(),                    // free-form; WINS over `test`
    build: z.string().nullable().optional(),               // null = skip; undefined = infer
    testExtension: z.string().optional(),                  // e.g. ".test.js"
    sourceExtension: z.string().optional(),                // e.g. ".js"
  }).optional();
  ```
  The same schema is reused for `workspaces[].toolchain` (per-workspace polyglot monorepo support).
- **DM-005**: `ExecutionManifest` schema committed to `specs/<feature>/.gwrk/runs/`.

---

## 6. Technical Constraints

- **TC-001**: Air-Gapped — No external network calls at runtime. No CDN. No telemetry.
- **TC-002**: Fail-Fast Config — Zod validation with no `.default()` calls. Missing var → `process.exit(1)`.
- **TC-003**: TypeScript Only — No `.js` or `.jsx` in `src/`. ESM modules, ES2022 target.
- **TC-004**: No interactive execution — All commands must complete without human input.

---

## 7. Testing Requirements

- **TR-001**: `src/scripts-e2e.test.ts` — asserts that a single phase runs successfully from start to finish. Vitest. (FR-001)
- **TR-002**: `src/scripts-e2e.test.ts` — asserts that dirty git working trees are rejected at branch setup stage. Vitest. (FR-002)
- **TR-003**: `src/scripts-e2e.test.ts` — asserts that passing pre-flight gates skips the task. Vitest. (FR-003)
- **TR-004**: `src/scripts-e2e.test.ts` — asserts the state transitions are recorded accurately. Vitest. (FR-004)
- **TR-005**: `src/scripts-e2e.test.ts` — asserts review dispatch loops on NO-GO. Vitest. (FR-005)
- **TR-006**: `src/scripts-e2e.test.ts` — asserts PR is created and CI is successfully awaited. Vitest. (FR-006)
- **TR-007**: `src/commands/ship.test.ts` — asserts circuit breaker triggers after MAX_ITERATIONS. Vitest. (FR-007)
- **TR-008**: `src/commands/ship.test.ts` — asserts crash recovery resumes correctly from the last persisted stage. Vitest. (FR-008)
- **TR-009**: `src/commands/ship.test.ts` — asserts hierarchical resolution of agent backends. Vitest. (FR-009)
- **TR-010**: `src/scripts-e2e.test.ts` — asserts raw logs are stored under `.runs/`. Vitest. (FR-010)
- **TR-011**: `src/commands/ship.test.ts` — asserts run details are saved into the SQLite execution runs table. Vitest. (FR-011)
- **TR-012**: `src/commands/ship.test.ts` — asserts execution manifest and digest write. Vitest. (FR-012)
- **TR-013**: `src/commands/ship.test.ts` — asserts sequential shipping of all phases. Vitest. (FR-013)
- **TR-014**: `src/commands/ship.test.ts` — asserts completed phases are skipped. Vitest. (FR-014)
- **TR-015**: `src/commands/ship.test.ts` — asserts exit codes are wrapped with signal format. Vitest. (FR-015)
- **TR-016**: `src/scripts-e2e.test.ts` — asserts out-of-scope files trigger staging validation failure. Vitest. (FR-016)
- **TR-017**: `src/scripts-e2e.test.ts` — asserts three-tier logging format and content. Vitest. (FR-017)
- **TR-018**: `src/scripts-e2e.test.ts` — asserts state contains failureContext JSON on circuit break. Vitest. (FR-018)
- **TR-019**: `src/utils/agent.test.ts` — asserts `dispatchToAgent` returns a valid `TaskResult`. Vitest. (FR-019)
- **TR-020**: `src/utils/agent.test.ts` — asserts exit code normalization. Vitest. (FR-020)
- **TR-021**: `src/utils/agent.test.ts` — asserts context piping via stdin. Vitest. (FR-021)
- **TR-022**: `src/utils/toolchain-mapper.test.ts` — asserts `getBuildCommand` returns correct command or null from ProjectProfile. Vitest. (FR-022)
- **TR-023**: `src/engine/ship-orchestrator.test.ts` — asserts `stageBuildCheck` and `stageTestGate` skip execution when build/test command is null. Vitest. (FR-022, FR-023)
- **TR-024**: `src/utils/config.test.ts` — asserts `GwrkConfigSchema` validates build/test toolchain properties. Vitest. (FR-024)
- **TR-025**: `src/commands/init.test.ts` — asserts agent configuration written during init is schema-compliant. Vitest. (FR-025)

---

## 8. Success Criteria

- **SC-001**: Clean ship run compiles and passes tests on TypeScript projects.
- **SC-002**: Clean ship run skips compilation and/or tests on non-TypeScript projects without crashing.
- **SC-003**: `gwrk init` writes valid schema-compliant configuration that Zod parses successfully.

---

## 9. Verification Requirements

- **VR-001**: E2E validation verifying that `gwrk ship` completes successfully on a typescript project.
- **VR-002**: E2E validation verifying that `gwrk ship` skips build check on a python project (no build toolchain).
- **VR-003**: E2E validation verifying that `gwrk init` produces a `.gwrkrc.json` that passes Zod verification.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-002, FR-004, FR-005, FR-011, FR-015, FR-019, FR-020, FR-021 | FR-001 | US-001, US-003 | TR-001 |
| US-002 | FR-003 | FR-002 | US-001 | TR-002 |
| US-003 | FR-001, FR-013 | FR-003 | US-002 | TR-003 |
| US-004 | FR-007 | FR-004 | US-001 | TR-004 |
| US-005 | FR-008 | FR-005 | US-001 | TR-005 |
| US-006 | FR-006 | FR-006 | US-006 | TR-006 |
| US-007 | FR-010, FR-012, FR-017 | FR-007 | US-004 | TR-007 |
| US-008 | FR-009 | FR-008 | US-005 | TR-008 |
| US-009 | FR-014 | FR-009 | US-008 | TR-009 |
| US-010 | FR-016 | FR-010 | US-007 | TR-010 |
| US-011 | FR-018 | FR-011 | US-001 | TR-011 |
| US-012 | FR-022, FR-023, FR-024 | FR-012 | US-007 | TR-012 |
| US-013 | FR-025 | FR-013 | US-003 | TR-013 |
| | | FR-014 | US-009 | TR-014 |
| | | FR-015 | US-001 | TR-015 |
| | | FR-016 | US-010 | TR-016 |
| | | FR-017 | US-007 | TR-017 |
| | | FR-018 | US-011 | TR-018 |
| | | FR-019 | US-001 | TR-019 |
| | | FR-020 | US-001 | TR-020 |
| | | FR-021 | US-001 | TR-021 |
| | | FR-022 | US-012 | TR-022, TR-023 |
| | | FR-023 | US-012 | TR-023 |
| | | FR-024 | US-012 | TR-024 |
| | | FR-025 | US-013 | TR-025 |
