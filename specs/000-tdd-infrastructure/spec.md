---
type: specification
feature: 000-tdd-infrastructure
last_modified: "2026-03-17T01:10:00Z"
revision: 3
---

# Feature Specification: 000 TDD Infrastructure

**Feature Branch**: `000-tdd-infrastructure`
**Created**: 2026-03-12
**Revised**: 2026-03-16
**Status**: In Progress
**Input**: Establish a rigorous, programmatically-enforced TDD standard across all gwrk features (001–008). Replace file-existence gate stubs with deterministic vitest invocations derived from a structured gap matrix. Wire `gwrk define tests` to produce both a coverage matrix and RED test files. Wire `gwrk define tasks` to consume the gap matrix for deterministic gate generation. Retroactively audit 001 and 002.
**ADR**: [ADR-005 TDD Gate Architecture](../../docs/decisions/ADR-005-tdd-gate-architecture.md) (including §8 Amendment: Deterministic Vitest Gates)

---

## 1. Background & Motivation

The current gate architecture produces two types of gates: structural (`grep -q`, `test -f`) and behavioral (`pnpm vitest run`). Structural gates verify that strings exist in files — they prove a file was touched, not that it works. ADR-005 §2.3 originally established LLM-authored gates as the fix. In practice, LLM gate authoring is expensive reasoning for a trivially derivable answer: once a RED test exists, the gate is just `pnpm vitest run <file>`.

The fix is the **Triad Model** (ADR-005 §8):
1. **Gap matrix** — structured coverage audit mapping acceptance criteria to test types
2. **Test inventory** — RED `.test.ts` files authored from the gap matrix before implementation
3. **Deterministic gates** — `pnpm vitest run <file> --grep "<FR>"` derived from the gap matrix

This eliminates wasted LLM reasoning on gate authoring for test-backed tasks, makes gap analysis a first-class consumed artifact (not a dead-end document), and ensures every acceptance criterion has a traceable path from spec → gap matrix → test → gate.

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

### US-002 — Gap Matrix + Deterministic Gates (P0)
As a PE, I want `gwrk define tasks <feature>` to read a gap matrix and generate deterministic vitest gates for all test-backed acceptance criteria, falling back to LLM authoring only for tasks without test coverage.

**Implements**: FR-002, FR-012

**Independent Test**: Run `gwrk define tests 003-slack`; verify `gap-matrix.md` is produced. Then run `gwrk define tasks 003-slack --reconcile`; inspect Phase 7 gate; it should contain `pnpm vitest run`.

**Acceptance Scenarios**:
1. **Given** a gap matrix with 5 rows where `Test Exists: ✅`, **When** `gwrk define tasks` generates gates, **Then**:
   - 5 gate scripts contain `pnpm vitest run <file> --grep "<FR>"` — no `grep -q` only assertions
   - `cat specs/003-slack/gates/T007-gate.sh | grep -q "pnpm vitest run"` exits 0
2. **Given** a gap matrix with 2 rows where `Test Exists: ❌`, **When** `gwrk define tasks` runs, **Then**:
   - LLM dispatch occurs for those 2 tasks only (not all tasks)
3. **Given** no gap matrix exists, **When** `gwrk define tasks` runs, **Then**:
   - Full LLM dispatch path (§2.3 fallback) — backward compatible
4. **Given** contracts are missing for a feature, **When** `gwrk define tasks` runs, **Then**:
   - Command exits 1 with corrective message: "Run 'gwrk define plan <feature>'"
   - No gates are written
5. **Given** `--no-llm` flag, **When** `gwrk define tasks` runs, **Then**:
   - tasks.json is written, deterministic vitest gates generated from gap matrix (if exists)
   - LLM dispatch is skipped entirely
   - `# AUTHORED` marker preserved on existing gates

### US-003 — Gap Matrix + Red-First Authoring (P0)
As a PE, I want `gwrk define tests <feature>` to produce a structured gap matrix AND RED test files, so that every acceptance criterion is auditable and every gap has a planned test.

**Implements**: FR-003, FR-010, FR-011

**Independent Test**: Run `gwrk define tests 003-slack`; verify `gap-matrix.md` exists with ≥1 row per FR; verify RED test files created.

**Acceptance Scenarios**:
1. **Given** a feature with 9 FRs, **When** `gwrk define tests <feature>` runs, **Then**:
   - `test -f specs/<feature>/gap-matrix.md` exits 0
   - `grep -c "FR-" specs/<feature>/gap-matrix.md` returns `>= 9`
   - Every FR-### appears at least once in the gap matrix
2. **Given** a gap matrix row with `Test Type: unit` and `Test Exists: ❌`, **When** `define tests` completes, **Then**:
   - A `.test.ts` file exists at the path specified in the matrix
   - The test file contains a `describe` block referencing the FR-### ID
   - `pnpm vitest run <file> 2>&1 | grep -qE "FAIL|failed"` exits 0 (tests are RED)
3. **Given** a gap matrix row with `Test Type: structural`, **Then**:
   - No `.test.ts` file is required — the matrix documents it as a non-test gap

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
As a PE, I want all failing 003-slack tests fixed and Phase 7–9 re-gated with vitest invocations.

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
1. **Given** any feature+phase with no `.test.ts` files matching its deliverables, **When** `gwrk ship <feature> <phase>` runs, **Then**:
   - Command exits 1 with `[BLOCKED] No test files found for <phase>`
   - `gwrk ship 004-ship-loop phase-01 2>&1 | grep -q "BLOCKED"` exits 0
   - This pre-flight check is **active now** — no phasing or toggle
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

- **FR-001**: Every `gates/T*-gate.sh` MUST contain a functional assertion — `pnpm vitest run <file>`, `pnpm biome check <file>`, `pnpm tsc --noEmit`, `curl ... | jq -e`, or `bash -n <file>`. A gate containing only `test -f` MUST be treated as a build failure. The target state (ADR-005 §8) is deterministic vitest invocations for all test-backed tasks. (Implements: US-001)

- **FR-002**: `gwrk define tasks <feature>` MUST read `gap-matrix.md` (if it exists) and call `generateVitestGates()` to produce deterministic vitest gate scripts for all test-backed rows. For tasks NOT covered by the gap matrix, it MUST fall back to LLM dispatch via `dispatchAgent()` with a structured `GateBrief` + contracts context (ADR-005 §2.3). Contracts are required — if `contracts/` is missing or empty, the command exits 1 with corrective guidance. The `# AUTHORED` marker on an existing gate preserves it through reconcile. `--no-llm` flag skips LLM gate authoring but still generates deterministic vitest gates from the gap matrix. (Implements: US-002, ADR-005 §8)

- **FR-003**: `gwrk define tests <feature> [phase]` MUST produce both `gap-matrix.md` AND RED vitest test files. The gap matrix is the coverage audit; the test files are the verification instruments. Tests MUST fail pre-implementation (RED). Every `describe` block MUST reference a `FR-###` ID. Tests MUST use Fastify `inject()` for API routes and Vitest mocks for side-effects. (Implements: US-003)

- **FR-004**: Every phase with an API surface MUST have a `contracts/<route>.md` file defining: request schema (TypeScript interface), response schema (success + error), side-effects, and edge cases — authored before `gwrk define tests` runs. (Implements: US-004)

- **FR-005**: `specs/001-cli-core/gap-analysis.md` MUST exist, classifying each FR-### as: ✅ tested, ⚠️ weak, or ❌ untested. Every ❌ or ⚠️ FR MUST have a corresponding open task. All 001 vitest test files MUST pass. (Implements: US-005)

- **FR-006**: `specs/002-build-server/gap-analysis.md` MUST exist with same FR classification. All 002 vitest test files MUST pass. (Implements: US-006)

- **FR-007**: All currently-failing 003-slack vitest tests MUST pass. Phase 7–9 gate scripts MUST invoke `pnpm vitest run` not `test -f`. (Implements: US-007)

- **FR-008**: `gwrk ship <feature> <phase>` MUST exit 1 with `[BLOCKED] No test files found for <phase>` if no `.test.ts` files exist for the phase's deliverable files. This pre-flight check is **active immediately** — not a flag, not a config option, not a later phase. (Implements: US-008)

- **FR-009**: `gwrk test <feature> [--phase <N>]` MUST run `pnpm vitest run` scoped to test files matching the feature's deliverable paths, report pass/fail counts, and exit 0 only if all tests pass. (Implements: US-009)

- **FR-010**: `gwrk define tests <feature>` MUST produce `specs/<feature>/gap-matrix.md` — a structured markdown table mapping every FR-###, US-###, TR-###, and SC-### from the spec to a test type (`unit`/`functional`/`e2e`/`structural`), a test file path, and an existence status (`✅`/`❌`). The gap matrix schema is defined in `contracts/gap-matrix.md`. (Implements: US-003, ADR-005 §8.2)

- **FR-011**: The gap matrix MUST be internally auditable. Every row with `Test Exists: ❌` is a documented gap. `define tests` MUST fill all vitest-class gaps (unit/functional/e2e) with RED test files, or document in the matrix why a gap is acceptable. Every `FR-###` from the spec MUST appear as at least one row. (Implements: US-003)

- **FR-012**: Gate generation for tasks backed by test files MUST be deterministic. `generateVitestGates()` reads the gap matrix and produces `pnpm vitest run <file> --grep "<FR-###>"` gate scripts — no LLM reasoning required. This is the primary gate strategy; LLM authoring is the fallback. (Implements: US-002, ADR-005 §8.3)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Gate contains only `test -f` | `FAIL: <taskId> — gate contains only test -f, not a functional assertion` | 1 |
| Gate script missing | `CRITICAL: gates/<taskId>-gate.sh not found` | 1 |

#### FR-002 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Contracts missing | `Contracts required for gate authoring. Run 'gwrk define plan <feature>' first.` | 1 |
| Agent gate authoring fails | `Gate authoring failed (exit N). See <logPath>` | 1 |
| Gap matrix exists, all covered | `Deterministic vitest gates: N generated, 0 skipped — LLM dispatch skipped` | 0 |

#### FR-008 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No test files for phase | `[BLOCKED] No test files found for <phase>` | 1 |
| Test files exist but all fail | Gate failure handled by post-ship gate | N/A |

#### FR-010 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Spec has no FR section | `Cannot produce gap matrix: spec.md has no FR-### section` | 1 |
| Gap matrix already exists | Overwritten (regenerated each invocation) | 0 |

---

## 5. Data Model Requirements

### DM-001: Gate Script Standard (Deterministic Vitest Gate)
```bash
#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T007 — Implement src/server/routes/notify.ts
# Generated from gap-matrix.md (deterministic vitest gate)

pnpm vitest run src/server/routes/notify.test.ts --grep "FR-007" --reporter=verbose

echo "PASS: T007 — notify route implementation verified"
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

### DM-004: Gap Matrix Standard (`gap-matrix.md`)
```markdown
| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| FR-001 | Every gate has functional assertion | unit | gate-gen.test.ts | ✅ | T001 |
| FR-010 | define tests produces gap-matrix.md | functional | tests-generate.test.ts | ❌ | T010 |
| FR-012 | Gate generation deterministic for vitest | unit | gate-gen.test.ts | ❌ | T012 |
```

Schema details in `contracts/gap-matrix.md`.

---

## 6. Technical Constraints

- **TC-001**: Determinism — gate assertions MUST be deterministic. No wall-clock or network-dependent assertions in unit gates.
- **TC-002**: Air-Gapped — Functional gates using `curl` MUST be tagged as integration-only and MUST NOT run in CI without a running server.
- **TC-003**: Fail-Fast Config — No `.default()` in Zod. Missing config → `process.exit(1)`.
- **TC-004**: Gate Language — Gates are `bash`. No Python, Ruby, or Node.js scripts in `gates/`.
- **TC-005**: Test Isolation — Vitest tests MUST use `:memory:` SQLite and mock all external I/O (Slack API, GitHub API, shell exec). No tests touch the real `~/.gwrk/gwrk.db`.
- **TC-006**: Biome as Gatekeeper — `pnpm biome check src/` MUST pass clean before any gate is considered passing for a lint-class task.
- **TC-007**: Polyglot Readiness — Gate standard MUST be extensible to Rust (`cargo test`), Python (`pytest`), and shell (`bats`) for future features. Gate type declared in task metadata.
- **TC-008**: Gap Matrix Regeneration — `gap-matrix.md` is regenerated on every `gwrk define tests` invocation. It is not an append-only artifact.

---

## 7. Testing Requirements

- **TR-001**: `src/utils/gate-gen.test.ts` — Unit: `generateGateBrief()` produces valid `GateBrief` JSON with correct file types, identifiers, contract refs, and doneWhen commands. `generateVitestGates()` produces vitest gate scripts from gap matrix. (Vitest) (FR-001, FR-002, FR-012, ADR-005)
- **TR-002**: `src/commands/tasks-generate.test.ts` — Unit: `--reconcile` preserves AUTHORED gates. Contracts guard exits 1 when contracts missing. `--no-llm` generates vitest gates from gap matrix but skips LLM dispatch. Gap matrix consumption produces deterministic gates. (Vitest) (FR-002, FR-012, ADR-005)
- **TR-003**: `specs/001-cli-core/gap-analysis.md` — Document: FR classification complete. (FR-005) — not a Vitest test, but gated via `test -f` + `grep "✅\|⚠️\|❌" specs/001-cli-core/gap-analysis.md | wc -l`
- **TR-004**: `src/commands/tasks-done.test.ts` — Unit: gate enforcement (fail → state unchanged, pass → state updated, missing gate → exit 1). (Vitest) (FR-001, US-001)
- **TR-005**: `src/commands/ship.test.ts` — Unit: pre-flight test-file check exits 1 with BLOCKED message when no .test.ts found. (Vitest) (FR-008)
- **TR-006**: `src/commands/test-cmd.test.ts` — Unit: `gwrk test` scopes vitest to feature paths, exits 0/1 correctly. (Vitest) (FR-009)
- **TR-007**: `src/server/routes/notify.test.ts` — Integration: `POST /api/notify` routes correctly to `notifySlack()`, handles all payload types, returns `{ok:true}`. (Vitest + Fastify inject) (FR-007, FR-003)
- **TR-008**: `src/server/slack-actions.test.ts` — Integration: approve action triggers `gh pr merge`, opsOnly events route to opsChannelId. (Vitest) (FR-007)
- **TR-009**: E2E gate runner — `bash specs/003-slack/gates/run-all-gates.sh` exits 0 after 003-slack implementation. (Shell) (FR-001)
- **TR-010**: `src/utils/gate-gen.test.ts` — Unit: AUTHORED marker prevents gate overwrite on reconcile. `generateVitestGates()` respects AUTHORED preservation. (Vitest) (FR-002, FR-012)
- **TR-011**: `src/utils/gate-gen.test.ts` — Unit: `generateVitestGates()` parses gap matrix and produces correct `pnpm vitest run` gate scripts. Structural rows are skipped. Missing test files are skipped. (Vitest) (FR-012, ADR-005 §8)
- **TR-012**: `src/commands/tests-generate.test.ts` — Unit: `gwrk define tests` produces `gap-matrix.md` with correct schema and ≥1 row per FR. (Vitest) (FR-010, FR-011)

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
- **SC-009**: `test -f specs/000-tdd-infrastructure/gap-matrix.md` exits 0 — gap matrix exists for this feature.
- **SC-010**: `grep -c "pnpm vitest run" specs/000-tdd-infrastructure/gates/T*-gate.sh | xargs test 0 -lt` exits 0 — at least one gate uses deterministic vitest invocation.

---

## 9. Verification Requirements

- **VR-001**: Run `pnpm vitest run` pre and post implementation — confirm 0 failures.
- **VR-002**: Manually inspect 3 random gate scripts from 001, 002, 003 — each must contain a functional assertion beyond `test -f`.
- **VR-003**: Attempt `gwrk tasks done 001-cli-core T001` with a deliberately failing gate — confirm state unchanged.
- **VR-004**: Run `gwrk define tasks 003-slack --reconcile` — confirm no AUTHORED gates are overwritten.
- **VR-005**: Run `gwrk ship 004-ship-loop phase-01` with no test files present — confirm BLOCKED exit 1.
- **VR-006**: Run `gwrk define tests 000-tdd-infrastructure` — confirm `gap-matrix.md` produced with ≥1 row per FR.
- **VR-007**: Run `gwrk define tasks 000-tdd-infrastructure --force` — confirm deterministic vitest gates generated from gap matrix.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|--------------|
| US-001 | FR-001 | FR-001 | US-001 | TR-001, TR-004 |
| US-002 | FR-002, FR-012 | FR-002 | US-002 | TR-001, TR-002, TR-010, TR-011 |
| US-003 | FR-003, FR-010, FR-011 | FR-003 | US-003 | TR-007, TR-012 |
| US-004 | FR-004 | FR-004 | US-004 | TR-007, TR-008 |
| US-005 | FR-005 | FR-005 | US-005 | TR-003, TR-004 |
| US-006 | FR-006 | FR-006 | US-006 | TR-004 |
| US-007 | FR-007 | FR-007 | US-007 | TR-007, TR-008, TR-009 |
| US-008 | FR-008 | FR-008 | US-008 | TR-005 |
| US-009 | FR-009 | FR-009 | US-009 | TR-006 |
| — | FR-010 | FR-010 | US-003 | TR-012 |
| — | FR-011 | FR-011 | US-003 | TR-012 |
| — | FR-012 | FR-012 | US-002 | TR-010, TR-011 |
