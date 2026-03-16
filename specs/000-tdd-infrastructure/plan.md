# Implementation Plan: 000 TDD Infrastructure

**Branch**: `develop` | **Date**: 2026-03-16 | **Spec**: [spec.md](./spec.md) | **ADR**: [ADR-005](../../docs/decisions/ADR-005-tdd-gate-architecture.md)

## Summary

Establish a rigorous, programmatically-enforced TDD standard across all gwrk features. Replace file-existence gate stubs with authored, executable assertions. Wire `gwrk define tasks` to produce tasks with LLM-authored gates from contracts. Retroactively audit 001 and 002. Fix all 22 currently-failing tests (8 test files: `notify.test.ts`, `slack-channel.test.ts`, `dispatch.test.ts`, `server.test.ts`, `setup-slack.test.ts`, `ship.test.ts`, `slack-messages.test.ts`, `slack-presence.test.ts`).

---

## Phases and File Structure

### Phase 1: Hard Gate Enforcement & CLI Infrastructure

Implement core functional gate logic, `# AUTHORED` preservation, the `gwrk test` command, and the `gwrk ship` pre-flight block. Wire `gwrk define tasks` to dispatch an LLM agent for gate authoring via `dispatchAgent()` with a structured `GateBrief` (ADR-005). Fix failing tests in `ship.test.ts` and `server.test.ts` that are entangled with pre-flight changes.

**Files (7):**
- `src/utils/gate-gen.ts` (MODIFY: `generateGates()` → `generateGateBrief()` — produces structured `GateBrief` JSON for LLM gate authoring. No longer writes gate scripts directly. Exports `GateBrief`, `TaskBrief` interfaces and `generateRunner()`.)
- `src/commands/tasks-generate.ts` (MODIFY: Add contracts guard (exit 1 if contracts/ missing), `dispatchAgent()` call to `author-gates` workflow, `--no-llm` flag, execution ledger integration via `startRun()`/`finishRun()`.)
- `src/commands/ship.ts` (MODIFY: Add pre-flight check — scan phase deliverable files for matching `.test.ts`. If none found, exit 1 with `[BLOCKED] No test files found for <phase>`. Active immediately, no flag.)
- `src/commands/test.ts` (NEW: `gwrk test <feature> [--phase <N>]` — runs `pnpm vitest run` scoped to feature test file paths from tasks.json, exits 0 only if all pass.)
- `src/cli.ts` (MODIFY: Register `test` command.)
- `src/commands/ship.test.ts` (MODIFY: Fix broken mock — `SlackConfigSchema` is not exported from the vi.mock of `../utils/config.js`. Fix mock, then add test for BLOCKED pre-flight.)
- `src/commands/server.test.ts` (MODIFY: Fix EADDRINUSE — server tests must use a mock port or `vi.mock` the net binding. Real port 18794 is in use during test runs.)

**Requirements Addressed**: FR-001, FR-002, FR-008, FR-009, US-001, US-002, US-008, US-009, ADR-005

**Dependencies**: None (bootstrap)

**Contract Mapping**:
- `specs/000-tdd-infrastructure/contracts/gate-gen.md` → `generateGateBrief()`, `GateBrief`, `TaskBrief`
- `specs/000-tdd-infrastructure/contracts/tasks-generate.md` → contracts guard, `dispatchAgent()`, `--no-llm`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agents/rules/coding-style.md | Strict TypeScript, Zod everywhere |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/utils/gate-gen.test.ts` | `generateGateBrief()` produces valid `GateBrief` JSON with file types, identifiers, contract refs |
| TR-002 | Unit | `src/commands/tasks-generate.test.ts` | Contracts guard exits 1 when missing; `--no-llm` skips gates; `--reconcile` preserves `# AUTHORED` |
| TR-004 | Unit | `src/commands/tasks-done.test.ts` | Gate failure prevents state transition; GATE_STUB gate exits 1 |
| TR-005 | Unit | `src/commands/ship.test.ts` | `gwrk ship` BLOCKED if no `.test.ts` found for phase |
| TR-006 | Unit | `src/commands/test-cmd.test.ts` | `gwrk test` scopes vitest to feature paths, exits 0/1 correctly |
| TR-010 | Unit | `src/utils/gate-gen.test.ts` | `# AUTHORED` marker prevents gate overwrite on reconcile |

#### Done When
- `pnpm vitest run src/utils/gate-gen.test.ts src/commands/tasks-generate.test.ts src/commands/tasks-done.test.ts src/commands/ship.test.ts src/commands/test-cmd.test.ts src/commands/server.test.ts` exits 0
- `pnpm build` exits 0

---

### Phase 2: Retroactive Audit & Gap Analysis (001, 002)

Read every FR-### from 001-cli-core/spec.md and 002-build-server/spec.md, check the corresponding test file coverage, and produce a gap-analysis.md for each. This phase is **document-only** — no source code changes.

> This phase can run in parallel with Phase 1. No dependency on Phase 1 code completing.

**Files (2):**
- `specs/001-cli-core/gap-analysis.md` (NEW: Classify each FR-### as ✅ tested | ⚠️ weak | ❌ untested. For every ❌ or ⚠️, describe exactly what assertion is missing and what test file should contain it.)
- `specs/002-build-server/gap-analysis.md` (NEW: Same classification. Focus on: server lifecycle start/stop, health endpoint, dispatch queue, Docker sandbox, git manager.)

**Requirements Addressed**: FR-005, FR-006, US-005, US-006

**Dependencies**: None (parallel with Phase 1)

**Contract Mapping**:
- None (document only)

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agents/rules/workspace.md | Documentation standards |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-003 | Doc | `specs/001-cli-core/gap-analysis.md` | Content grep proves classification complete |

#### Done When
- `grep -cE "✅|⚠️|❌" specs/001-cli-core/gap-analysis.md | xargs test 0 -lt` exits 0
- `grep -cE "✅|⚠️|❌" specs/002-build-server/gap-analysis.md | xargs test 0 -lt` exits 0

---

### Phase 3: 003-slack Remediation & Red-First Authoring

Fix the remaining 20 failing tests across 003-slack test files (ship.test.ts and server.test.ts fixed in Phase 1). Author `contracts/notify.md`. Replace T007's bare `test -f` gate with a `pnpm vitest run` invocation.

**Root cause of failures (confirmed)**:
- `notify.test.ts`: `process.exit(1)` on `fs.unlinkSync` (pid file missing in test env); `masterOnly` renamed to `opsOnly`; timeout on server start
- `slack-channel.test.ts`, `dispatch.test.ts`: mock assertion mismatches
- `setup-slack.test.ts`: log message assertion mismatches, timeout in missing-tokens path
- `slack-messages.test.ts`, `slack-presence.test.ts`: interface/mock mismatches from ship run using renamed fields

**Files (8+):**
- `src/server/routes/notify.test.ts` (MODIFY: Fix pid file teardown — guard with `fs.existsSync` before `unlinkSync`. Fix `masterOnly` → `opsOnly`. Use Fastify `inject()`, never real HTTP. Set explicit timeout.)
- `src/server/slack-channel.test.ts` (MODIFY: Fix mock assertion mismatches.)
- `src/server/dispatch.test.ts` (MODIFY: Fix mock assertion mismatches.)
- `src/server/setup-slack.test.ts` (MODIFY: Fix log message expectations; fix timeout in missing-tokens test via `vi.useFakeTimers()` or stub the slow path.)
- `src/server/slack-messages.test.ts` (MODIFY: Realign with renamed fields — `opsOnly` not `masterOnly`.)
- `src/server/slack-presence.test.ts` (MODIFY: Fix mock mismatches.)
- `specs/003-slack/contracts/notify.md` (NEW: Full contract for `POST /api/notify` — `NotifyPayload` interface, success/error response shapes, side-effects, edge cases.)
- `specs/003-slack/gates/T007-gate.sh` (MODIFY: Replace `test -f src/server/routes/notify.ts` with `pnpm vitest run src/server/routes/notify.test.ts --reporter=verbose`. Mark `# AUTHORED`.)

**Requirements Addressed**: FR-003, FR-004, FR-007, US-003, US-004, US-007

**Dependencies**: Phase 1 (gate-gen changes; `# AUTHORED` preservation must work before T007 gate is re-authored)

**Contract Mapping**:
- `specs/003-slack/contracts/notify.md` → `POST /api/notify` → `src/server/routes/notify.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agents/rules/coding-style.md | Fastify `inject()` for API tests, `vi.mock` for Slack SDK |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-007 | Integration | `src/server/routes/notify.test.ts` | All payload types route correctly; `{ok: true}` on success |
| TR-008 | Integration | `src/server/slack-actions.test.ts` | Slack actions, `opsOnly` routing |
| TR-009 | E2E | `specs/003-slack/gates/run-all-gates.sh` | All 003-slack gates pass |

#### Done When
- `pnpm vitest run src/server/ 2>&1 | grep -q " 0 failed"` exits 0
- `cat specs/003-slack/gates/T007-gate.sh | grep -q "pnpm vitest run"` exits 0
- `pnpm vitest run 2>&1 | tail -3 | grep -q " 0 failed"` exits 0 (full suite green)

---

### Phase 4: Feature-Level RED Test Generation

Wire `gwrk define tests` into the CLI to run feature-globally by default, driven by rigorous analysis and reasoning to validate planned tasks against the spec/plan. Modify `gwrk define tasks` to support optional phase targeting.

**Files (4):**
- `.agents/workflows/define-tests.md` (MODIFY: Change prompt to map to all phases of a feature, using analysis/reasoning to guide the generation to strictly tie off against tasks in the plan/spec)
- `src/commands/tests-generate.ts` (NEW: `gwrk define tests <feature> [options]` command that receives an optional `--phase <N>` flag, defaulting to all phases)
- `src/commands/tasks-generate.ts` (MODIFY: Add `--phase <N>` option to filter task/gate generation to a specific phase, defaulting to all phases)
- `src/commands/define.ts` (MODIFY: Register `tests` subcommand explicitly)

**Requirements Addressed**: FR-002, FR-003, US-002, US-003

**Dependencies**: Phase 1

**Contract Mapping**:
- None

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agents/rules/coding-style.md | Commander.js strict routing |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| N/A | Verification | CLI integration | `gwrk define tests --help` must resolve correctly without throwing |

#### Done When
- `node dist/cli.js define tests --help` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `TaskState` / `Task` / `Phase` | `src/utils/state.ts` | `gate-gen.ts`, `tasks-generate.ts`, `test.ts` |
| `NotifyPayload` | `specs/003-slack/contracts/notify.md` → `src/server/types.ts` | `src/server/routes/notify.ts`, `src/server/slack-messages.ts` |

---

## Deferred Items

- **FR-002 LLM gate authoring**: Implemented (ADR-005). `gwrk define tasks` now calls `generateGateBrief()` to produce a structured brief, then `dispatchAgent()` with the `author-gates` workflow to author gates. Contracts are required. `GATE_STUB` is abolished.

> [!IMPORTANT]
> There is no fallback. If contracts are missing, `gwrk define tasks` exits 1 with corrective guidance. If the LLM cannot gate a task, the gate explains why and exits 1. The `--no-llm` flag explicitly skips gate authoring.

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 1 | Planned |
| US-002 | 1 | Planned |
| US-003 | 3 | Planned |
| US-004 | 3 | Planned |
| US-005 | 2 | Planned |
| US-006 | 2 | Planned |
| US-007 | 3 | Planned |
| US-008 | 1 | Planned |
| US-009 | 1 | Planned |
| FR-001 | 1 | Planned |
| FR-002 | 1 | Implemented (ADR-005) |
| FR-003 | 3 | Planned |
| FR-004 | 3 | Planned |
| FR-005 | 2 | Planned |
| FR-006 | 2 | Planned |
| FR-007 | 3 | Planned |
| FR-008 | 1 | Planned |
| FR-009 | 1 | Planned |
| TR-001 | 1 | Planned |
| TR-002 | 1 | Planned |
| TR-003 | 2 | Planned |
| TR-004 | 1 | Planned |
| TR-005 | 1 | Planned |
| TR-006 | 1 | Planned |
| TR-007 | 3 | Planned |
| TR-008 | 3 | Planned |
| TR-009 | 3 | Planned |
| TR-010 | 1 | Planned |
| SC-001 | 1 | Planned |
| SC-002 | 3 | Planned |
| SC-003 | 2 | Planned |
| SC-004 | 1 | Planned |
| SC-005 | 3 | Planned |
| SC-006 | 1 | Planned |
| SC-007 | 1 | Planned |
| SC-008 | 3 | Planned |
| VR-001 | 3 | Planned |
| VR-002 | 1 | Planned |
| VR-003 | 1 | Planned |
| VR-004 | 1 | Planned |
| VR-005 | 1 | Planned |
