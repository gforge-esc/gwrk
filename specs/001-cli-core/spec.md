# Feature Specification: 001 CLI Core

**Feature Branch**: `001-cli-core`
**Created**: 2026-02-26
**Status**: Draft
**Input**: gwrk CLI basic infrastructure and CLI commands

---

## 2. User Scenarios & Testing

### US-001 - Agent Specification (Priority: P0)
As a Principal Engineer, I want the CLI to orchestrate the `/specify` workflow against a feature prompt, so that I can generate a `spec.md` with explicit shell assertions without writing it manually.

**Implements**: FR-001

**Independent Test**: Execute `gwrk specify "a simple calculator"` and verify `specs/00X-simple-calculator/spec.md` is created with assertions.

**Acceptance Scenarios**:
1. **Given** a new feature request, **When** the user runs `gwrk specify "my feature"`, **Then**:
   - `test -f specs/*-my-feature/spec.md` exits 0.

### US-002 - Agent Planning (Priority: P0)
As a Senior Architect, I want the CLI to read a `spec.md` and orchestrate the `/plan` workflow, so that I can generate a technical `plan.md`.

**Implements**: FR-002

**Independent Test**: Run `gwrk plan 001-cli-core` and verify `specs/001-cli-core/plan.md` is created.

**Acceptance Scenarios**:
1. **Given** a valid `spec.md`, **When** the user runs `gwrk plan <feature>`, **Then**:
   - `test -f specs/<feature>/plan.md` exits 0.

### US-003 - Hard Gate Compilation (Priority: P0)
As the DUS (Define Until Solid) persona, I want the CLI to read a `plan.md` and generate a `tasks.json` tracking file alongside strict `gates/T0xx-gate.sh` verification scripts, so that implementation execution is strictly governed.

**Implements**: FR-003

**Independent Test**: Run `gwrk plan-to-tasks 001-cli-core` and verify `.gwrk/tasks.json` and `gates/` directory are populated.

**Acceptance Scenarios**:
1. **Given** an approved `plan.md`, **When** the user runs `gwrk plan-to-tasks <feature>`, **Then**:
   - `test -d specs/<feature>/gates` exits 0.
   - `test -f specs/<feature>/.gwrk/tasks.json` exits 0.

### US-004 - Hard Gate Enforcement (Priority: P0)
As the WUD (Work Until Done) engine, I want to execute `gwrk tasks done <feature> <taskId>`, which runs the gate script, so that tasks cannot be marked complete without passing assertions.

**Implements**: FR-004

**Independent Test**: Given a failing script in `gates/T001-gate.sh`, running `gwrk tasks done <feature> T001` should fail and `tasks.json` remains open.

**Acceptance Scenarios**:
1. **Given** a failing gate script for T001, **When** the user runs `gwrk tasks done <feature> T001`, **Then**:
   - `grep '"status": "open"' specs/<feature>/.gwrk/tasks.json` exits 0.
2. **Given** a passing gate script for T001, **When** the user runs `gwrk tasks done <feature> T001`, **Then**:
   - `grep '"status": "completed"' specs/<feature>/.gwrk/tasks.json` exits 0.

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: System MUST provide a `gwrk specify <prompt>` command that orchestrates the `.agent/workflows/specify.md` workflow. (Implements: US-001)
- **FR-002**: System MUST provide a `gwrk plan <feature>` command that orchestrates the `.agent/workflows/plan.md` workflow. (Implements: US-002)
- **FR-003**: System MUST provide a `gwrk plan-to-tasks <feature>` command that parses `plan.md`, writes to `specs/<feature>/.gwrk/tasks.json`, and generates executable `.sh` files in `specs/<feature>/gates/`. (Implements: US-003)
- **FR-004**: System MUST provide a `gwrk tasks done <feature> <task_id>` command that executes `gates/<task_id>-gate.sh` and only updates `tasks.json` if the exit code is 0. (Implements: US-004)

#### FR-004 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Gate script returns non-zero | `Gate execution failed. Task state remains untouched.` | 1 |
| Gate script missing | `CRITICAL: Gate script gates/<task_id>-gate.sh not found.` | 1 |

---

## 5. Data Model Requirements

_No database entities required for this feature. Task state is stored locally in `.gwrk/tasks.json`._

---

## 6. Technical Constraints

- **TC-001**: Determinism — SHA256 input/output stability for all engine functions.
- **TC-002**: Air-Gapped — No external network calls at runtime. All assets vendored/bundled.
- **TC-003**: Fail-Fast Config — Zod validation with no `.default()` calls. Missing var → `process.exit(1)`.
- **TC-004**: Hard Gates — Agents cannot update JSON task state directly. Only `gwrk tasks done` can mutate state upon exit 0 of the shell gate.

---

## 7. Testing Requirements

- **TR-001**: `src/commands/specify.test.ts` — Verify `specify` calls Gemini CLI or mock appropriately. Vitest. (FR-001)
- **TR-002**: `src/commands/plan-to-tasks.test.ts` — Verify JSON tree generation and `chmod +x` gate script generation. Vitest. (FR-003)
- **TR-003**: `src/commands/tasks.test.ts` — Verify `done` command executes arbitrary script and handles exit codes 0 and 1 correctly. Vitest. (FR-004)

---

## 8. Success Criteria

- **SC-001**: `gwrk` CLI can bootstrap its own second feature (Feature 002) natively using only binary invocations.

---

## 9. Verification Requirements

- **VR-001**: E2E test executing a fake specification, simulating an agent writing a file, and passing a mock `gates/T001-gate.sh` script via `gwrk tasks done`.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001 | FR-001 | US-001 | TR-001 |
| US-002 | FR-002 | FR-002 | US-002 | DEFERRED (no test - relies on specify logic) |
| US-003 | FR-003 | FR-003 | US-003 | TR-002 |
| US-004 | FR-004 | FR-004 | US-004 | TR-003 |
