# Implementation Plan: 028 Review-Finding Liveness

**Branch**: `develop` (definitional artifacts) → implementation by hand on `fix/review-finding-liveness-w3` | **Date**: 2026-08-20 | **Spec**: [spec.md](./spec.md)

## Summary

W1 and W2 are landed on `develop` (`5cd80cb`, PR #176) and were re-verified against the current source while writing this plan. What is outstanding is two-sided:

1. **Coverage, not code.** FR-001…FR-007 are implemented but only partly guarded. TR-001, TR-002, TR-004, TR-005 and TR-006 exist and pass; TR-003 (prompt contract) and TR-007 (doc-comment contract) were never authored, so the D1/D9/D10 prompt regressions and the doctrine comment are unprotected. Phase 01 closes that.
2. **W3 + W4.** The durable findings channel (FR-008 detection, FR-009 append-only store), the one-way returned-verdict ratchet (FR-010), and the ADR-007 correction block (FR-011) do not exist. Phases 02–05 build them.

Six phases, ≤3 files each, delivered **by hand**. TC-004 forbids verifying this feature with `gwrk ship`: the defect is in the machinery `gwrk ship` uses to verify work, so shipping the fix through the broken review loop would let a phase pass by exactly the mechanism under repair. Verification is `npm run build`, targeted `vitest`, and `gwrk gate` — never the daemon.

No new CLI commands (spec §12), so no new ADR-004 signal-envelope or `--format json` surface. No SQLite schema change (TC-008): the findings store is a filesystem sibling of `tasks.json`.

### Verified starting state (`develop` @ `cee5ada`)

Every row below was checked against the working tree, not inferred from the spec's status table.

| Marker | Location | State |
|---|---|---|
| `VERDICT CHANNEL` block | `src/engine/ship-orchestrator.ts:1358` | present (W1) |
| `Do NOT touch tasks belonging to any OTHER phase` | `src/engine/ship-orchestrator.ts:1348` | present (W1) |
| D10 sentence (`note them in your summary but do NOT change its status`) | `src/engine/ship-orchestrator.ts` | absent (W1) |
| D1 phase-wide force-complete | both code-review `PROMPT.md` | absent (W1) |
| `Gate authority is one-way` + `APPEND ONLY` | both code-review `PROMPT.md` | present (W1) |
| Prompt byte-identity (TC-007) | `review-code-cli` vs `review-code-webapp` | `diff -q` clean |
| Gateless-re-open branch + `REVIEW FINDING (<id>, no gate)` | `src/engine/ship-orchestrator.ts:1495-1502`, `:1561` | present (W2) |
| Widened DIAGNOSE regex | `src/engine/ship-orchestrator.ts:2154`, `:2186` | present (W2) |
| `readVerdict` doc comment states the real rule | `src/engine/ship-orchestrator.ts:1414-1422` | present (W2) — **but detached**: the block sat two `/** */` above `readVerdict`, immediately followed by `detectReviewReopens`' own doc, so `readVerdict` had no doc comment at all and JSDoc attributed the correction to the wrong method. This pass reattaches it and TR-007 asserts adjacency, not presence. |
| `028 correction` in ADR-007 | `docs/decisions/ADR-007-single-dispatch-path.md` | **absent — W4 outstanding** |
| `review-prompts.test.ts` | `src/plugins/builtins/reviews/` | **absent — TR-003 outstanding** |
| VR-003 baseline | 3 named review suites | **green today: 6 files, 58 tests passed** |
| Call sites to change | `detectReviewReopens` and `readVerdict` each have exactly **one** caller (`:500`, `:501`) | signature changes are contained |
| `result.stdout` reachable for FR-010 | `dispatchWithFailback` → `TaskResult.stdout` (`src/utils/agent.ts:154`) | available in `executeReviewWorkflow` |

### Two false-green traps these gates deliberately avoid

This feature exists because a verification channel reported success over a real finding. Two constructions used by the spec's own acceptance criteria would reproduce that failure inside the phase gates, so this plan does not use either. Both were verified empirically.

1. **`! grep -q <pattern> <file>` cannot fail a gate.** Bash exempts a command whose exit status is inverted with `!` from `set -e` (`set -e; ! true; echo reached` prints `reached`). Every "MUST NOT contain" assertion in the spec (US-001 AS-2, US-007 AS-2, VR-005, VR-006) is therefore authored here as `if grep -q '<pattern>' <file>; then echo 'FAIL: …' >&2; exit 1; fi`, which fails for real.
2. **`vitest run <file> -t "<case name>"` exits 0 when nothing matches** (verified: a nonsense `-t` filter reports `22 skipped` and exits `0`). A `-t`-filtered command therefore cannot prove a named case exists — renaming or deleting the case keeps the gate green. Gates here run whole test files bare (the file's own exit code decides) and assert named-case existence with a bare `grep -q "<case name>" <test file>`, which reads a file and is allowed by the assertion contract.

### Cross-spec coordination (mandatory cross-reference pass)

| Sister spec | Shared surface | Finding |
|---|---|---|
| **029-decision-records** | `docs/decisions/ADR-007-single-dispatch-path.md` | 🟡 **AMBER — same edit claimed twice.** 029's FR-006 applies the W4 `028 correction` block and states "Landing FR-006 closes 028 FR-011" (029 §11). **Resolution taken:** 028 applies it in Phase 05. W4 is a two-file hand edit already scoped here, 029 is spec-stage only (no plan, no tasks), and leaving the seeded doctrine written down is what re-authored this defect three times. 029 is unharmed — its FR-006 acceptance test is `grep -q '028 correction'`, which an already-applied block satisfies; FR-022 then registers the block in `## Amendments` and FR-025 corrects the citing comment at `ship-orchestrator.ts:492`. This is the user's call to reverse if they would rather 029 own the edit. |
| **026-gate-runner-convergence** | `runTaskGate`, `getPhaseVerificationGate`, resolution/execution ports | No conflict. 028 depends on 026 (the one-way rule is meaningless until the gate actually runs) and modifies none of its ports. `readVerdict`'s gate-execution path is untouched — only the finding channel consulted before it changes. |
| **027-gate-liveness** | `runInlineGate`, `hasRecognizedTestSummary`, `parseTestOutput` | No conflict; not touched. Build-plan dependency **028 needs 027** stands. |
| **025-gate-only-phases** | the `task.gateScript` gate convention | Consumed, not changed. It is why gateless tasks are common (FR-005) and why VR-008 checks this feature's own tasks for a non-empty `gateScript`. |
| **ADR-004** | agent-native output protocol | No new command surface, so no new exit-code or `--format json` contract (spec §12). |
| **`ship-orchestrator.review-gate-divergence.test.ts` / `.review.test.ts`** | `readVerdict` signature | 🟡 Phase 02 widens the `readVerdict` parameter from `Set<string>` to `ReviewFindings`. Both suites must stay green; the default-parameter form is preserved so no-argument callers keep compiling. Gated in Phases 02 and 06. |

---

## Phases and File Structure

### Phase 01: Regression guards for the landed W1/W2 contract

FR-001…FR-007 are live code with no protection against a "simplification" reverting them — which is precisely how D10 shipped. This phase authors the two missing test surfaces (TR-003, TR-007) and pins the prompt and orchestrator invariants as executable assertions. No behavioural production change: the only edit to `src/engine/ship-orchestrator.ts` moves the FR-007 doc block so it is attached to `readVerdict` instead of orphaned above `detectReviewReopens`. If any assertion here fails, W1/W2 have regressed on `develop` and that is the finding.

#### Files

- `src/engine/review-prompts.test.ts` — **create** — outside `src/plugins/builtins/`, which `postbuild` copies verbatim into `dist/` and `files: ["dist/"]` publishes (TC-005); resolves both `PROMPT.md` paths from the repo root and runs the contract over `src/` **and** `dist/` as a matrix, because `PluginLoader` dispatches the `dist/` copy — TR-003: reads both code-review `PROMPT.md` files and asserts the FR-003(a–h) and FR-004 contract on each — no phase-wide `(.tasks[].status) = "completed"`, `Gate authority is one-way` present, the MUST-flip-status contract inside `<scope_constraints>`, every `.phases[]` selector uses `$pid`/`$PHASE_ID` and none a bare number, the read-back verification present, `APPEND ONLY` present, the JSON-Intent-Format warning present, the inverted anti-patterns present — plus byte-identity of the two files (TC-007)
- `src/engine/ship-orchestrator.review-finding-liveness.test.ts` — **amend** — TR-007: read `src/engine/ship-orchestrator.ts` and assert `readVerdict`'s doc comment states the real rule and no longer claims "any open task → NO-GO"; TR-012: drive `stageCodeReview` / `stageUatReview` (each reads tasks.json BEFORE dispatching, so the state mock keys off the dispatch, not off a call count); TR-006: the third note format `REVIEW FINDING (<id>, no gate)` and the review-driven DIAGNOSE prompt
- `src/engine/ship-orchestrator.ts` — **amend** — move the FR-007 doc block so it immediately precedes `private async readVerdict` (no behaviour change)
- `specs/028-review-finding-liveness/gates/phase-01-contract.sh` — **create** — the one baseline both tasks share; `gates/T001-gate.sh`, `gates/T002-gate.sh` and both `gateScript` fields delegate to it

**Requirements Addressed:** FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007 (all landed — this phase makes them regression-guarded), US-001, US-002, US-003, US-006, US-007, TC-007

**Dependencies:** None. W1/W2 are on `develop` at `5cd80cb`.

**Contract Mapping:** none — this phase adds no interfaces.

#### Governance & Skills Contract

| Rule / Skill | Applicability |
|---|---|
| `.gwrk/rules/workspace.md` — Source File Hygiene (TS only) | Always (TC-003) — both files are `.ts` |
| `.gwrk/rules/workspace.md` — Safe Shell Inputs (`/tmp/`, never repo root) | Applies to the gate script's capture files |
| ADR-004 agent-native output | N/A — no new command surface (spec §12) |
| TC-004 — `gwrk ship` MUST NOT verify this feature | Always. Build + vitest + `gwrk gate` only |
| TC-007 — prompt byte-identity | Asserted by TR-003 and this phase's gate |
| compile-gate | Always |

#### Test Strategy

| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-001 | integration | `src/engine/ship-orchestrator.review-finding-liveness.test.ts` | existing: scope context contains `VERDICT CHANNEL` and names the status flip as the NO-GO (`"tells the review agent that re-opening the task is the NO-GO"`) |
| TR-002 | integration | `src/engine/ship-orchestrator.review-finding-liveness.test.ts` | existing: scope context still forbids touching other phases' tasks (`"still forbids touching tasks from other phases"`) |
| TR-003 | unit | `src/engine/review-prompts.test.ts` | new: both prompts satisfy FR-003(a–h) and FR-004, and are byte-identical |
| TR-004 | integration | `src/engine/ship-orchestrator.review-finding-liveness.test.ts` | existing: a re-open on a gateless task yields NO-GO, stays open, records a `REVIEW FINDING (<id>, no gate)` note |
| TR-005 | integration | `src/engine/ship-orchestrator.review-finding-liveness.test.ts` | existing: an untouched gateless task still yields GO and runs no gate (no false positive) |
| TR-006 | integration | `src/engine/ship-orchestrator.review-finding-liveness.test.ts` | existing: both review note formats reach DIAGNOSE; an open task with no finding still skips |
| TR-007 | unit | `src/engine/ship-orchestrator.review-finding-liveness.test.ts` | new: `readVerdict`'s doc comment states the real rule (`"readVerdict's doc comment states the real rule"`) |

#### Done When
```bash
# One baseline for both tasks. `runTaskGate` strategy 1 always prefers the
# convention file `gates/<id>-gate.sh` over a task's declared `gateScript`
# (src/utils/gate-exec.ts:64-74), so a gateScript that repeats the assertions is
# dead text — the executed artifact is the file. Both Phase 01 gate files, both
# `gateScript` fields, and this block therefore run the same script:
#
#   build + postbuild (dist/ is what PluginLoader dispatches — TC-005)
#   both suites; the prompt contract over src/ AND dist/ as a matrix
#   diff -q cli vs webapp (TC-007), and src vs dist for each
#   no *.test.ts published inside dist/plugins/builtins/reviews
#   the D1 / D9 / D10 negatives on every live copy of the prompt
#   VERDICT CHANNEL, the cross-phase guard, `REVIEW FINDING` and `REVIEW FAIL`
#     as two separate `grep -q` (in BRE `|` is a literal, so one alternation
#     asserts only that the file contains that regex source)
#   the FR-007 doc block asserted ATTACHED to `private async readVerdict`
#   named-case existence for every case in both suites, plus the two
#     shape guards (no call-counting state mock, no section-scoped D9 negative)
bash specs/028-review-finding-liveness/gates/phase-01-contract.sh
```

### Phase 02: Description-diff finding detection (FR-008, D3 detection)

`detectReviewReopens` reads one signal: a task that moved `completed → open`. All four missed NO-GOs wrote their finding into `task.description` and left the status alone, so the orchestrator saw nothing. This phase adds the second signal — a `REVIEW FAIL (` block newly appended during this dispatch — and widens the return value so `readVerdict` can name which mechanism raised the finding. This single change would have caught all four.

Detection is **count-based**, not presence-based: a finding fires when the occurrence count of `REVIEW FAIL (` in a task's description is higher after the dispatch than in the pre-dispatch snapshot. Presence alone would re-fire on an earlier iteration's block; a count comparison also fires correctly when a second finding is appended to a description that already carried one.

#### Files

- `src/engine/ship-orchestrator.ts` — **amend** — `detectReviewReopens` returns `ReviewFindings` (`reopened` / `descriptionOnly` / `all`) and diffs descriptions against `beforeState`; `readVerdict` takes `ReviewFindings` and consults `.all` before any `continue`, naming the mechanism in its output; the single call site at `:500-501` is updated
- `src/engine/ship-orchestrator.review-finding-liveness.test.ts` — **amend** — TR-008 cases

**Requirements Addressed:** FR-008, US-004, TC-002, TC-009, SC-005 (detection half)

**Dependencies:** Phase 01 (the guards must be green before the verdict path is restructured, so a regression is attributable).

**Contract Mapping:**
- `contracts/review-verdict.md` → `detectReviewReopens()` → `src/engine/ship-orchestrator.ts`
- `contracts/review-verdict.md` → `readVerdict()` → `src/engine/ship-orchestrator.ts`
- `contracts/review-verdict.md` → `ReviewFindings` → `src/engine/ship-orchestrator.ts`

#### Governance & Skills Contract

| Rule / Skill | Applicability |
|---|---|
| `.gwrk/rules/workspace.md` — Fail Fast, no graceful defaults | Applies inverted (TC-002): an unresolved finding NO-GOs loudly rather than being absorbed into a silent GO |
| ADR-007 §78 + the `028 correction` (Phase 05) | The doctrine this change narrows: a green gate never closes a task a reviewer reproduced a defect on |
| TC-009 — `tasks.json` is the agent's only surviving channel | The new signal lives in `tasks.json`, which `revertSourceMutations()` preserves |
| TC-004 — no `gwrk ship` | Always |
| compile-gate | Always |

#### Test Strategy

| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-008 | integration | `src/engine/ship-orchestrator.review-finding-liveness.test.ts` | a `REVIEW FAIL (` block appended during the dispatch with `status: "completed"` is reported as a description-only finding and yields NO-GO; a block present pre-dispatch does not re-fire |
| TR-004 | integration | `src/engine/ship-orchestrator.review-finding-liveness.test.ts` | regression: the gateless-re-open path still yields NO-GO under the new parameter type |
| TR-005 | integration | `src/engine/ship-orchestrator.review-finding-liveness.test.ts` | regression: no false positive — an untouched gateless task still yields GO |

#### Done When
```bash
npm run build
npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts
npx vitest run src/engine/ship-orchestrator.review-gate-divergence.test.ts
npx vitest run src/engine/ship-orchestrator.review.test.ts
grep -q 'REVIEW FAIL (' src/engine/ship-orchestrator.ts
grep -q 'descriptionOnly' src/engine/ship-orchestrator.ts
grep -q 'treats a newly appended REVIEW FAIL block as a finding' src/engine/ship-orchestrator.review-finding-liveness.test.ts
grep -q 'reports NO-GO on a description-only finding' src/engine/ship-orchestrator.review-finding-liveness.test.ts
grep -q 'does not re-fire on a pre-existing REVIEW FAIL block' src/engine/ship-orchestrator.review-finding-liveness.test.ts
```

### Phase 03: Append-only findings ledger (FR-009, D3 durability)

`task.description` is rewritten by every later agent — `48c3ea6` and `5b29881` each silently deleted a real finding that way. This phase adds the store of record, resolving **OQ-001 as recommended**: a line-oriented `specs/<feature>/.gwrk/findings.jsonl`, structurally immune to the whole-file `jq` rewrite that is D3's erasure mode. `task.description` remains the human-readable mirror, lossy by design.

The decisive mechanism, verified: `specs/028-review-finding-liveness/.gwrk/findings.jsonl` is **not** git-ignored, so the `git clean -fd` inside `revertSourceMutations()` would delete it — an earlier iteration's entries would vanish on the next review dispatch. The ledger therefore gets exactly the snapshot-and-restore treatment `tasks.json` already gets in that function, rather than relying on a `--exclude` glob. (Noted in passing, out of scope: the existing `--exclude=.runs/` names a path that does not exist — the real directory is `.gwrk/runs/`, and its contents are git-tracked, so the exclude is dead but harmless.)

Appends happen in `executeReviewWorkflow` after `revertSourceMutations()` and before `readVerdict()` rewrites `tasks.json`, so a dispatch's own entries can never be reverted. The stage is derived from the workflow name (`uat` → `uat-review`, otherwise `code-review`).

#### Files

- `src/engine/findings-ledger.ts` — **create** — `findingsPath`, `appendFinding` (`fs.appendFileSync`, one JSON object per line — no read-modify-write, so an existing entry cannot be rewritten through the normal path), `readFindings` (tolerates malformed lines by skipping them, never throws)
- `src/engine/ship-orchestrator.ts` — **amend** — append one ledger entry per finding from `ReviewFindings`; snapshot and restore `.gwrk/findings.jsonl` in `revertSourceMutations()` alongside `tasks.json`
- `src/engine/ship-orchestrator.findings-ledger.test.ts` — **create** — TR-009 cases

**Requirements Addressed:** FR-009, US-004, DM-Finding (§5), TC-008, TC-009, SC-005 (durability half)

**Dependencies:** Phase 02 (`ReviewFindings` is the ledger's input).

**Contract Mapping:**
- `contracts/findings-ledger.md` → `findingsPath()` → `src/engine/findings-ledger.ts`
- `contracts/findings-ledger.md` → `appendFinding()` → `src/engine/findings-ledger.ts`
- `contracts/findings-ledger.md` → `readFindings()` → `src/engine/findings-ledger.ts`
- `contracts/findings-ledger.md` → `FindingSchema` → `src/engine/findings-ledger.ts` (shape in [data-model.md](./data-model.md))

#### Governance & Skills Contract

| Rule / Skill | Applicability |
|---|---|
| TC-008 — bare-clone verdict path | The ledger is a filesystem sibling of `tasks.json`. No SQLite, no build server, no migration |
| TC-009 — the revert preserves only `tasks.json` | Why the ledger needs an explicit snapshot/restore entry rather than a `git clean` exclude |
| TC-001 — air-gapped | Local file append only. No network, no telemetry |
| `.gwrk/rules/seeding-governance.md` | Not present in this repo — no fixture/seed governance applies; test data is constructed in-test |
| TC-004 — no `gwrk ship` | Always |
| compile-gate | Always |

#### Test Strategy

| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-009 | integration | `src/engine/ship-orchestrator.findings-ledger.test.ts` | a recorded finding is still readable after a later agent overwrites `task.description`; an attempt to rewrite or delete an existing entry through the normal write path does not remove it |
| TR-008 | integration | `src/engine/ship-orchestrator.review-finding-liveness.test.ts` | regression: description-only detection still fires with the ledger wired in |

#### Done When
```bash
npm run build
npx vitest run src/engine/ship-orchestrator.findings-ledger.test.ts
npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts
test -f src/engine/findings-ledger.ts
grep -q 'appendFileSync' src/engine/findings-ledger.ts
grep -q 'findings.jsonl' src/engine/ship-orchestrator.ts
grep -q 'a recorded finding survives a description overwrite' src/engine/ship-orchestrator.findings-ledger.test.ts
grep -q 'the ledger is append-only' src/engine/ship-orchestrator.findings-ledger.test.ts
# TC-008: no SQLite in the verdict path.
if grep -q 'better-sqlite3' src/engine/findings-ledger.ts; then echo 'FAIL: the ledger must not require SQLite (TC-008)' >&2; exit 1; fi
```

### Phase 04: One-way returned-verdict ratchet (FR-010, D4)

Run #2728 iteration 2 is the case nothing else catches: the agent returned a structured `"verdict": "NO-GO"`, gates were green, no task was re-opened, and the console printed GO. `ReviewResult.verdict` is declared at `review-plugin.ts:45` and consumed nowhere.

TC-006 forbids this growing teeth in the other direction, permanently. That is enforced **in the type**, not in a comment: `parseReturnedVerdict` returns `"NO-GO" | undefined`. A returned `GO` is unrepresentable in the parser's output, so no future edit can make it override gate or re-open evidence without changing a signature that the phase gate asserts. Parse failure returns `undefined` and never throws — the gate + re-open computation stands unchanged.

#### Files

- `src/engine/returned-verdict.ts` — **create** — `parseReturnedVerdict(stdout: string): "NO-GO" | undefined`; tolerant scan of agent stdout (JSON object, fenced JSON, or bare `"verdict": "NO-GO"`), no throw on any input
- `src/engine/ship-orchestrator.ts` — **amend** — `executeReviewWorkflow` parses `result.stdout` and ratchets the stage verdict to NO-GO when the parser fires, naming the returned verdict as the source in its output; the ratchet runs after the gate + re-open computation and can only tighten it
- `src/engine/ship-orchestrator.review-finding-liveness.test.ts` — **amend** — TR-010 cases

**Requirements Addressed:** FR-010, US-005, TC-002, TC-006, SC-006

**Dependencies:** Phase 02 (the ratchet composes with the finding computation, not with the raw `Set`).

**Contract Mapping:**
- `contracts/review-verdict.md` → `parseReturnedVerdict()` → `src/engine/returned-verdict.ts`
- `contracts/review-verdict.md` → `executeReviewWorkflow()` ratchet step → `src/engine/ship-orchestrator.ts`

#### Governance & Skills Contract

| Rule / Skill | Applicability |
|---|---|
| TC-006 — the ratchet is one-way, permanently | Enforced structurally by the `"NO-GO" \| undefined` return type; asserted by this phase's gate |
| `.gwrk/rules/workspace.md` — Fail Fast | Deliberate exception, documented in TC-002: a malformed agent verdict MUST NOT hard-fail a run |
| ADR-007 §78 | The returned verdict stays advisory in the GO direction; only NO-GO ratchets |
| TC-004 — no `gwrk ship` | Always |
| compile-gate | Always |

#### Test Strategy

| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-010 | integration | `src/engine/ship-orchestrator.review-finding-liveness.test.ts` | returned `"NO-GO"` + green gates + no re-opens → NO-GO; returned `"GO"` + a re-opened task → NO-GO; absent/unparseable stdout → verdict unchanged, no throw |

#### Done When
```bash
npm run build
npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts
npx vitest run src/engine/ship-orchestrator.review-gate-divergence.test.ts
test -f src/engine/returned-verdict.ts
# TC-006 enforced in the signature: a returned GO must be unrepresentable.
grep -q '"NO-GO" | undefined' src/engine/returned-verdict.ts
grep -q 'parseReturnedVerdict' src/engine/ship-orchestrator.ts
grep -q 'a returned NO-GO forces NO-GO' src/engine/ship-orchestrator.review-finding-liveness.test.ts
grep -q 'a returned GO never overrides re-open evidence' src/engine/ship-orchestrator.review-finding-liveness.test.ts
grep -q 'an absent or unparseable verdict does not fail the run' src/engine/ship-orchestrator.review-finding-liveness.test.ts
```

### Phase 05: The doctrine correction (FR-011, W4)

ADR-007 §78 is where *"The agent's verdict is advisory. Gates are truth."* is written down, and it is the sentence the review prompts encoded into a phase-wide force-complete. While it stands in its broad form, the fourth recurrence can be re-authored from the ADR. The block's markdown already exists verbatim at `docs/code-review-verdict-defect.md:422-431`.

Placement: the `028 correction` blockquote is appended directly after the existing `026 correction` blockquote (`ADR-007-single-dispatch-path.md:80-84`), so both corrections sit under the §78 paragraph they qualify, in landing order and in the file's established house style.

The `decision-forge` skill that `/gwrk-plan` routes ADR work to does **not** exist on this machine (`~/.gwrk/plugins/skills/decision-forge/` is absent — the same defect 029 records). The edit is made by hand against ADR-007's own house style instead.

#### Files

- `docs/decisions/ADR-007-single-dispatch-path.md` — **amend** — append the `028 correction` blockquote after the `026 correction` block: one-way gate authority, a gate may close a task with no finding but never one a reviewer reproduced a defect on, the combination is a coverage hole `readVerdict` treats as NO-GO, the prompts asserted the broad version and discarded four blocking findings across runs #2727/#2728, citing `docs/code-review-verdict-defect.md`
- `src/engine/ship-orchestrator.review-finding-liveness.test.ts` — **amend** — TR-011 case reading the doc

**Requirements Addressed:** FR-011, US-007, SC-007

**Dependencies:** None on Phases 02–04 — this is a documentation edit and can land in parallel. Sequenced last among the outstanding work so the ADR describes shipped behaviour.

**Contract Mapping:** none — documentation.

#### Governance & Skills Contract

| Rule / Skill | Applicability |
|---|---|
| `decision-forge` skill | **Unavailable** — `~/.gwrk/plugins/skills/decision-forge/` does not exist. Edit made by hand in ADR-007's existing `026 correction` house style |
| ADR-007 §78 | The record under amendment. 028 **narrows** the doctrine; it does not overturn it, and changes no dispatch path |
| 029-decision-records FR-006/FR-022/FR-025 | Downstream: FR-006's acceptance grep is satisfied by this block; FR-022 registers it in `## Amendments`; FR-025 then corrects the citation form at `ship-orchestrator.ts:492` |
| `.gwrk/rules/workspace.md` — consult governance docs over current state | Always |
| compile-gate | Always |

#### Test Strategy

| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-011 | unit | `src/engine/ship-orchestrator.review-finding-liveness.test.ts` | ADR-007 contains an `028 correction` block stating the one-way rule and citing `docs/code-review-verdict-defect.md` |

#### Done When
```bash
npm run build
npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts
grep -q '028 correction' docs/decisions/ADR-007-single-dispatch-path.md
grep -q 'code-review-verdict-defect.md' docs/decisions/ADR-007-single-dispatch-path.md
grep -q 'one-way' docs/decisions/ADR-007-single-dispatch-path.md
grep -q '026 correction' docs/decisions/ADR-007-single-dispatch-path.md
grep -q 'ADR-007 carries the 028 one-way correction' src/engine/ship-orchestrator.review-finding-liveness.test.ts
```

### Phase 06: Seam proof and full verification (TR-012, VR-001…VR-009)

The phase that proves SC-001 the way the defect actually presented: one gated task, gates green, the review agent appends a `REVIEW FAIL (code)` note, and the console must read `<workflow>: NO-GO` in **both** variants — status flipped (FR-005 path) and status left `completed` (FR-008 path). Then the whole VR set.

**On VR-002.** Its literal baseline ("1272 passed, 3 failed") is not mechanically assertable in this working tree: `.claude/worktrees/fix-spinner-elapsed-inplace/` is a nested git worktree that vitest collects, so `npm run test:ci` reports **2547 passed / 6 failed** today — the 3 known `src/commands/server.test.ts` daemon-spawn failures plus the same 3 from the worktree copy. Asserting counts would therefore gate an environmental artifact. The gate asserts the invariant that actually matters and survives both the duplication and suite growth: **no failing test file outside `src/commands/server.test.ts`**. `NO_COLOR=1` keeps the log ANSI-free so the `FAIL` grep is exact (verified). The two `|| true` guards are load-bearing and deliberate, not oversight: the test run legitimately exits non-zero on the known quarantine, and `grep` exits 1 when a fully green run produces no `FAIL` lines. Every assertion that decides the gate reads a captured file, and its own exit status is enforced by `set -e`.

**On the build-plan graph (W5).** `gwrk plan add feature 028 …` is a DB-backed action (`PlanStore` requires SQLite), so it cannot be a gate in a bare clone and is listed as a manual step. Its other half — `plan dep add 028 --needs 027`, `plan render`, `plan verify` — is deferred: 027 is unregistered (OQ-005), so the edge would dangle and `plan render` regenerates `specs/000-build-plan.md` from a graph missing 021–027. See Deferred Items.

Manual steps (recorded, not gated — each needs SQLite or is a process constraint):
- `gwrk plan add feature 028 "Review Finding Liveness"`, verified with `gwrk plan list`
- VR-008: after `gwrk define tasks 028`, confirm every phase-01 task reports a non-empty `gateScript`, then `gwrk gate 028 -p 01 -v` and `gwrk tasks verify 028`
- VR-009: confirm `gwrk ship 028 1` was never run and the daemon was never used (TC-004)

#### Files

- `src/engine/ship-orchestrator.review-finding-liveness.test.ts` — **amend** — TR-012: the runs #2727/#2728 seam, both variants, asserting the console line reads `<workflow>: NO-GO` and the stage takes the NO-GO path rather than advancing

**Requirements Addressed:** SC-001…SC-008, VR-001…VR-009, TC-001, TC-003, TC-004, TC-005, US-001, US-004

**Dependencies:** Phases 01–05.

**Contract Mapping:** none — this phase adds no interfaces; it exercises the seam across those Phases 02–04 built.

#### Governance & Skills Contract

| Rule / Skill | Applicability |
|---|---|
| TC-004 — `gwrk ship` MUST NOT verify this feature | The controlling constraint of this phase (VR-009). Build + vitest + `gwrk gate` only, never the daemon |
| TC-005 — prompt changes go live via `postbuild` | VR-004. `dist/` is shared mutable state: do not leave a feature-branch build in place while other projects are shipping |
| `.gwrk/rules/workspace.md` — Safe Shell Inputs (`/tmp/`, never repo root) | The gate's capture files live in `/tmp/` |
| ADR-004 agent-native output | Inherited only — no new command surface (spec §12) |
| compile-gate | Always |

#### Test Strategy

| TR-### | Type | Target | Assertion |
|---|---|---|---|
| TR-012 | integration | `src/engine/ship-orchestrator.review-finding-liveness.test.ts` | one gated task, gates green: (a) note appended + status flipped → NO-GO; (b) note appended + status left `completed` → NO-GO via FR-008; console reads `<workflow>: NO-GO` |
| VR-001 | gate | `npm run build` | exits 0, no TypeScript errors |
| VR-002 | gate | `npm run test:ci` (captured) | no failing test file outside `src/commands/server.test.ts` |
| VR-003 | gate | `npx vitest run` over the three review suites | exits 0 |
| VR-004 | gate | `diff -q src/… dist/…` for both code-review prompts | `postbuild` copied them — prompt change is live |
| VR-005 | gate | prompt parity + D1/D9 absence | `diff -q` clean; force-complete absent; one-way rule present |
| VR-006 | gate | orchestrator contract greps | `VERDICT CHANNEL`, cross-phase guard, DIAGNOSE regex present; D10 sentence absent |
| VR-007 | gate | `grep -q '028 correction' docs/decisions/ADR-007-single-dispatch-path.md` | exits 0 |

#### Done When
```bash
npm run build
npx vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts src/engine/ship-orchestrator.review-gate-divergence.test.ts src/engine/ship-orchestrator.review.test.ts
npx vitest run src/engine/ship-orchestrator.findings-ledger.test.ts
npx vitest run src/engine/review-prompts.test.ts
diff -q src/plugins/builtins/reviews/review-code-cli/PROMPT.md dist/plugins/builtins/reviews/review-code-cli/PROMPT.md
diff -q src/plugins/builtins/reviews/review-code-webapp/PROMPT.md dist/plugins/builtins/reviews/review-code-webapp/PROMPT.md
diff -q src/plugins/builtins/reviews/review-code-cli/PROMPT.md src/plugins/builtins/reviews/review-code-webapp/PROMPT.md
grep -q '028 correction' docs/decisions/ADR-007-single-dispatch-path.md
grep -q 'the exact runs #2727/#2728 shape' src/engine/ship-orchestrator.review-finding-liveness.test.ts
# VR-002: the suite exits non-zero on the 3 known server.test.ts daemon-spawn failures, so capture and
# assert the invariant instead of the exit code. NO_COLOR keeps the log ANSI-free for an exact match.
# Both `|| true` guards are deliberate: the run fails on the known quarantine, and grep exits 1 when a
# fully green run yields no FAIL lines. The assertions that decide this gate all read captured files.
NO_COLOR=1 npm run test:ci > /tmp/028-test-ci.log 2>&1 || true
grep -E '^ *FAIL ' /tmp/028-test-ci.log > /tmp/028-test-ci-failures.log || true
if grep -vq 'src/commands/server.test.ts' /tmp/028-test-ci-failures.log; then echo 'FAIL: a test failed outside the known server.test.ts daemon-spawn quarantine' >&2; exit 1; fi
```

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `ReviewFindings` | `src/engine/ship-orchestrator.ts` (Phase 02) | `detectReviewReopens` (producer), `readVerdict` (consumer), `executeReviewWorkflow` (carrier), `appendFinding` (Phase 03) |
| `Finding` / `FindingSchema` | `src/engine/findings-ledger.ts` (Phase 03) | `appendFinding`, `readFindings`, `src/engine/ship-orchestrator.ts`, `ship-orchestrator.findings-ledger.test.ts` |
| `"NO-GO" \| undefined` (returned-verdict result) | `src/engine/returned-verdict.ts` (Phase 04) | `executeReviewWorkflow`. The absent `"GO"` member is the type-level enforcement of TC-006 |
| `Task`, `Phase`, `TaskState` | `src/utils/state.ts` (existing) | unchanged — no schema widening (§5) |
| `ReviewResult.verdict` | `src/plugins/review-plugin.ts:45` (existing) | consumed in one direction by Phase 04. The type itself is unchanged |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| W8 / D7 (OQ-003) | De-CLI-ify `review-code-webapp` / `review-uat-webapp` | Quality, not verdict — explicitly out of scope (spec §1). When done, use `[type: …]` conditional guards resolved by `conditionPrompt`, not a third copy of the file | Future feature; deliberately retires TC-007's byte-identity constraint |
| D8 | One-branch-per-feature / squash-merge divergence | Not a bug. `ensurePushable` correctly refuses a diverged branch | Documentation follow-up |
| W7 | `data-dashboard` unblock and reconciliation | Downstream, in another repository | `data-dashboard` |
| OQ-004 | Audit for the same failure shape elsewhere (a stage whose verdict depends on an agent voluntarily writing state a later prompt tells it to overwrite) | A discovery task, not a requirement — the reason this spec is a definitional record rather than only a `fix(ship):` PR | Discovery backlog |
| OQ-005 | Build-plan back-fill of features 021–027 | Explicitly out of scope (spec §11). `gwrk plan verify` will report drift that is not this feature's doing | Build-plan reconciliation |
| W5 (partial) | `gwrk plan dep add 028 --needs 027`, `gwrk plan render`, `gwrk plan verify` | **Blocked by OQ-005.** `dep add` does not validate node existence, so `--needs 027` would store a dangling edge; `plan render` then regenerates `specs/000-build-plan.md` from a graph missing 021–027. Registering the 028 feature node is kept (Phase 06 manual step); the edge and the render are not | Same reconciliation as OQ-005 |
| VR-002 (literal counts) | "1272 passed, 3 failed" as an assertion | Not assertable in this working tree: `.claude/worktrees/fix-spinner-elapsed-inplace/` is collected by vitest, so the suite reports 2547 passed / 6 failed. Phase 06 gates the invariant (no failure outside `src/commands/server.test.ts`) instead | Resolved if the nested worktree is removed or added to `vitest.config.ts`'s `exclude` |
| FR-010 fallback clause | Deleting the "JSON Intent Format" section from the review prompts | Not taken — OQ-002 recommends building the ratchet, and Phase 04 does. The fallback applies only if FR-010 is dropped | N/A while Phase 04 lands |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 01, 06 | guarded (FR-001/003/004 landed `a57a68f`); seam proof in 06 |
| US-002 | 01 | guarded (FR-005 landed `e588d1f`; TR-004/TR-005 exist and pass) |
| US-003 | 01 | guarded (FR-002 landed `a57a68f`; TR-002 exists and passes) |
| US-004 | 02, 03 | planned (FR-008, FR-009) |
| US-005 | 04 | planned (FR-010) |
| US-006 | 01 | guarded (FR-006 landed `e588d1f`; TR-006 exists and passes) |
| US-007 | 01, 05 | FR-007 code landed, TR-007 authored in 01; FR-011 planned in 05 |
| FR-001 | 01 | landed (W1) — guard authored |
| FR-002 | 01 | landed (W1) — guard exists |
| FR-003 | 01 | landed (W1) — guard authored (TR-003) |
| FR-004 | 01 | landed (W1) — guard authored (TR-003) |
| FR-005 | 01 | landed (W2) — guard exists |
| FR-006 | 01 | landed (W2) — guard exists |
| FR-007 | 01 | landed (W2) — guard authored (TR-007) |
| FR-008 | 02 | planned |
| FR-009 | 03 | planned (OQ-001 resolved: `.gwrk/findings.jsonl`) |
| FR-010 | 04 | planned (OQ-002 resolved: build the ratchet) |
| FR-011 | 05 | planned (W4) |
| TR-001 | 01 | exists — passes |
| TR-002 | 01 | exists — passes |
| TR-003 | 01 | to author |
| TR-004 | 01 | exists — passes |
| TR-005 | 01 | exists — passes |
| TR-006 | 01 | exists — passes |
| TR-007 | 01 | to author |
| TR-008 | 02 | to author |
| TR-009 | 03 | to author |
| TR-010 | 04 | to author |
| TR-011 | 05 | to author |
| TR-012 | 06 | to author |
| TC-001 (air-gapped) | 03, 06 | ledger is a local file append; VR-001 |
| TC-002 (fail-fast, inverted) | 02, 04 | a finding NO-GOs loudly; FR-010 parse failure is the one documented exception |
| TC-003 (TypeScript only) | all | every new file is `.ts`; `npm run build` in every gate |
| TC-004 (no `gwrk ship`) | all, asserted in 06 | VR-009 — process constraint, verified by absence |
| TC-005 (`postbuild`, not release) | 06 | VR-004 `diff -q src/… dist/…` |
| TC-006 (ratchet is one-way, permanently) | 04 | enforced in the return type; gate asserts the signature |
| TC-007 (prompt parity) | 01, 06 | TR-003 byte-identity + `diff -q` in both gates |
| TC-008 (bare-clone verdict path) | 03 | no SQLite in the ledger; gate rejects a `better-sqlite3` import |
| TC-009 (`tasks.json` is the only surviving channel) | 02, 03 | new signal in `tasks.json`; ledger snapshot/restored across the revert |
| SC-001 | 06 | TR-012 — a code review that commits `- NO-GO` prints `NO-GO` |
| SC-002 | 01 | TR-003 + VR-005 |
| SC-003 | 01 | TR-004 + TR-005 |
| SC-004 | 01 | TR-002 + VR-006 |
| SC-005 | 02, 03 | TR-008 + TR-009 |
| SC-006 | 04 | TR-010 |
| SC-007 | 01, 05 | TR-007 + TR-011 + VR-006 + VR-007 |
| SC-008 | 06 | VR-001 + VR-002 (invariant form) + VR-003 |
| VR-001 | 01–06 | `npm run build` in every phase gate |
| VR-002 | 06 | invariant form — see Deferred Items for why counts are not asserted |
| VR-003 | 02, 06 | three review suites run bare |
| VR-004 | 06 | `diff -q` src vs dist for both prompts |
| VR-005 | 01, 06 | parity + D1/D9 absence (if-form negatives) |
| VR-006 | 01 | four orchestrator contract greps |
| VR-007 | 05 | `grep -q '028 correction'` |
| VR-008 | 06 | manual — needs `gwrk define tasks 028` first; verify non-empty `gateScript` per task, then `gwrk gate 028 -p 01 -v` and `gwrk tasks verify 028` |
| VR-009 | 06 | manual — `gwrk ship 028 1` not run, daemon not used |
| DM — Finding (§5) | 03 | [data-model.md](./data-model.md); TR-009 |
| DM — `task.description` mirror | 02, 03 | unchanged shape; lossy by design |
| OQ-001 | 03 | **resolved** — `.gwrk/findings.jsonl` with snapshot/restore in `revertSourceMutations()` |
| OQ-002 | 04 | **resolved** — build the ratchet, guarded by TC-006 |
| OQ-003 | — | deferred (W8/D7) |
| OQ-004 | — | deferred (discovery task) |
| OQ-005 | — | deferred (build-plan reconciliation) |

Every `US-###`, `FR-###`, `TR-###`, `TC-###`, `SC-###`, `VR-###` and data-model entity in the spec appears above. Zero unaccounted items.
