# ADR-005: TDD Gate Architecture

> **Status:** Decided · **Date:** 2026-03-16
> **Decision:** Gates are LLM-authored from contracts. No heuristic fallback. No stubs.
> **Depends on:** ADR-001 (Hard Gate Architecture), ADR-004 (Agent-Native Output Protocol)
> **Author:** David Gonzalez · **Decision Scope:** gwrk gate generation, TDD enforcement, define pipeline

---

## 1. Context

ADR-001 §6 established the **Hard Gate Architecture**: every task has a gate script, gates exit 0 (PASS) or non-0 (FAIL), agents cannot mark a task done without passing the gate. This is the compliance mandate that prevents agents from interpreting their way to "done."

The problem is HOW gates get written.

### What Was Built

`gwrk define tasks <feature>` was implemented as a pure TypeScript command that:
1. Parses `plan.md` into phases and tasks → writes `tasks.json` (deterministic, correct)
2. Generates gate scripts via `gate-gen.ts` → writes `gates/T0xx-gate.sh` (heuristic, broken)

The heuristic generator (`gate-gen.ts`) examines file extensions and task descriptions to produce assertions:
- `.ts` files → `test -f <path> && grep -q '<identifier>' <path>`
- `.test.ts` files → `pnpm vitest run <path>`
- `.sh` files → `test -f <path> && bash -n <path>`
- `.md` files → `test -f <path>` (existence only)
- Everything else → `GATE_STUB: authored gate required ... && exit 1`

### Why It Fails

1. **`GATE_STUB` is a lie.** It unconditionally fails. Nobody replaces it. It gives the illusion that gate coverage exists while blocking `gwrk tasks done` on tasks that may already be complete. It's ceremony — the exact thing Foxtrot Charlie exists to kill.

2. **Heuristic gates are too weak for the Hard Gate Architecture.** `test -f <path> && grep -q 'foo' <path>` verifies that a string exists in a file, not that behavior is correct. An agent can create a file containing the string "foo" without implementing anything. The gate passes. Truth is corrupted.

3. **The pattern is broken.** Every other `define` command follows CLI → `dispatchAgent()` → agent workflow:
   - `gwrk define spec` → `dispatchAgent()` → `/specify`
   - `gwrk define plan` → `dispatchAgent()` → `/plan`
   - `gwrk define tasks` → **pure TypeScript** (no agent, no reasoning)

   Gate authoring requires reasoning about contracts, source code, and behavior. This is an LLM's job, not a regex parser's job.

4. **000-tdd-infrastructure deferred the fix.** The spec's FR-002 said "MUST call the LLM to author gates." The plan explicitly deferred this (line 146): *"Gate authoring by agent remains a manual step... Deferred to after Phase 1–3 are complete."* Phases 1–3 are complete. The deferral is over.

### Forces

- Gates exist to enforce truth. Weak gates produce weak truth.
- LLM agents can read contracts, source code, and specs simultaneously — they can write gates that test behavior, not just file existence.
- The `dispatchAgent()` infrastructure already exists and is proven (used by `plan.ts`).
- Contracts (`specs/<feature>/contracts/`) are the authoritative definition of what code must do. They exist for 013, 004, and should exist for any feature that needs gates.
- The plugin system (F014) will need different gate strategies for different project types. Today's architecture must not hardcode "gwrk-TypeScript" assumptions.

---

## 2. Decision: LLM-Authored Gates from Contracts

### 2.1 Contracts Are Required

A feature cannot have gates without contracts. `specs/<feature>/contracts/` must exist and be non-empty.

Contracts are a deliverable of `gwrk define plan` (workflow step 6: "Generate contracts/ — MANDATORY if APIs or shared types exist"). If contracts are missing, it means `define plan` either wasn't run or the workflow skipped step 6. The corrective message points upstream:

If contracts are missing, `gwrk define tasks` exits 1 (ADR-004 §2.2: expected failure) with error-as-navigation (013 FR-007):

```
✗ Contracts required for gate authoring.
  Run 'gwrk define plan <feature>' to generate plan.md and contracts/.
  See 'gwrk define plan --help'.
```

### 2.2 The Gate Brief

The heuristic generator is **demoted to a brief generator**. It no longer writes gate scripts. It produces a structured JSON manifest (`GateBrief`) describing what each task touches:

```typescript
interface GateBrief {
  feature: string;
  projectType: "gwrk-typescript";  // extensible via F014
  tasks: TaskBrief[];
}

interface TaskBrief {
  taskId: string;
  title: string;
  description: string;
  primaryFile: string | null;
  fileType: "typescript" | "test" | "shell" | "markdown" | "json" | "config" | "unknown";
  identifiers: string[];          // extracted function/class/export names
  doneWhenCommands: string[];     // from phase doneWhen
  contractRefs: string[];         // matched contract file paths
}
```

This follows the F014 manifest boundary: `GateBrief` = contract (structured data describing what needs gating), `author-gates` workflow = reasoning program (how to write assertions for this project type). The `projectType` field enables future dispatch to different gate strategies without changing the brief format.

### 2.3 The LLM Authors Gates

`gwrk define tasks` dispatches an agent with the `author-gates` workflow after writing `tasks.json`. The agent reads:

- `spec.md` — what the feature promises
- `plan.md` — how it's structured
- `contracts/*` — the behavioral contracts
- Gate brief — what each task touches
- Actual source files — what currently exists

And writes gate scripts with:
- `#!/bin/bash` + `set -euo pipefail`
- `# AUTHORED` marker (line 2)
- Functional assertions (must invoke at least one real tool: `pnpm`, `grep`, `bash -n`, `jq`)
- `echo "PASS: <taskId> — <title>"`

### 2.4 GATE_STUB Is Abolished

There is no stub. If the LLM cannot write a gate for a task, the gate script MUST:
1. Explain WHY in a comment
2. Exit 1 with a descriptive message: `echo "FAIL: T003 — cannot gate: <reason>"; exit 1`

This is honest. A descriptive failure is truth. A generic `GATE_STUB` is a lie that hides the gap.

### 2.5 Authored Gates Satisfy `GateCheckResult`

Authored gates must be compatible with `gwrk gate-check` (013 FR-006, contract `gate-check.md`):

- Exit 0 on PASS, non-0 on FAIL
- stdout and stderr are capturable
- Result is parseable into `GateCheckResult` schema

### 2.6 `# AUTHORED` Preservation

Gate scripts containing `# AUTHORED` are never overwritten by `--force` or `--reconcile`. This preserves:
- Gates authored by the LLM agent
- Gates manually authored by the PE
- Gates improved during code review

---

## 3. Pipeline After This Decision

```
gwrk define spec <feature>        → dispatchAgent() → /specify       → spec.md
gwrk define plan <feature>        → dispatchAgent() → /plan          → plan.md
gwrk define tasks <feature>       → TypeScript: tasks.json
                                  → TypeScript: GateBrief to /tmp/
                                  → dispatchAgent() → /author-gates  → gates/*.sh
gwrk ship <feature> [phase]       → work-until-done.sh              → implement → review → PR
```

`define tasks` is now a two-step command: deterministic task decomposition (TypeScript), then LLM gate authoring (agent dispatch). Both steps are within a single `withSignal()` call. The execution ledger records the agent dispatch via `startRun()`/`finishRun()` (ADR-002).

### `--no-llm` Escape Hatch

`gwrk define tasks <feature> --no-llm` skips gate authoring entirely. Tasks.json is written. Gates directory is empty. This is explicit absence — the user chose to skip gates, not pretend they exist.

---

## 4. Impact on Existing Code

| Component | Change |
|---|---|
| `src/utils/gate-gen.ts` | `generateGates()` → `generateGateBrief()`. Returns brief path. No longer writes `.sh` files. |
| `src/commands/tasks-generate.ts` | Add contracts guard, `generateGateBrief()`, `dispatchAgent()` call, execution ledger integration. |
| `.agents/workflows/author-gates.md` | New workflow. The reasoning program for gate authoring. |
| `scripts/dev/agent-run.sh` | Register `author-gates` case. |
| `specs/000-tdd-infrastructure/spec.md` | Rewrite to reflect this decision. FR-002 is no longer deferred. |
| `specs/000-tdd-infrastructure/plan.md` | Rewrite with new phases reflecting LLM gate authoring. |
| `specs/000-build-plan.md` | Add ADR-005 to decisions. Update 000-TDD status. |

---

## 5. What Dies

- `GATE_STUB` as a concept and as code
- `generateGates()` as a gate script producer
- Heuristic gate scripts as production artifacts
- The fiction that file-existence checks constitute verification

## 6. What Survives

- ADR-001 Hard Gate Architecture — gates as the compliance mechanism
- `# AUTHORED` preservation — gates are never silently overwritten
- `--force` / `--reconcile` semantics for `tasks.json`
- All heuristic extraction logic (file types, identifiers, doneWhen) — repurposed as `GateBrief` fields
- `run-all-gates.sh` gate runner
- `gwrk gate-check` (013 FR-006) as the structured gate verification command

---

## 7. Decision Record

**Position**: Gates are LLM-authored from contracts. The heuristic generator produces a structured brief for the LLM but never writes production gate scripts. Contracts are required. GATE_STUB is abolished.

**Confidence**: 9/10

**Key rationale**: The Hard Gate Architecture (ADR-001) only works if gates test behavior, not file existence. Heuristic generation can identify WHAT needs gating but cannot reason about HOW to test behavior — that requires reading contracts, source code, and specs simultaneously. The `dispatchAgent()` infrastructure is proven. The GateBrief interface is structured for plugin extensibility (F014). The cost is one LLM call per `define tasks` invocation, which is acceptable given that `define spec` and `define plan` already make LLM calls.

**Reversibility**: Moderate. Reverting means restoring `generateGates()` and accepting heuristic gates. The brief generation code would remain useful. Cost: ~4 hours.

---

## 8. Amendment: Deterministic Vitest Gates (2026-03-16)

> **Status:** Decided · **Date:** 2026-03-16
> **Amends:** §2.3 (LLM Authors Gates), §2.4 (GATE_STUB Is Abolished)
> **Author:** David Gonzalez

### 8.1 Context

§2.3 established LLM-authored gates as the primary gate strategy. In practice, the LLM gate authoring path produces two categories of gates:

1. **Structural gates** (`grep -q`, `test -f`, `bash -n`) — verify strings exist in files but not that code works
2. **Behavioral gates** (`pnpm vitest run`) — invoke actual tests that verify behavior

The TDD mandate (000-tdd-infrastructure FR-003) requires RED tests authored before implementation. Once tests exist, a gate's job is trivially: run the test. The LLM is reasoning about HOW to write bash assertions when the answer is already in the test file.

### 8.2 Decision: The Triad Model

Three layers, each with a distinct job:

**Gap Matrix** (`gap-matrix.md`) — structured coverage audit produced by `define tests`. Maps every acceptance criterion (FR/US/TR/SC) to a test type (unit/functional/e2e), the test file, and existence status. This is the macro audit — human-readable, PE-reviewable, and machine-parseable.

**Test Inventory** (`.test.ts` files) — RED tests produced by `define tests`. Each test file contains `describe` blocks labeled by FR-### and `it` blocks mapping to acceptance scenarios. This is the micro enforcement.

**Gates** (deterministic vitest invocations) — produced by `define tasks`. For every task backed by a test file in the gap matrix, the gate is: `pnpm vitest run <file> --grep "<FR-###>"`. No LLM reasoning needed. Gates are parameterized test runners, not assertion scripts.

### 8.3 Gate Generation Strategy

| Task has... | Gate strategy | Generator |
|---|---|---|
| Test file in gap matrix | Deterministic: `pnpm vitest run <file> --grep "<AC>"` | `generateVitestGates()` in `gate-gen.ts` |
| No test file, has contracts | LLM-authored via `dispatchAgent()` (§2.3 fallback) | `author-gates` workflow |
| No test file, no contracts | Honest failure: `echo "FAIL: cannot gate" && exit 1` | `generateVitestGates()` skip |

The deterministic path is tried first. The LLM path is fallback. `# AUTHORED` preservation (§2.6) survives — PE or LLM-authored gates are never overwritten.

### 8.4 Pipeline Reorder

The recommended definition sequence becomes:

```
define spec    → spec.md                    (what we promise)
define plan    → plan.md + contracts/       (how we structure + API shapes)
define tests   → gap-matrix.md + *.test.ts  (coverage audit + RED tests)
define tasks   → tasks.json + gates/        (task decomposition + vitest gates)
```

`define tests` now runs before `define tasks`. The gap matrix feeds task decomposition and enables deterministic gate generation. The code doesn't enforce ordering (both commands are independent), but this is the intended workflow.

### 8.5 What This Changes

| Before (§2.3) | After (§8) |
|---|---|
| All gates LLM-authored | Tests-backed gates deterministic; LLM fallback for rest |
| `GateBrief` is the only gate input | Gap matrix is primary input; `GateBrief` is fallback context |
| Gap analysis in `/plan-to-tasks` | Gap matrix in `/define-tests` |
| Gates are bash assertion scripts | Gates are parameterized vitest invocations |
| Gate authoring = LLM call per `define tasks` | Gate authoring = deterministic for covered tasks, LLM for edge cases |

### 8.6 What Survives

- §2.1: Contracts are required (unchanged)
- §2.2: The Gate Brief → `GateBrief` interface (preserved as LLM fallback context)
- §2.4: GATE_STUB is abolished (unchanged)
- §2.5: Gates satisfy `GateCheckResult` (unchanged)
- §2.6: `# AUTHORED` preservation (unchanged)
- §3: Pipeline structure (updated sequence in §8.4)

### 8.7 Reversibility

Low cost. Reverting means removing `generateVitestGates()` and routing all gate generation through the LLM path. The gap matrix artifact would survive as documentation. Cost: ~2 hours.

---

## 9. Amendment: Profile-Driven Gates (2026-06-16)

> **Status:** Decided · **Date:** 2026-06-16
> **Amends:** §8 (Deterministic Vitest Gates)
> **Author:** David Gonzalez

### 9.1 Context

§8 established deterministic gates using `pnpm vitest run`. However, hardcoding vitest blocks `gwrk` from being used as a daily driver on non-TypeScript projects (e.g. Python, Go, Rust). The F014 Plugin System originally considered a heavy `toolchain` extension plugin to solve this, but this proved unnecessary as `.gwrkrc.json` already provides a robust, project-specific override mechanism.

### 9.2 Decision: `ProjectProfile` Driven Commands

We replace hardcoded `vitest` assumptions with a `toolchain-mapper` utility that reads `ProjectProfile.toolchain.test` and `ProjectProfile.toolchain.primary`.

1. **Config-First**: `detectProfile()` merges `.gwrkrc.json` overrides into the detected `ProjectProfile`.
2. **Language-Agnostic Generation**: `generateVitestGates` is renamed to `generateDeterministicGates` and takes the `ProjectProfile`. It maps the test harness (e.g. `pytest`, `cargo-test`, `go-test`) to the correct bash execution string.
3. **Pre-flight Checks**: `ship-orchestrator.ts` uses the same mapper to run the appropriate test suite command prior to implementation.

### 9.3 Impact

- `generateVitestGates()` → `generateDeterministicGates()`
- `pnpm vitest run` and `.test.ts` assumptions removed from `plan-to-tasks.ts`, `gate-gen.ts`, and `ship-orchestrator.ts`.
- Gwrk is now capable of managing TDD gates for polyglot monorepos and multiple language ecosystems natively.
