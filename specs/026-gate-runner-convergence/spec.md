# 026 — Gate Runner Convergence

> **Status:** In Progress · **Owner:** gwrk core · **Supersedes drift in:** ADR-003, ADR-005,
> ADR-007, 000-tdd-infrastructure, 001-cli-core, 004-ship-loop, 011-harvest, 023-plan-format-contract,
> 024-gate-assertion-contract, 025-gate-only-phases.

## 1. Problem

gwrk decided pass/fail at ~6 points with 3 different gate-resolution strategies. The real
executable gate lives in `task.gateScript` (compiled from a fenced `#### Done When` block);
`phase.doneWhen` holds only prose bullets and is empty on every real feature. Two runners were
file-only and broke on inline gates:

- **CODE_REVIEW / UAT** (`readVerdict`): `join(featureDir, gateScript)` then skip-if-missing →
  inline gate never ran → **vacuous GO** for every real phase.
- **Harvest** (`reconcileGates`): ran the inline string as a path → ENOENT exit 127 → **false FAIL**
  written to the SQLite "done-done" evidence of record.

Root cause: `task.gateScript` is overloaded (a file path in 001-cli-core, inline bash in 023) and
several specs falsely stated the fenced block lands in `phase.doneWhen`. That lie seeded the 025
field bug.

## 2. Outcome

One gate **resolution** port and one gate **execution** port, used by every driver, so
`gwrk gate`, ship (pre-flight, TEST_GATE, CODE_REVIEW, post-flight), and harvest return the SAME
verdict for the same `task.gateScript` on the same checkout. The specs are corrected so the
definitional layer no longer contradicts the runtime.

## 3. Architecture (ports & adapters)

- **Resolution port** — `getPhaseVerificationGate(phase): string | null` (`src/utils/gate-quality.ts`).
  The one way to read a phase's executable gate: the single distinct authored `task.gateScript`
  (fenced Done-When, shared across tasks), else joined prose `doneWhen`, else null. Rejects hollow
  and unauthored gates.
- **Execution port** — `runTaskGate(task, {featureDir, cwd}): TaskGateResult`
  (`src/utils/gate-exec.ts`). The one way to run a task's gate: convention file → `gateScript`-as-path
  file → inline `set -e` under `/bin/bash`; hollow / unauthored gates rejected before execution.
- **Adapters:** `runGate` (file exec) and `runInlineGate` (bash `-e`) sit under the execution port.
- **Drivers (all route through the ports):** `gwrk gate` (`runGateCheck`), ship `runPostFlightGates`,
  `readVerdict`, TEST_GATE phase-gate path (`runGateScript` → `runInlineGate`), harvest `reconcileGates`.

## 4. User Stories

- **US-001** — As a maintainer, a phase that is green under `gwrk gate` reaches GO at CODE_REVIEW and
  records a real pass at harvest, because all three run the identical gate.
- **US-002** — As a maintainer, a phase whose only gate is hollow or unauthored NO-GOs at every
  verdict point, never vacuous-passes.
- **US-003** — As a maintainer, harvest's post-merge evidence reflects the real gate result, not an
  ENOENT artifact.

## 5. Functional Requirements

- **FR-001** — A single `runTaskGate` resolves a gate by convention file → `gateScript` file → inline
  `set -e`/`bash`, and is the ONLY gate executor for `gwrk gate`, ship pre-flight-verdict/TEST_GATE/
  post-flight, and harvest.
- **FR-002** — `runTaskGate` rejects hollow (`echo`/`test -f` only) and unauthored placeholder gates
  as build failures BEFORE inline execution (FR-001 of 000/023).
- **FR-003** — `readVerdict` runs the phase's inline gate (no skip-if-missing). "Gates are truth"
  (ADR-007) holds because the gate actually executes.
- **FR-004** — `reconcileGates` verifies through `runTaskGate` with cwd pinned to the checkout; a
  phase's shared gate runs once (dedupe), and the recorded evidence is the real verdict.
- **FR-005** — `task.gateScript` is authoritatively either a file path OR inline shell; readers must
  use `runTaskGate` / `getPhaseVerificationGate`, never `join(featureDir, gateScript)` + existsSync.
- **FR-006** — The review-verdict gate (`readVerdict`) and the harvest reconciliation gate
  (`reconcileGates`) are first-class, specified behaviors (previously unspecified — see 004/011).

## 6. Test Requirements

- **TR-001** — `runTaskGate` unit: all three strategies + hollow/unauthored reject + cwd
  (`src/utils/gate-exec.test.ts`).
- **TR-002** — `getPhaseVerificationGate` + `isUnauthoredGate` unit (`src/utils/gate-quality.test.ts`).
- **TR-003** — Harvest: an inline gate returns a real pass/fail, not ENOENT 127
  (`src/engine/reconcile-gates.test.ts`).
- **TR-004 (SEAM)** — `parsePlanMarkdown` → `task.gateScript` → `runTaskGate` with NO injected
  `doneWhen` (the exact path the 025 bug bypassed) (`src/utils/gate-exec.test.ts`).
- **TR-005 (parity, Phase 06)** — for one feature/phase, `gwrk gate` == `readVerdict` ==
  `reconcileGates` == TEST_GATE, same checkout, under `--worktree`.

## 7. Scope decisions found during implementation

- **stageImplement pre-flight stays file-only.** Running a possibly-Docker inline gate BEFORE
  IMPLEMENT would waste a guaranteed-fail run; a missed pre-completion is only a redundant dispatch,
  never a false verdict. Not a verdict runner, so it is a documented exception to FR-001.
- **`runIntegrationGate` is not repointed.** For fenced specs its target already executes inside the
  full gate (via `runTaskGate`); repointing to derive from the resolved gate would double-run it. For
  legacy prose-`doneWhen` specs it remains the path that runs those targets.
- **`generateGateBrief` left as-is** — it is vestigial (the active define flow uses
  `generateDeterministicGates` / `generateFilesystemGates`).

## 8. Open Questions / deferred

- **OQ-001 (Phase 05 deferred) — gate-invoked-test liveness.** A gate line that invokes a test
  runner (`make test:*`, `node --test`) which executes 0 tests still exits 0 (false green). Applying
  `testsRun > 0` liveness by parsing the FULL gate's combined output risks false-failing opaque
  wrappers that hide their counts, and the integration line already executes inside the full gate.
  Deferred to a follow-up feature; `runIntegrationGate` retains liveness for the prose-`doneWhen`
  path. Tracked, not done here.

## 9. Drift ledger (the definitional blessing — comprehensive)

Each item is a spec/ADR/doc statement that contradicts the one-runner reality. `[fixed]` = corrected
in this feature; `[ledger]` = tracked for a follow-up doc pass (wording/status/line-ref only, not
bug-seeding).

**ADR-005** — §6 runner inventory omits `readVerdict`/`reconcileGates` `[ledger]`; §10.2 Invariant 2
implies one executional gate guards CODE_REVIEW `[ledger]`; §10.2.1 liveness scoped only to TEST_GATE
`[ledger]`; §5/§9.3 "removed/abolished" claims unreliable, re-verify `[ledger]`.

**ADR-007** — §2.1/§4 "gates are truth" via `readVerdict` is only true once it runs inline `[fixed]`.

**ADR-003** — harvest re-executes gates (`reconcileGates`), not only a manifest→DB upsert `[ledger]`.

**000-tdd-infrastructure** — `gateScript` is a file OR inline; hollow rule holds at runtime, not only
define-time; status header stale `[ledger]`.

**001-cli-core** — `gateScript` documented as file-path-only; reconcile to "path OR inline" `[ledger]`.

**004-ship-loop** — no FR for the review-verdict gate (`readVerdict`); add one `[ledger]`; gap-matrix
names retired `work-until-done.sh` `[ledger]`.

**011-harvest** — gate reconciliation entirely unspecified; add an FR `[ledger]`.

**023-plan-format-contract** — §5 "`phase.doneWhen` fed by fenced blocks" is FALSE (fenced → each
task's `gateScript`); "becomes the phase's gateScript" → "each task's gateScript" `[fixed]`.

**024-gate-assertion-contract** — "execution layer == `runGateCheck`" false premise; there are
multiple execution layers, now one shared runner `[ledger]`.

**025-gate-only-phases** — FR-004/US-003 read `phase.doneWhen`; must read `task.gateScript` via the
shared runner `[fixed]`.

## 10. Verification

`pnpm run build` + `pnpm run test:ci` green (only the 3 known local-only `server.test.ts` spawn
failures). Parity check (TR-005) run in Phase 06 against a gwrk feature under `--worktree`.
