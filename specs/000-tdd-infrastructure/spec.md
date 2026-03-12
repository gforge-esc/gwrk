---
type: specification
feature: 000-tdd-infrastructure
last_modified: "2026-03-12T14:00:00Z"
revision: 1
---

# Feature Specification: 000 TDD Infrastructure

**Feature Branch**: `000-tdd-infrastructure`
**Created**: 2026-03-12
**Status**: Draft
**Input**: Establish a rigorous, programmatically-enforced TDD standard across all gwrk features (001–008). Replace file-existence gate stubs with authored, executable assertions. Wire `gwrk define tasks` to produce tasks with LLM-authored gates from contracts. Retroactively audit 001 and 002.

---

## 1. Background & Motivation

The current gate architecture produces `test -f <file>` assertions — these prove a file was touched, not that it works. `review-code` and `review-uat` LLM judgment has proven unreliable: tasks marked done that weren't, tasks marked incomplete that obviously were. `gwrk ship 003-slack` produced tests referencing renamed fields within hours of running. These are systemic failures, not one-off mistakes.

The fix is disciplined TDD:
1. Gates are runner invocations (`pnpm vitest run`, `pnpm biome check`, `curl | jq`) — not prose
2. Tests are authored before implementation (red → green)
3. Contracts are comprehensive before tests are authored
4. `gwrk tasks done` runs the gate; the gate runs the test; the test is authoritative

---

## 2. User Scenarios & Testing

### US-001 — Gate Standard (P0)
As a PE, I want every gate script to make a functional assertion so that task completion cannot be faked by file creation alone.

**Implements**: FR-001

**Independent Test**: Audit `specs/*/gates/T*-gate.sh`; no gate should contain `test -f` as its only assertion.

**Acceptance Scenarios**:
1. **Given** a TypeScript source task, **When** its gate runs, **Then**:
   - Gate script contains `pnpm vitest run` or `pnpm biome check` or `pnpm tsc --noEmit`, not only `test -f`
   - `bash specs/001-cli-core/gates/T001-gate.sh` exits 0 for a completed task
   - `grep -rL "test -f" specs/001-cli-core/gates/T*-gate.sh | wc -l` outputs `0` (no gate is purely test-f)
2. **Given** a failing test, **When** the gate runs, **Then**:
   - `bash gates/Txxx-gate.sh` exits non-zero
   - `gwrk tasks done <feature> <taskId>` exits 1, state unchanged

### US-002 — LLM-Authored Gates (P0)
As a PE, I want `gwrk define tasks <feature>` to call the LLM with spec + plan + contracts to produce authored gate scripts rather than template-generated stubs.

**Implements**: FR-002

**Independent Test**: Run `gwrk define tasks 003-slack --reconcile`; inspect a new Phase 7 gate; it should contain a `pnpm vitest run` or `curl` invocation.

**Acceptance Scenarios**:
1. **Given** a task for `src/server/routes/notify.ts`, **When** `gwrk define tasks` generates its gate, **Then**:
   - `cat specs/003-slack/gates/T007-gate.sh | grep -qE "vitest|curl|biome"` exits 0
   - Gate does NOT contain only `test -f src/server/routes/notify.ts`
2. **Given** a task for `src/server/routes/notify.test.ts`, **When** `gwrk define tasks` generates its gate, **Then**:
   - `cat specs/003-slack/gates/T012-gate.sh | grep -q "pnpm vitest run"` exits 0
3. **Given** an existing gate marked `# AUTHORED`, **When** `gwrk define tasks --reconcile` runs, **Then**:
   - `cat gates/Txxx-gate.sh | grep -q "# AUTHORED"` exits 0 (gate preserved unchanged)

### US-003 — Red-First Authoring (P0)
As a PE, I want `gwrk define tests <feature> <phase>` to write red vitest test files before any implementation, so that the implementing agent's job is precisely defined.

**Implements**: FR-003

**Independent Test**: Run `gwrk define tests 003-slack 7`; run `pnpm vitest run src/server/routes/notify.test.ts`; it should fail pre-implementation or pass if already shipped.

**Acceptance Scenarios**:
1. **Given** Phase 7 of 003-slack with no implementation, **When** `gwrk define tests 003-slack 7` runs, **Then**:
   - `test -f src/server/routes/notify.test.ts` exits 0
   - `pnpm vitest run src/server/routes/notify.test.ts 2>&1 | grep -qE "FAIL|failed"` exits 0 (tests are RED)
   - Every `describe` block contains a FR-### reference: `grep -q "FR-010" src/server/routes/notify.test.ts` exits 0
2. **Given** an implemented feature, **When** gate runs, **Then**:
   - `pnpm vitest run src/server/routes/notify.test.ts 2>&1 | grep -q "PASS"` exits 0

### US-004 — Comprehensive Contracts (P0)
As a PE, I want every API surface to have a `contracts/` file defining exact request/response shapes before tests are authored, so that test assertions are grounded in reality.

**Implements**: FR-004

**Independent Test**: Check that contracts exist and define typed schemas for all phase-7 API routes.

**Acceptance Scenarios**:
1. **Given** a phase with API routes, **When** contracts are authored, **Then**:
   - `test -f specs/003-slack/contracts/notify.md` exits 0
   - `grep -q "NotifyPayload" specs/003-slack/contracts/notify.md` exits 0
   - Contract defines: request schema, response schema, error shapes, side-effects
2. **Given** a contract exists, **When** vitest tests import from the source, **Then**:
   - Type check passes: `pnpm tsc --noEmit 2>&1 | grep -c error | xargs test 0 -eq` exits 0

### US-005 — Retroactive Audit: 001-cli-core (P0)
As a PE, I want a gap analysis and full test coverage for 001-cli-core so I know its actual implementation state.

**Implements**: FR-005

**Independent Test**: Full vitest run scoped to 001 test files.

**Acceptance Scenarios**:
1. **Given** 001-cli-core complete, **When** tests run, **Then**:
   - `pnpm vitest run src/commands/init.test.ts src/commands/tasks-done.test.ts src/utils/config.test.ts 2>&1 | grep -q "0 failed"` exits 0
   - `test -f specs/001-cli-core/gap-analysis.md` exits 0
   - `grep -q "FR-006" src/commands/tasks-done.test.ts` exits 0 (gate enforcement tested)
2. **Given** gap analysis written, **When** reviewed, **Then**:
   - Every FR-### is classified: ✅ tested | ⚠️ weak test | ❌ untested

### US-006 — Retroactive Audit: 002-build-server (P0)
As a PE, I want a gap analysis and full test coverage for 002-build-server.

**Implements**: FR-006

**Independent Test**: Full vitest run scoped to 002 test files.

**Acceptance Scenarios**:
1. **Given** 002-build-server complete, **When** tests run, **Then**:
   - `pnpm vitest run src/server/routes/health.test.ts src/server/index.test.ts 2>&1 | grep -q "0 failed"` exits 0
   - `test -f specs/002-build-server/gap-analysis.md` exits 0
2. **Given** gap analysis written, **When** reviewed, **Then**:
   - Server lifecycle (start/stop), dispatch queue, health endpoint all have ≥1 passing test each

### US-007 — 003-slack Test Remediation (P0)
As a PE, I want all 22 failing 003-slack tests fixed and Phase 7–9 re-gated with vitest invocations.

**Implements**: FR-007

**Independent Test**: `pnpm vitest run` passes with 0 failures in 003-slack test files.

**Acceptance Scenarios**:
1. **Given** 003-slack test suite, **When** vitest runs, **Then**:
   - `pnpm vitest run src/server/routes/notify.test.ts src/server/slack-actions.test.ts src/server/slack-commands.test.ts 2>&1 | grep -q "0 failed"` exits 0
2. **Given** Phase 7–9 gates, **When** inspected, **Then**:
   - `grep -l "pnpm vitest" specs/003-slack/gates/T007-gate.sh specs/003-slack/gates/T012-gate.sh` returns both files

### US-008 — Forward TDD Standard for 004–008 (P1)
As a PE, I want a gate checklist enforced before any `gwrk ship` runs on features 004–008, so that we never repeat the pattern of ad-hoc stubs.

**Implements**: FR-008

**Independent Test**: Confirm `gwrk ship 004-ship-loop phase-01` exits 1 (blocked) if no vitest tests exist.

**Acceptance Scenarios**:
1. **Given** 004-ship-loop with no test files, **When** `gwrk ship 004-ship-loop phase-01` runs, **Then**:
   - Command exits 1 with `[BLOCKED] No test files found for phase-01`
   - `gwrk ship 004-ship-loop phase-01 2>&1 | grep -q "BLOCKED"` exits 0
2. **Given** red tests are committed for a phase, **When** `gwrk ship` runs, **Then**:
   - Ship proceeds, implementing agent turns tests green
   - Post-ship gate (`pnpm vitest run`) exits 0

### US-009 — gwrk test Command (P1)
As a PE, I want `gwrk test <feature> [--phase N]` to run the vitest suite scoped to a feature and report against gate results.

**Implements**: FR-009

**Independent Test**: `gwrk test 001-cli-core` runs vitest and exits 0 if all pass.

**Acceptance Scenarios**:
1. **Given** 001-cli-core with passing tests, **When** `gwrk test 001-cli-core` runs, **Then**:
   - `gwrk test 001-cli-core 2>&1 | grep -q "Tests passed"` exits 0
   - Exit code 0
2. **Given** failing tests, **When** `gwrk test 003-slack` runs, **Then**:
   - `gwrk test 003-slack 2>&1 | grep -q "failed"` exits 0
   - Exit code 1

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: Every `gates/T*-gate.sh` MUST contain a functional assertion — `pnpm vitest run <file>`, `pnpm biome check <file>`, `pnpm tsc --noEmit`, `curl ... | jq -e`, or `bash -n <file>`. A gate containing only `test -f` MUST be treated as a build failure. (Implements: US-001)

- **FR-002**: `gwrk define tasks <feature>` MUST call the LLM (agent) with spec.md + plan.md + contracts/ context to author each gate script. The gate authoring strategy MUST follow priority: (1) `# AUTHORED` — preserved unchanged, (2) Done When shell commands from plan, (3) typed fallback by file extension (test.ts → vitest, .ts → biome+compile, .sql → migration check, .sh → bash -n), (4) `pnpm build` as absolute fallback. NEVER bare `test -f` as sole assertion. (Implements: US-002)

- **FR-003**: `gwrk define tests <feature> <phase>` (workflow invocation) MUST write red vitest test files for every FR/US/TR in the phase before any implementation runs. Tests MUST fail pre-implementation (RED). Every `describe` block MUST reference a `FR-###` ID. Tests MUST use Fastify `inject()` for API routes and Vitest mocks for side-effects. (Implements: US-003)

- **FR-004**: Every phase with an API surface MUST have a `contracts/<route>.md` file defining: request schema (TypeScript interface), response schema (success + error), side-effects, and edge cases — authored before `gwrk define tests` runs. (Implements: US-004)

- **FR-005**: `specs/001-cli-core/gap-analysis.md` MUST exist, classifying each FR-### as: ✅ tested, ⚠️ weak, or ❌ untested. Every ❌ or ⚠️ FR MUST have a corresponding open task. All 001 vitest test files MUST pass. (Implements: US-005)

- **FR-006**: `specs/002-build-server/gap-analysis.md` MUST exist with same FR classification. All 002 vitest test files MUST pass. (Implements: US-006)

- **FR-007**: All 22 currently-failing 003-slack vitest tests MUST pass. Phase 7–9 gate scripts MUST invoke `pnpm vitest run` not `test -f`. (Implements: US-007)

- **FR-008**: `gwrk ship <feature> <phase>` MUST exit 1 with `[BLOCKED] No test files found for <phase>` if no `.test.ts` files exist for the phase's deliverable files. This pre-flight check is added to `src/commands/ship.ts`. (Implements: US-008)

- **FR-009**: `gwrk test <feature> [--phase <N>]` MUST run `pnpm vitest run` scoped to test files matching the feature's deliverable paths, report pass/fail counts, and exit 0 only if all tests pass. (Implements: US-009)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Gate contains only `test -f` | `GATE_STUB: test -f only — replace with functional assertion` | 1 |
| Gate script missing | `CRITICAL: gates/<taskId>-gate.sh not found` | 1 |

#### FR-008 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No test files for phase | `[BLOCKED] No test files found for <phase>` | 1 |
| Test files exist but all fail | Gate failure handled by post-ship gate | N/A |

---

## 5. Data Model Requirements

### DM-001: Gate Script Standard
```bash
#!/bin/bash
set -euo pipefail
# Gate: T007 — Implement src/server/routes/notify.ts
# AUTHORED — do not overwrite
# Assertion #1: POST /api/notify returns ok:true
pnpm vitest run src/server/routes/notify.test.ts --reporter=verbose
echo "PASS: T007"
```

### DM-002: Contract File Standard (`contracts/<route>.md`)
```markdown
# Contract: POST /api/notify

## Request
interface NotifyPayload {
  type: "phase_start" | "phase_complete" | "phase_fail" | "ci_result" | "review_ready" | "done_done";
  feature: string;
  phase: string;
  message?: string;
  prUrl?: string;
  opsOnly?: boolean;
}

## Response (200)
{ ok: true }

## Response (400)
{ ok: false, error: string }

## Side Effects
- Calls notifySlack(message, { opsOnly }) with Block Kit payload
- Does NOT throw if Slack unavailable (non-fatal)
```

### DM-003: Gap Analysis Standard (`gap-analysis.md`)
```markdown
| FR | Description | Status | Test File | Notes |
|---|---|---|---|---|
| FR-001 | gwrk init scaffold | ✅ tested | init.test.ts | Idempotency tested |
| FR-006 | Hard Gate Enforcement | ⚠️ weak | tasks-done.test.ts | Gate failure path missing |
| FR-022 | gwrk setup | ❌ untested | — | No test file exists |
```

---

## 6. Technical Constraints

- **TC-001**: Determinism — gate assertions MUST be deterministic. No wall-clock or network-dependent assertions in unit gates.
- **TC-002**: Air-Gapped — Functional gates using `curl` MUST be tagged as integration-only and MUST NOT run in CI without a running server.
- **TC-003**: Fail-Fast Config — No `.default()` in Zod. Missing config → `process.exit(1)`.
- **TC-004**: Gate Language — Gates are `bash`. No Python, Ruby, or Node.js scripts in `gates/`.
- **TC-005**: Test Isolation — Vitest tests MUST use `:memory:` SQLite and mock all external I/O (Slack API, GitHub API, shell exec). No tests touch the real `~/.gwrk/gwrk.db`.
- **TC-006**: Biome as Gatekeeper — `pnpm biome check src/` MUST pass clean before any gate is considered passing for a lint-class task.
- **TC-007**: Polyglot Readiness — Gate standard MUST be extensible to Rust (`cargo test`), Python (`pytest`), and shell (`bats`) for future features. Gate type declared in task metadata.

---

## 7. Testing Requirements

- **TR-001**: `src/utils/gate-gen.test.ts` — Unit: `generateGates()` never emits `test -f` as sole assertion. Tests all typed fallback branches. (Vitest) (FR-001, FR-002)
- **TR-002**: `src/commands/tasks-generate.test.ts` — Unit: `--reconcile` preserves AUTHORED gates. Gate count equals active task count. (Vitest) (FR-002)
- **TR-003**: `specs/001-cli-core/gap-analysis.md` — Document: FR classification complete. (FR-005) — not a Vitest test, but gated via `test -f` + `grep "✅\|⚠️\|❌" specs/001-cli-core/gap-analysis.md | wc -l`
- **TR-004**: `src/commands/tasks-done.test.ts` — Unit: gate enforcement (fail → state unchanged, pass → state updated, missing gate → exit 1). (Vitest) (FR-001, US-001)
- **TR-005**: `src/commands/ship.test.ts` — Unit: pre-flight test-file check exits 1 with BLOCKED message when no .test.ts found. (Vitest) (FR-008)
- **TR-006**: `src/commands/test-cmd.test.ts` — Unit: `gwrk test` scopes vitest to feature paths, exits 0/1 correctly. (Vitest) (FR-009)
- **TR-007**: `src/server/routes/notify.test.ts` — Integration: `POST /api/notify` routes correctly to `notifySlack()`, handles all payload types, returns `{ok:true}`. (Vitest + Fastify inject) (FR-007, FR-003)
- **TR-008**: `src/server/slack-actions.test.ts` — Integration: approve action triggers `gh pr merge`, opsOnly events route to opsChannelId. (Vitest) (FR-007)
- **TR-009**: E2E gate runner — `bash specs/003-slack/gates/run-all-gates.sh` exits 0 after 003-slack implementation. (Shell) (FR-001)
- **TR-010**: `src/utils/gate-gen.test.ts` — Unit: AUTHORED marker prevents gate overwrite on reconcile. (Vitest) (FR-002)

---

## 8. Success Criteria

- **SC-001**: `grep -rl "^test -f" specs/*/gates/T*-gate.sh | wc -l` outputs `0` — no gate is purely file-existence.
- **SC-002**: `pnpm vitest run 2>&1 | tail -1` shows `0 failed` — full test suite green.
- **SC-003**: `test -f specs/001-cli-core/gap-analysis.md && test -f specs/002-build-server/gap-analysis.md` exits 0.
- **SC-004**: `gwrk test 001-cli-core 2>&1 | grep -q "Tests passed"` exits 0.
- **SC-005**: `gwrk test 003-slack 2>&1 | grep -q "Tests passed"` exits 0.
- **SC-006**: `gwrk ship 004-ship-loop phase-01 2>&1 | grep -q "BLOCKED"` exits 0 when no tests exist (pre-flight enforced).
- **SC-007**: `pnpm biome check src/ 2>&1 | grep -c error | xargs test 0 -eq` exits 0.
- **SC-008**: `test -f specs/003-slack/contracts/notify.md && grep -q "NotifyPayload" specs/003-slack/contracts/notify.md` exits 0.

---

## 9. Verification Requirements

- **VR-001**: Run `pnpm vitest run` pre and post implementation — confirm 0 failures.
- **VR-002**: Manually inspect 3 random gate scripts from 001, 002, 003 — each must contain a functional assertion beyond `test -f`.
- **VR-003**: Attempt `gwrk tasks done 001-cli-core T001` with a deliberately failing gate — confirm state unchanged.
- **VR-004**: Run `gwrk define tasks 003-slack --reconcile` — confirm no AUTHORED gates are overwritten.
- **VR-005**: Run `gwrk ship 004-ship-loop phase-01` with no test files present — confirm BLOCKED exit 1.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|--------------|
| US-001 | FR-001 | FR-001 | US-001 | TR-001, TR-004 |
| US-002 | FR-002 | FR-002 | US-002 | TR-001, TR-002, TR-010 |
| US-003 | FR-003 | FR-003 | US-003 | TR-007 |
| US-004 | FR-004 | FR-004 | US-004 | TR-007, TR-008 |
| US-005 | FR-005 | FR-005 | US-005 | TR-003, TR-004 |
| US-006 | FR-006 | FR-006 | US-006 | TR-004 |
| US-007 | FR-007 | FR-007 | US-007 | TR-007, TR-008, TR-009 |
| US-008 | FR-008 | FR-008 | US-008 | TR-005 |
| US-009 | FR-009 | FR-009 | US-009 | TR-006 |
