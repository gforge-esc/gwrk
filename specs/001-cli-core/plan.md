# Implementation Plan: 001 CLI Core

**Branch**: `001-cli-core` | **Date**: 2026-02-26 | **Spec**: [spec.md](./spec.md)

## Summary
Implement the core `gwrk` CLI infrastructure and commands (`specify`, `plan`, `plan-to-tasks`, `tasks done`) to enable a self-bootstrapping agent-driven development loop using flat-file state and hard-gate enforcement.

---

## Phases and File Structure

### Phase 1: CLI Bootstrap & Basic Command Routing

Bootstrap the TypeScript project with `package.json`, `tsconfig.json`, and the main CLI entry point using `Commander`. Implement `specify` and `plan` as thin wrappers around the `gemini` CLI tool to orchestrate agent workflows.

**Files (6):**
- `package.json` (NEW: Project manifest with dependencies for Commander, Vitest, and Biome)
- `tsconfig.json` (NEW: TypeScript configuration for ES2022)
- `src/cli.ts` (NEW: CLI entry point and route registration)
- `src/commands/specify.ts` (NEW: Logic for `gwrk specify <prompt>`)
- `src/commands/plan.ts` (NEW: Logic for `gwrk plan <feature>`)
- `src/utils/exec.ts` (NEW: Utility to execute shell commands and handle agent output)

**Requirements Addressed:** FR-001, FR-002, US-001, US-002, TC-001, TC-002

**Dependencies:** None

**Contract Mapping:**
- `contracts/tasks.md` → `runAgent` → `src/utils/exec.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agent/rules/workspace.md | General architecture and project structure. |
| .agent/rules/coding-style.md | Strict TypeScript and Vitest testing standards. |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit (Vitest) | `src/commands/specify.test.ts` | `specify` command calls `gemini` with the correct prompt and arguments. |

#### Done When
- `pnpm install` succeeds and installs `commander`, `vitest`, and `biome`.
- `node dist/cli.js --help` outputs available commands.
- `gwrk specify "test"` successfully triggers the agent (in a mock/test environment).

---

### Phase 2: Plan Parsing and Task Generation

Implement the `plan-to-tasks` command which parses a `plan.md` file to generate a structured `tasks.json` state and individual shell gate scripts in the `gates/` directory.

**Files (3):**
- `src/commands/plan-to-tasks.ts` (NEW: Implementation of `gwrk plan-to-tasks <feature>`)
- `src/utils/parser.ts` (NEW: Markdown parser logic to extract phases and tasks from `plan.md`)
- `src/utils/gate-gen.ts` (NEW: Generator for executable shell scripts from task assertions)

**Requirements Addressed:** FR-003, US-003, TC-003, TC-004

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/tasks.md` → `saveTaskState` → `src/utils/state.ts` (Shared with Phase 3)

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agent/rules/workspace.md | Safe shell inputs and directory structure. |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-002 | Unit (Vitest) | `src/commands/plan-to-tasks.test.ts` | `plan.md` is correctly parsed into a JSON tree and gate scripts are written with `+x` permissions. |

#### Done When
- Running `gwrk plan-to-tasks 001-cli-core` creates `specs/001-cli-core/.gwrk/tasks.json` and `specs/001-cli-core/gates/`.
- All generated gate scripts have executable permissions.

---

### Phase 3: Task Management & Enforcement

Implement the `tasks done` command to execute task gates and mutate the local task state only upon successful verification.

**Files (2):**
- `src/commands/tasks.ts` (NEW: Implementation of `gwrk tasks done <feature> <taskId>`)
- `src/utils/state.ts` (NEW: Logic for reading and writing `tasks.json` with atomicity and validation)

**Requirements Addressed:** FR-004, US-004, TC-004

**Dependencies:** Phase 2

**Contract Mapping:**
- `contracts/tasks.md` → `getTaskState` → `src/utils/state.ts`
- `contracts/tasks.md` → `markTaskComplete` → `src/utils/state.ts`
- `contracts/tasks.md` → `runGate` → `src/utils/exec.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agent/rules/workspace.md | Determinism and Fail-Fast principles. |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-003 | Unit (Vitest) | `src/commands/tasks.test.ts` | `done` command only updates task status to "completed" if the gate script exits with code 0. |
| VR-001 | E2E | `tests/e2e/bootstrap.test.ts` | A full flow from `plan-to-tasks` to `tasks done` passes for a mock feature. |

#### Done When
- `gwrk tasks done 001-cli-core T001` fails if `gates/T001-gate.sh` returns exit 1.
- `gwrk tasks done 001-cli-core T001` succeeds and updates `tasks.json` if `gates/T001-gate.sh` returns exit 0.

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `Task` | `src/utils/state.ts` | `src/commands/tasks.ts`, `src/utils/parser.ts` |
| `Phase` | `src/utils/state.ts` | `src/utils/parser.ts`, `src/commands/plan-to-tasks.ts` |
| `TaskState` | `src/utils/state.ts` | `src/commands/tasks.ts`, `src/commands/plan-to-tasks.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

_None — full coverage._

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 1 | Planned |
| US-002 | 1 | Planned |
| US-003 | 2 | Planned |
| US-004 | 3 | Planned |
| FR-001 | 1 | Planned |
| FR-002 | 1 | Planned |
| FR-003 | 2 | Planned |
| FR-004 | 3 | Planned |
| TC-001 | 1 | Planned |
| TC-002 | 1 | Planned |
| TC-003 | 2 | Planned |
| TC-004 | 3 | Planned |
| TR-001 | 1 | Planned |
| TR-002 | 2 | Planned |
| TR-003 | 3 | Planned |
| SC-001 | 3 | Planned (via VR-001) |
| VR-001 | 3 | Planned |
| DM-001 | 2 | Planned (via data-model.md) |
