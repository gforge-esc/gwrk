# Code Review — 029 Decision Records, Phase 01 (Parser and corpus reconciliation)

**Verdict: GO** — 5/5 tasks completed. Prior NO-GO findings remediated and re-verified.

## Mechanical baseline

| Check | Result |
|---|---|
| `pnpm build` (`tsc`) | PASS — 0 errors |
| `runTaskGate` T001 | PASS exit=0, strategy=`inline` |
| `runTaskGate` T002–T005 | PASS exit=0, strategy=`convention` |
| `npx vitest run src/engine/adr-parser.test.ts` | 20/20 pass |
| Regression (`init.test.ts`, `source-scanner.test.ts`) | 20 pass / 7 skipped, 0 fail |
| Lint on phase-01 files | 0 errors |

Gates were verified **twice**: directly via `bash gates/<id>-gate.sh`, and end-to-end through the
shipped `dist/utils/gate-exec.js` `runTaskGate` — the same authoritative path the prior UAT used to
record its NO-GO.

## Prior findings — remediated

The Phase 01 code review (`1c20d6b`) and UAT (`1ab31f8`) both recorded NO-GO on one defect: each of
`gates/T002…T005-gate.sh` ran `pnpm vitest run <file>.md`, which can never exit 0 (vitest's include
glob is `**/*.{test,spec}.?(c|m)[jt]s?(x)`; a `.md` path matches nothing → "No test files found",
exit 1).

`210d6e0` fixes all four. The vitest invocation is gone; each gate now asserts its TR-014 corpus
properties as shell assertions — and goes one better than the plan's Done-When by adding the
**positive half** of each negative grep (`grep -q 'Status:\*\* Decided'` alongside
`! grep -q 'Status:\*\* Proposed'`), so a deleted `Status` line cannot read as a pass. `set -euo
pipefail` plus the `if grep …; then exit 1; fi` negative form (not `! grep -q`, which is a `set -e`
no-op) are both correct.

The prior `REVIEW FAIL` notes are retained on the task descriptions for audit trail, with an
appended `REVIEW PASS` line marking them remediated.

## Task-by-task

| Task | Gate | Finding | Status |
|---|---|---|---|
| T001 `adr-parser.ts` | inline, exit 0 | none | completed |
| T002 ADR-001 | convention, exit 0 | none | completed |
| T003 ADR-002 | convention, exit 0 | none | completed |
| T004 ADR-006 | convention, exit 0 | none | completed |
| T005 ADR-007 | convention, exit 0 | none | completed |

## Spec match

**FR-004 / FR-005** — `adr-parser.ts` (447 lines) implements the contract §1–2 surface exactly:
`parseRecord`, `parseCorpus`, `resolveSection`, `listSectionAddresses`, and all six exported types
with the contract's field names and nullability. MPL header present by hand (VR-004). No `any`.
Lint-clean.

**TR-002 self-check** — `adr-parser.test.ts` was *only un-skipped* by the ACTIVATE_TESTS stage
(`@status red` → `active`, 20 × `it.skip` → `it`). Diffed against the definition commit `d4163f1`:
**not one assertion was weakened, relaxed or deleted.** All six spec-named `-t` assertions from
US-002 scenarios 1–5 and 8 exit 0 and each runs exactly 1 test.

**Gate-coverage probe (beyond the gate).** TR-002 mandates fixtures only, so *nothing in Phase 01
runs the parser against the real corpus*. I closed that hole by hand — built parser vs. live
`docs/decisions/`:

- All **9** records parse, no throw. Every `status` = `Decided`, every `date` populated.
- Number recovery works on both H1 styles; `dependsOn`/`supersedes` populated where present, `[]`
  where absent (ADR-001), `targetId: "ADR-001"` with the `(storage mechanism only)` qualifier on
  ADR-002.
- ADR-001 addresses are now `1..8` — the duplicate `## 7.` is genuinely gone.
- ADR-007: `resolveSection("9.9")` → `null`, `resolveSection("78")` → `null` (FR-020 / OQ-001 —
  no line-number fallback), `resolveSection("§2.1")` resolves at depth 3.

**FR-006 — all five migration edits verified in place, nothing rewritten/deleted/reordered:**

1. `# ADR: …` → `# ADR-001: …` / `# ADR-002: …` — one line each.
2. `Status: Proposed` → `Decided` on ADR-006 and ADR-007.
3. Both dead `file:///Users/gonzo/…` links → `./ADR-001-task-tracking.md`, `./ADR-003-state-contract.md`
   — both resolve to files on disk. `grep -rn 'file:///' docs/decisions/` → nothing.
4. Duplicate `## 7.` deduplicated: second heading → `## 8. Next Steps`. Verified no prior `## 8.`
   existed, and **no citation anywhere targets ADR-001 §7 or §8** — the six live citations all
   target §6 (Hard Gate Architecture), untouched. No anchor references the old H1 slugs.
5. The `028 correction` block on ADR-007 is **byte-for-byte** the canonical W4 markdown at
   `docs/code-review-verdict-defect.md:422-431`, placed inside §2.1 directly beneath the existing
   `026 correction` and immediately before `### 2.2`. Confirmed the parser puts §2.1's `bodyEnd` at
   the line just past it — the exact insertion point `contracts/adr-engine.md` §5 `amendAtSection`
   will need in Phase 8. **This closes 028 FR-011 (W4).**

## Non-blocking observations (no task re-opened)

1. **`normalizeStatus` casts out-of-vocabulary values** — `adr-parser.ts:143-149` returns
   `value as AdrStatus` for an unknown status, and a *missing* `Status:` field yields `status: ""`.
   The documented rationale is right (coercing `Accepted` → `Decided` would hide what FR-011's
   `--check` assertion exists to report), and contract §2 requires a throw only on an unparseable
   header, so this is in-contract. Flagging it for **Phase 10**: FR-011 must reject `""` as well as
   `Accepted`, or a header with no `Status:` line passes silently.
2. **H1 search does not skip code fences** — `parseRecord` finds the H1 with `/^#\s+\S/` over raw
   lines, while `collectHeadings` correctly skips fenced blocks. Cannot fire today (all nine records
   and the §4.1 template put the H1 on line 1). Robustness only.
3. **`SECTION_ADDRESS` would read `## 2026 Retrospective` as address `2026`.** No such heading in the
   corpus or the template. Noted for the Phase 2 scaffolder's heading vocabulary.
4. **Dead branch** — `parseAmendments`'s `if (cells.length === 0) continue;` is unreachable;
   `tableCells` always returns ≥1 element. Cosmetic.
5. **Spec assertion form is not self-guarding** (spec defect, not code): `npx vitest run <file> -t
   "<name>"` **exits 0 when the filter matches nothing** — verified, a bogus name reports
   "20 skipped" and exits 0. The US-002 names all match real tests today so the scenarios genuinely
   hold, but later phases should not rely on this form alone to prove a test exists.

## Out of Phase 01 scope (noted, not acted on)

- **`docs/grounding/architecture.md` still carries `file:///Users/gonzo` links** (lines 4, 8, 10, 18,
  19). TR-014's full text names this file, but Phase 01's Done-When and the plan's Phase 01 TR-014 row
  both scope the assertion to `docs/decisions/`; `architecture.md` belongs to FR-018 in a later phase.
  Same for the `file:///` links surviving in `docs/research/` and `docs/archive/`.
- **`pnpm lint` reports 357 repo-wide errors** — a pre-existing baseline in files Phase 01 never
  touched (`src/cli.ts`, `scripts/`, `.gwrkrc.json`, `package.json`, legacy `*.test.ts`), almost all
  `biome check` formatting. The two in-scope source files are clean, so there was nothing in scope to
  auto-fix. I deliberately did **not** run `biome lint --write .`: it would rewrite files across the
  repo outside this phase, against the phase-scoped-commit constraint.
