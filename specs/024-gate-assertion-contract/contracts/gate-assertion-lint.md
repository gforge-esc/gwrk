# Contract: Gate Assertion Contract & Output-as-Pass Lint

**Feature**: 024-gate-assertion-contract
**Scope**: Internal gwrk service contracts (no cross-spec public API, no new DB schema). **Extends** [023's `plan-gate-validator` contract](../../023-plan-format-contract/contracts/plan-gate-validator.md) additively; reuses ADR-003 `Phase`/`gateScript` and ADR-005 §10 `gate-quality`. Layer 3 (assertion) after 023 FR-001 (extraction) and PR #150 (execution). Does NOT alter extraction or execution (TC-005).

This contract defines (1) the **generator assertion-contract guidance** the `gwrk-plan` prompt MUST document, (2) the **method-level surface** of the FR-003 output-as-pass lint added to `validatePlanGates`, and (3) the **`define plan` integration hook** and its error string.

---

## 1. Generator assertion-contract guidance — `src/plugins/builtins/workflows/gwrk-plan/PROMPT.md`

The §4a canonical-output-format `#### Done When` guidance MUST document all three rules below (FR-001, FR-002). These are documentation obligations verified by the doc-contract tests in `prompt-contract.test.ts`.

### Rule 1 — Exit-based assertion (FR-001, TR-001)
- Every Done-When line that verifies a command (a build/test/runner that already exits non-zero on failure: `make`, `pnpm`, `node`, `vitest`, …) MUST assert on that command's **exit code** by running it directly — e.g. `make test:db`, `pnpm vitest run path/to.test.ts`.
- Rationale documented: under Layer 2's `set -e` (no `pipefail`) the command's non-zero exit fails the gate.
- The prompt MUST NOT present output-text matching as a way to prove a command succeeded. The canonical example shown MUST be a bare command, not an output-grep.
- **Doc-contract check**: `PROMPT.md` matches `/exit code|exit status/i` within the Done-When guidance.

### Rule 2 — Forbid the output-as-pass antipattern (FR-002, TR-002)
- The prompt MUST name and forbid `<cmd> | grep -q <pattern>` (and `<cmd> 2>&1 | grep -q …`), with a forbid/never/do-not/antipattern directive adjacent to the named form.
- **Why (documented)**: on failure the pattern can appear in the command's error output; with `set -e` + no `pipefail`, only the trailing `grep -q`'s exit decides, masking the producer's non-zero exit → false green.
- **Doc-contract check**: `grep -qiE 'grep -q' PROMPT.md` exits 0 AND `grep -qiE 'forbid|never|do not|antipattern' PROMPT.md` exits 0.

### Rule 3 — Safe alternative (FR-002, TR-002)
- To legitimately assert on a specific output token: capture the command's output to a file **as a separate step** (whose exit `set -e` enforces), then `grep -q <pattern> <file>`. Grep reads a **file**, never a command's mixed stdout/stderr pipe.
- A bare `grep -q <pattern> <file>` (file argument, no pipe from a command) remains allowed.

---

## 2. Lint method surface — `src/engine/plan-gate-validator.ts`

### Type: `PlanGateViolation` (extended, additive)

```ts
interface PlanGateViolation {
  phaseId: string;          // e.g. "phase-03"
  title: string;            // phase title
  gateScript: string;       // the resolved gate
  kind: "hollow" | "output-as-pass"; // NEW discriminator (default "hollow" for the 023 path)
  offendingLine?: string;   // NEW: for "output-as-pass", the Done-When line that pipes into grep -q
}

interface PlanGateReport {
  ok: boolean;                     // true iff NO violation of EITHER kind
  violations: PlanGateViolation[]; // hollow stubs (023 FR-006) AND output-as-pass lines (024 FR-003)
}
```

The 023 hollow-stub violation (fields `phaseId`/`title`/`gateScript`) is preserved verbatim; `kind` and `offendingLine` are additive so 023's `define-plan.test.ts` assertions do not regress.

### Method: `validatePlanGates(featureDir: string, featureId: string, opts?: { profile?: ProjectProfile }): PlanGateReport`

- **Does (extended)**: parse `plan.md` via `parsePlanMarkdown`; for each **source-bearing phase** (declares ≥1 file line AND/OR a `#### Done When` section):
  1. **Hollow check (023 FR-006, unchanged)**: evaluate `isHollowGate(resolvedGate)`; on true push a `{ kind: "hollow", … }` violation.
  2. **Output-as-pass lint (024 FR-003, NEW)**: for each line of the phase's fenced-bash `#### Done When` block (compiled onto each task's `gateScript`; there is no persisted `phase.gateScript` — 026), test the shape `/\|\s*grep\b[^|]*-q/`. On match push a `{ kind: "output-as-pass", phaseId, title, gateScript, offendingLine: <the line, trimmed> }` violation.
- **Detection shape**: `\|\s*grep\b[^|]*-q` — a pipe into a `grep` invocation carrying the quiet flag. Requires a leading `|`.
- **MUST NOT flag**:
  - A `grep -q <pattern> <file>` line with **no leading pipe from a command** (file argument form) — the regex requires `\|` and does not match.
  - Exit-based command lines (`make test:db`, `pnpm vitest run x.test.ts`) — no `grep`, no match.
- **Returns**: `PlanGateReport`; `ok === false` iff ≥1 violation of either kind.
- **Purity**: pure regex/string matching, LLM-free, no network, no DB (TC-001, TC-004); deterministic and reproducible.
- **No regression**: existing `specs/_fixtures/plan-format/*.md` fixtures contain no `| grep` line, so the extended pass leaves 023's `passes on executable gates` / `fails on stub-gate phase` results unchanged.

---

## 3. `define plan` integration hook — `src/commands/define-plan.ts`

- The existing post-generation call `validatePlanGates(featureDir, feature)` (added by 023 FR-006, before `commitAllClean`) is retained.
- On `report.ok === false`, format each violation's message **by `kind`** and throw `CommandError` (exit 1):
  - `kind === "hollow"` → the 023 message, unchanged: `define plan: <phaseId> "<title>" resolves to a stub gate (no executable Done-When). Author a fenced bash Done-When block. See docs/grounding/023-plan-format-contract.md.`
  - `kind === "output-as-pass"` → the FR-003 message: `define plan: <phaseId> "<title>" Done-When asserts on output, not exit ('<offendingLine>'). Assert on the command's exit code (run it directly); to check a token, capture output to a file then grep the file. See specs/024-gate-assertion-contract/spec.md.`
- On unparseable plan (no phases): the existing `No phases found in <path>. Expected '### Phase N: Title' headings.` fatal surfaces (exit 1).
- **Signal contract (ADR-004)**: exit 0 valid; exit 1 output-as-pass (or hollow, or unparseable); error-as-navigation on stderr names the phase, quotes the offending line, states the remediation; `[exit:N | Xs]` wrapper preserved via `withSignal`.

> NOTE: This feature does NOT modify `src/commands/gate.ts` or any execution semantics (TC-005 / VR-005). It acts purely at the authoring (PROMPT.md) and define-time (validator + define-plan message) layers.
