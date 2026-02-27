# Feature Specification: 001 CLI Core

**Feature Branch**: `001-cli-core`
**Created**: 2026-02-26
**Status**: Draft
**Input**: gwrk CLI infrastructure — the TypeScript CLI entry point, command routing, flat-file task tracking with Hard Gate enforcement, project scaffolding, and agent dispatch wrappers

---

## 2. User Scenarios & Testing

### US-001 - Project Initialization (Priority: P0)
As a developer adopting gwrk, I want to run `gwrk init` in my project root so that the `.agent/`, `.specify/`, `specs/`, and `.gwrkrc.json` files are scaffolded and I can start using gwrk workflows immediately.

**Implements**: FR-001

**Independent Test**: Run `gwrk init` in a temp directory and verify all scaffold directories exist.

**Acceptance Scenarios**:
1. **Given** an empty directory, **When** the user runs `gwrk init`, **Then**:
   - `test -d .agent/workflows` exits 0
   - `test -d .agent/rules` exits 0
   - `test -d .specify/templates` exits 0
   - `test -d specs` exits 0
   - `test -f .gwrkrc.json` exits 0
2. **Given** a directory that already has `.agent/`, **When** the user runs `gwrk init`, **Then**:
   - `gwrk init 2>&1 | grep -q 'already initialized'` exits 0

### US-002 - Agent Specification (Priority: P0)
As a Principal Engineer, I want to run `gwrk specify "my feature"` so that the `/specify` workflow is dispatched against a configured agent backend and a `spec.md` is generated.

**Implements**: FR-002

**Independent Test**: Run `gwrk specify "test feature"` and verify the spec file is created.

**Acceptance Scenarios**:
1. **Given** a gwrk project, **When** the user runs `gwrk specify "a calculator"`, **Then**:
   - `test -f specs/*-calculator/spec.md` exits 0

### US-003 - Agent Planning (Priority: P0)
As a Senior Architect, I want to run `gwrk plan <feature>` so that the `/plan` workflow generates a `plan.md` from the spec.

**Implements**: FR-003

**Independent Test**: Run `gwrk plan 001-cli-core` and verify `plan.md` is created.

**Acceptance Scenarios**:
1. **Given** a valid `spec.md` exists, **When** the user runs `gwrk plan <feature>`, **Then**:
   - `test -f specs/<feature>/plan.md` exits 0

### US-004 - Task Decomposition with Hard Gates (Priority: P0)
As the DUS persona, I want to run `gwrk tasks generate <feature>` so that `plan.md` is decomposed into `.gwrk/tasks.json` and every task gets a corresponding `gates/T0xx-gate.sh` script.

**Implements**: FR-004

**Independent Test**: Run `gwrk tasks generate 001-cli-core` and verify tasks.json and gate scripts exist.

**Acceptance Scenarios**:
1. **Given** an approved `plan.md`, **When** the user runs `gwrk tasks generate <feature>`, **Then**:
   - `test -f specs/<feature>/.gwrk/tasks.json` exits 0
   - `test -d specs/<feature>/gates` exits 0
   - `ls specs/<feature>/gates/T*-gate.sh | wc -l | grep -qv '^0$'` exits 0
2. **Given** tasks.json with N tasks, **When** counting gate files, **Then**:
   - `jq '.tasks | length' specs/<feature>/.gwrk/tasks.json` equals `ls specs/<feature>/gates/T*-gate.sh | wc -l`

### US-005 - Task State Query (Priority: P0)
As a WUD agent, I want to run `gwrk tasks list <feature>` and `gwrk tasks next <feature> <phase>` so that I can discover available work without parsing JSON manually.

**Implements**: FR-005

**Independent Test**: Given tasks with mixed statuses, `gwrk tasks next` returns only the next unblocked task.

**Acceptance Scenarios**:
1. **Given** a tasks.json with open and completed tasks, **When** running `gwrk tasks list <feature>`, **Then**:
   - `gwrk tasks list <feature> --json | jq '.tasks | length'` returns the total task count
2. **Given** a tasks.json with one open task in phase 1, **When** running `gwrk tasks next <feature> 1`, **Then**:
   - `gwrk tasks next <feature> 1 --json | jq -r '.id'` returns the task ID

### US-006 - Hard Gate Enforcement (Priority: P0)
As the WUD engine, I want `gwrk tasks done <feature> <taskId>` to execute the corresponding gate script and only update state if exit code is 0, so that tasks cannot be marked complete without passing assertions.

**Implements**: FR-006

**Independent Test**: Given a failing gate, `gwrk tasks done` must fail and state must remain unchanged.

**Acceptance Scenarios**:
1. **Given** a failing gate script for T001, **When** the user runs `gwrk tasks done <feature> T001`, **Then**:
   - Command exits with code 1
   - `jq '.tasks[] | select(.id == "T001") | .status' specs/<feature>/.gwrk/tasks.json | grep -q '"open"'` exits 0
2. **Given** a passing gate script for T001, **When** the user runs `gwrk tasks done <feature> T001`, **Then**:
   - Command exits with code 0
   - `jq '.tasks[] | select(.id == "T001") | .status' specs/<feature>/.gwrk/tasks.json | grep -q '"completed"'` exits 0
3. **Given** a missing gate script for T099, **When** the user runs `gwrk tasks done <feature> T099`, **Then**:
   - Command exits with code 1
   - `gwrk tasks done <feature> T099 2>&1 | grep -q 'Gate script .* not found'` exits 0

### US-007 - Status Transition History (Priority: P1)
As the Compression engine (future), I want every status transition to be appended to `.gwrk/history.jsonl` with timestamps, so that delivery timing can be measured.

**Implements**: FR-007

**Independent Test**: After completing a task, verify a JSONL entry was appended.

**Acceptance Scenarios**:
1. **Given** a task T001, **When** `gwrk tasks done <feature> T001` succeeds, **Then**:
   - `tail -1 .gwrk/history.jsonl | jq -r '.taskId'` outputs `T001`
   - `tail -1 .gwrk/history.jsonl | jq -r '.toStatus'` outputs `completed`
   - `tail -1 .gwrk/history.jsonl | jq -r '.timestamp'` matches ISO 8601 format

### US-008 - Configuration Validation (Priority: P0)
As a developer, I want `.gwrkrc.json` loaded and validated at CLI startup with Zod so that missing configuration crashes immediately rather than failing silently downstream.

**Implements**: FR-008

**Independent Test**: Remove a required field from `.gwrkrc.json` and verify the CLI crashes on startup.

**Acceptance Scenarios**:
1. **Given** a malformed `.gwrkrc.json`, **When** running any `gwrk` command, **Then**:
   - Command exits with code 1
   - `gwrk tasks list foo 2>&1 | grep -q 'Configuration error'` exits 0
2. **Given** a valid `.gwrkrc.json`, **When** running `gwrk --version`, **Then**:
   - Command exits with code 0

### US-009 - Agent Cross-Artifact Analysis (Priority: P1)
As a Principal Engineer, I want to run `gwrk analyze <feature>` so that a read-only consistency audit runs across the spec, plan, and task artifacts.

**Implements**: FR-009

**Independent Test**: Run `gwrk analyze 001-cli-core` and verify the agent is dispatched with the `/analyze` workflow.

**Acceptance Scenarios**:
1. **Given** a feature with spec.md, plan.md, and tasks.json, **When** running `gwrk analyze <feature>`, **Then**:
   - The agent process exits with code 0

### US-010 - Effort Estimation (Priority: P1)
As a Principal Engineer, I want to run `gwrk effort <feature>` so that an SP-driven effort estimate is generated from the spec stories.

**Implements**: FR-010

**Independent Test**: Run `gwrk effort 001-cli-core` and verify a report markdown file is created.

**Acceptance Scenarios**:
1. **Given** a feature with a spec.md containing user stories, **When** running `gwrk effort <feature>`, **Then**:
   - `test -f docs/assessments/effort-*.md` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: System MUST provide a `gwrk init` command that scaffolds `.agent/`, `.specify/`, `specs/`, and `.gwrkrc.json` in the current directory. Idempotent — running twice must not overwrite existing files. (Implements: US-001)
- **FR-002**: System MUST provide a `gwrk specify <prompt>` command that dispatches the configured agent backend with the `/specify` workflow and the provided prompt. (Implements: US-002)
- **FR-003**: System MUST provide a `gwrk plan <feature>` command that dispatches the configured agent backend with the `/plan` workflow targeting the specified feature directory. (Implements: US-003)
- **FR-004**: System MUST provide a `gwrk tasks generate <feature>` command that parses `plan.md`, writes `specs/<feature>/.gwrk/tasks.json`, and generates an executable `gates/T0xx-gate.sh` for every task. (Implements: US-004)
- **FR-005**: System MUST provide `gwrk tasks list <feature>` and `gwrk tasks next <feature> <phase>` commands that query `tasks.json` and return task state as structured JSON (when `--json` is passed) or formatted terminal output. (Implements: US-005)
- **FR-006**: System MUST provide a `gwrk tasks done <feature> <taskId>` command that executes `gates/<taskId>-gate.sh` and updates `tasks.json` status to `completed` ONLY if the gate script exits with code 0. If the gate fails, the task status MUST remain unchanged. (Implements: US-006)
- **FR-007**: System MUST append an entry to `.gwrk/history.jsonl` for every state transition, containing: `timestamp` (ISO 8601), `featureId`, `taskId`, `fromStatus`, `toStatus`, `agentId` (optional). (Implements: US-007)
- **FR-008**: System MUST load and validate `.gwrkrc.json` using a Zod schema at CLI startup. Missing required fields MUST cause `process.exit(1)` with a clear error message. No `.default()` calls. (Implements: US-008)
- **FR-009**: System MUST provide a `gwrk analyze <feature>` command that dispatches the `/analyze` workflow for cross-artifact consistency auditing. (Implements: US-009)
- **FR-010**: System MUST provide a `gwrk effort <feature>` command that dispatches the `/effort` workflow for SP-driven estimation. (Implements: US-010)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Already initialized | `gwrk already initialized` | 0 (idempotent) |
| No write permission | `Cannot write to directory` | 1 |

#### FR-004 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| plan.md not found | `plan.md not found for feature` | 1 |
| spec.md not found | `spec.md not found — run gwrk specify first` | 1 |

#### FR-006 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Gate script returns non-zero | `Gate failed for <taskId>. State unchanged.` | 1 |
| Gate script missing | `CRITICAL: gates/<taskId>-gate.sh not found` | 1 |
| Task not found | `Task <taskId> not found in tasks.json` | 1 |
| Task already completed | `Task <taskId> already completed` | 1 |

#### FR-008 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| .gwrkrc.json missing | `Configuration file .gwrkrc.json not found` | 1 |
| Invalid schema | `Configuration error: <zod error message>` | 1 |

---

## 5. Data Model Requirements

### DM-001: Task State (`tasks.json`)

Per ADR-001, task state is stored as flat JSON in `specs/<feature>/.gwrk/tasks.json`. Schema:

```typescript
interface TaskState {
  featureId: string;          // e.g. "001-cli-core"
  createdAt: string;          // ISO 8601
  phases: Phase[];
}

interface Phase {
  id: string;                 // e.g. "phase-01"
  title: string;
  tasks: Task[];
}

interface Task {
  id: string;                 // e.g. "T001"
  title: string;
  description: string;
  status: "open" | "in_progress" | "completed";
  gateScript: string;         // relative path: "gates/T001-gate.sh"
  completedAt?: string;       // ISO 8601
}
```

### DM-002: History Log (`.gwrk/history.jsonl`)

Append-only JSONL, one entry per status transition:

```typescript
interface HistoryEntry {
  timestamp: string;           // ISO 8601
  featureId: string;
  taskId: string;
  fromStatus: string;
  toStatus: string;
  agentId?: string;            // optional: which agent performed the transition
}
```

### DM-003: Configuration (`.gwrkrc.json`)

Validated by Zod at startup. Fail-fast — no defaults.

```typescript
interface GwrkConfig {
  project: {
    name: string;
  };
  agents: {
    define: "gemini" | "claude" | "codex";
    implement: "gemini" | "claude" | "codex" | "codex-cloud";
  };
}
```

---

## 6. Technical Constraints

- **TC-001**: Determinism — Task IDs (`T001`, `T002`) are assigned sequentially per-phase. No UUIDs.
- **TC-002**: Air-Gapped — gwrk CLI itself makes no network calls. Agent dispatch is via `child_process.execFile`. Network calls are the agent backend's responsibility.
- **TC-003**: Fail-Fast Config — Zod validation with no `.default()` calls. Missing config field → `process.exit(1)`.
- **TC-004**: Hard Gates — Agents cannot update JSON task state directly. Only `gwrk tasks done` can mutate state, and only upon exit 0 of the gate script.
- **TC-005**: TypeScript Only — No `.js` or `.jsx` files in `src/`. TypeScript (`.ts`) is the source of truth.
- **TC-006**: ESM Modules — ES2022 target, ESM output. No CommonJS.
- **TC-007**: Branch-Scoped State — `.gwrk/tasks.json` lives alongside the spec so that branch checkouts carry isolated state (ADR-001 §5).

---

## 7. Testing Requirements

- **TR-001**: `src/commands/init.test.ts` — Verify `init` creates scaffold directories and `.gwrkrc.json`. Verify idempotency. Vitest. (FR-001)
- **TR-002**: `src/commands/specify.test.ts` — Verify `specify` invokes the agent backend with correct args. Mock `execFile`. Vitest. (FR-002)
- **TR-003**: `src/commands/plan.test.ts` — Verify `plan` invokes the agent with `/plan` workflow and validates spec.md existence. Vitest. (FR-003)
- **TR-004**: `src/commands/tasks-generate.test.ts` — Verify `tasks generate` parses plan.md, creates tasks.json with correct schema, and writes gate scripts with `+x` permissions. Vitest. (FR-004)
- **TR-005**: `src/commands/tasks-query.test.ts` — Verify `tasks list` returns all tasks, `tasks next` returns only the next unblocked task for a given phase. Vitest. (FR-005)
- **TR-006**: `src/commands/tasks-done.test.ts` — Verify `done` executes gate script, updates state on exit 0, rejects on exit 1, rejects on missing gate. Vitest. (FR-006)
- **TR-007**: `src/utils/state.test.ts` — Verify atomic read/write of tasks.json, history.jsonl append, and Zod validation of task state. Vitest. (FR-006, FR-007)
- **TR-008**: `src/utils/config.test.ts` — Verify Zod schema validation: valid config passes, missing fields crash, invalid types crash. Vitest. (FR-008)
- **TR-009**: `src/commands/analyze.test.ts` — Verify `analyze` invokes agent with `/analyze` workflow. Mock dispatch. Vitest. (FR-009)
- **TR-010**: `src/commands/effort.test.ts` — Verify `effort` invokes agent with `/effort` workflow. Mock dispatch. Vitest. (FR-010)

---

## 8. Success Criteria

- **SC-001**: `gwrk init` scaffolds a project in under 2 seconds with zero network calls.
- **SC-002**: `gwrk tasks done` enforces gates strictly — a failing gate NEVER updates state.
- **SC-003**: The gwrk CLI can bootstrap its own second feature (`002-build-server`) using only `gwrk specify`, `gwrk plan`, `gwrk tasks generate`, and `gwrk tasks done`.

---

## 9. Verification Requirements

- **VR-001**: E2E integration test: `gwrk init` → create mock spec.md + plan.md → `gwrk tasks generate` → verify tasks.json + gates → mock gate passes → `gwrk tasks done` → verify state updated + history.jsonl entry.
- **VR-002**: Negative test: `gwrk tasks done` with a failing gate script → verify state is NOT mutated and exit code is 1.
- **VR-003**: Config validation: remove required field from `.gwrkrc.json` → verify any gwrk command crashes with Zod error.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001 | FR-001 | US-001 | TR-001 |
| US-002 | FR-002 | FR-002 | US-002 | TR-002 |
| US-003 | FR-003 | FR-003 | US-003 | TR-003 |
| US-004 | FR-004 | FR-004 | US-004 | TR-004 |
| US-005 | FR-005 | FR-005 | US-005 | TR-005 |
| US-006 | FR-006 | FR-006 | US-006 | TR-006, TR-007 |
| US-007 | FR-007 | FR-007 | US-007 | TR-007 |
| US-008 | FR-008 | FR-008 | US-008 | TR-008 |
| US-009 | FR-009 | FR-009 | US-009 | TR-009 |
| US-010 | FR-010 | FR-010 | US-010 | TR-010 |
