# Feature Specification: 024 Gate Assertion Contract

> **026 correction.** This spec treats "the execution layer" as `runGateCheck` alone ("this feature
> MUST NOT modify `runGateCheck` … those semantics are owned by 023 §13"). There were actually three
> execution layers; `readVerdict` and `reconcileGates` never ran inline gates at all, so 024's
> exit-code assertion lint was only meaningful in the one runner that did. As of 026 there is a single
> `runTaskGate` and the assertion contract applies wherever a gate runs. Also: `phase.gateScript` is
> not a persisted field — the fenced block compiles onto each **task's** `gateScript`; read a phase's
> gate via `getPhaseVerificationGate`.

**Feature Branch**: `024-gate-assertion-contract`
**Created**: 2026-07-24
**Status**: Draft
**Input**: Gates must assert on command **exit codes**, not by grepping command **output** (which matches error text and false-passes even under `set -e`). Update the `gwrk-plan` generator to emit exit-based Done-When assertions and forbid the `<cmd> | grep -q <pattern>` output-as-pass antipattern; add a `define plan` lint that rejects the antipattern in generated plans. This is the third layer, after 023 (extraction) and PR #150 (execution).
**Authoritative source**: [`specs/023-plan-format-contract/spec.md` §13](../023-plan-format-contract/spec.md) — *"Known follow-up (assertion layer, out of scope here)"* — tracks this exact defect and fix. No separate `docs/grounding/024-*.md` brief exists; this spec is authored from that tracked follow-up plus the verified evidence in [`docs/grounding/023-plan-format-contract.md`](../../docs/grounding/023-plan-format-contract.md).

---

## 1. Overview

gwrk's gate pipeline has been hardened in two layers:

- **Layer 1 — extraction ([023 FR-001](../023-plan-format-contract/spec.md))**: a phase's fenced-` ```bash ` `#### Done When` block compiles into the phase `gateScript` **verbatim**, instead of falling through to a hollow `echo "Phase N"` stub.
- **Layer 2 — execution (PR #150, commit `a873961`)**: `runGateCheck` (`src/commands/gate.ts`) runs the gateScript as `set -e\n${gateScript}` under `/bin/bash`, so a non-zero exit from **any** command fails the gate — not only the last. `pipefail` and `-u` are **deliberately omitted** (a `producer | grep -q` pipe that SIGPIPEs its producer must not false-fail a true assertion; a pipeline's status is therefore its **last** command's).

**The gap this feature closes (Layer 3 — assertion).** Because `pipefail` is off (by design), a gate line of the form `<cmd> | grep -q <pattern>` is decided solely by the trailing `grep -q`. When `<cmd>` is the *command under test* (a build/test/`make` target that already exits non-zero on failure), grepping its output **discards the real signal** — and on failure the pattern frequently appears in the command's **error output**, so `grep -q` matches and the gate passes green while the command failed.

**Motivating case** (data-dashboard `002-metric-model`, observed): the gate `make test:db 2>&1 | grep -q 'db/definitions'` reports PASS even though `make test:db` fails 0/2 — the failing test's error text contains the path `db/definitions`, so `grep -q` matches. Layers 1 and 2 both did their jobs (the real command *was* extracted and *was* run under `set -e`), yet the gate still lies, because the **assertion** was written against output text instead of the exit code. This is exactly the follow-up [023 §13](../023-plan-format-contract/spec.md) tracks as out of scope for that feature.

**Root cause**: the *authoring layer* permits gates to prove success by matching a command's output text rather than checking its exit code. The fix belongs where gates are authored and generated — not in the executor (Layer 2 is correct as designed).

Two coordinated changes:
- **A. Generator** (`src/plugins/builtins/workflows/gwrk-plan/PROMPT.md`) — instruct that every Done-When line verifying a command asserts on that command's **exit code** (run it directly; `set -e` propagates failure), and **explicitly forbid** the `<cmd> | grep -q <pattern>` output-as-pass antipattern, documenting why and the safe alternative.
- **B. `define plan` lint** (`src/engine/plan-gate-validator.ts`, already invoked by `gwrk define plan` for 023 FR-006 self-validation) — after generating `plan.md`, lint every source-bearing phase's fenced-bash Done-When for the antipattern and **fail loudly** (exit 1) naming the phase and offending line. This closes the loop so a regenerated plan cannot reintroduce the false-green.

### The assertion contract (what this feature establishes)

- A Done-When gate line that verifies a command's **success** MUST run that command directly and rely on its **exit code** — e.g. `make test:db`, `pnpm vitest run path/to.test.ts`. Under Layer 2's `set -e` the non-zero exit fails the gate.
- The **output-as-pass antipattern** — piping the command under test into `grep -q` to derive pass/fail from a text match, e.g. `make test:db 2>&1 | grep -q 'db/definitions'` — is **forbidden** in generated Done-When blocks.
- To legitimately assert on a specific output **token**, capture the command's output to a file **as a separate step** (whose exit `set -e` enforces), then `grep -q <pattern> <file>`. Grep reads a **file**, never a command's mixed stdout/stderr pipe. A bare `grep -q <pattern> <file>` (file argument, no pipe from a command) is allowed.

### Out of scope

- **Rewriting the gates of gwrk's existing plans.** Auditing/repairing the Done-When of the 13 existing specs is content work, not a generator/lint change (parity with [023 out-of-scope](../023-plan-format-contract/spec.md)).
- **Any change to gate execution semantics.** `runGateCheck`, `set -e`, and the deliberate omission of `pipefail`/`-u` are owned by 023 §13 / PR #150 and are **unchanged** here. This feature operates purely at the authoring (generator) and define-time (lint) layers.
- **Deriving executable gates for prose-only Done-When blocks** — owned by [023 FR-001/FR-006](../023-plan-format-contract/spec.md).

---

## 2. User Scenarios & Testing

### US-001 - Generator emits exit-based Done-When assertions (Priority: P0)
As the `gwrk-plan` generator, I emit Done-When gate lines that verify a command by **running it directly** so its exit code decides pass/fail (under Layer 2's `set -e`), rather than deriving pass/fail from the command's textual output — so new plans yield honest gates by construction.

**Implements**: FR-001

**Independent Test**: Inspect `gwrk-plan/PROMPT.md`; assert it documents that Done-When lines verifying a command must assert on the command's exit code (run it directly), not on its output.

**Acceptance Scenarios**:
1. **Given** the generator prompt, **When** its Done-When output contract is inspected, **Then**:
   - `grep -qiE 'exit code|exit status' src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` exits 0
   - `pnpm vitest run src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts -t "exit-based Done-When assertion"` exits 0

### US-002 - The output-as-pass antipattern is forbidden in generated plans (Priority: P0)
As a plan author reading the generator contract, the `<cmd> | grep -q <pattern>` output-as-pass form is explicitly forbidden — with the reason (on failure the pattern can appear in the command's error output; with `set -e` and no `pipefail` only the trailing `grep -q` decides, masking the producer's non-zero exit) and the safe alternative (bare exit-based command; or capture to a file, then `grep -q <pattern> <file>`) — so I never author a gate that greps a command's output to prove success.

**Implements**: FR-002

**Independent Test**: Inspect `gwrk-plan/PROMPT.md`; assert it names and forbids `<cmd> | grep -q`, states why, and documents the capture-then-grep-file safe alternative.

**Acceptance Scenarios**:
1. **Given** the generator prompt, **When** the Done-When guidance is inspected, **Then**:
   - `grep -qiE 'grep -q' src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` exits 0 (the antipattern is named)
   - `grep -qiE 'forbid|do not|never|antipattern' src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` exits 0
   - `pnpm vitest run src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts -t "forbids output-as-pass grep"` exits 0

### US-003 - `define plan` rejects the antipattern in generated plans (Priority: P1)
As a developer running `gwrk define plan`, if a source-bearing phase in the generated `plan.md` has a Done-When block that pipes a command into `grep -q` (output-as-pass), `define plan` exits 1 with a corrective message naming the phase and the offending line — so a regenerated plan cannot reintroduce the false-green.

**Implements**: FR-003

**Independent Test**: Run the plan-gate validator on a fixture plan whose source-bearing Done-When contains `make test:db 2>&1 | grep -q 'db/definitions'`; assert it exits non-zero and names the phase + line. On a fixture with exit-based Done-When (and a `grep -q pattern file` line), assert exit 0.

**Acceptance Scenarios**:
1. **Given** a generated `plan.md` whose source-bearing Phase 3 `#### Done When` contains `` make test:db 2>&1 | grep -q 'db/definitions' ``, **When** `define plan` validates it, **Then**:
   - `pnpm vitest run src/commands/define-plan.test.ts -t "rejects output-as-pass Done-When"` exits 0 (the test asserts the validator exits 1 and names the phase + offending line)
2. **Given** a generated `plan.md` whose Phase 3 Done-When asserts exit-based (`make test:db`) and separately uses `grep -q 'schemaVersion' package.json` (file argument, no command pipe), **When** `define plan` validates it, **Then**:
   - `pnpm vitest run src/commands/define-plan.test.ts -t "accepts exit-based and file grep"` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: `src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` MUST instruct that every Done-When gate line verifying a command (a build/test/runner that already exits non-zero on failure — `make`, `pnpm`, `node`, `vitest`, etc.) asserts on that command's **exit code** by running it directly (e.g. `make test:db`, `pnpm vitest run path/to.test.ts`), so Layer 2's `set -e` propagates a real failure. The prompt MUST NOT present output-text matching as a way to prove a command succeeded. (Implements: US-001)
- **FR-002**: The same generator prompt MUST **explicitly forbid** the output-as-pass antipattern `<cmd> | grep -q <pattern>` (and `<cmd> 2>&1 | grep -q …`) in Done-When blocks, documenting (a) **why** — on failure the pattern can appear in the command's error output, and with `set -e` + no `pipefail` only the trailing `grep -q`'s exit decides, masking the producer's non-zero exit → false green; and (b) the **safe alternative** — a bare exit-based command, or capturing output to a file as a separate step (whose exit `set -e` enforces) then `grep -q <pattern> <file>`. A `grep -q <pattern> <file>` reading a **file** (no pipe from a command) remains allowed. (Implements: US-002)
- **FR-003**: After generating `plan.md`, `gwrk define plan` (via `src/engine/plan-gate-validator.ts`, the same self-validation pass added for [023 FR-006](../023-plan-format-contract/spec.md)) MUST lint every **source-bearing phase**'s fenced-bash `#### Done When` block for the output-as-pass antipattern — a line that pipes a command into `grep` with the quiet flag, matching the shape `\|\s*grep\b[^|]*-q`. If any such line is found, `define plan` MUST exit 1 with a corrective message naming the phase and the offending line. A `grep -q <pattern> <file>` line with **no leading pipe from a command** MUST NOT be flagged; exit-based command lines MUST NOT be flagged. (Implements: US-003)

#### FR-003 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Source-bearing phase's Done-When pipes a command into `grep -q` (output-as-pass) | `define plan: phase-NN "<title>" Done-When asserts on output, not exit ('<offending line>'). Assert on the command's exit code (run it directly); to check a token, capture output to a file then grep the file. See specs/024-gate-assertion-contract/spec.md.` | 1 |
| Generated `plan.md` cannot be parsed (no phases) | `No phases found in <path>. Expected '### Phase N: Title' headings.` | 1 |

---

## 5. Data Model Requirements

_No new database entities. See DM-000._

This feature adds no schema and no new persisted state. It operates on the existing `PhaseSchema`/`gateScript` contract (ADR-003): FR-003 reads each source-bearing phase's already-parsed fenced-bash Done-When text and applies a deterministic string check. No schema change is required.

---

## 6. Technical Constraints

- **TC-001**: Air-Gapped — No external network calls at runtime. No CDN. No telemetry. The `define plan` lint runs the deterministic check locally.
- **TC-002**: Fail-Fast Config — Zod validation with no `.default()` calls. The FR-003 lint is itself a fail-fast gate: an output-as-pass plan → `process.exitCode = 1` with a corrective message.
- **TC-003**: TypeScript Only — No `.js`/`.jsx` in `src/`. ESM modules, ES2022 target.
- **TC-004**: Deterministic lint — the FR-003 detection MUST be pure regex/string matching (LLM-free) and reproducible, consistent with the deterministic `plan-gate-validator` (parity with [023 TC-005](../023-plan-format-contract/spec.md)).
- **TC-005**: Execution layer unchanged — this feature MUST NOT modify `runGateCheck` (`src/commands/gate.ts`), `set -e`, or the deliberate omission of `pipefail`/`-u`. Those semantics are owned by 023 §13 / PR #150. 024 acts only at the authoring (generator prompt) and define-time (lint) layers.

---

## 7. Testing Requirements

- **TR-001** (FR-001): `src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts` — a doc-contract test asserts the prompt instructs Done-When lines that verify a command to assert on the command's **exit code** (run it directly), e.g. it references "exit code"/"exit status" in the Done-When guidance and shows a bare-command example (not an output-grep example) as the canonical assertion. Vitest (grep/string assertions over the prompt file).
- **TR-002** (FR-002): `src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts` — a doc-contract test asserts the prompt names the `<cmd> | grep -q` antipattern, forbids it (contains a forbid/never/do-not directive adjacent to it), states the failure reason, and documents the capture-to-file-then-`grep -q <file>` safe alternative. Vitest.
- **TR-003** (FR-003, POSITIVE): `src/commands/define-plan.test.ts` — the plan-gate validator returns non-zero and names the phase **and** the offending line when a source-bearing phase's Done-When contains `make test:db 2>&1 | grep -q 'db/definitions'`. Vitest.
- **TR-004** (FR-003, NEGATIVE): `src/commands/define-plan.test.ts` — the validator returns 0 when Done-When asserts exit-based (`make test:db`, `pnpm vitest run x.test.ts`) and when it uses a file-argument `grep -q 'schemaVersion' package.json` (no pipe from a command); i.e. the lint does not false-fail legitimate exit-based or file-grep gates. Vitest.
- **TR-005** (SEAM, FR-001/FR-002/FR-003): `src/commands/define-plan.test.ts` — the exact data-dashboard `002-metric-model` false-green case is exercised end-to-end: a plan whose source-bearing phase gate is `make test:db 2>&1 | grep -q 'db/definitions'` (a gate that PASSES under Layer 2's `set -e` execution even though `make test:db` fails, because the pattern appears in the error text) is rejected by the `define plan` lint (exit 1, phase named). This is the coverage that would have caught the Layer-3 false-green after Layers 1 and 2 both passed. Vitest.

---

## 8. Success Criteria

- **SC-001**: The `gwrk-plan` generator prompt documents exit-based Done-When assertions and explicitly forbids the `<cmd> | grep -q` output-as-pass antipattern; plans it produces assert on exit codes by construction.
- **SC-002**: A generated plan whose source-bearing phase's Done-When pipes a command into `grep -q` causes `gwrk define plan` to exit 1 with a phase-named, line-named corrective message.
- **SC-003**: The data-dashboard `002-metric-model` case (`make test:db 2>&1 | grep -q 'db/definitions'`) — which false-passes under Layer 2 execution — is rejected at define time and is not emitted by the updated generator.
- **SC-004**: Execution semantics are unchanged — `runGateCheck` still runs `set -e` without `pipefail`/`-u`; the existing gate-execution tests remain green (`pnpm run test:ci`).
- **SC-005**: A legitimate exit-based gate (`make test:db`) and a legitimate file-grep (`grep -q 'x' file`) both pass the FR-003 lint without a false failure.

---

## 9. Verification Requirements

- **VR-001**: `pnpm run build` is clean (no TypeScript errors) after the generator-prompt and `plan-gate-validator` changes.
- **VR-002**: `pnpm vitest run src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts` and `pnpm vitest run src/commands/define-plan.test.ts` exit 0.
- **VR-003**: `grep -qiE 'grep -q' src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` exits 0 and the surrounding text forbids the form: `grep -qiE 'forbid|never|do not|antipattern' src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` exits 0.
- **VR-004**: On the SEAM fixture (TR-005), the `define plan` lint exits 1 and its stderr contains the offending line `make test:db 2>&1 | grep -q 'db/definitions'` and the phase id.
- **VR-005**: `git diff --name-only` shows `src/commands/gate.ts` is **not** modified by this feature (TC-005 — execution layer untouched).

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001 | FR-001 | US-001 | TR-001, TR-005 |
| US-002 | FR-002 | FR-002 | US-002 | TR-002, TR-005 |
| US-003 | FR-003 | FR-003 | US-003 | TR-003, TR-004, TR-005 |

All FRs map to ≥1 US and ≥1 TR. All TRs trace to an FR. No orphans.

| Other spec item | Verified by |
|---|---|
| TC-001…TC-005 | VR-001, VR-005; TC-004 by TR-003/TR-004 (deterministic, reproducible) |
| SC-001 | TR-001, TR-002, VR-003 |
| SC-002 | TR-003, VR-004 |
| SC-003 | TR-005 |
| SC-004 | VR-005; existing gate-execution suite under `pnpm run test:ci` |
| SC-005 | TR-004 |
| DM-000 | No new entities (§5) |

---

## 11. Cross-References

- **023-plan-format-contract** — §13 *"Known follow-up (assertion layer, out of scope here)"* tracks this exact defect and names the fix ("assert on the command's exit … rather than grepping its output … Tracked separately"). This feature is that tracked work — the **third layer** after 023 FR-001 (extraction) and PR #150 / 023 §13 FR-007 (execution). No contract conflict: 024 changes only the generator prompt and the `plan-gate-validator` lint; it does not alter extraction or execution.
- **PR #150 (commit `a873961`)** — Layer 2, `runGateCheck` `set -e` enforcement. 024 is complementary: `set -e` enforces **exit codes**, so gates must *assert via exit codes* for that enforcement to be meaningful. 024 does not modify `gate.ts` (TC-005).
- **ADR-005 §10 / gate-quality** (`src/utils/gate-quality.ts`) — `isHollowGate` rejects *no-op* gates (bare `echo`/`test -f`). The FR-003 lint is a sibling check targeting the *output-as-pass* shape; it does not replace `isHollowGate` and introduces no new gate-quality semantics at the execution layer.
- **ADR-003** (state contract) — operates within existing `PhaseSchema`/`gateScript`; no schema change.

---

## 12. Agent-Native Compliance

No new CLI commands. One existing command gains a failure mode (parity with [023 FR-006](../023-plan-format-contract/spec.md)):

| Command | Type | New behavior | Exit codes | Error-as-navigation | `--format json` |
|---|---|---|---|---|---|
| `gwrk define plan <feature>` | generator / mutator | FR-003 lint of generated `plan.md` Done-When blocks for the output-as-pass antipattern | `0` clean; `1` output-as-pass antipattern detected (or unparseable) | stderr names the offending `phase-NN`, quotes the offending Done-When line, and states the remediation (assert on exit; capture-to-file-then-grep) | independent of the lint; lint failures surface on stderr and via the standard `[exit:N \| Xs]` signal wrapper |

---

## 13. Open Questions

- **OQ-001 (resolved → fail-loud)**: Should the FR-003 lint *warn* or *fail*? Resolved to **fail (exit 1)**, consistent with 023 FR-006 self-validation and TC-002 fail-fast. The lint runs on the freshly generated `plan.md` only (per 023's post-generation validation pass), so the updated generator will not trip it; failing loudly prevents a regenerated plan from silently reintroducing the false-green.
- **OQ-002**: The lint targets the named `| grep -q` (quiet) form. A non-quiet `| grep <pattern>` used as a terminal pass condition shares the same risk but is out of scope for the named antipattern; if it recurs in practice, extend the FR-003 shape in a follow-up.
