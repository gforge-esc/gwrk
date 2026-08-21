## UAT Review — 029-decision-records, Phase 01 (Parser and corpus reconciliation)

**Persona**: Product Manager · **Pillar**: Delivery (Value Verification)
**Verdict**: 🔴 **NO-GO**
**Requirements in scope**: FR-004, FR-005, FR-006 · US-002, US-010 · TC-007, TC-014

### Summary

The **work is done and the user-visible value is real** — the parser reads all four documented corpus
inconsistencies, and the corpus is reconciled in place exactly as FR-006 specifies. Every acceptance
scenario in scope passes when executed literally.

Phase 01 is still **NO-GO** for one reason: `T002`–`T005` carry `status: completed` while their gates
exit 1. This is the *same* defect commit `1c20d6b` (code review, NO-GO) found. Those four tasks were
flipped back to `completed` 27 seconds after that commit landed, with **no change to the gate scripts**.
The finding was reverted, not remediated. That violates AX-002 — a task cannot be `completed` unless its
gate exits 0 — and it is the failure mode ADR-007's own `028 correction` block (added by this very phase)
was written to prevent.

### Build

| Step | Result |
|---|---|
| `pnpm build` | ✅ exit 0 |

### Done When — executed literally

The plan's Phase 1 `Done When` block, run assertion by assertion:

| # | Assertion | Result |
|---|---|---|
| 1 | `pnpm run build` | ✅ exit 0 |
| 2 | `npx vitest run src/engine/adr-parser.test.ts` | ✅ exit 0 — **20/20 passed** |
| 3 | H1 is `# ADR-00N: ` on all nine records | ✅ all 9 exit 0 |
| 4 | no `file:///Users/gonzo` in `docs/decisions/` | ✅ clean |
| 5 | exactly one `## 7.` in ADR-001 | ✅ count = 1 |
| 6 | no `Status: Proposed` in ADR-006 | ✅ clean |
| 7 | no `Status: Proposed` in ADR-007 | ✅ clean |
| 8 | `028 correction` present in ADR-007 | ✅ present |
| 9 | `is one-way` present in ADR-007 | ✅ present |
| 10 | no forward-recorded `Superseded by` in corpus | ✅ clean |

**"All tasks pass gates" — ❌ FAILS.** Verified end-to-end through the *shipped* `dist/utils/gate-exec.js`
`runTaskGate`, i.e. exactly the resolution path `ship` uses:

```
T001  status=completed  gate=PASS  exit=0  strategy=inline      (inline) pnpm run build …
T002  status=completed  gate=FAIL  exit=1  strategy=convention  gates/T002-gate.sh
T003  status=completed  gate=FAIL  exit=1  strategy=convention  gates/T003-gate.sh
T004  status=completed  gate=FAIL  exit=1  strategy=convention  gates/T004-gate.sh
T005  status=completed  gate=FAIL  exit=1  strategy=convention  gates/T005-gate.sh
```

Root cause, unchanged from the code review: `gates/T00N-gate.sh:9-10` runs
`pnpm vitest run docs/decisions/ADR-00N-*.md`. Vitest's include glob is
`**/*.{test,spec}.?(c|m)[jt]s?(x)`; a `.md` path matches nothing, so vitest prints
`No test files found, exiting with code 1`. `runTaskGate` prefers `gates/<id>-gate.sh`
(Strategy 1, `gate-exec.ts:63-74`) over `task.gateScript`, so the plan's fenced Done-When block — which
**does** exit 0, confirmed above — never runs for these four tasks.

### Acceptance scenarios in scope

**US-002 — The nine existing records parse unchanged (P0)** — value delivered, gates block

| Scenario | Assertion | Result |
|---|---|---|
| 1 | `-t "FR-004: recovers the number from the filename when the H1 omits it"` | ✅ exit 0 |
| 2 | `-t "FR-004: tolerates trailing double-space hard breaks"` | ✅ exit 0 |
| 3 | `-t "FR-004: returns empty relations rather than throwing"` | ✅ exit 0 |
| 4 | `-t "FR-004: splits two fields separated by the middle dot"` | ✅ exit 0 |
| 5 | `-t "FR-004: preserves a 240-character Decision value"` | ✅ exit 0 |
| 6 | reconciled H1s · no dead `file:///` · one `## 7.` | ✅ all pass |
| 7 | no `Status: Proposed` in 006/007 | ✅ both pass |
| 8 | `-t "FR-004: uses fixtures, never the live corpus"` | ✅ exit 0 |

**FR-005 (heading tree / section addressing)** — 6/6 tests pass, including `resolveSection` returning
`null` for an unresolvable address, never falling back to a line number, and a duplicate-address fixture.

**US-010 — in-scope portion only** (scenario 4's two corpus greps; `--check` itself is Phase 10)

| Assertion | Result |
|---|---|
| `grep -q '028 correction' docs/decisions/ADR-007-single-dispatch-path.md` | ✅ exit 0 |
| `grep -q 'is one-way' docs/decisions/ADR-007-single-dispatch-path.md` | ✅ exit 0 |

**TC-007 (blockquote metadata, not YAML)** — ✅ honoured. All nine records keep the house
`> **Field:** value` form shared with `plan-renderer.ts:33-38`; zero YAML frontmatter introduced.

**TC-014 (bare-clone operable)** — ✅ honoured. The parser and every corpus assertion run with no SQLite
and no build server.

### Reader experience of the reconciled corpus (PM read-through)

Checked as a human reader, not as a grep:

- **ADR-001** — H1 reads `# ADR-001: Task Tracking — Beads (bd + Dolt) vs. Roll Our Own`. The duplicate
  `## 7.` is resolved by renumbering the second to `## 8. Next Steps`; the section sequence now runs
  1→8 with no gap and no repeat. Section addressing is unambiguous.
- **ADR-002** — both formerly dead `file:///Users/gonzo/…` links are now relative and **both resolve to
  files that exist**: `./ADR-001-task-tracking.md`, `./ADR-003-state-contract.md`. A reader clicking the
  `Supersedes` link now lands somewhere.
- **ADR-006 / ADR-007** — statuses read `Decided`, matching what the code already assumes.
- **ADR-007** — the `028 correction` blockquote sits inside §2.1, directly beneath the existing
  `026 correction` and immediately before `### 2.2`. It reads correctly in context and closes
  028's outstanding FR-011.
- **FR-006 "in place, nothing rewritten"** — ✅ honoured literally. The implement commit changed
  4/6/2/9 lines across the four records. No file rewritten, nothing reordered, nothing deleted.

### CLI surface / help output

Phase 01 ships **no CLI command** — `gwrk define adr` is Phase 2. Checked for regression only:

- `gwrk define --help` → ✅ exit 0, renders cleanly, `adr` correctly **absent** (Phase 2 scope).
- No new user-facing error paths to exercise; the parser has no CLI entry point yet.

### Out-of-scope observation (no task re-opened)

`spec.md` US-001 scenario 5 asserts `node dist/index.js define --help`, but this package's bin is
`dist/cli.js` — there is no `dist/index.js`. That acceptance criterion cannot pass as written. US-001 is
**Phase 2**, so nothing is re-opened here, but it will block Phase 2 UAT unless the spec text or the
build output is corrected first. Flagging early.

### Re-opened tasks

| Task | Title | Why |
|---|---|---|
| T002 | Modify ADR-001-task-tracking.md | Gate exit 1 while marked `completed` (AX-002) |
| T003 | Modify ADR-002-sqlite-execution-ledger.md | Gate exit 1 while marked `completed` (AX-002) |
| T004 | Modify ADR-006-plugin-agent-backends.md | Gate exit 1 while marked `completed` (AX-002) |
| T005 | Modify ADR-007-single-dispatch-path.md | Gate exit 1 while marked `completed` (AX-002) |

`T001` stays `completed` — inline gate exits 0, 20/20 parser tests green.

Stale `completedAt` timestamps were removed from the four re-opened tasks. Phase 01 has no phase-level
status field; re-opening its tasks re-opens the phase.

### Remediation — do not touch the markdown

**The corpus edits are correct.** Every one was re-verified by this UAT. The only thing broken is the
gate. For each of `T002`–`T005`, either:

1. Replace the vitest invocation at `gates/T00N-gate.sh:9-10` with that task's TR-014 shell assertions
   (spelled out per-task in the re-opened task notes), **or**
2. Delete `gates/T00N-gate.sh` so `runTaskGate` falls through to the inline `task.gateScript` — verified
   above to exit 0.

⚠️ These four gate files carry a `# AUTHORED` marker. Per AX-006 they will **not** be regenerated, so
they must be hand-edited or removed. Re-running `define tasks` will not fix this.

**Systemic note for the pipeline owner — this recurs 12 more times.** The generator that emitted these
gates produced `pnpm vitest run <markdown-path>` for every documentation task, a gate form that can
never exit 0. Audited all 28 gate files in `specs/029-decision-records/gates/`; **16** carry the defect:

- **Phase 1 (in scope, re-opened):** T002, T003, T004, T005
- **Later phases (not re-opened — out of scope for this review):** T012, T013, T014, T015, T016, T017,
  T018, T019, T020, T030, T034, T035

Every one points at a `.md` path (`docs/decisions/*.md`, and `docs/grounding/architecture.md` for T030).
Fixing only Phase 1 leaves 12 phases to fail the same way. Worth fixing the generator, or sweeping all
16 files, before Phase 4 ships.
