# UAT Review — 029 Decision Records, Phase 2

**Verdict: NO-GO.** One in-scope requirement fails. `FR-003` says the record carries today's date. The record carries tomorrow's date for any author west of UTC working in the evening. Everything else in scope passes.

Reviewed at `eb378ff`. Scope is Phase 2 only: the scaffolder and `gwrk define adr`.

## Requirements in scope

| Requirement | Plain name | Result |
|---|---|---|
| FR-003 | Section-numbered template with today's date | **FAIL** |
| US-001 | Engineer records a decision without choosing its number | PASS |
| FR-001 | Command surface, Examples block, exit signal | PASS |
| FR-002 | Numbering, filtering, collision refusal, root walk | PASS |
| FR-008 | Neither `--refs` nor `--dry-run` declared | PASS |
| FR-019 | `project.architecture.decisions` is the configuration point | PASS |
| TC-002 | Fail-fast on a present-but-invalid config | PASS |
| TC-013 | Nine-entry collision baseline holds | PASS |
| TC-015 | No lock manager, loser fails loudly | PASS |
| SC-001 | Correct number from any subdirectory, refuses siblings | PASS |

## The failure: the record is stamped in UTC, not the author's date

`src/engine/adr-scaffold.ts:426` renders the header date as `new Date().toISOString().slice(0, 10)`. That is the UTC calendar date. The author's calendar date is what FR-003 and US-001 both ask for.

Reproduced on the built CLI at 20:59 local:

```
record Date field : > **Date:** 2026-08-31
user's today (MDT): 2026-08-30
user's clock (MDT): 2026-08-30 20:59 MDT
```

Every record authored after 18:00 in `America/Denver` is stamped tomorrow. The window is six hours a day on this machine, seven under Pacific time.

Two consequences follow.

The stated field is wrong. An author who runs the command tonight and reads the file back sees a date they did not live through.

Corpus ordering stops being monotonic. A record authored at 19:00 on the 30th outranks one authored at 09:00 on the 31st. `Date:` is the only ordering signal a reader has once numbers are allocated by a race rather than by hand.

The existing test cannot catch this. `src/engine/adr-scaffold.test.ts:431` passes `date: "2026-08-20"` into `renderTemplate` and asserts it renders. It never exercises the call that chooses the date.

## What passes

### Golden path

`gwrk define adr "Decision Records"` against a copy of the nine-record corpus writes `docs/decisions/ADR-010-decision-records.md` and exits 0. The `[exit:0 | 3ms]` line ADR-004 requires is present on every invocation, including every failure.

Run from `src/deep/nested`, the same command found the root and wrote `ADR-011-nested-origin.md`. SC-001's from-any-subdirectory clause holds.

### The template

The written body carries `Status: Proposed`, the blockquote header fields FR-003 lists, numbered sections §1 through §7, the four-row `Position` / `Confidence` / `Reversibility` / `Risk` table, and an empty `## Amendments` registry. The unnumbered heading form is AMBER-2, recorded in the plan.

### The four FR-002 error states

Each matches the spec's stderr text and exits 1.

| Condition | Observed stderr | Exit |
|---|---|---|
| No `.gwrkrc.json` in any parent | `Not a gwrk project: no .gwrkrc.json found in <cwd> or any parent. Run: gwrk init` | 1 |
| Empty title | `Title is required: gwrk define adr "<title>"` | 1 |
| Missing title argument | `Title is required: gwrk define adr "<title>"` | 1 |
| `docs/decisions/` unwritable | `Cannot write docs/decisions/: EACCES` | 1 |

### Concurrency

Five two-process races on a real filesystem. Every round landed exactly one `ADR-002-*.md`, the loser exited 1 naming the winner's real path, and no claim or stage file survived.

```
round 1: ADR-002 count=1 leftovers=0 exits=[B=1 A=0]
round 2: ADR-002 count=1 leftovers=0 exits=[A=1 B=0]
round 3: ADR-002 count=1 leftovers=0 exits=[A=1 B=0]
round 4: ADR-002 count=1 leftovers=0 exits=[A=1 B=0]
round 5: ADR-002 count=1 leftovers=0 exits=[A=1 B=0]
```

The winner alternates. That is an atomic claim, not a fixed ordering.

### Configuration

A `.gwrkrc.json` setting `decisions` to `docs/adr` writes `docs/adr/ADR-001-configured-dir.md` and creates no `docs/decisions`. FR-019 holds.

A config present but schema-invalid exits 1 naming the `project.name` error and writes nothing. A config holding malformed JSON exits 1 with `Configuration error: invalid JSON in .gwrkrc.json`. TC-002 holds. AMBER-4 is closed.

### Help output and flags

`gwrk define --help` lists `adr` and carries `gwrk define adr "Decision Records"` in its Examples block. `gwrk define adr --help` carries an `Examples:` section with three worked invocations.

`define adr` declares `--print` and `--run` only. `--print` emits the template and leaves the corpus at nine files. `cli.option-collisions.test.ts` passes untouched, so the nine-entry baseline holds with no allowlist entry. FR-008 and TC-013 hold.

### Gates

`pnpm build` succeeds. The T006, T007 and T008 gate scripts each exit 0. The plan's Phase 2 Done-When block, run verbatim, exits 0. All six US-001 named tests exist and pass, confirmed by name against a verbose run rather than by exit code alone.

## Observations, not blockers

### `gwrk define adr "X" --dry-run` writes the record

The flag is accepted, exits 0, and writes. It binds to the parent `define` command, so `adr`'s action never sees it and no unknown-option error fires. A control probe with `--bogus` correctly errors with exit 2.

Not re-opened. FR-008's requirement is that `define adr` declare neither flag, and it declares neither. The same probe against `define research "Probe Initiative" --dry-run` also scaffolds for real, so this is the pre-existing intermediate-parent behaviour `cli.option-collisions.test.ts` documents in its own header, not something Phase 2 introduced. Fixing it means changing how `define` hands flags to every child.

### The schema error prints raw zod JSON

A present-but-invalid config exits 1 with the zod issue array pretty-printed to stderr. Correct behaviour, unfriendly presentation. Every other `loadConfig` caller does the same, so it is a house-wide surface, not a Phase 2 choice.

## Task state

`T006` re-opened. `T007` and `T008` unchanged — the date is chosen in the engine, not the command surface.
