# CODE_REVIEW reports GO over a blocking finding — diagnosis and remedy plan

> **Status:** In progress on `fix/review-finding-liveness` → [PR #176](https://github.com/gforge-esc/gwrk/pull/176)
> (open across all workstreams; D10/D1/D9 landed, D2/D5/D6 in W2) · **Date:** 2026-08-17
> **Reported by:** an agent working in `~/Projects/Data/data-dashboard` (not a gwrk maintainer)
> **Verified in:** `gwrk` @ `develop` (18efd1a, v1.4.0-alpha.1) and `data-dashboard` @ `origin/feat/{008,010}`
> **Severity:** High — burns the entire iteration budget on defects the loop already found
> **Blast radius:** every project that runs `gwrk ship`, both `review-code-cli` and `review-code-webapp`

---

## 0. Executive summary

`gwrk ship` computes a review verdict from two signals only: **gate results** and **tasks the review
agent flipped `completed → open`**. The code-review prompt instructs the agent to force *every* task in
the phase to `completed` whenever gates pass — destroying the only channel the orchestrator reads. The
agent writes an excellent, specific finding into the task `description`, leaves the status `completed`,
commits `review: code review Phase N - NO-GO`, and exits 0. The orchestrator sees no re-open, all gates
green, and prints **GO**.

The UAT prompt has no such step. That single prompt asymmetry — not the stage wiring — is the bug.

**The reporter's evidence is sound and their instinct was right; their mechanism was not.** Their
top-ranked fix ("run the re-open detection after CODE_REVIEW too") is already implemented. §2 corrects
the record so the remedy targets the real cause.

Cost observed: two consecutive ships tripped the circuit breaker after 3/3 iterations —
`008-dashboard-surfaces` P5 (run #2728, 84m) and `010-reporting-email` P6 (run #2727, 121m). Roughly
half of each run was UAT re-deriving a defect code review had already found, written down, and committed.

---

## 1. Evidence

### 1.1 The verdict divergence (as reported)

`review-code-webapp: <verdict>` printed **GO in all six code reviews**. The agent's own commit subject
disagreed in four:

| run | iter | committed subject | structured `"verdict"` returned | console printed |
|---|---|---|---|---|
| #2728 (008 P5) | 1 | `code review Phase 5 - NO-GO` (`7166e5a`) | *none* | **GO** |
| #2728 | 2 | `code review Phase 5 - NO-GO` (`5f7abab`) | **`"NO-GO"`** | **GO** |
| #2728 | 3 | `code review Phase 5 - GO` (`00fda93`) | *none* | GO |
| #2727 (010 P6) | 1 | `code review Phase 6 - NO-GO` (`2cffb8d`) | *none* | **GO** |
| #2727 | 2 | `code review Phase 6 - GO` (`48c3ea6`) | *none* | GO |
| #2727 | 3 | `code review Phase 6 - NO-GO` (`862b8f4`) | *none* | **GO** |

Reproduce:

```bash
cd ~/Projects/Data/data-dashboard
git log --format='%h %s' origin/feat/008-dashboard-surfaces | grep 'code review Phase 5'
perl -CSD -pe 's/\e\[[0-9;]*m//g' .runs/<run>.log | grep -oiE '"verdict"[^,}]{0,40}'
```

> Grepping `"verdict"` alone gives false positives — the log embeds the review *prompt*, which documents
> a `verdict` field. Match `"verdict"` **followed by a value**.

### 1.2 The decisive evidence (added during verification)

What each review commit actually changed in `tasks.json`:

```
7166e5a  NO-GO  → description only (+REVIEW FAIL note), status untouched
5f7abab  NO-GO  → description only,                    status untouched
2cffb8d  NO-GO  → description only,                    status untouched
862b8f4  NO-GO  → description only,                    status untouched
00fda93  GO     → "status": "open" → "completed"
48c3ea6  GO     → "status": "open" → "completed"
```

```bash
cd ~/Projects/Data/data-dashboard
for c in 7166e5a 5f7abab 862b8f4 2cffb8d 00fda93 48c3ea6; do
  echo "=== $c $(git log -1 --format='%s' $c)"
  git show --format='' $c | grep -E '^[+-].*"status"'
done
```

**The code-review agent's `tasks.json` writes only ever move *toward* GO.** It never once set a task
`open`. Both affected phases have exactly one gated task (`T005`, `T006`); both are `open` today —
re-opened by UAT, never by code review.

---

## 2. Verified diagnosis

### 2.1 How the verdict is actually computed

[`ship-orchestrator.ts:418`](../src/engine/ship-orchestrator.ts#L418) `executeReviewWorkflow` is a
**single shared function**. CODE_REVIEW and UAT_REVIEW both dispatch through it, both call
[`detectReviewReopens`](../src/engine/ship-orchestrator.ts#L1409) and
[`readVerdict`](../src/engine/ship-orchestrator.ts#L1439). The wiring is byte-identical:

```
exit ≠ 0                        → stage fails
exit 0 → validatePhaseScope() → revertSourceMutations() → detectReviewReopens() → readVerdict()
                                                              ↑                      ↑
                                            tasks flipped completed→open      gate pass/fail
```

Nothing reads the agent's returned JSON. `ReviewResult.verdict` at
[`review-plugin.ts:45`](../src/plugins/review-plugin.ts#L45) is declared and consumed **nowhere** in the
codebase. `revertSourceMutations()` discards every file the agent wrote *except* `tasks.json`, so
`tasks.json` is the agent's only surviving channel.

### 2.2 Root cause — two instructions, both code-review-only

> **Correction (2026-08-17, during W1).** The first pass of this document named only the prompt (D1).
> Implementing the fix surfaced a second instruction, in the orchestrator itself, that is **dominant**:
> it is appended *after* `PROMPT.md`, so it is the last and most specific thing the agent reads. D1
> alone would have been overruled by it. Both are fixed together in W1.

#### D10 — the scope context tells the agent not to change status *(dominant)*

[`stageCodeReview`](../src/engine/ship-orchestrator.ts#L1343) built the scope block appended after the
prompt, and it ended with:

```ts
"Do NOT re-open tasks from earlier phases that are already completed.",
"If a completed task's implementation has issues, note them in your summary but do NOT change its status.",
```

The intent was the infinite-loop guard described at
[:1320-1323](../src/engine/ship-orchestrator.ts#L1320-L1323) — stop the agent re-opening *earlier*
phases. But the second sentence carries **no phase qualifier**, and by the time CODE_REVIEW runs every
task in the current phase is `completed` (IMPLEMENT completed them). So it reads as *never re-open
anything, just write a note* — which is precisely, literally what the agent did, four times.

[`stageUatReview`](../src/engine/ship-orchestrator.ts#L1381) has **no equivalent sentence**. That is
the other half of the asymmetry, and it is why UAT looped correctly every single time.

#### D1 — the prompt force-completes every task when gates pass

[`review-code-webapp/PROMPT.md:76-81`](../src/plugins/builtins/reviews/review-code-webapp/PROMPT.md#L76-L81)
— when all gates pass, run a `jq` that force-sets **every** task in the phase to `completed`:

```bash
jq --arg pid "$PHASE_ID" '(.phases[] | select(.id == $pid) | .tasks[].status) = "completed"' ...
```

Reinforced in four more places:

| Location | Text | Effect |
|---|---|---|
| [:60-62](../src/plugins/builtins/reviews/review-code-webapp/PROMPT.md#L60-L62) | "Gates are truth, tasks.json status is bookkeeping. If all gates pass, the task is done regardless of what `tasks.json` says." | Agent believes a green gate overrules its own finding |
| [:109](../src/plugins/builtins/reviews/review-code-webapp/PROMPT.md#L109) | "If gates passed in Step 2, tasks are already completed. Skip to Step 6." | Routes *past* Step 8, the only step that re-opens |
| [:120-147](../src/plugins/builtins/reviews/review-code-webapp/PROMPT.md#L120-L147) | Steps 6-7 record findings | …with no path back to Step 8 |
| [:238](../src/plugins/builtins/reviews/review-code-webapp/PROMPT.md#L238) | "❌ Using tasks.json status as primary verdict when gates exist" | Named as an anti-pattern |

[`review-uat-webapp/PROMPT.md`](../src/plugins/builtins/reviews/review-uat-webapp/PROMPT.md) has **no
equivalent step**. Its only task-state instruction is "re-open failed tasks." That is the entire
difference, and it explains the observation "whatever wiring UAT has is the wiring CODE_REVIEW needs" —
the wiring is the same; the *prompt* differs.

Both `review-code-cli` and `review-code-webapp` carry the defect:

```bash
cd ~/Projects/MyTools/gwrk/src/plugins/builtins/reviews
for d in */; do echo "=== $d"; grep -n 'tasks\[\].status) = "completed"' "$d/PROMPT.md"; done
# review-code-cli/PROMPT.md:79
# review-code-webapp/PROMPT.md:79
```

### 2.3 Prior art — this is the third recurrence

[`ship-orchestrator.review-gate-divergence.test.ts:5-23`](../src/engine/ship-orchestrator.review-gate-divergence.test.ts#L5-L23)
documents an identical console-says-GO symptom on `005-dashboard-api` Phase 1. That fix stopped
`readVerdict()` from **erasing** a re-open. It works. This is the *upstream* half: the agent never
creates one. Feature 026 made "gates are truth" literally true; 027 gave gates liveness; this is
review-finding liveness — the same lineage.

### 2.4 Corrections to the handoff's proposed fixes

| Reported | Verdict |
|---|---|
| "Run the existing re-open detection after CODE_REVIEW, not only after UAT_REVIEW" | **Already implemented.** Same function, both stages. |
| "The orchestrator appears to treat exit 0 as GO" | Not quite: exit 0 hands the verdict to gates + re-opens. UAT is not wired differently. |
| "A structured NO-GO is ignored when it IS returned" | True, but not a second defect — *nothing* reads the JSON, for any review stage. |
| "Treat a `review:` commit subject ending `NO-GO` as NO-GO" | Workable, but weaker than description-diffing (see D3). The commit is skippable and the subject is agent-authored prose. |
| "Make the returned verdict authoritative; fail loudly when absent" | Conflicts with [ADR-007 §78](decisions/ADR-007-single-dispatch-path.md) by design, and adds a new way for a run to hard-fail on agent formatting. Take the one-way ratchet instead (D4). |
| DIAGNOSE contributes nothing on this path | **Correct**, verified. One-line fix (D5). |
| `BRANCH_SETUP` / squash-merge divergence | **Correct**, and the refusal is right. See W6. |

---

## 3. Defect register

| ID | Defect | Location | Sev |
|---|---|---|---|
| **D10** | `stageCodeReview`'s scope context — appended *after* the prompt, so read last — told the agent "if a completed task's implementation has issues, note them in your summary but do NOT change its status", unqualified by phase. Every current-phase task is `completed` by then, so it disabled the verdict channel outright. UAT has no equivalent line. | [`ship-orchestrator.ts:1343-1355`](../src/engine/ship-orchestrator.ts#L1343) | **High** |
| **D1** | Code-review prompt force-completes all tasks when gates pass, destroying the re-open channel | `review-code-{cli,webapp}/PROMPT.md:76-81`, `:60-62`, `:109`, `:238` | **High** |
| **D9** | Prompt Step 8's re-open `jq` selected `.phases[] \| select(.id == $n)` with `$n` = bare phase *number*, but phase ids are zero-padded strings (`phase-05`). Followed literally the selector matches nothing, `jq` rewrites the file unchanged, and the re-open silently vanishes. Step 2 used the correct `$PHASE_ID` — the two steps disagreed. | `review-code-{cli,webapp}/PROMPT.md:174-176`, `:208` | **High** (latent) |
| **D2** | `readVerdict` skips re-opens on tasks with no `gateScript` — `if (!task.gateScript) continue` runs *before* `reopenedByReview` is consulted, so a re-open on a gateless task is silently dropped → vacuous GO | [`ship-orchestrator.ts:1463`](../src/engine/ship-orchestrator.ts#L1463) | **High** (latent) |
| **D3** | Findings are stored only in `task.description`, which every later agent rewrites. The two 010 P6 code-review findings (held-draft un-sendable; 8BITMIME un-negotiated) were committed in `2cffb8d`/`862b8f4` and are **gone from `tasks.json` at HEAD** — erased by `5b29881 implement Phase 6` and `48c3ea6 review: code review Phase 6 - GO`. No append-only findings ledger exists. | `tasks.json` schema / all review + implement prompts | **High** |
| **D4** | `ReviewResult.verdict` is declared and never consumed; the prompts' "JSON Intent Format" section promises a contract nothing reads. This is what sent the reporter looking in the wrong place. | [`review-plugin.ts:45`](../src/plugins/review-plugin.ts#L45), `PROMPT.md:243-249` | Med |
| **D5** | DIAGNOSE's context regex matches only `BUILD_CHECK FAILED\|TEST_GATE REGRESSION\|POST-FLIGHT GATE FAIL`, so it always prints "no error context" on the review-divergence path | [`ship-orchestrator.ts:2096-2103`](../src/engine/ship-orchestrator.ts#L2096-L2103) | Med |
| **D6** | Stale doc comment promises "If any tasks in the phase are `open` … → NO-GO". The code does not do that. | [`ship-orchestrator.ts:1396-1399`](../src/engine/ship-orchestrator.ts#L1396-L1399) | Low |
| **D7** | `review-code-webapp` and `review-uat-webapp` are verbatim copies of the CLI prompts — titled "for CLI Projects", asserting "gwrk is a CLI tool. No Docker, no web server", running `pnpm build`/`biome`/`pnpm vitest`. `conditionPrompt` prepends real profile XML but does not rewrite the body, so a Next.js/Docker project gets a self-contradicting prompt. | `review-{code,uat}-webapp/PROMPT.md:1`, `:36-45` | Med (quality, not verdict) |
| **D8** | *Not a bug.* `ensurePushable` correctly refuses a diverged branch. But gwrk reuses **one branch per feature across all phases**, so a squash-merged phase PR permanently diverges it. | [`ship-orchestrator.ts:550`](../src/engine/ship-orchestrator.ts#L550) | Doc |

---

## 4. Remedy plan

### 4.0 Design rule the whole remedy encodes

> **Gate authority is one-way.** A green gate may close a task the reviewer raised **no** finding on.
> It may never close a task the reviewer reproduced a defect on. Green gate + review finding is not a
> contradiction to resolve in the gate's favour — it is the gate's coverage hole, and it is the only
> moment the system can know that.

This narrows, but does not overturn, "gates are truth." The orchestrator already implements it
([`readVerdict:1474-1485`](../src/engine/ship-orchestrator.ts#L1474-L1485)). ADR-007 and the prompts
still assert the broad version. Closing that gap *is* the remedy.

### 4.1 Workstreams

| WS | Scope | Kind | Blocks | Effort |
|---|---|---|---|---|
| **W1** ✅ | Fix the code-review prompts + the scope context (D1, D9, D10) — **done**, see §5a | **Definitional** | everything | S |
| **W2** ✅ | Code backstops: D2, D5, D6 + unit tests — **done**, see §5b | **Manual fix** | — | S |
| **W3** | Durable findings channel (D3) + one-way JSON ratchet (D4) | **Manual fix** | W1 | M |
| **W4** | ADR-007 §78 correction block | **Definitional cascade** | W1 | XS |
| **W5** | Spec record `028-review-finding-liveness` + build-plan graph | **Definitional cascade** | W1-W3 | S |
| **W6** | Branch + `dist` hygiene | **Process** | — | XS |
| **W7** | `data-dashboard` unblock and reconciliation | **Manual fix, downstream** | W1 (or override) | S |
| **W8** | De-CLI-ify the webapp prompts (D7) | **Definitional** | — | M |

**Recommended split:** W1+W2+W4 in one `fix/` PR (they are one semantic change, and W1 alone is the
80% win). W3 and W5 follow. W7 can start **immediately** via a project-local override — it does not
wait on a gwrk release.

### 4.2 Why the gwrk fix is a manual fix, not a `gwrk ship` run

Three reasons, and they are decisive:

1. **Circularity.** The defect is *in the machinery `gwrk ship` uses to verify work.* Shipping the fix
   through the broken review loop would let a phase pass by exactly the mechanism under repair.
2. **Precedent.** This class of defect lands as a plain `fix(ship): …` PR in this repo — see #171-#175.
   No spec was created for any of them.
3. **`gwrk ship` is human-only** (never agent-invoked; it spawns agents, burns tokens, opens PRs).

W5 still creates the **definitional record** — because this is the third recurrence of one failure mode
and it amends a doctrine in ADR-007. Spec-and-plan, then implement by hand. Use `gwrk define tasks` so
the gate scripts exist and `gwrk gate` can verify the fix mechanically.

---

## 5. Execution — `gwrk` repo

### W6 first: branch and `dist` hygiene

Two facts that shape everything below:

1. **`gwrk` on this machine runs straight from this working tree.** `~/.local/bin/gwrk` is a 3-line
   launcher: `exec node ~/Projects/MyTools/gwrk/dist/cli.js`. And `postbuild` copies
   `src/plugins/builtins/*` → `dist/plugins/builtins/`. So **`npm run build` here makes the prompt fix
   live in `data-dashboard` instantly** — no publish, no install.
2. **`dist/` is therefore shared mutable state across every project on this machine.** A build on a
   feature branch changes gwrk's behaviour for `data-dashboard`, `data-org`, everything — until you
   rebuild on `develop`. Do not leave a feature-branch build in `dist/` while other projects are
   shipping.

```bash
cd ~/Projects/MyTools/gwrk
git checkout develop && git pull --ff-only origin develop
git checkout -b fix/review-finding-liveness      # fix/* — matches repo convention
```

Standing constraints for this repo:

- **PRs always target `develop`, never `main`.** Flow: feature → develop → main → release-please.
- Commit author **David Gonzalez `<dgonzalez@wisecode.ai>`**; `Co-Authored-By: Claude …`.
- Verify with `npm run build && npm run test:ci` (`test:ci` sets `GWRK_SKIP_INTEGRATION=1`).
  **Never** verify by running the real `gwrk ship` or the daemon.
- The later `develop → main` promotion must be **code-only** — exclude
  `package.json`, `.release-please-manifest.json`, `CHANGELOG.md`, or you revert main's release bump.
  Back-merge `main → develop` afterward.

### W1 — Fix the code-review prompts *(the 80% win)*

Edit **both** `src/plugins/builtins/reviews/review-code-cli/PROMPT.md` and
`review-code-webapp/PROMPT.md` (they are currently identical in the relevant region):

1. **Delete the blanket auto-complete** at `:76-81`. Replace with:
   *"All gates pass **and you recorded no blocking finding on the task** → complete it. Gates never
   close a task you raised a finding on."*
2. **Rewrite the `:60-62` callout** to the one-way rule in §4.0.
3. **Remove the `:109` skip** so Steps 6-7 findings flow into Step 8. Step 8 becomes unconditional.
4. **Add an explicit contract line** near the top of `<scope_constraints>`:
   *"If you record a blocking finding on a task you MUST set `status: "open"` on that task. The note
   alone is invisible to the orchestrator — a description without a status flip reads as GO."*
5. **Replace the `:238` anti-pattern** with its inverse:
   *"❌ Leaving a task `completed` after recording a blocking finding on it."*
6. **Fix `<verdict_criteria>`** to state that the console verdict is derived from gates + re-opens, and
   the returned JSON is advisory (see W3 for the ratchet).

Verify the prompt actually changed behaviour before trusting it:

```bash
npm run build                                    # postbuild copies prompts into dist/
diff src/plugins/builtins/reviews/review-code-webapp/PROMPT.md \
     dist/plugins/builtins/reviews/review-code-webapp/PROMPT.md && echo "prompt is live"
```

### §5a — W1 as landed (2026-08-17, `a57a68f` on `fix/review-finding-liveness`, [PR #176](https://github.com/gforge-esc/gwrk/pull/176))

`src/engine/ship-orchestrator.ts` — `stageCodeReview` scope context (**D10**):

- The unqualified "do NOT change its status" sentence is gone. The other-phase guard it was protecting
  is preserved and made explicit ("Do NOT touch tasks belonging to any OTHER phase").
- Added a `VERDICT CHANNEL:` block naming the mechanism outright: the status flip *is* the NO-GO; prose,
  commit subject and JSON `verdict` are not read; a green gate over a reproduced defect is a coverage
  hole and re-opening is how you report it. A code comment records why, so it is not "simplified" back.

`review-code-cli/PROMPT.md` + `review-code-webapp/PROMPT.md` (kept byte-identical, as they were before):

| Change | Defect |
|---|---|
| `<scope_constraints>` opens with the MUST-flip-status contract and why a note alone is invisible | D1 |
| Step 2 callout rewritten from "Gates are truth, tasks.json is bookkeeping" to **one-way gate authority** (§4.0) | D1 |
| Step 2's phase-wide `.tasks[].status = "completed"` **deleted**; gates now record a baseline and write nothing | D1 |
| Step 5 is read-only; the "gates passed → skip to Step 6" bypass removed, so findings reach Step 8 | D1 |
| Step 5 calls out that a task with **no `gateScript`** has review as its only verdict | D2 |
| Step 8 is the single write point, with a 5-row decision table where findings beat gates | D1 |
| Step 8 selectors switched to `$PHASE_ID`, with a CAUTION about the silent no-op | **D9** |
| Step 8 completes tasks **one id at a time**, never phase-wide | D1 |
| Step 8 ends with a read-back verification (`jq … .id + " " + .status`) so a lost write is caught pre-commit | D9 |
| Description writes marked **APPEND ONLY**, never overwrite | D3 |
| `<verdict_criteria>` now states how the verdict is really derived | D4 |
| "JSON Intent Format" carries a warning that it is a log summary, not the verdict channel, and that `intents` are reverted | D4 |
| Anti-patterns: the "gates are truth" entry replaced by its inverse, plus entries for early status writes, bare-number selectors, and description overwrites | D1, D9, D3 |
| Duplicate `### 1.` heading merged (two different steps both numbered 1) | coherence |
| Step 2 retitled "PRIMARY VERDICT" → "MECHANICAL BASELINE" | coherence |

Verification:

```
npm run build                                     # ok; postbuild copies prompts → dist (confirmed live)
npx vitest run …review-gate-divergence …review.test …ship-orchestrator.test   # 37 passed
npm run test:ci                                   # 1261 passed, 3 failed
```

The 3 failures are **pre-existing and unrelated** — `src/commands/server.test.ts` (daemon spawn
assertions). Confirmed by re-running that file with these changes stashed on clean `develop`: same 3
failures. Not introduced here, and not in scope for this branch.

W1 changes behaviour but adds no test of its own — the prompt and scope context are agent-facing text.
W2's unit tests are what pin the orchestrator side, and W5's spec is what makes the rule testable.

### W2 — Code backstops

- **D2** — in `readVerdict`, honour a re-open even with no `gateScript`. Restructure the loop so
  `reopenedByReview` is checked for every task, and only the *gate execution* is skipped when
  `gateScript` is absent. A re-open on a gateless task must produce NO-GO, not silence.
- **D5** — add `REVIEW/GATE DIVERGENCE` and `REVIEW FAIL` to the DIAGNOSE regex at `:2097`.
- **D6** — correct the stale doc comment at `:1396-1399` to describe what the code does.

Each needs a unit test alongside the existing
[`ship-orchestrator.review-gate-divergence.test.ts`](../src/engine/ship-orchestrator.review-gate-divergence.test.ts)
— that file is the model to follow (it mocks `gate-exec`, `state`, `loader`, `agent`).

```bash
npm run build && npm run test:ci
npx vitest run src/engine/ship-orchestrator.review-gate-divergence.test.ts \
               src/engine/ship-orchestrator.review.test.ts
```

### §5b — W2 as landed (2026-08-17, `e588d1f`)

`src/engine/ship-orchestrator.ts`:

| Change | Defect |
|---|---|
| `readVerdict`'s loop no longer `continue`s past an ungated task before consulting `reopenedByReview`. A re-open on a task with no `gateScript` now returns **NO-GO** and appends a `REVIEW FINDING (…, no gate)` note. | **D2** |
| New `ungatedFindings` branch prints which tasks were re-opened with no gate to check them, and why that is NO-GO. | D2 |
| DIAGNOSE's context regex now also matches `REVIEW/GATE DIVERGENCE`, `REVIEW FINDING`, `REVIEW FAIL`. | **D5** |
| When the context is review-driven, the diagnosis prompt says the build is green, and asks for a gate or test alongside each fix — "a finding that survives its own fix is a finding that will recur". Persona widened from "TypeScript build diagnostician" to "build and code-review diagnostician". | D5 |
| `readVerdict`'s doc comment now states the real rule instead of "any open task → NO-GO", which the code never did and must not (a task can be open because nobody implemented it yet). | **D6** |

New `src/engine/ship-orchestrator.review-finding-liveness.test.ts` — 11 tests:

- **D2**: ungated re-open → NO-GO; task stays open; note recorded; **untouched ungated task still GO**
  (no false positive); no gate is run for a task that has none.
- **D5**: both note formats reach the diagnostician; an open task with no finding still skips.
- **D10 regression guard**: the code-review scope context still carries `VERDICT CHANNEL`, no longer
  carries "note them in your summary but do NOT change its status", and still forbids touching other
  phases — i.e. the earlier-phase infinite-loop guard survived the fix.

The D10 tests passed on first run, which is the check that W1 actually landed in the dispatched prompt
rather than only in the file. D2 and D5 failed first, then passed.

Verification: `npm run test:ci` → **1272 passed, 3 failed** (up from 1261; +11 new). The 3 are the same
pre-existing `src/commands/server.test.ts` daemon-spawn failures confirmed against clean `develop`.

### W3 — Durable findings + one-way JSON ratchet

**D3 (findings durability).** Two layers, cheapest first:

1. **Detection now.** Extend `detectReviewReopens` to also diff task *descriptions* pre/post dispatch
   and treat a newly appended `REVIEW FAIL (` block as a finding — NO-GO regardless of status. This is
   the reporter's "durable artifact" idea, one layer earlier than the commit subject, and it alone
   would have caught all four missed NO-GOs.
2. **Storage next.** Add an append-only `findings[]` array to the phase in `tasks.json` (or a sibling
   `.gwrk/findings.jsonl`) that implement/review agents may append to but never rewrite. `description`
   stays the human-readable mirror. Without this, D3 recurs: `48c3ea6` and `5b29881` each silently
   deleted a real finding.

**D4 (JSON ratchet).** `TaskResult.stdout` *is* captured
([`agent.ts:154`](../src/utils/agent.ts#L154)), so the returned verdict is readable. Make it a
**one-way ratchet only**: a returned `NO-GO` forces NO-GO; a returned `GO` is ignored. Never let a
returned GO override gate or re-open evidence. If you would rather not build it, **delete the "JSON
Intent Format" section from the review prompts** — an unconsumed contract is worse than no contract.

### W4 — ADR-007 correction block *(definitional cascade)*

[ADR-007 §78](decisions/ADR-007-single-dispatch-path.md) is the source of the doctrine the prompts
encode: *"The agent's verdict is advisory. Gates are truth."* It needs the same treatment the file
already gives feature 026 — an inline correction block, matching the existing house style:

```markdown
> **028 correction.** "Gates are truth" is one-way. A gate may close a task the reviewer raised no
> finding on; it may never close a task the reviewer reproduced a defect on — that combination is a
> gate coverage hole (`readVerdict` treats it as NO-GO). The review prompts asserted the broad version
> and instructed agents to force `status: completed` whenever gates passed, which silently discarded
> four blocking code-review findings across runs #2727/#2728. See D1 in
> `docs/code-review-verdict-defect.md`.
```

### W5 — Definitional record `028-review-finding-liveness`

Next free number is **028** (`specs/` currently ends at `027-gate-liveness`). The name continues the
lineage: 026 gate-runner convergence → 027 gate liveness → 028 review-finding liveness.

```bash
cd ~/Projects/MyTools/gwrk

# 1. Spec — slug, not "028-…": for a NEW feature gwrk assigns the number itself
#    (a numeric first arg means "rework existing spec 028"). Pass the diagnosis
#    in as grounding so the agent doesn't re-derive it.
gwrk define spec "review-finding-liveness" \
  "A review agent's blocking finding must survive to the orchestrator's verdict. \
Gate authority is one-way: a green gate closes only tasks with no finding against them." \
  --refs docs/code-review-verdict-defect.md
/bin/ls specs/ | tail -3       # confirm it landed as 028-review-finding-liveness

# 2. Plan → tasks → RED tests → gates
gwrk define plan  028
gwrk define tasks 028
gwrk define tests 028

# 3. Register in the build-plan graph, then re-render 000-build-plan.md
gwrk plan add feature 028 "Review Finding Liveness"
gwrk plan dep add 028 --needs 027
gwrk plan render
gwrk plan verify          # confirm no drift between graph and specs/

# 4. Mechanical verification of the hand-written implementation
gwrk tasks list   028
gwrk gate         028 -p 01 -v
gwrk tasks verify 028
```

> **Do not run `gwrk ship 028 1`.** Human-only, and circular here (§4.2).

Sanity-check the definitional artifacts before implementing — per the standing gate convention, the
phase gate lives in `task.gateScript`, **not** `phase.doneWhen`, and it is empty for fenced Done-When
blocks. If `gwrk gate 028 -p 01` reports nothing to run, the tasks have no gates and D2 is about to
bite this very feature:

```bash
jq -r '.phases[]|select(.id=="phase-01")|.tasks[]
       | .id+" gate="+(if (.gateScript//"")=="" then "NONE ⚠" else "ok" end)' \
  specs/028-review-finding-liveness/.gwrk/tasks.json
```

### PR

```bash
npm run build && npm run test:ci
git add -A && git commit          # author: David Gonzalez <dgonzalez@wisecode.ai>
gh pr create --base develop --title "fix(ship): a blocking code-review finding now reaches the verdict"
```

Suggested PR body skeleton: the §1.2 status-diff table (the proof), the §4.0 rule (the fix), and an
explicit note that W1 is a prompt change that goes live via `postbuild` — so reviewers know `dist/`
behaviour changes on merge+build, not on release.

---

## 6. Execution — `data-dashboard` (downstream)

### W7a — Unblock today, without waiting on gwrk

Project-local plugins **win over builtins**
([`loader.ts:223-238`](../src/plugins/loader.ts#L223-L238) is scanned before
[`:274`](../src/plugins/loader.ts#L274) builtins). So the corrected prompt can be dropped in per-project:

```bash
cd ~/Projects/Data/data-dashboard
mkdir -p .gwrk/plugins/reviews/review-code-webapp
cp ~/Projects/MyTools/gwrk/src/plugins/builtins/reviews/review-code-webapp/{PROMPT.md,manifest.yaml} \
   .gwrk/plugins/reviews/review-code-webapp/
# apply the W1 edits to .gwrk/plugins/reviews/review-code-webapp/PROMPT.md
gwrk plugin list --project --type review     # confirm it resolves to .gwrk/plugins/, not builtins
```

Use this if you want to unblock before the gwrk PR merges, or to A/B the prompt on one project first.
Once W1 ships, **delete the override** — a stale local copy silently pins an old prompt.

### W7b — Recover the erased findings *(do this before re-shipping)*

The two 010 P6 code-review findings are **not in `tasks.json` at HEAD** (D3). They exist only in git:

```bash
cd ~/Projects/Data/data-dashboard
git show 2cffb8d -- specs/010-reporting-email/.gwrk/tasks.json | grep -A20 'REVIEW FAIL (code)'
git show 862b8f4 -- specs/010-reporting-email/.gwrk/tasks.json | grep -A20 'REVIEW FAIL (code)'
```

Both are real and specific:

- *a held draft becomes permanently un-sendable once upstream numbers move* — FR-014
- *an 8-bit body is put on the wire without negotiating 8BITMIME* — FR-011/FR-014

Re-append them to `T006`'s description (it is already `status: open`, so it re-enters the ready queue
with the notes attached). Without this the next run re-derives them for a third time.

`008-dashboard-surfaces` P5 `T005` needs no surgery — verified `open` with 2× `REVIEW FAIL (code)`,
5× `REVIEW FAIL (uat)` and 2× `REVIEW/GATE DIVERGENCE` notes intact:

```bash
jq -r '.phases[]|select(.id=="phase-05")|.tasks[]|select(.id=="T005")|.status' \
  specs/008-dashboard-surfaces/.gwrk/tasks.json     # → open
```

### W7c — Branch hygiene for the two stranded features (D8)

Live state (measured 2026-08-17):

| branch | ahead of `origin/develop` | behind |
|---|---|---|
| `feat/008-dashboard-surfaces` | 13 | 3 |
| `feat/010-reporting-email` | 7 | 17 |

Neither is currently diverged from its own remote, so `ensurePushable` will pass — but 010 is 17 behind
`develop`, which is where a squash-merged phase PR shows up as permanent divergence.

Decision rule before each re-ship:

```bash
cd ~/Projects/Data/data-dashboard
git fetch origin
B=feat/010-reporting-email
git rev-list --count origin/develop..origin/$B   # unmerged work on the branch
git rev-list --count origin/$B..origin/develop   # how far behind
```

- **Unmerged work > 0** → `git merge origin/develop` into the feature branch. **Merge commit, not
  rebase or squash** — gwrk reuses one branch per feature across all phases, and a squash breaks
  fast-forwardability for every later phase.
- **Unmerged work = 0** (prior phases all squash-merged, nothing local) → the branch is a stale label:
  `git branch -f $B origin/develop && git push --force-with-lease origin $B`.
- **Project policy:** use **merge commits for phase PRs** on features that will ship more phases.
  Reserve squash for the final phase PR. gwrk's branch model requires it.

### W7d — Re-ship (human-invoked only)

```bash
cd ~/Projects/Data/data-dashboard
gwrk gate 010 -p 06 -v          # confirm the gate still passes over the live defect (it should — that's D1)
gwrk tasks ready 010
gwrk ship 010 6                 # human runs this, after W1 or W7a is in place
gwrk db runs 010                # confirm the verdict now reads NO-GO on a finding
```

The success criterion is narrow and checkable: **a code review that commits `- NO-GO` must print
`review-code-webapp: NO-GO`**, and the loop must return to IMPLEMENT rather than advancing to UAT.

---

## 7. Follow-ups (do not block on these)

- **W8 / D7** — de-CLI-ify `review-code-webapp` and `review-uat-webapp`. Both are verbatim CLI copies
  ("gwrk is a CLI tool. No Docker, no web server", `pnpm build`, `biome`, `pnpm vitest`). Prefer
  `[type: …]` conditional guards — `conditionPrompt` already resolves them
  ([`prompt-conditioner.ts:58-70`](../src/engine/prompt-conditioner.ts#L58-L70)) — over a third copy
  of the file.
- **Document the branch model** (D8): gwrk reuses one branch per feature across all phases and
  therefore needs merge commits, not squashes, until the final phase. Optionally teach `BRANCH_SETUP`
  to offer `git branch -f <branch> origin/develop` when the branch has no unmerged work.
- **Audit for the same shape elsewhere**: any stage whose verdict depends on an agent voluntarily
  writing state that a later prompt instructs it to overwrite.

## 8. What not to do

- Don't make the returned JSON verdict authoritative in both directions — a returned `GO` must never
  override gate or re-open evidence (§2.4, D4).
- Don't verify any of this with a real `gwrk ship` run or the daemon.
- Don't leave a feature-branch `dist/` build in place while other projects are shipping (§W6).
- Don't rebase or squash a feature branch that has phases still to ship (§W7c).
- Don't leave the `data-dashboard` plugin override in place after W1 merges.
