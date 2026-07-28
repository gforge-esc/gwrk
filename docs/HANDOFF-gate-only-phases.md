# HANDOFF — First-class "gate-only" phases (ship + gate)

> **RESOLVED (feature 025, PRs #157, #158, and the field-fix follow-up).** Both surfaces are closed:
> - **Path B** (orchestrator test-liveness gate) — a test-less phase is verified by running
>   its executable gate under `set -e` (pass iff exit 0) in `stageTestGate`, instead of
>   NO-Going on `testsRun === 0`.
> - **Path A** (ship pre-flight hard block) — the same discriminator in `ship.ts`: when
>   `phaseHasTests` is false but the phase has a real gate, it proceeds (logged) instead of
>   `[BLOCKED]`.
>
> **Approach taken: inference, not the explicit `[gate]` marker below.** The discriminator is
> `getPhaseVerificationGate(phase) !== null` — one rule across pre-flight and TEST_GATE, no
> `PhaseSchema` field, no plan re-authoring.
>
> **IMPORTANT field correction.** The first cut (#157/#158) read `phase.doneWhen`, but the
> canonical `#### Done When` fenced block compiles onto **`task.gateScript`**, not
> `phase.doneWhen` (which is empty on every real feature — verified across all 12 dashboard
> features). So on real data the fix was inert (pre-flight still blocked; Fix B blind-passed).
> The follow-up reads the real gate from the compiled task state via `getPhaseVerificationGate`
> (in `gate-quality.ts`): the one authored, non-hollow, non-unauthored `task.gateScript` the
> phase's tasks share, falling back to prose-bullet `doneWhen`. The tests originally passed only
> because they mocked `doneWhen` — the wrong field; the follow-up adds tests that use the real
> `task.gateScript` shape.
>
> The regression guard holds: a source phase whose only gate is the unauthored placeholder
> (`echo "FAIL: no test maps to …"; exit 1`) or a hollow `echo`-only gate still blocks. The
> explicit `verification: "gate"` marker in §3 remains a valid FUTURE hardening; deferred.
>
> The remainder of this doc is preserved as the original analysis.

**Status:** ✅ resolved (025 / #157 / #158 / field-fix) · **Area:** `ship` pre-flight + `ship-orchestrator` test-liveness gate
**Lineage:** sequel to the *test-discovery counts non-test targets* fix (already applied — see
`test-discovery.ts:76` / `:131`, the `fileExists(t) && isTestFile(t, testExt)` guard). That fix was
correct. This handoff addresses the gap it **exposed**, not a regression to undo.
**Repro'd against:** gwrk `1.4.0-alpha.1`, data-dashboard `004-github-project-adapter` phase-01.

---

## 1. Symptom

```
$ gwrk ship 004-github-project-adapter 1 --worktree
  ▸ creating worktree for 004-github-project-adapter (feat/004-github-project-adapter)
  ✓ worktree ready: …/.runs/sandboxes/004-github-project-adapter-ship-8dc2d198
  🤖 Router selected backend: claude
✗ [BLOCKED] [BLOCKED] No test files found for phase-01
  ▸ removing worktree …
[exit:1 | 292ms] ship: No test files found for phase-01
```

Hard block at **ship pre-flight**, ~292 ms, **before any implementation**. The phase never runs.

---

## 2. Root cause

Two code paths demand a discoverable `*.test.*` per phase. Neither has a way to say "this phase is
proven by an executable gate, not a unit test."

### Path A — `ship` pre-flight (the block above)

`src/commands/ship.ts:168-181`:

```ts
const hasTests = phaseHasTests({
  sourceFiles, mentionedTests,
  testExt: getTestExtension(profile),
  fileExists: (rel) => fs.existsSync(path.join(cwd, rel)),
  testsTreeFiles: listTestsTree(cwd),
  declaredTargets: phaseData.testTargets ?? [],
});
if (!hasTests) {
  blocked(`[BLOCKED] No test files found for ${phaseId}`);
  throw new CommandError(`No test files found for ${phaseId}`, 1);   // ← exit 1, pre-implementation
}
```

`phaseHasTests` (`src/utils/test-discovery.ts:118-153`) already has **one** escape:

```ts
if (sourceFiles.length === 0) return true; // nothing to gate   // :128
```

**Why 004 phase-01 still blocks:** its task files are `src/config/env.js`, `.env.example`,
`prisma/schema.prisma`. `extractFilePaths` yields one **source** `.js` — `src/config/env.js` — so
`sourceFiles.length === 1`, the `:128` escape does not fire, and no test maps to basename `env`
(no colocated `src/config/env.test.js`, no `tests/**/env.test.js` covering the new GitHub readers).
→ `false` → block.

By design this phase is **gate-provable, not unit-tested** — the plan says so verbatim
(`specs/004-github-project-adapter/plan.md:97`: *"Phase 1 (config + schema) … bare-clone provable
(grep + config gate)"*). Its Done-When is `make config:inspect` + a `.ts`/literal grep, not a
`.test.js`.

### Path B — `ship-orchestrator` test-liveness gate (the original NO-GO)

`src/engine/ship-orchestrator.ts:~1125` (`getPhaseTestFiles` → `discoverTestsForSources`) feeds
`captureTestBaseline` / `runTestSuite`. When discovery returns `[]`, the downstream liveness check
NO-GOs on `testsRun === 0`. This is the **migration** shape: 004 phase-02's files are
`prisma/migrations/<ts>_add_initiative_model/` — no `.js`/`.ts` source, so Path A's `:128` escape
lets it *past* pre-flight, but Path B then has nothing to run. Verified by
`prisma migrate diff --exit-code`, it should pass — but currently NO-GOs.

**Same conceptual gap, two surfaces:** a phase whose verification is an executable gate has no
first-class representation, so both the pre-flight and the liveness gate treat "no test file" as
failure.

---

## 3. Proposed change — model gate-only phases as first-class

A **gate-only phase** is one whose Done-When is an executable, exit-code gate (a fenced
`#### Done When` bash block — already captured as `gateScript`, see `state.ts:22` /
`plan-to-tasks.ts:46`) rather than a unit test. For such a phase:

- **Path A** must **not** hard-block on "no test files."
- **Path B** must **not** NO-GO on `testsRun === 0`; the phase's `gateScript` is the pass/fail authority.

The safety for *ordinary* phases (source deliverables that forgot their test) **must stay** — the fix
is a scoped, intentional opt-out, not a global loosening.

### 3a. The marker — explicit, not inferred (recommended)

Add an explicit field to `PhaseSchema` (`src/utils/state.ts:35-59`):

```ts
// alongside doneWhen / testTargets
verification: z.enum(["test", "gate"]).default("test"),   // "gate" ⇒ gate-only phase
```

Set it in `plan-to-tasks` (`src/engine/plan-to-tasks.ts`) when the plan authored the phase as
gate-provable. Trigger on an explicit, greppable tag in the phase's **Test Strategy** — e.g. a
leading `[gate]` (mirrors the existing `[integration]` / `[optional]` tags the plans already use) —
so opting out is a deliberate authoring act, visible in `plan.md` and in task-state. Emit near the
existing phase emit (`plan-to-tasks.ts:~368`).

> **Why explicit over inferred:** inferring "gate-only" from *"has `gateScript` and no `testTargets`
> and no discoverable test"* would silently reclassify a phase that genuinely *forgot* its test —
> exactly the failure the pre-flight exists to catch. An explicit `[gate]` tag keeps the opt-out
> auditable and impossible to trip into by omission.

### 3b. Change points

| # | File | Change |
|---|------|--------|
| 1 | `src/utils/state.ts:35-59` | Add `verification: z.enum(["test","gate"]).default("test")` to `PhaseSchema`. |
| 2 | `src/engine/plan-to-tasks.ts` (`ParsedPhase` ~:39, parse loop, emit ~:368) | Parse a `[gate]` tag in the phase Test-Strategy; carry it to `verification: "gate"`. |
| 3 | `src/commands/ship.ts:168-181` | If `phaseData.verification === "gate"`, skip the `phaseHasTests` block and proceed to implement + gate. |
| 4 | `src/engine/ship-orchestrator.ts` (liveness/baseline path ~:1125) | For a gate-only phase, don't NO-GO on `testsRun === 0`; run `gateScript` as the authority (`testBaseline` = 0, skip the test-suite liveness assertion). |
| 5 | tests | `src/commands/ship.test.ts:297` (add a gate-only-proceeds case beside the existing block case); `src/utils/test-discovery.test.ts`; `src/engine/ship-orchestrator.*.test.ts`. |

---

## 4. Acceptance criteria

1. **Gate-only phase ships.** `gwrk ship 004-github-project-adapter 1 --worktree` (phase-01 marked
   `[gate]`) proceeds to IMPLEMENT and runs its `config:inspect` gate — no `[BLOCKED] No test files
   found` pre-flight.
2. **Gate-only migration passes gate.** `gwrk gate 004-github-project-adapter -p 02` passes via
   `prisma migrate diff --exit-code`, not a `testsRun === 0` NO-GO.
3. **Regression preserved.** A phase with a `.js`/`.ts` **source** deliverable, **not** marked
   `[gate]`, and **no** discoverable test **still** blocks with the same message. (Keep the existing
   `ship.test.ts:297` assertion for that case.)
4. **Ordinary test phases unchanged.** 003 phase-01 (`windows.js` + `tests/metrics/windows.test.js`)
   and phase-02 (`client.test.js`) still discover their tests and ship exactly as today.

---

## 5. Blast radius — why this is fleet-wide, not a 004 one-off

Every one of the 12 dashboard features has a **config phase-01**, and most a **migration phase** —
all authored gate-provable, all destined to hit Path A or Path B:

- **004** phase-01 (config+schema, Path A block) and phase-02 (migration, Path B NO-GO). ← today
- **003** phase-01 *escapes* only because it also ships a pure-logic module (`windows.js`) that has a
  real unit test — incidental, not by rule.
- Any feature whose phase-01 edits `src/config/env.js` without a colocated env test → Path A block.

Fixing the concept once unblocks the whole fleet's non-test phases; patching per-phase (Option A
below) does not.

---

## 6. Alternatives considered

- **Option A — give each such phase a `.test.*`** (env fail-fast unit; a `migrate diff` wrapper),
  via plan Test-Strategy amendment + `gwrk define tests`. No gwrk change, but per-phase, repeated
  ~15× across the fleet, and a migration "test" is a gate wearing a test costume. Viable for the
  *config* phases (fail-fast **is** genuinely unit-testable) — not a clean answer for migrations.
- **Loosen `isTestFile` / the `:128` escape again** — rejected. That would re-admit the false
  positives the applied fix removed (junk `declaredTargets` counted as tests), reopening the
  original bug. The gap is a *missing concept* (gate-only phases), not an over-tight filter.
- **Infer gate-only** from `gateScript && !testTargets && no-discovered-test` — rejected; silently
  reclassifies forgotten-test phases (§3a).

---

## 7. Notes for the implementer

- `gateScript` already exists per-phase (fenced `#### Done When` bash) — reuse it as the gate-only
  authority; you are adding a *classification*, not a new gate mechanism.
- The existing tag vocabulary in the dashboard plans is `[integration]` / `[optional]`; `[gate]`
  slots in naturally and is greppable in `plan-to-tasks`.
- Keep the pre-flight block message byte-identical for the non-gate path so the existing
  `ship.test.ts:297` assertion (and any operator muscle memory) is undisturbed.
