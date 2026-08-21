# UAT Review — 029-decision-records Phase 01

**Persona**: Product Manager · **Pillar**: Delivery (Value Verification)
**Date**: 2026-08-21 · **Verdict**: ✅ **GO**
**Tasks re-opened**: none

## Scope

Phase 1 "Parser and corpus reconciliation". Requirements in scope per `plan.md` Phase 1:
**FR-004, FR-005, FR-006 · US-002, US-010 · TC-007, TC-014 · TR-002, TR-014**.

US-010 is only partly in scope: scenarios 1–3 and 5 and the `node dist/index.js define adr --check`
assertion belong to FR-024 (Phase 10). Only scenario 4's two corpus greps are Phase 1's to satisfy.
Stories from other phases were not evaluated.

## Prior NO-GO — remediation verified

The previous UAT (commit `1ab31f8`) was NO-GO: `gates/T002..T005-gate.sh` ran
`pnpm vitest run <file>.md`, which matches nothing under vitest's include glob and exits 1, so four
tasks carried `completed` against a red gate (AX-002 violation).

**Re-verified independently: remediated.** All four gate files now assert the TR-014 corpus
properties as shell assertions, and each adds the positive half of its negative grep so a *deleted*
`Status:` line cannot read as a pass. Confirmed end-to-end through the shipped
`dist/utils/gate-exec.js` — the same authoritative `runTaskGate` path `readVerdict()` uses:

```
T001  status=completed  gate=PASS exit=0  strategy=inline      (inline gateScript)
T002  status=completed  gate=PASS exit=0  strategy=convention  gates/T002-gate.sh
T003  status=completed  gate=PASS exit=0  strategy=convention  gates/T003-gate.sh
T004  status=completed  gate=PASS exit=0  strategy=convention  gates/T004-gate.sh
T005  status=completed  gate=PASS exit=0  strategy=convention  gates/T005-gate.sh

ALL_PHASE_01_GATES_PASS=true
```

AX-002 holds: every `completed` task's gate exits 0.

## Build & Done When

| Check | Result |
|---|---|
| `pnpm build` | exit 0 |
| Phase 1 `Done When` block, run literally under `set -e` / bash | **exit 0** |
| `npx vitest run src/engine/adr-parser.test.ts` | exit 0 — **20 passed** |
| `pnpm test:ci` (full suite) | 4 pre-existing failures, see Regressions |

## US-002 — The nine existing records parse unchanged

Each acceptance scenario executed literally.

| Sc. | Assertion | Result |
|---|---|---|
| 1 | `-t "FR-004: recovers the number from the filename when the H1 omits it"` | exit 0 — 1 passed / 19 skipped |
| 2 | `-t "FR-004: tolerates trailing double-space hard breaks"` | exit 0 — 1 passed / 19 skipped |
| 3 | `-t "FR-004: returns empty relations rather than throwing"` | exit 0 — 1 passed / 19 skipped |
| 4 | `-t "FR-004: splits two fields separated by the middle dot"` | exit 0 — 1 passed / 19 skipped |
| 5 | `-t "FR-004: preserves a 240-character Decision value"` | exit 0 — 1 passed / 19 skipped |
| 6 | all nine H1s `# ADR-00N: `; no `file:///Users/gonzo`; exactly one `## 7.` in ADR-001 | exit 0 |
| 7 | no `Status: Proposed` in ADR-006 / ADR-007 | exit 0 |
| 8 | `-t "FR-004: uses fixtures, never the live corpus"` | exit 0 — 1 passed / 19 skipped |

Scenario 6 was run in **both** forms — the spec's prose `head -1 \| grep -qE` and the plan's
`awk 'NR==1{exit !/…/}'` rewrite. Both exit 0; the property holds independent of assertion form.

Corpus evidence:

```
ADR-001  # ADR-001: Task Tracking — Beads (bd + Dolt) vs. Roll Our Own
ADR-002  # ADR-002: Task Storage & Execution Ledger — Flat JSON → SQLite
ADR-003…ADR-009  all `# ADR-00N: <title>`
grep -rn 'file:///' docs/decisions/   -> (none)
grep -c '^## 7\.' ADR-001             -> 1     (## 6., ## 7., ## 8. — sequential)
ADR-006:3  > **Status:** Decided · **Date:** 2026-03-17
ADR-007:3  > **Status:** Decided · **Date:** 2026-05-22
grep -rn 'Superseded by' docs/decisions/ -> (none)
```

### Golden path — the value claim behind the story

TR-002 keeps the suite fixture-only, so **no automated test proves the nine live records parse**.
US-002's actual promise ("I read every one of the nine records on disk and return its status,
decision, dependencies and supersession relations plus its heading tree") was therefore verified by
hand against the built parser:

```
records parsed: 9
ADR-001 status=Decided headings=8  supersedes=0 dependsOn=0 decision="Option B (Roll Our Own — Flat JSON/JSONL…"
ADR-002 status=Decided headings=7  supersedes=1 dependsOn=0 decision="SQLite via `better-sqlite3`…"
ADR-003 status=Decided headings=8  supersedes=1 dependsOn=0
ADR-004 status=Decided headings=8  supersedes=0 dependsOn=2
ADR-005 status=Decided headings=12 supersedes=0 dependsOn=2
ADR-006 status=Decided headings=8  supersedes=0 dependsOn=3
ADR-007 status=Decided headings=6  supersedes=0 dependsOn=3
ADR-008 status=Decided headings=5  supersedes=0 dependsOn=3
ADR-009 status=Decided headings=5  supersedes=0 dependsOn=3

records missing status/decision/headings: 0
```

All nine parse. Every record returns a populated header and a non-empty heading tree.

**FR-005 on the live corpus:** `resolveSection(ADR-007, "2.1")` → `{address:"2.1", depth:3,
title:"Single Dispatch Path: All Workflows Through \`WorkflowRuntime\`", line:46, bodyEnd:91}`.
`resolveSection(ADR-007, "9.9")` → `null` — unresolvable, exactly as FR-005 requires.
ADR-001's addresses are `1,2,3,4,5,6,7,8` with **zero duplicates**, so the dedup edit achieves its
stated purpose: section addressing is now unambiguous.

**Negative paths** degrade gracefully rather than crashing:

```
parseCorpus(missing dir)      -> []   (empty list, no throw)
parseRecord(no blockquote)    -> throws "ADR-099-x.md: no blockquote header found after the H1"
resolveSection(bogus address) -> null
```

The throw names the offending file — a corrective message, not a stack trace.

## US-010 — in-scope portion (scenario 4)

| Assertion | Result |
|---|---|
| `grep -q '028 correction' docs/decisions/ADR-007-single-dispatch-path.md` | exit 0 |
| `grep -q 'Gate authority is one-way\|is one-way' …ADR-007…` | exit 0 |

The block is **verbatim** the canonical W4 markdown at `docs/code-review-verdict-defect.md:422-431`,
placed inside §2.1 immediately below the existing `026 correction` and directly before `### 2.2`.
§2.1's `bodyEnd` is line 91 and the block occupies 86–92 — i.e. the `amendAtSection` insertion point
from `contracts/adr-engine.md` §5. Landing this closes 028 FR-011 (W4).

## FR-006 — reconciled in place

`git diff` vs base `d4163f1`: **4 files, +14 −7**. Exactly migration edits 1–5, nothing else.

```
ADR-001  4 ++--    H1 → `# ADR-001:`; `## 7. Next Steps` → `## 8. Next Steps`
ADR-002  6 +++---   H1 → `# ADR-002:`; two dead file:/// links → ./relative
ADR-006  2 +-       Status: Proposed → Decided
ADR-007  9 ++++++-   Status → Decided; +7 lines of `028 correction`
```

No file rewritten, nothing deleted, nothing reordered. Both rewritten ADR-002 links
(`./ADR-001-task-tracking.md`, `./ADR-003-state-contract.md`) resolve to files that exist on disk.

## Phase contracts

| Rule | Result |
|---|---|
| TC-007 — blockquote metadata, not YAML | `adr-parser.ts` parses `> **Field:**` via `FIELD_LABEL`; no yaml import, no frontmatter path |
| TC-014 — bare-clone operable | Imports are `node:fs/promises` and `node:path` **only**. No sqlite, no db, no build server, no network |
| VR-004 — MPL header | Present, lines 1–3 |
| TR-002 — fixtures, never the live corpus | Enforced by a self-assertion that reads the suite's own source and asserts it contains neither `docs/decisions` nor `process.cwd()` |
| TR-014 — corpus invariants | All nine assertions exit 0 (above) |

## CLI surface / help output

Phase 1 ships **no CLI command** — `gwrk define adr` is Phase 2 (FR-007). Verified no regression and
no false promise:

- `node dist/cli.js --help` → exit 0, command list intact
- `node dist/cli.js define --help` → exit 0; subcommands are `spec, plan, tasks, tests, research,
  ontology`. `adr` is correctly **absent** — help does not advertise a command that does not exist yet.

## Regressions

`pnpm test:ci` → **4 failed | 1354 passed | 114 skipped** across 223 files.

All 4 failures are in `src/commands/server.test.ts` (3) and `src/server/routes/status.test.ts` (1).
Not Phase 1 defects:

1. Both files are **untouched** by this phase (`git diff --name-only` vs base lists neither, nor any
   `src/server/` or `src/commands/server.ts` file).
2. The cause is sandbox device-role live state, not logic: `expected '…server start: This machine is
   registered as a remote device. The daemon runs on the server only.' to contain 'Server already
   running'`.

This matches the known-issue profile for ship sandboxes. Phase 1's own suite is 20/20 green.

## Observations (non-blocking, no task re-opened)

1. **The spec's `-t` acceptance form is a weak gate.** A deliberately bogus filter
   (`-t "FR-004: this test does not exist"`) still **exits 0**, despite `passWithNoTests: false` in
   `vitest.config.ts` — vitest treats "file found, all tests filtered out" as a pass. So if a test
   were renamed, its scenario would silently stop being asserted. Not a Phase 1 defect: all six named
   tests were confirmed to exist and pass individually (`1 passed | 19 skipped` each). Worth
   tightening in the spec's acceptance-scenario form for later phases.
2. **No standing gate proves the live corpus parses.** TR-002 deliberately keeps the suite
   fixture-only so ADR-010 landing in Phase 9 cannot break it — a sound call. The residual risk is
   bounded because the corpus side is gated by the TR-014 greps. Verified by hand this run (9/9).

## Verdict

✅ **GO** — every in-scope acceptance criterion passes, the Phase 1 `Done When` block exits 0, all
five task gates pass through the authoritative `runTaskGate` path, and the prior UAT's blocking
finding is independently confirmed remediated. No tasks re-opened.
