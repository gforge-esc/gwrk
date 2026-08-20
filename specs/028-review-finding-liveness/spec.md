# Feature Specification: 028 Review-Finding Liveness

> **Definitional record.** This spec is the written record of a fix that is being applied **by hand**,
> not shipped through `gwrk ship` — the defect is in the machinery `gwrk ship` uses to verify work, so
> shipping it through the broken review loop would let the phase pass by exactly the mechanism under
> repair (§4.2 of the authoritative source). W1 and W2 have already landed; W3 and W4 have not.

**Feature Directory**: `specs/028-review-finding-liveness/`
**Created**: 2026-08-20
**Status**: Draft (W1/W2 landed on `develop` via [PR #176](https://github.com/gforge-esc/gwrk/pull/176), `5cd80cb`; W3/W4 outstanding)
**Lineage**: 026 gate-runner convergence → 027 gate liveness → **028 review-finding liveness**
**Input**: A review agent's blocking finding must survive to the orchestrator's verdict. Gate authority is one-way: a green gate closes only tasks with no finding against them. Amends ADR-007 §78.
**Authoritative source**: [`docs/code-review-verdict-defect.md`](../../docs/code-review-verdict-defect.md) — "CODE_REVIEW reports GO over a blocking finding — diagnosis and remedy plan" (2026-08-17). Every defect ID (`D1`–`D10`), workstream ID (`W1`–`W8`), run number, commit SHA, and acceptance criterion below is drawn from that document and verified against the current source on `develop`.

---

## 1. Overview

`gwrk ship` computes a review verdict from two signals only: **gate results** and **tasks the review agent flipped `completed → open`**. The code-review prompt instructed the agent to force *every* task in the phase to `completed` whenever gates pass — destroying the only channel the orchestrator reads. The agent wrote an excellent, specific finding into the task `description`, left the status `completed`, committed `review: code review Phase N - NO-GO`, and exited 0. The orchestrator saw no re-open, all gates green, and printed **GO**.

The UAT prompt had no such step. That single prompt asymmetry — not the stage wiring — was the bug.

### The failure (observed — runs #2728 and #2727)

`review-code-webapp: <verdict>` printed **GO in all six code reviews**. The agent's own commit subject disagreed in four:

| run | iter | committed subject | structured `"verdict"` returned | console printed |
|---|---|---|---|---|
| #2728 (008 P5) | 1 | `code review Phase 5 - NO-GO` (`7166e5a`) | *none* | **GO** |
| #2728 | 2 | `code review Phase 5 - NO-GO` (`5f7abab`) | **`"NO-GO"`** | **GO** |
| #2728 | 3 | `code review Phase 5 - GO` (`00fda93`) | *none* | GO |
| #2727 (010 P6) | 1 | `code review Phase 6 - NO-GO` (`2cffb8d`) | *none* | **GO** |
| #2727 | 2 | `code review Phase 6 - GO` (`48c3ea6`) | *none* | GO |
| #2727 | 3 | `code review Phase 6 - NO-GO` (`862b8f4`) | *none* | **GO** |

Cost: two consecutive ships tripped the circuit breaker after 3/3 iterations — `008-dashboard-surfaces` P5 (run #2728, 84m) and `010-reporting-email` P6 (run #2727, 121m). Roughly half of each run was UAT re-deriving a defect code review had already found, written down, and committed.

### The decisive evidence (§1.2 of the source)

What each review commit actually changed in `tasks.json`:

```
7166e5a  NO-GO  → description only (+REVIEW FAIL note), status untouched
5f7abab  NO-GO  → description only,                    status untouched
2cffb8d  NO-GO  → description only,                    status untouched
862b8f4  NO-GO  → description only,                    status untouched
00fda93  GO     → "status": "open" → "completed"
48c3ea6  GO     → "status": "open" → "completed"
```

**The code-review agent's `tasks.json` writes only ever moved *toward* GO.** It never once set a task `open`. Both affected phases have exactly one gated task (`T005`, `T006`); both are `open` today — re-opened by UAT, never by code review.

### Root cause (verified in source)

[`executeReviewWorkflow`](../../src/engine/ship-orchestrator.ts#L418) is a **single shared function**. CODE_REVIEW and UAT_REVIEW both dispatch through it, both call [`detectReviewReopens`](../../src/engine/ship-orchestrator.ts#L1431) and [`readVerdict`](../../src/engine/ship-orchestrator.ts#L1461). The wiring is byte-identical:

```
exit ≠ 0                        → stage fails
exit 0 → validatePhaseScope() → revertSourceMutations() → detectReviewReopens() → readVerdict()
                                                              ↑                      ↑
                                            tasks flipped completed→open      gate pass/fail
```

Nothing reads the agent's returned JSON. `ReviewResult.verdict` at [`review-plugin.ts:45`](../../src/plugins/review-plugin.ts#L45) is declared and consumed **nowhere**. `revertSourceMutations()` discards every file the agent wrote *except* `tasks.json`, so `tasks.json` is the agent's only surviving channel.

Two instructions, both code-review-only, disabled that channel:

- **D10 (dominant)** — `stageCodeReview`'s scope context, appended *after* `PROMPT.md` and therefore read last, ended with *"If a completed task's implementation has issues, note them in your summary but do NOT change its status."* The sentence carries **no phase qualifier**, and every current-phase task is `completed` by the time CODE_REVIEW runs (IMPLEMENT completed them), so it read as *never re-open anything, just write a note* — which is precisely, literally what the agent did, four times. `stageUatReview` has no equivalent sentence; that is why UAT looped correctly every time.
- **D1** — the code-review prompt force-completed **every** task in the phase when gates passed (`jq … (.tasks[].status) = "completed"`), reinforced by a "Gates are truth, tasks.json status is bookkeeping" callout, a "skip to Step 6" bypass that routed *past* the only re-opening step, and an anti-pattern entry naming task status as the wrong verdict channel.

### Prior art — the third recurrence

[`ship-orchestrator.review-gate-divergence.test.ts`](../../src/engine/ship-orchestrator.review-gate-divergence.test.ts) documents an identical console-says-GO symptom on `005-dashboard-api` Phase 1. That fix stopped `readVerdict()` from **erasing** a re-open. This is the *upstream* half: the agent never creates one. Feature 026 made "gates are truth" literally true; 027 gave gates liveness; 028 is review-finding liveness.

### The design rule this whole feature encodes (§4.0, verbatim)

> **Gate authority is one-way.** A green gate may close a task the reviewer raised **no** finding on.
> It may never close a task the reviewer reproduced a defect on. Green gate + review finding is not a
> contradiction to resolve in the gate's favour — it is the gate's coverage hole, and it is the only
> moment the system can know that.

This narrows, but does not overturn, "gates are truth."

### State of the remedy

| WS | Scope | Status | Landed as |
|---|---|---|---|
| **W1** | Code-review prompts + scope context (D1, D9, D10) | ✅ landed | `a57a68f` |
| **W2** | Code backstops (D2, D5, D6) + 11 unit tests | ✅ landed | `e588d1f` |
| **W3** | Durable findings channel (D3) + one-way JSON ratchet (D4) | ⬜ outstanding | — |
| **W4** | ADR-007 §78 correction block | ⬜ outstanding | — |
| **W5** | This definitional record + build-plan graph | 🟡 in progress | this spec |
| **W6** | Branch + `dist` hygiene | ✅ process | — |
| **W7** | `data-dashboard` unblock and reconciliation | downstream | — |
| **W8** | De-CLI-ify the webapp prompts (D7) | deferred | see OQ-003 |

W1 and W2 merged into `develop` as `5cd80cb` (PR #176). This spec states their behaviour as **normative requirements with regression guards** (FR-001…FR-007) so the rule is testable rather than merely historical, and specifies the outstanding W3/W4 work (FR-008…FR-011).

### Out of scope

- **W8 / D7** — de-CLI-ifying `review-code-webapp` / `review-uat-webapp` (verbatim CLI copies asserting "gwrk is a CLI tool. No Docker, no web server"). Quality, not verdict. Tracked as OQ-003.
- **D8** — the one-branch-per-feature / squash-merge divergence. *Not a bug*; `ensurePushable` correctly refuses a diverged branch. Documentation follow-up.
- **W7** — `data-dashboard` reconciliation (project-local plugin override, finding recovery, branch hygiene, re-ship). Downstream, in another repo.
- Making the returned JSON verdict authoritative in **both** directions. Explicitly forbidden — see TC-006.

---

## 2. User Scenarios & Testing

### US-001 - A code review that reproduces a blocking defect reports NO-GO (Priority: P0)
As `gwrk ship` running CODE_REVIEW on a phase whose gates are green but whose implementation carries a defect the reviewer reproduced, the console prints `review-code-*: NO-GO` and the loop returns to IMPLEMENT — because the agent is told, in the last thing it reads, that flipping the task's status to `open` **is** its NO-GO, and nothing instructs it to force-complete the phase.

**Implements**: FR-001, FR-003, FR-004

**Independent Test**: Build the code-review scope context for a phase and assert it contains a `VERDICT CHANNEL` block naming the status flip as the NO-GO, and does **not** contain the unqualified "note them in your summary but do NOT change its status". Assert both code-review prompts contain no phase-wide `.tasks[].status = "completed"` write.

**Acceptance Scenarios**:
1. **Given** the current `stageCodeReview` scope context, **When** it is built for a phase, **Then**:
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "tells the review agent that re-opening the task is the NO-GO"` exits 0
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "no longer tells it to leave a completed task's status alone"` exits 0
2. **Given** the shipped code-review prompts, **When** they are inspected for the D1 auto-complete, **Then**:
   - `! grep -q 'tasks\[\].status) = "completed"' src/plugins/builtins/reviews/review-code-cli/PROMPT.md` exits 0
   - `! grep -q 'tasks\[\].status) = "completed"' src/plugins/builtins/reviews/review-code-webapp/PROMPT.md` exits 0
3. **Given** the shipped code-review prompts, **When** the §4.0 rule is looked for, **Then**:
   - `grep -q 'Gate authority is one-way' src/plugins/builtins/reviews/review-code-cli/PROMPT.md` exits 0
   - `grep -q 'Gate authority is one-way' src/plugins/builtins/reviews/review-code-webapp/PROMPT.md` exits 0

### US-002 - A re-open on a task with no `gateScript` produces NO-GO, not a vacuous GO (Priority: P0)
As `gwrk ship` on a phase whose Done-When is fenced prose (so `task.gateScript` is empty — the common shape), a task the review agent re-opened yields **NO-GO** with a recorded reason, instead of being skipped before `reopenedByReview` is consulted and silently dropped.

**Implements**: FR-005

**Independent Test**: Drive `readVerdict` with `reopenedByReview` containing a task that has no `gateScript`; assert the verdict is `NO-GO`, the task remains `open`, and its description carries a `REVIEW FINDING (<id>, no gate)` note. Drive the same phase with an empty `reopenedByReview`; assert `GO`.

**Acceptance Scenarios**:
1. **Given** a gateless task re-opened by review, **When** `readVerdict` runs, **Then**:
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "reports NO-GO when review re-opens a gateless task"` exits 0
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "leaves the gateless re-opened task open"` exits 0
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "records why, so DIAGNOSE and IMPLEMENT can act on it"` exits 0
2. **Given** a gateless task review left alone, **When** `readVerdict` runs, **Then**:
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "still reports GO when review leaves a gateless task alone"` exits 0
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "does not run a gate for a task that has none"` exits 0

### US-003 - The earlier-phase infinite-loop guard survives the fix (Priority: P0, guard)
As `gwrk ship`, the review agent still MUST NOT re-open tasks belonging to any **other** phase — the guard the D10 sentence was protecting is preserved and made explicit, so removing the unqualified "do not change status" line does not reintroduce cross-phase re-open loops.

**Implements**: FR-002

**Independent Test**: Build the code-review scope context and assert it forbids touching tasks of any other phase (status **and** description), while permitting a summary-only note about them.

**Acceptance Scenarios**:
1. **Given** the current `stageCodeReview` scope context, **When** the cross-phase guard is inspected, **Then**:
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "still forbids touching tasks from other phases"` exits 0
   - `grep -q 'Do NOT touch tasks belonging to any OTHER phase' src/engine/ship-orchestrator.ts` exits 0

### US-004 - A blocking finding survives a later agent rewriting the task description (Priority: P0)
As a maintainer, a `REVIEW FAIL (` block a review agent appended during this dispatch produces **NO-GO regardless of the task's status**, and the finding text remains recoverable from `tasks.json` after IMPLEMENT and a later review have run — so a finding is not silently deleted the way `48c3ea6` and `5b29881` each deleted a real one.

**Implements**: FR-008, FR-009

**Independent Test**: Snapshot `tasks.json` before dispatch; simulate a review agent that appends `REVIEW FAIL (code): …` to a task description and leaves `status: "completed"`; assert `detectReviewReopens` reports the task as carrying a finding and `readVerdict` returns `NO-GO`. Then simulate a later agent overwriting that description; assert the finding is still readable from the append-only ledger.

**Acceptance Scenarios**:
1. **Given** a review dispatch that appends a `REVIEW FAIL (` block and leaves the task `completed`, **When** the verdict is computed, **Then**:
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "treats a newly appended REVIEW FAIL block as a finding"` exits 0
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "reports NO-GO on a description-only finding"` exits 0
2. **Given** a description that already carried a `REVIEW FAIL (` block before dispatch, **When** the verdict is computed, **Then**:
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "does not re-fire on a pre-existing REVIEW FAIL block"` exits 0
3. **Given** a later agent that overwrites the task description, **When** the ledger is read, **Then**:
   - `npx vitest run src/engine/ship-orchestrator.findings-ledger.test.ts -t "a recorded finding survives a description overwrite"` exits 0
   - `npx vitest run src/engine/ship-orchestrator.findings-ledger.test.ts -t "the ledger is append-only"` exits 0

### US-005 - The returned JSON verdict is a one-way ratchet (Priority: P1)
As `gwrk ship`, a review agent that returns `"verdict": "NO-GO"` in its structured output forces **NO-GO** even when gates are green and no task was re-opened (the run-#2728-iteration-2 case); a returned `"GO"` is **ignored** and never overrides gate or re-open evidence.

**Implements**: FR-010

**Independent Test**: Feed `readVerdict`/`executeReviewWorkflow` a captured agent stdout containing `"verdict": "NO-GO"` with all gates green and no re-opens; assert `NO-GO`. Feed one containing `"verdict": "GO"` alongside a re-opened task; assert `NO-GO` (the returned GO loses). Feed unparseable stdout; assert the verdict is unchanged from the gate + re-open computation (no hard fail).

**Acceptance Scenarios**:
1. **Given** green gates, no re-opens, and a returned `"verdict": "NO-GO"`, **When** the verdict is computed, **Then**:
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "a returned NO-GO forces NO-GO"` exits 0
2. **Given** a re-opened task and a returned `"verdict": "GO"`, **When** the verdict is computed, **Then**:
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "a returned GO never overrides re-open evidence"` exits 0
3. **Given** agent stdout with no parseable verdict, **When** the verdict is computed, **Then**:
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "an absent or unparseable verdict does not fail the run"` exits 0

### US-006 - DIAGNOSE receives the review finding as error context (Priority: P1)
As `gwrk ship` on the NO-GO → DIAGNOSE → IMPLEMENT path, the diagnosis agent is handed the actual `REVIEW/GATE DIVERGENCE` / `REVIEW FINDING` / `REVIEW FAIL` note instead of printing "no error context", and is asked for a gate or test alongside each fix.

**Implements**: FR-006

**Independent Test**: Put each of the three note formats on an open task and drive DIAGNOSE; assert the note reaches the diagnosis prompt. Put an open task with no finding at all; assert DIAGNOSE still skips it.

**Acceptance Scenarios**:
1. **Given** a task carrying a review-driven note, **When** DIAGNOSE builds its context, **Then**:
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "diagnoses a task carrying a REVIEW/GATE DIVERGENCE note"` exits 0
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "diagnoses a task carrying a REVIEW FAIL note"` exits 0
2. **Given** an open task with no finding, **When** DIAGNOSE builds its context, **Then**:
   - `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts -t "still skips when an open task carries no finding at all"` exits 0

### US-007 - The doctrine is corrected wherever it is written down (Priority: P1)
As a maintainer reading ADR-007 or `readVerdict`'s doc comment, the "gates are truth" doctrine that seeded this defect carries the one-way correction, so the definitional layer no longer contradicts the runtime and the fourth recurrence is not re-authored from the ADR.

**Implements**: FR-007, FR-011

**Independent Test**: Assert ADR-007 contains an `028 correction` block stating the one-way rule and citing `docs/code-review-verdict-defect.md`. Assert `readVerdict`'s doc comment no longer promises "any open task → NO-GO".

**Acceptance Scenarios**:
1. **Given** `docs/decisions/ADR-007-single-dispatch-path.md`, **When** the correction block is looked for, **Then**:
   - `grep -q '028 correction' docs/decisions/ADR-007-single-dispatch-path.md` exits 0
   - `grep -q 'code-review-verdict-defect.md' docs/decisions/ADR-007-single-dispatch-path.md` exits 0
2. **Given** `readVerdict`'s doc comment, **When** the stale promise is looked for, **Then**:
   - `! grep -q 'If any tasks in the phase are .open. .* NO-GO' src/engine/ship-orchestrator.ts` exits 0
   - `grep -q 'NOT "any open task → NO-GO"' src/engine/ship-orchestrator.ts` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

One operational constraint is role-shaped and normative: **`gwrk ship` is human-invoked only** — never agent-invoked, because it spawns agents, burns tokens, and opens PRs. It is also circular as a verification method for this feature (TC-004).

---

## 4. Functional Requirements

- **FR-001**: `stageCodeReview` (`src/engine/ship-orchestrator.ts:1318`) MUST build a scope context containing a `VERDICT CHANNEL` block that names the mechanism outright: for a blocking defect in a task of **this** phase, set that task's status to `"open"` in `tasks.json` and append a `REVIEW FAIL` note; that status flip **is** the NO-GO; the orchestrator reads it and not the agent's prose, commit subject, or JSON `verdict` field; a finding left on a completed task is discarded and the phase advances to UAT as if approved; and this holds **even when the task's gate passes**, because a green gate over a reproduced defect is a gate coverage hole. The scope context MUST NOT contain the unqualified sentence *"If a completed task's implementation has issues, note them in your summary but do NOT change its status."* A code comment MUST record why, so the block is not "simplified" back. (Implements: US-001) *(landed `a57a68f`)*
- **FR-002**: The same scope context MUST preserve the earlier-phase infinite-loop guard explicitly — *"Do NOT touch tasks belonging to any OTHER phase — not their status, not their descriptions"* — with summary-only notes permitted for other-phase issues. Removing the D10 sentence MUST NOT reintroduce cross-phase re-opens. (Implements: US-003) *(landed `a57a68f`)*
- **FR-003**: `src/plugins/builtins/reviews/review-code-cli/PROMPT.md` and `review-code-webapp/PROMPT.md` MUST:
  (a) open `<scope_constraints>` with the MUST-flip-status contract and why a note alone is invisible to the orchestrator;
  (b) state the §4.0 **one-way gate authority** rule in place of "Gates are truth, tasks.json status is bookkeeping";
  (c) contain **no** phase-wide `(.phases[] | select(.id == $pid) | .tasks[].status) = "completed"` write — the gate step records a mechanical baseline and writes nothing;
  (d) have no "gates passed → skip to Step 6" bypass, so findings recorded in the review/test steps reach the single write step;
  (e) complete tasks **one task id at a time**, never phase-wide, from a decision table in which a finding beats a green gate;
  (f) mark description writes **APPEND ONLY**, never overwrite;
  (g) state in `<verdict_criteria>` how the console verdict is really derived (gates + re-opens), and warn in "JSON Intent Format" that the JSON is a log summary, not the verdict channel, and that `intents` are reverted;
  (h) carry anti-patterns that are the inverse of the old ones — leaving a task `completed` after recording a blocking finding on it, writing status before the write step, bare-number phase selectors, and description overwrites.
  The two files MUST remain byte-identical (TC-007). (Implements: US-001) *(landed `a57a68f`)*
- **FR-004**: Every `.phases[]` selector in both code-review prompts MUST select by `$PHASE_ID` — the zero-padded string id (`phase-05`) — never by the bare phase number. The prompt MUST carry a CAUTION that a bare-number selector matches nothing, causes `jq` to rewrite the file unchanged, and makes the re-open silently vanish. The write step MUST end with a read-back verification (`jq -r … .id + " " + .status`) so a lost write is caught before commit. (Implements: US-001) *(landed `a57a68f`)*
- **FR-005**: `readVerdict` (`src/engine/ship-orchestrator.ts:1461`) MUST consult `reopenedByReview` for **every** task before any `continue`. The pre-existing `if (!task.gateScript) continue` MUST NOT run ahead of that check. When a task with no `gateScript` is in `reopenedByReview`, `readVerdict` MUST return `NO-GO`, leave the task `open`, clear `completedAt`, append a `REVIEW FINDING (<task.id>, no gate)` note explaining that nothing mechanical can confirm or refute the finding, and print a line naming every such task. Only *gate execution* is skipped when `gateScript` is absent. A gateless task that review did **not** re-open MUST NOT produce NO-GO (no false positive), and no gate MUST be run for a task that has none. (Implements: US-002) *(landed `e588d1f`)*
- **FR-006**: The DIAGNOSE context regex (`src/engine/ship-orchestrator.ts:2154`) MUST match `REVIEW/GATE DIVERGENCE`, `REVIEW FINDING`, and `REVIEW FAIL` in addition to `BUILD_CHECK FAILED`, `TEST_GATE REGRESSION`, and `POST-FLIGHT GATE FAIL`. When the matched context is review-driven, the diagnosis prompt MUST state that the build is green and ask for a gate or test alongside each fix — *a finding that survives its own fix is a finding that will recur* — with the persona widened from "TypeScript build diagnostician" to "build and code-review diagnostician". An open task carrying no finding MUST still be skipped. (Implements: US-006) *(landed `e588d1f`)*
- **FR-007**: `readVerdict`'s doc comment MUST describe what the code does — the verdict comes from each task's gate plus the tasks the review agent re-opened; NO-GO if a gate fails, if a re-opened task's gate passes anyway (a coverage hole), or if a re-opened task has no gate at all. It MUST NOT claim "If any tasks in the phase are `open` … → NO-GO", which the code has never done and must not (a task can be open because nobody has implemented it yet). (Implements: US-007) *(landed `e588d1f`)*
- **FR-008**: `detectReviewReopens` MUST additionally diff each phase task's `description` between the pre-dispatch snapshot and the post-dispatch state, and MUST treat a **newly appended** `REVIEW FAIL (` block as a finding on that task — producing `NO-GO` regardless of the task's status. A `REVIEW FAIL (` block already present in the pre-dispatch snapshot MUST NOT re-fire (it belongs to an earlier iteration). The returned value MUST distinguish status-flip findings from description-only findings so `readVerdict` can name the mechanism in its output. This single change would have caught all four missed NO-GOs. (Implements: US-004)
- **FR-009**: A blocking finding MUST be recorded in an **append-only** store that later agents may append to but never rewrite — an append-only `findings[]` array on the phase in `tasks.json`, or a sibling `.gwrk/findings.jsonl`. Each entry MUST carry at minimum the task id, the phase id, the review stage that raised it, and the finding text. `task.description` remains the human-readable mirror, not the store of record. Rewriting or deleting an existing entry MUST NOT be possible through the normal write path. Without this, D3 recurs: `48c3ea6` and `5b29881` each silently deleted a real finding. (Implements: US-004)
- **FR-010**: The review agent's returned structured verdict MUST be consumed as a **one-way ratchet only**. `TaskResult.stdout` is already captured (`src/utils/agent.ts:154`), so the returned verdict is readable. A parsed `"verdict": "NO-GO"` MUST force the stage verdict to `NO-GO`. A parsed `"verdict": "GO"` MUST be ignored — it MUST NEVER override gate or re-open evidence. An absent, unparseable, or malformed verdict MUST leave the gate + re-open computation untouched and MUST NOT hard-fail the run. If FR-010 is not built, the "JSON Intent Format" section MUST instead be deleted from the review prompts — an unconsumed contract is worse than no contract. (Implements: US-005)
- **FR-011**: `docs/decisions/ADR-007-single-dispatch-path.md` MUST carry an inline `028 correction` block immediately after the "The agent's verdict is advisory. Gates are truth." paragraph, in the same house style as the existing `026 correction`, stating that "gates are truth" is one-way; that a gate may close a task the reviewer raised no finding on but never one it reproduced a defect on; that the combination is a gate coverage hole which `readVerdict` treats as NO-GO; that the review prompts asserted the broad version and instructed agents to force `status: completed` whenever gates passed, silently discarding four blocking code-review findings across runs #2727/#2728; and citing `docs/code-review-verdict-defect.md`. (Implements: US-007)

#### FR-001/FR-002/FR-003/FR-004 Error States (agent-facing text)
_No process exit. These are prompt and scope-context contents; the failure mode is a wrong agent action, not a thrown error._
| Condition | Observable behaviour | Result |
|---|---|---|
| Agent records a blocking finding and flips the task to `open` | Status flip detected by `detectReviewReopens` | `NO-GO` → DIAGNOSE → IMPLEMENT |
| Agent records a blocking finding but leaves the task `completed` | Prompt + scope context forbid it; FR-008 catches it as a description-only finding | `NO-GO` (FR-008) |
| Agent selects `.phases[]` by bare number | `jq` matches nothing and rewrites the file unchanged; read-back verification (FR-004) prints the unchanged status | Caught pre-commit by the agent |
| Agent touches a task in another phase | `validatePhaseScope` rejects the out-of-scope mutation | Stage fails |

#### FR-005 Error States (`readVerdict`)
| Condition | stdout contains | Verdict |
|---|---|---|
| Re-opened task, no `gateScript` | `⚠ REVIEW FINDING: <id> — re-opened by review, and no gate covers it` and `✗ <n> task(s) re-opened by review with no gate to check them: <ids>` | `NO-GO` |
| Re-opened task, gate PASSES | `⚠ REVIEW/GATE DIVERGENCE: <id> — gate PASSES but review re-opened the task` | `NO-GO` |
| Re-opened task, gate FAILS | existing gate-failure output | `NO-GO` |
| Untouched task, no `gateScript` | (nothing) | does not contribute NO-GO |
| Untouched task, gate PASSES | task completed, `completedAt` stamped | `GO` |

#### FR-006 Error States (DIAGNOSE)
| Condition | Behaviour | Result |
|---|---|---|
| Open task with a `REVIEW/GATE DIVERGENCE` / `REVIEW FINDING` / `REVIEW FAIL` note | Note is extracted into the diagnosis prompt; build stated green; a gate or test requested alongside each fix | DIAGNOSE runs with real context |
| Open task with `BUILD_CHECK FAILED` / `TEST_GATE REGRESSION` / `POST-FLIGHT GATE FAIL` | (existing) note extracted | DIAGNOSE runs with real context |
| Open task with no matching note | Skipped | DIAGNOSE reports no error context for that task |

#### FR-008/FR-009 Error States (findings channel)
| Condition | Behaviour | Verdict |
|---|---|---|
| `REVIEW FAIL (` newly appended during this dispatch, status left `completed` | Finding recorded in the append-only store; task treated as carrying a finding | `NO-GO` |
| `REVIEW FAIL (` present in the pre-dispatch snapshot, unchanged | Not a new finding; no re-fire | unchanged |
| `tasks.json` unreadable after dispatch | Existing `detectReviewReopens` catch returns an empty set; `readVerdict` reports the read failure | `readVerdict`'s existing error path |
| Later agent overwrites `task.description` | Ledger entry is unaffected; description mirror is lossy by design | Finding still recoverable |

#### FR-010 Error States (JSON ratchet)
| Condition | Behaviour | Verdict |
|---|---|---|
| Returned `"verdict": "NO-GO"`, gates green, no re-opens | Ratchet fires; stage output names the returned verdict as the source | `NO-GO` |
| Returned `"verdict": "GO"`, task re-opened | Returned GO ignored | `NO-GO` |
| Returned `"verdict": "GO"`, gates green, no re-opens | Returned GO ignored; verdict unchanged | `GO` |
| No verdict / unparseable stdout | Parse failure swallowed; no new failure mode introduced | gate + re-open result |

---

## 5. Data Model Requirements

This feature introduces **one** persisted structure — the append-only findings store required by FR-009. Everything else operates on existing shapes (`PhaseSchema`, `TaskSchema` in `src/utils/state.ts`; `ReviewResult` in `src/plugins/review-plugin.ts`). No SQLite schema change: discovery and verdict computation MUST work from a bare git clone (TC-008).

| Entity | Location | Shape | Mutability |
|---|---|---|---|
| Finding | append-only `findings[]` on the phase in `tasks.json`, **or** sibling `.gwrk/findings.jsonl` | `{ taskId, phaseId, stage, text, recordedAt }` (minimum; `stage` ∈ `code-review` \| `uat-review`) | **Append only.** Existing entries are never rewritten or deleted through the normal write path. |
| `task.description` | existing | free text | Human-readable mirror. Lossy by design — every later agent may rewrite it. Not the store of record. |

`ReviewResult.verdict` (`src/plugins/review-plugin.ts:45`) is an existing declared field that is currently consumed nowhere. FR-010 makes it consumed in one direction; the type itself is unchanged.

---

## 6. Technical Constraints

- **TC-001**: **Air-Gapped** — no runtime CDN fetches, no telemetry, no analytics. The verdict path reads local `tasks.json` and runs local gates only.
- **TC-002**: **Fail-Fast Config** — no graceful defaults. This feature's own fail-fast shape is inverted from the defect: an unresolved review finding NO-GOs loudly rather than being absorbed into a silent GO. FR-010's parse failure is the one deliberate exception (TC-006).
- **TC-003**: **TypeScript Only** — no `.js`/`.jsx` in `src/`; ESM, ES2022.
- **TC-004**: **`gwrk ship` MUST NOT be used to verify this feature.** Three reasons, all decisive: (1) circularity — the defect is *in the machinery `gwrk ship` uses to verify work*, so shipping the fix through the broken review loop lets a phase pass by exactly the mechanism under repair; (2) precedent — this defect class lands as a plain `fix(ship): …` PR in this repo (#171–#176), no spec created for any of them; (3) `gwrk ship` is human-only. Verification is `npm run build && npm run test:ci` (`test:ci` sets `GWRK_SKIP_INTEGRATION=1`), plus `gwrk gate`/`gwrk tasks verify` for the definitional artifacts. **Never** the daemon.
- **TC-005**: **Prompt changes go live via `postbuild`, not via release.** `~/.local/bin/gwrk` execs `dist/cli.js` from this working tree, and `postbuild` copies `src/plugins/builtins/*` → `dist/plugins/builtins/`. `npm run build` therefore makes a prompt change live for every project on the machine immediately. `dist/` is shared mutable state: a feature-branch build MUST NOT be left in place while other projects are shipping.
- **TC-006**: **The JSON verdict ratchet is one-way, permanently.** A returned `GO` MUST NEVER override gate or re-open evidence, and an absent or malformed verdict MUST NOT hard-fail a run. Making the returned verdict authoritative in both directions is explicitly forbidden — it conflicts with ADR-007 by design and adds a new way for a run to hard-fail on agent formatting.
- **TC-007**: **Prompt parity** — `review-code-cli/PROMPT.md` and `review-code-webapp/PROMPT.md` MUST stay byte-identical, as they were before this feature. A divergence in the verdict-channel region is a defect. (De-CLI-ifying the webapp prompt is W8/OQ-003, and MUST be done with `[type: …]` conditional guards resolved by `conditionPrompt`, not a third copy of the file.)
- **TC-008**: **Bare-clone verdict path** — computing a verdict MUST require only the git working tree (`tasks.json` + gate scripts). No SQLite, no build server. Commands that require server/DB access MUST fail fast if unavailable.
- **TC-009**: **`tasks.json` is the review agent's only surviving channel.** `revertSourceMutations()` discards every file the agent wrote except `tasks.json`; `intents` returned by the agent are not applied. Any new verdict signal MUST therefore live in `tasks.json` (or a sibling artifact the revert preserves), not in a source file the agent writes.

---

## 7. Testing Requirements

- **TR-001** (FR-001, D10 REGRESSION GUARD): `src/engine/ship-orchestrator.review-finding-liveness.test.ts` — build the `stageCodeReview` scope context and assert it contains `VERDICT CHANNEL`, names the status flip as the NO-GO, and does **not** contain "note them in your summary but do NOT change its status". Named cases: `"tells the review agent that re-opening the task is the NO-GO"`, `"no longer tells it to leave a completed task's status alone"`. Vitest. *(exists)*
- **TR-002** (FR-002, GUARD): same file — assert the scope context still forbids touching tasks from other phases. Named case: `"still forbids touching tasks from other phases"`. This is the check that the infinite-loop guard survived the D10 removal. Vitest. *(exists)*
- **TR-003** (FR-003/FR-004, PROMPT CONTRACT): **new** `src/plugins/builtins/reviews/review-prompts.test.ts` — read both code-review `PROMPT.md` files and assert, for each: no `(.tasks[].status) = "completed"` phase-wide write; presence of `Gate authority is one-way`; presence of the MUST-flip-status contract inside `<scope_constraints>`; every `.phases[]` selector uses `$pid`/`$PHASE_ID` and none uses a bare number; presence of the read-back verification; presence of `APPEND ONLY`; the JSON-Intent-Format warning; and the inverted anti-pattern entries. Assert the two files are byte-identical (TC-007). Vitest reading the source files. *(to author)*
- **TR-004** (FR-005, D2 POSITIVE): `…review-finding-liveness.test.ts` — a re-open on a task with no `gateScript` → `NO-GO`; the task stays `open`; a `REVIEW FINDING (<id>, no gate)` note is recorded. Named cases: `"reports NO-GO when review re-opens a gateless task"`, `"leaves the gateless re-opened task open"`, `"records why, so DIAGNOSE and IMPLEMENT can act on it"`. Vitest (mocks `gate-exec`, `state`, `loader`, `agent`). *(exists)*
- **TR-005** (FR-005, D2 NEGATIVE / no-false-positive): same file — an **untouched** gateless task still yields `GO`, and no gate is executed for a task that has none. Named cases: `"still reports GO when review leaves a gateless task alone"`, `"does not run a gate for a task that has none"`. Vitest. *(exists)*
- **TR-006** (FR-006, D5): same file — both note formats (`REVIEW/GATE DIVERGENCE`, `REVIEW FAIL`) reach the diagnostician; an open task with no finding still skips. Named cases: `"diagnoses a task carrying a REVIEW/GATE DIVERGENCE note"`, `"diagnoses a task carrying a REVIEW FAIL note"`, `"still skips when an open task carries no finding at all"`. Vitest. *(exists)*
- **TR-007** (FR-007, DOC CONTRACT): **new** case in `…review-finding-liveness.test.ts` — read `src/engine/ship-orchestrator.ts` and assert `readVerdict`'s doc comment states the real rule and no longer claims "any open task → NO-GO". Named case: `"readVerdict's doc comment states the real rule"`. Vitest. *(to author)*
- **TR-008** (FR-008, D3 DETECTION): **new** cases in `…review-finding-liveness.test.ts` — snapshot a phase, simulate a dispatch that appends `REVIEW FAIL (code): …` to a task description while leaving `status: "completed"`, and assert `detectReviewReopens` reports a description-only finding and `readVerdict` returns `NO-GO`; assert a `REVIEW FAIL (` block already present pre-dispatch does **not** re-fire. Named cases: `"treats a newly appended REVIEW FAIL block as a finding"`, `"reports NO-GO on a description-only finding"`, `"does not re-fire on a pre-existing REVIEW FAIL block"`. This is the coverage that would have caught all four missed NO-GOs. Vitest. *(to author)*
- **TR-009** (FR-009, D3 DURABILITY): **new** `src/engine/ship-orchestrator.findings-ledger.test.ts` — record a finding, then simulate a later agent overwriting `task.description`; assert the finding is still readable from the append-only store; assert an attempt to rewrite or delete an existing entry through the normal write path does not remove it. Named cases: `"a recorded finding survives a description overwrite"`, `"the ledger is append-only"`. Vitest. *(to author)*
- **TR-010** (FR-010, D4 RATCHET): **new** cases in `…review-finding-liveness.test.ts` — a returned `"verdict": "NO-GO"` with green gates and no re-opens → `NO-GO`; a returned `"verdict": "GO"` alongside a re-opened task → `NO-GO`; absent/unparseable stdout → verdict unchanged and no thrown error. Named cases: `"a returned NO-GO forces NO-GO"`, `"a returned GO never overrides re-open evidence"`, `"an absent or unparseable verdict does not fail the run"`. Vitest. *(to author)*
- **TR-011** (FR-011, ADR CONTRACT): **new** case in `…review-finding-liveness.test.ts` (or `docs`-assertion test) — assert `docs/decisions/ADR-007-single-dispatch-path.md` contains an `028 correction` block that states the one-way rule and cites `docs/code-review-verdict-defect.md`. Named case: `"ADR-007 carries the 028 one-way correction"`. Vitest reading the doc. *(to author)*
- **TR-012** (SEAM, FR-001/FR-003/FR-005/FR-008): **new** case in `…review-finding-liveness.test.ts` — the exact runs #2727/#2728 shape end-to-end: a phase with **one** task, gates green, the review agent appends a `REVIEW FAIL (code)` note and (a) flips the status → `NO-GO`; (b) leaves the status `completed` → still `NO-GO` via FR-008. Assert the console line reads `<workflow>: NO-GO` and the stage returns the NO-GO path rather than advancing. Vitest. *(to author)*

---

## 8. Success Criteria

- **SC-001**: A code review that reproduces a blocking defect prints `review-code-cli: NO-GO` / `review-code-webapp: NO-GO` and the loop returns to IMPLEMENT rather than advancing to UAT. The narrow, checkable criterion from the source: **a code review that commits `- NO-GO` must print `NO-GO`**.
- **SC-002**: Neither code-review prompt contains a phase-wide force-complete, and both state the one-way gate-authority rule; the two files remain byte-identical.
- **SC-003**: A re-open on a task with no `gateScript` yields `NO-GO` with a recorded reason; a gateless task review left alone still yields `GO` (no false positive).
- **SC-004**: The earlier-phase infinite-loop guard still holds — the review agent may not re-open or edit tasks of any other phase.
- **SC-005**: A blocking finding produces `NO-GO` even when the agent leaves the status `completed`, and the finding text survives a later agent rewriting `task.description`. The 010 P6 erasure (`48c3ea6`, `5b29881`) cannot recur.
- **SC-006**: A returned `"verdict": "NO-GO"` forces NO-GO; a returned `"GO"` changes nothing; a missing verdict never hard-fails a run.
- **SC-007**: ADR-007 §78 and `readVerdict`'s doc comment both state the one-way rule, so the doctrine that seeded three recurrences is no longer written down in its broad form.
- **SC-008**: `npm run build` is clean and `npm run test:ci` is green apart from the 3 known pre-existing `src/commands/server.test.ts` daemon-spawn failures, confirmed against clean `develop`.

---

## 9. Verification Requirements

- **VR-001**: `npm run build` exits 0 (no TypeScript errors).
- **VR-002**: `npm run test:ci` is green apart from the 3 pre-existing `src/commands/server.test.ts` failures. Baseline at W2: **1272 passed, 3 failed** (up from 1261; +11 new).
- **VR-003**: `npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts src/engine/ship-orchestrator.review-gate-divergence.test.ts src/engine/ship-orchestrator.review.test.ts` exits 0.
- **VR-004**: Prompt live-ness — `npm run build && diff -q src/plugins/builtins/reviews/review-code-webapp/PROMPT.md dist/plugins/builtins/reviews/review-code-webapp/PROMPT.md` exits 0 (`postbuild` copied it), and the same for `review-code-cli`.
- **VR-005**: Prompt parity and D1/D9 absence —
  `diff -q src/plugins/builtins/reviews/review-code-cli/PROMPT.md src/plugins/builtins/reviews/review-code-webapp/PROMPT.md` exits 0;
  `! grep -q 'tasks\[\].status) = "completed"' src/plugins/builtins/reviews/review-code-cli/PROMPT.md` exits 0;
  `grep -q 'Gate authority is one-way' src/plugins/builtins/reviews/review-code-cli/PROMPT.md` exits 0.
- **VR-006**: Orchestrator contract —
  `grep -q 'VERDICT CHANNEL' src/engine/ship-orchestrator.ts` exits 0;
  `! grep -q 'note them in your summary but do NOT change its status' src/engine/ship-orchestrator.ts` exits 0;
  `grep -q 'Do NOT touch tasks belonging to any OTHER phase' src/engine/ship-orchestrator.ts` exits 0;
  `grep -q 'REVIEW FINDING|REVIEW FAIL' src/engine/ship-orchestrator.ts` exits 0 — the DIAGNOSE regex literal.
  (Match the unescaped alternatives: the source writes the slash escaped, as `REVIEW\/GATE DIVERGENCE`, inside the JS regex.)
- **VR-007**: ADR correction — `grep -q '028 correction' docs/decisions/ADR-007-single-dispatch-path.md` exits 0.
- **VR-008**: Definitional artifacts are mechanically checkable. Per the standing gate convention the phase gate lives in `task.gateScript`, **not** `phase.doneWhen` (which is empty for fenced Done-When blocks). After `gwrk define tasks 028`, every phase-01 task MUST report a non-empty gate:
  ```bash
  jq -r '.phases[]|select(.id=="phase-01")|.tasks[]
         | .id+" gate="+(if (.gateScript//"")=="" then "NONE ⚠" else "ok" end)' \
    specs/028-review-finding-liveness/.gwrk/tasks.json
  ```
  If `gwrk gate 028 -p 01` reports nothing to run, the tasks have no gates and D2 is about to bite this very feature. Then `gwrk gate 028 -p 01 -v` and `gwrk tasks verify 028` exit 0.
- **VR-009**: `gwrk ship 028 1` is **not** run, and the daemon is **not** used, at any point (TC-004). Verification is by build + tests + `gwrk gate` only.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-003, FR-004 | FR-001 | US-001 | TR-001, TR-012 |
| US-002 | FR-005 | FR-002 | US-003 | TR-002 |
| US-003 | FR-002 | FR-003 | US-001 | TR-003, TR-012 |
| US-004 | FR-008, FR-009 | FR-004 | US-001 | TR-003 |
| US-005 | FR-010 | FR-005 | US-002 | TR-004, TR-005, TR-012 |
| US-006 | FR-006 | FR-006 | US-006 | TR-006 |
| US-007 | FR-007, FR-011 | FR-007 | US-007 | TR-007 |
|  |  | FR-008 | US-004 | TR-008, TR-012 |
|  |  | FR-009 | US-004 | TR-009 |
|  |  | FR-010 | US-005 | TR-010 |
|  |  | FR-011 | US-007 | TR-011 |

Every US maps to ≥1 FR; every FR maps to ≥1 US and ≥1 TR; every TR traces to an FR. No orphans.

| Other spec item | Verified by |
|---|---|
| TC-001, TC-003 | VR-001 (no network in the verdict path; `tsc` clean) |
| TC-002 | TR-004, TR-008 (a finding NO-GOs loudly) |
| TC-004 | VR-009 |
| TC-005 | VR-004 |
| TC-006 | TR-010 (`"a returned GO never overrides re-open evidence"`, `"an absent or unparseable verdict does not fail the run"`) |
| TC-007 | TR-003, VR-005 |
| TC-008 | TR-004, TR-005 (verdict computed from `tasks.json` + gates only; no DB in the harness) |
| TC-009 | TR-008, TR-009 (finding lives in `tasks.json` / sibling ledger, which the revert preserves) |
| SC-001 | TR-012, TR-001 |
| SC-002 | TR-003, VR-005 |
| SC-003 | TR-004, TR-005 |
| SC-004 | TR-002, VR-006 |
| SC-005 | TR-008, TR-009 |
| SC-006 | TR-010 |
| SC-007 | TR-007, TR-011, VR-006, VR-007 |
| SC-008 | VR-001, VR-002, VR-003 |
| DM (findings store) | TR-009 (§5) |

---

## 11. Cross-References

- **`docs/code-review-verdict-defect.md`** (authoritative) — the diagnosis and remedy plan. This spec is W5 of that document. FR-001…FR-007 record W1 (`a57a68f`) and W2 (`e588d1f`) as normative, testable requirements; FR-008…FR-010 specify W3; FR-011 specifies W4. §4.0's one-way rule is the doctrine; §4.2's circularity argument is TC-004; §8's "what not to do" list is TC-004, TC-005, TC-006.
- **ADR-007 §78 (single dispatch path)** — the source of *"The agent's verdict is advisory. Gates are truth."* FR-011 adds the `028 correction` block, in the same inline style ADR-007 already uses for the `026 correction`. 028 **narrows** the doctrine; it does not overturn it. No conflict with ADR-007's dispatch architecture — this feature changes no dispatch path.
- **026-gate-runner-convergence** — made "gates are truth" literally true by routing `readVerdict` through the one shared `runTaskGate` (before it, an inline `task.gateScript` never executed and every real phase got a vacuous GO). 028 **depends on** that: the one-way rule is only meaningful once the gate actually runs. 028 does not modify `runTaskGate`, `getPhaseVerificationGate`, or the resolution/execution ports 026 established.
- **027-gate-liveness** — gave gates liveness (a gate that runs zero tests is not a pass). 028 is the same lineage applied to the *review* signal: a finding that is recorded but never reaches the verdict is the review equivalent of a gate that runs zero tests. 028 does not touch `runInlineGate`, `hasRecognizedTestSummary`, or `parseTestOutput`. Build-plan dependency: **028 needs 027**.
- **`ship-orchestrator.review-gate-divergence.test.ts`** — the second recurrence's regression suite, and the structural model for this feature's tests (it mocks `gate-exec`, `state`, `loader`, `agent`). 028's `readVerdict` changes MUST keep it green: FR-005 restructures the loop but preserves the divergence branch (`⚠ REVIEW/GATE DIVERGENCE`) exactly.
- **ADR-004 (agent-native output)** — no new command surface, so no new exit-code or `--format json` contract is introduced; the changed stages inherit `gwrk ship`'s existing output protocol (§12).
- **025-gate-only-phases / the gate convention** — a phase's executable gate lives in `task.gateScript` (compiled from a fenced Done-When block), **not** `phase.doneWhen`, which is empty on every real feature. This matters twice here: it is why gateless tasks are common (D2/FR-005), and it is the VR-008 sanity check on this feature's own definitional artifacts.
- **`src/plugins/review-plugin.ts:45`** (`ReviewResult.verdict`) — declared and consumed nowhere. FR-010 consumes it in one direction; if FR-010 is dropped, FR-010's fallback clause requires deleting the "JSON Intent Format" section from the prompts instead.
- **Build-plan graph** — 028 must be registered (`gwrk plan add feature 028 "Review Finding Liveness"`, `gwrk plan dep add 028 --needs 027`, `gwrk plan render`, `gwrk plan verify`). Note that `specs/000-build-plan.md` currently tops out at feature 020; registering 021–027 is a separate reconciliation and is **not** in this feature's scope.

---

## 12. Agent-Native Compliance

**No new CLI commands.** Three existing `gwrk ship` stages change behaviour; all inherit ship's existing output protocol and exit-code contract (ADR-004).

| Stage / command | Type | Behaviour | Exit codes / result | Error-as-navigation | `--format json` |
|---|---|---|---|---|---|
| `gwrk ship` → CODE_REVIEW (`stageCodeReview` → `executeReviewWorkflow`) | verifier | Scope context carries the `VERDICT CHANNEL` block (FR-001) and the cross-phase guard (FR-002); prompts no longer force-complete the phase (FR-003, FR-004) | `{ success: true, exitCode: 0 }` on GO; `handleNoGo("review-code-*")` on NO-GO; agent exit ≠ 0 → stage fails with `<workflow> agent exited <code>` | Console prints `<workflow>: GO`/`NO-GO`; on NO-GO the re-opened task's description names what to fix and that a gate or test is expected alongside the fix | inherits ship's existing `--format`/event stream; no new flag |
| `gwrk ship` → `readVerdict` (both review stages) | verifier | A re-open on a gateless task is honoured (FR-005); a green gate over a re-open stays a coverage hole; JSON `NO-GO` ratchets (FR-010) | `"GO"` \| `"NO-GO"` | `⚠ REVIEW FINDING: <id> — re-opened by review, and no gate covers it`; `✗ <n> task(s) re-opened by review with no gate to check them: <ids>`; `⚠ REVIEW/GATE DIVERGENCE: <id> — gate PASSES but review re-opened the task` — each names the task id and the corrective action | inherits ship's output protocol |
| `gwrk ship` → DIAGNOSE | query | Review-driven notes reach the diagnosis prompt (FR-006); persona widened to "build and code-review diagnostician" | unchanged | Diagnosis prompt states the build is green and requests a gate or test per fix | inherits ship's output protocol |

**Air-gapped / bare-clone**: the verdict path reads `tasks.json` and runs local gate scripts; no network, no SQLite (TC-001, TC-008).

---

## 13. Open Questions

- **OQ-001 (FR-009 storage location — `tasks.json` vs `.gwrk/findings.jsonl`)**: The source offers both. An append-only `findings[]` on the phase keeps everything in the one file `revertSourceMutations()` already preserves (TC-009) and needs no new revert-allowlist entry, but widens `PhaseSchema` and every agent that rewrites `tasks.json` becomes a potential eraser. A sibling `.gwrk/findings.jsonl` is structurally append-only and cannot be rewritten by a whole-file `jq` write, but must be explicitly added to what the revert preserves or it is discarded with the rest of the agent's output. **Recommendation**: `.gwrk/findings.jsonl` plus a revert-allowlist entry — the erasure mode (D3) is precisely whole-file rewriting, and a line-oriented file is immune to it. Resolve before implementing FR-009.
- **OQ-002 (FR-010 or prompt deletion)**: FR-010 says build the one-way ratchet **or** delete the "JSON Intent Format" section from the review prompts, because an unconsumed contract is worse than no contract. The ratchet is the better outcome — it would have caught run #2728 iteration 2, the one case where the agent *did* return a structured `"NO-GO"` — but it is the only requirement here that reads agent-authored JSON, and TC-006 exists to keep that from growing teeth in the other direction. **Recommendation**: build it, guarded by TC-006, and keep the prompt's existing warning that the JSON is a log summary.
- **OQ-003 (W8 / D7, deferred)**: `review-code-webapp` and `review-uat-webapp` are verbatim copies of the CLI prompts — titled "for CLI Projects", asserting "gwrk is a CLI tool. No Docker, no web server", running `pnpm build`/`biome`/`pnpm vitest`. `conditionPrompt` prepends real profile XML but does not rewrite the body, so a Next.js/Docker project gets a self-contradicting prompt. Quality, not verdict — explicitly out of scope here. When it is done, prefer `[type: …]` conditional guards (already resolved by `conditionPrompt`) over a third copy of the file, and note that TC-007's byte-identity constraint is what W8 will deliberately retire.
- **OQ-004 (audit for the same shape elsewhere)**: The failure shape is *a stage whose verdict depends on an agent voluntarily writing state that a later prompt instructs it to overwrite.* CODE_REVIEW was one instance; the source recommends auditing for others. Not scoped here — it is a discovery task, not a requirement — but it is the reason this spec exists as a definitional record rather than only a `fix(ship):` PR.
- **OQ-005 (build-plan reconciliation)**: `specs/000-build-plan.md` and the plan graph currently top out at feature 020; features 021–027 are unregistered. `gwrk plan verify` will therefore report drift that is not this feature's doing. Registering 028 (`--needs 027`) is in scope for W5; back-filling 021–027 is not.
