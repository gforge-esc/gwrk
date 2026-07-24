# Gap Matrix: 024 Gate Assertion Contract

Coverage of every FR / US / TR in this feature (Phases 1–2) to its RED test.
Tests are committed RED before implementation. **Gate** column is left empty for
`define tasks` to fill.

| AC | Acceptance Criterion | Test Type | Test File | Test Exists | Gate |
|----|---------------------|-----------|-----------|-------------|------|
| US-001 | Generator emits exit-based Done-When assertions | doc-contract (unit) | src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts | ✅ | |
| US-002 | Output-as-pass antipattern forbidden in generated plans | doc-contract (unit) | src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts | ✅ | |
| US-003 | `define plan` rejects the antipattern in generated plans | integration | src/commands/define-plan.test.ts | ✅ | |
| FR-001 | PROMPT.md requires Done-When lines to assert on the command's exit code (run directly) | doc-contract (unit) | src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts | ✅ | |
| FR-002 | PROMPT.md forbids `<cmd> \| grep -q <pattern>`, states why + safe alternative | doc-contract (unit) | src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts | ✅ | |
| FR-003 | `validatePlanGates` lints source-bearing Done-When for output-as-pass; `define plan` exits 1 naming phase + line | integration | src/commands/define-plan.test.ts | ✅ | |
| TR-001 | `"exit-based Done-When assertion"` — prompt references exit code/status in Done-When guidance + bare-command canonical example | doc-contract (unit) | src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts | ✅ | |
| TR-002 | `"forbids output-as-pass grep"` — prompt names `grep -q`, forbids adjacent, states reason, documents capture-to-file safe alternative | doc-contract (unit) | src/plugins/builtins/workflows/gwrk-plan/prompt-contract.test.ts | ✅ | |
| TR-003 | `"rejects output-as-pass Done-When"` — validator returns `ok:false`, `phase-03`, `kind:"output-as-pass"`, `offendingLine` = the SEAM line | integration | src/commands/define-plan.test.ts | ✅ | |
| TR-004 | `"accepts exit-based and file grep"` — validator returns `ok:true`, no output-as-pass violations (exit-based + file-argument grep not flagged) | integration | src/commands/define-plan.test.ts | ✅ | |
| TR-005 | SEAM — the exact `make test:db 2>&1 \| grep -q 'db/definitions'` false-green (passes Layer 2 `set -e`) is rejected at define time | integration | src/commands/define-plan.test.ts | ✅ | |
| FR-003 Error States / §3 | `define plan` maps `output-as-pass` violations to the FR-003 corrective message and cites `specs/024-gate-assertion-contract/spec.md` (source-contract) | integration | src/commands/define-plan.test.ts | ✅ | |

## Fixtures (test support, `specs/_fixtures/gate-assertion/`, excluded from vitest collection)

| Fixture | Purpose |
|---------|---------|
| plan-output-as-pass.md | Positive/SEAM — Phase 3 Done-When `make test:db 2>&1 \| grep -q 'db/definitions'` (the 002-metric-model false-green). Drives TR-003, TR-005. |
| plan-exit-based.md | Negative — Phase 3 Done-When `make test:db`, `pnpm vitest run …`, and file-argument `grep -q 'schemaVersion' package.json`. Drives TR-004. |

## RED status

12 test cases across 2 files. **11 committed RED** (fail because the feature's
production code — the PROMPT.md guidance and the `validatePlanGates`
output-as-pass lint + `define-plan.ts` message mapping — does not exist yet).

**TR-004 (`"accepts exit-based and file grep"`) is GREEN pre-implementation by
design** — it is a negative regression guard asserting the lint does NOT
false-fail legitimate exit-based / file-argument-grep gates (SC-005). With no
detection logic yet, nothing is flagged, so it passes now; its value is
preventing a naive implementation from over-reaching. This is the one expected
non-RED case and is not hollow. Verified via
`pnpm vitest run src/commands/define-plan.test.ts` (10 pass / 6 fail alongside
the FR-005/FR-006 suites) — the 6 failures are exactly the FR-001/FR-002/FR-003
RED tests, and all 9 pre-existing 023 tests remain green (no regression).

Every FR/US/TR in the coverage matrix (spec §10) has ≥1 test; every test has a
negative/boundary companion (FR-002 forbid-directive proximity + reason + safe
alternative; FR-003 positive TR-003 + negative TR-004 + SEAM TR-005). No
deferred (❌) rows.
