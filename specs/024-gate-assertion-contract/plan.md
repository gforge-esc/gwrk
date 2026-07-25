# Implementation Plan: 024 Gate Assertion Contract

**Branch**: `024-gate-assertion-contract` (feature branch created at `/implement`) | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

## Summary

gwrk's gate pipeline has two prior layers: **Layer 1 — extraction** ([023 FR-001](../023-plan-format-contract/spec.md)) compiles a phase's fenced-` ```bash ` `#### Done When` block into the phase `gateScript` verbatim, and **Layer 2 — execution** (PR #150, commit `a873961`) runs that gateScript as `set -e\n${gateScript}` under `/bin/bash`, so any command's non-zero exit fails the gate. `pipefail`/`-u` are deliberately omitted (023 §13).

This feature closes **Layer 3 — assertion**. Because `pipefail` is off, a Done-When line of the shape `<cmd> | grep -q <pattern>` is decided solely by the trailing `grep -q`. When `<cmd>` is the command under test, its real exit signal is discarded, and on failure the pattern frequently appears in the command's error output — so `grep -q` matches and the gate reports PASS while the command failed (motivating case: data-dashboard `002-metric-model`, `make test:db 2>&1 | grep -q 'db/definitions'` false-passes). The fix belongs at the **authoring** and **define-time** layers, not the executor (Layer 2 is correct as designed — TC-005).

Two coordinated, committed changes:

- **A. Generator** (`src/plugins/builtins/workflows/gwrk-plan/PROMPT.md`, §4a canonical output format) — instruct that every Done-When line verifying a command asserts on that command's **exit code** by running it directly (`set -e` propagates a real failure), and **explicitly forbid** the `<cmd> | grep -q <pattern>` output-as-pass antipattern with the reason and the safe alternative (capture output to a file as a separate step, then `grep -q <pattern> <file>`). (Phase 1 — FR-001, FR-002)
- **B. `define plan` lint** (`src/engine/plan-gate-validator.ts`, the same self-validation pass 023 FR-006 added, invoked by `gwrk define plan`) — after generating `plan.md`, lint every source-bearing phase's fenced-bash Done-When for the antipattern (shape `\|\s*grep\b[^|]*-q`) and fail loudly (exit 1) naming the phase and offending line. A bare `grep -q <pattern> <file>` (file argument, no pipe from a command) and exit-based commands are NOT flagged. (Phase 2 — FR-003)

No database schema change and no new entities (spec §5, DM-000 — no `data-model.md`). The lint is pure regex/string matching, LLM-free and deterministic (TC-004), reusing the existing `PhaseSchema`/`gateScript` contract (ADR-003). The `PlanGateViolation` extension is **additive** over 023 (new `kind` discriminator + optional `offendingLine`; the hollow-gate path from 023 FR-006 is preserved verbatim), so 023's tests and fixtures do not regress. This plan.md is itself authored with exit-based fenced-bash Done-When blocks and contains no `<cmd> | grep -q` line, so it passes both the 023 FR-006 self-validation and the FR-003 lint this feature introduces.

---

## Phases and File Structure

### Phase 1: Generator emits exit-based Done-When assertions and forbids output-as-pass (FR-001, FR-002)

Amend the `gwrk-plan` generator's canonical-output-format contract (§4a of `PROMPT.md`, the `#### Done When` guidance) so newly generated plans yield honest gates by construction:

1. **Exit-based assertion (FR-001).** Document that every Done-When line verifying a command — a build/test/runner that already exits non-zero on failure (`make`, `pnpm`, `node`, `vitest`, …) — MUST assert on that command's **exit code** by running it directly (e.g. `make test:db`, `pnpm vitest run path/to.test.ts`), so Layer 2's `set -e` propagates a real failure. The prompt MUST NOT present output-text matching as a way to prove a command succeeded.
2. **Forbid the output-as-pass antipattern (FR-002).** Explicitly forbid `<cmd> | grep -q <pattern>` (and `<cmd> 2>&1 | grep -q …`) in Done-When blocks, documenting (a) **why** — on failure the pattern can appear in the command's error output, and with `set -e` + no `pipefail` only the trailing `grep -q`'s exit decides, masking the producer's non-zero exit → false green; and (b) the **safe alternative** — a bare exit-based command, or capturing output to a file as a separate step (whose exit `set -e` enforces) then `grep -q <pattern> <file>`. A `grep -q <pattern> <file>` reading a file (no pipe from a command) remains allowed.

Add deterministic doc-contract tests (grep/string assertions over the prompt file) with the exact `-t` names the spec's acceptance scenarios invoke, so generator↔contract drift is caught in CI.

**Files (2):**
- `src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` — **amend** — in §4a `#### Done When` guidance: add the exit-based-assertion rule (reference "exit code"/"exit status", show a bare-command example as the canonical assertion), name and forbid the `<cmd> | grep -q <pattern>` antipattern, state the failure reason, and document the capture-to-file-then-`grep -q <file>` safe alternative
- `src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts` — **amend** — TR-001 test `"exit-based Done-When assertion"` (asserts the prompt references exit code/status and shows a bare-command canonical example) and TR-002 test `"forbids output-as-pass grep"` (asserts the prompt names `grep -q`, contains a forbid/never/do-not/antipattern directive adjacent to it, and documents the capture-to-file safe alternative)

**Requirements Addressed:** FR-001, FR-002, US-001, US-002, TC-003, SC-001, VR-003

**Dependencies:** 023-plan-format-contract (the §4a canonical output format section this phase extends exists in `PROMPT.md`, commit `03910cc`). No intra-024 dependency.

**Contract Mapping:**
- `contracts/gate-assertion-lint.md` → §1 generator assertion-contract guidance (exit-based Done-When; forbid output-as-pass; safe alternative) → `src/plugins/builtins/workflows/gwrk-plan/PROMPT.md`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-004 (agent-native output) | Generated plans must yield honest, exit-code-based gates that downstream agent-native commands can run truthfully |
| ADR-005 §10 (gate-quality) | Assertion contract is a sibling to `isHollowGate` (no-op gates); it targets the output-as-pass shape without changing execution-layer gate-quality semantics |
| specify-sharpen | Prompt text is the generator's output contract; wording must be unambiguous and testable |
| TC-005 (execution layer unchanged) | This phase touches only the authoring prompt; it does NOT modify `src/commands/gate.ts`, `set -e`, or the `pipefail`/`-u` omission |
| compile-gate | Always |

#### Test Strategy
| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-001 | integration | `src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts` | Test `"exit-based Done-When assertion"`: `PROMPT.md` matches `/exit code\|exit status/i` in the Done-When guidance and shows a bare-command canonical example (not an output-grep example) as the way to prove a command succeeded |
| TR-002 | integration | `src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts` | Test `"forbids output-as-pass grep"`: `PROMPT.md` names `grep -q`, contains a forbid/never/do-not/antipattern directive adjacent to the `<cmd> | grep -q` form, states the failure reason, and documents the capture-to-file-then-`grep -q <file>` safe alternative |

#### Done When
```bash
pnpm run build
pnpm vitest run src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts
grep -qiE 'exit code|exit status' src/plugins/builtins/workflows/gwrk-plan/PROMPT.md
grep -qiE 'grep -q' src/plugins/builtins/workflows/gwrk-plan/PROMPT.md
grep -qiE 'forbid|never|do not|antipattern' src/plugins/builtins/workflows/gwrk-plan/PROMPT.md
```

### Phase 2: `define plan` lint rejects the output-as-pass antipattern (FR-003)

Extend the deterministic `validatePlanGates` self-validation pass (added for [023 FR-006](../023-plan-format-contract/spec.md), invoked by `gwrk define plan` after generation) so that, in addition to the existing hollow-stub check, it lints every **source-bearing phase**'s fenced-bash `#### Done When` block (the text already captured into `phase.gateScript` by `parsePlanMarkdown`) for the output-as-pass antipattern — a line that pipes a command into `grep` with the quiet flag, matching the shape `\|\s*grep\b[^|]*-q`. If any such line is found, `define plan` exits 1 with a corrective message naming the `phase-NN`, its title, and the offending line, and pointing to the remediation.

The `PlanGateViolation` type gains a `kind` discriminator (`"hollow" | "output-as-pass"`) and an optional `offendingLine`; the 023 hollow-stub violation path (message and `phaseId`/`title`/`gateScript` fields) is preserved verbatim so 023's tests stay green. A `grep -q <pattern> <file>` line with **no leading pipe from a command** MUST NOT be flagged; exit-based command lines MUST NOT be flagged. Existing `specs/_fixtures/plan-format/*` fixtures contain no `| grep` line, so the extended pass does not regress the 023 suite.

Error state (FR-003): a source-bearing phase whose Done-When pipes a command into `grep -q` emits on stderr `define plan: phase-NN "<title>" Done-When asserts on output, not exit ('<offending line>'). Assert on the command's exit code (run it directly); to check a token, capture output to a file then grep the file. See specs/024-gate-assertion-contract/spec.md.` and exits 1. An unparseable plan (no phases) surfaces the existing `No phases found in <path>. Expected '### Phase N: Title' headings.` fatal (exit 1). This is a verifier behavior on the existing generator/mutator command `gwrk define plan`, preserving the `[exit:N | Xs]` signal wrapper (ADR-004).

**Files (5):**
- `src/engine/plan-gate-validator.ts` — **amend** — extend `PlanGateViolation` with `kind: "hollow" | "output-as-pass"` and optional `offendingLine`; after the existing `isHollowGate` check, for each source-bearing phase scan `phase.gateScript` lines for `/\|\s*grep\b[^|]*-q/` and push an `output-as-pass` violation carrying the offending line; hollow-stub detection and its report shape are unchanged (LLM-free, no network/DB — TC-001, TC-004)
- `src/commands/define-plan.ts` — **amend** — branch the violation→message mapping by `kind`: keep the 023 `resolves to a stub gate … 023-plan-format-contract.md` message for `hollow`; for `output-as-pass` emit the FR-003 corrective message naming the phase, title, and offending line and citing `specs/024-gate-assertion-contract/spec.md`; throw `CommandError` (exit 1) when `report.ok === false`
- `src/commands/define-plan.test.ts` — **amend** — TR-003 test `"rejects output-as-pass Done-When"` (validator/command exits 1 and names the phase + offending line on the SEAM fixture), TR-004 test `"accepts exit-based and file grep"` (exit 0 on the exit-based fixture), TR-005 SEAM assertion (the exact `make test:db 2>&1 | grep -q 'db/definitions'` false-green case is rejected)
- `specs/_fixtures/gate-assertion/plan-output-as-pass.md` — **create** — positive/SEAM fixture: a plan whose source-bearing Phase 3 fenced-bash `#### Done When` contains `make test:db 2>&1 | grep -q 'db/definitions'` (the data-dashboard `002-metric-model` case that PASSES under Layer 2 `set -e` yet is a false green)
- `specs/_fixtures/gate-assertion/plan-exit-based.md` — **create** — negative fixture: a plan whose Phase 3 Done-When asserts exit-based (`make test:db`, `pnpm vitest run x.test.ts`) and separately uses `grep -q 'schemaVersion' package.json` (file argument, no pipe from a command) — MUST NOT be flagged

**Requirements Addressed:** FR-003, FR-003 Error States, US-003, TC-001, TC-002, TC-004, TC-005, SC-002, SC-003, SC-005, VR-002, VR-004, VR-005, Agent-Native compliance (§12)

**Dependencies:** Phase 1 (the generator emits the exit-based format the lint enforces — the same generator↔lint coordination 023 established); 023 FR-006 (`validatePlanGates` and its `define plan` wiring must already exist — they do, commit `03910cc`).

**Contract Mapping:**
- `contracts/gate-assertion-lint.md` → §2 `validatePlanGates` output-as-pass detection over each source-bearing phase's fenced-bash gateScript (extended `PlanGateReport`) → `src/engine/plan-gate-validator.ts`
- `contracts/gate-assertion-lint.md` → §3 `define plan` FR-003 corrective-message hook (exit 1, error-as-navigation) → `src/commands/define-plan.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-004 (agent-native output) | `gwrk define plan` gains an exit-1 failure mode with error-as-navigation on stderr (phase + offending line + remediation); `[exit:N | Xs]` wrapper preserved via `withSignal` |
| ADR-005 §10 (gate-quality) | The FR-003 lint is a sibling to `isHollowGate` targeting the output-as-pass shape; it reuses the validator's source-bearing classification and introduces NO new execution-layer gate-quality semantics |
| ADR-003 (state contract) | Operates on the existing `PhaseSchema`/`gateScript` fields via `parsePlanMarkdown`; no schema change (DM-000) |
| `.gwrk/rules/workspace.md` | Fail-fast config (TC-002): the lint is itself a fail-fast gate — output-as-pass → `process.exitCode = 1`, no `.default()` softening |
| `.gwrk/rules/seeding-governance.md` | Fixtures under `specs/_fixtures/gate-assertion/` are committed, deterministic, and network-free (TC-001) |
| TC-005 (execution layer unchanged) | This phase does NOT modify `src/commands/gate.ts`, `set -e`, or the `pipefail`/`-u` omission; it acts only at the define-time lint layer |
| compile-gate | Always |

#### Test Strategy
| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-003 | integration | `src/commands/define-plan.test.ts` | Test `"rejects output-as-pass Done-When"`: on `plan-output-as-pass.md`, the validator returns `ok:false` and a violation naming `phase-03` AND its `offendingLine` equals `make test:db 2>&1 | grep -q 'db/definitions'` |
| TR-004 | integration | `src/commands/define-plan.test.ts` | Test `"accepts exit-based and file grep"`: on `plan-exit-based.md` (Done-When `make test:db`, `pnpm vitest run x.test.ts`, and file-argument `grep -q 'schemaVersion' package.json`) the validator returns `ok:true` with zero violations — no false-fail of legitimate exit-based or file-grep gates |
| TR-005 | integration | `src/commands/define-plan.test.ts` | SEAM: the exact `make test:db 2>&1 | grep -q 'db/definitions'` false-green case (which passes Layer 2 `set -e` execution because the pattern appears in the error text) is rejected by the define-plan lint (exit 1, phase named) — the coverage that would have caught the Layer-3 false-green after Layers 1 and 2 both passed |

#### Done When
```bash
pnpm run build
pnpm vitest run src/commands/define-plan.test.ts
```

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `PlanGateViolation` (extended: `kind: "hollow" | "output-as-pass"`, optional `offendingLine`; 023's `phaseId`/`title`/`gateScript` retained) | `src/engine/plan-gate-validator.ts` (ADR-005 §10 sibling) | `src/commands/define-plan.ts`, `src/commands/define-plan.test.ts` |
| `PlanGateReport { ok, violations }` (existing; `violations` now carries both hollow and output-as-pass kinds; `ok === false` iff ≥1 violation of either kind) | `src/engine/plan-gate-validator.ts` | `src/commands/define-plan.ts` |
| `parsePlanMarkdown` → `phase.gateScript` (fenced-bash `#### Done When` block captured verbatim; existing, unchanged) | `src/engine/plan-to-tasks.ts` (023 FR-001) | `validatePlanGates` (reads `gateScript` for the FR-003 lint) |
| `isHollowGate` (existing; unchanged — hollow-stub predicate) | `src/utils/gate-quality.ts` (ADR-005 §10) | `validatePlanGates` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._ It is a deterministic generator-prompt + define-time lint change with no UI surface.

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| Out-of-scope | Rewrite/repair the Done-When gates of gwrk's 13 existing plans | Content work (auditing existing gates), not a generator/lint change (spec §1 Out of scope; parity with 023 out-of-scope) | Future per-spec definitional work |
| Out-of-scope | Any change to gate execution semantics (`runGateCheck`, `set -e`, `pipefail`/`-u` omission) | Owned by 023 §13 / PR #150; unchanged here (TC-005). No phase lists `src/commands/gate.ts` | specs/023-plan-format-contract §13 |
| Out-of-scope | Deriving executable gates for prose-only Done-When blocks | Owned by [023 FR-001/FR-006](../023-plan-format-contract/spec.md) | specs/023-plan-format-contract |
| OQ-002 | Lint the non-quiet `<cmd> | grep <pattern>` terminal-pass form | Out of scope for the named `-q` antipattern; shares the risk but deferred to a follow-up if it recurs in practice | Future extension of the FR-003 shape |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | Phase 1 | Planned |
| US-002 | Phase 1 | Planned |
| US-003 | Phase 2 | Planned |
| FR-001 | Phase 1 | Planned |
| FR-002 | Phase 1 | Planned |
| FR-003 | Phase 2 | Planned |
| FR-003 Error States | Phase 2 | Planned |
| DM-000 (no new entities / no schema change) | Phases 1–2 | Leveraged (no data-model.md) |
| TC-001 (air-gapped) | Phase 2 | Planned |
| TC-002 (fail-fast config) | Phase 2 | Planned |
| TC-003 (TypeScript only) | Phases 1–2 | Planned |
| TC-004 (deterministic lint) | Phase 2 | Planned |
| TC-005 (execution layer unchanged) | Phases 1–2 (no phase touches `src/commands/gate.ts`) | Planned |
| TR-001 | Phase 1 | Planned |
| TR-002 | Phase 1 | Planned |
| TR-003 | Phase 2 | Planned |
| TR-004 | Phase 2 | Planned |
| TR-005 | Phase 2 | Planned |
| SC-001 | Phase 1 | Planned |
| SC-002 | Phase 2 | Planned |
| SC-003 | Phase 2 | Planned |
| SC-004 | Phases 1–2 (gate.ts untouched; existing gate-execution suite green under `pnpm run test:ci`) | Planned |
| SC-005 | Phase 2 | Planned |
| VR-001 (build clean) | Phases 1–2 (Done When: `pnpm run build`) | Planned |
| VR-002 (vitest green: prompt-contract + define-plan) | Phase 1 + Phase 2 | Planned |
| VR-003 (`grep -q` named + forbidden in PROMPT.md) | Phase 1 (Done When greps) | Planned |
| VR-004 (SEAM lint exit 1, offending line + phase in stderr) | Phase 2 | Planned |
| VR-005 (`src/commands/gate.ts` not modified) | Phases 1–2 (structural: no phase declares `src/commands/gate.ts`; TC-005) | Planned |

All US/FR/TR/TC/SC/VR items are assigned to a phase. DM items: none (DM-000 leveraged, no schema change → no data-model.md). No unaccounted items.
