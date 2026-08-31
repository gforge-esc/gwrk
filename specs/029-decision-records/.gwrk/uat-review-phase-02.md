# UAT Review — 029 Decision Records, Phase 2

**Verdict: GO.** Every in-scope requirement passes on the built CLI. Both failures from the previous rounds are fixed and re-tested: the concurrent-allocation race (T006) and the UTC date stamp (FR-003).

Reviewed at `ed9d3f0`. Scope is Phase 2 only: the scaffolder and `gwrk define adr`.

## Requirements in scope

| Requirement | Plain name | Result |
|---|---|---|
| US-001 | Engineer records a decision without choosing its number | PASS |
| FR-001 | Command surface, Examples block, exit signal | PASS |
| FR-002 | Numbering, filtering, collision refusal, root walk | PASS |
| FR-003 | Section-numbered template, author's local date | PASS |
| FR-008 | Neither `--refs` nor `--dry-run` declared | PASS |
| FR-019 | `project.architecture.decisions` is the configuration point | PASS |
| TC-002 | Fail-fast on a present-but-invalid config | PASS |
| TC-013 | Nine-entry collision baseline holds | PASS |
| TC-015 | No lock manager, loser fails loudly | PASS |
| SC-001 | Correct number from any subdirectory, refuses siblings | PASS |

## The two prior failures are closed

### The race now yields exactly one record

Six rounds of two overlapping `gwrk define adr` runs against a corpus of ADR-001. Every round: one writer, one loser at exit 1, one file at the number, no claim file left behind.

```
round 1: exitA=1 exitB=0  count(ADR-002-*)=1  claims_left=0
  loser: [exit:1 | 2ms] define adr: ADR-002 already exists: docs/decisions/ADR-002-beta-two.md
round 2: exitA=0 exitB=1  count(ADR-002-*)=1  claims_left=0
round 3: exitA=1 exitB=0  count(ADR-002-*)=1  claims_left=0
round 4: exitA=1 exitB=0  count(ADR-002-*)=1  claims_left=0
round 5: exitA=1 exitB=0  count(ADR-002-*)=1  claims_left=0
round 6: exitA=1 exitB=0  count(ADR-002-*)=1  claims_left=0
```

The stderr text matches the FR-002 error table verbatim. The previous round reproduced two siblings 5/5. This round reproduces zero siblings 6/6.

### The date is the author's, not UTC

Run at 23:11 UTC, which is a different calendar day from half the world.

| Timezone | Local date | `--print` | Written record |
|---|---|---|---|
| Pacific/Kiritimati | 2026-09-01 | 2026-09-01 | 2026-09-01 |
| Asia/Tokyo | 2026-09-01 | 2026-09-01 | 2026-09-01 |
| Pacific/Auckland | 2026-09-01 | 2026-09-01 | 2026-09-01 |
| America/Denver | 2026-08-31 | 2026-08-31 | 2026-08-31 |
| Etc/GMT+12 | 2026-08-31 | 2026-08-31 | 2026-08-31 |

`--print` and the write path agree in every zone. That was the second half of AMBER-5 and it holds.

## Golden path

Corpus of ADR-001 through ADR-009, plus a directory named `ADR-099-a-directory` and a file named `ADR-050-not-markdown.txt`. Command run from `src/deep/nested`.

```
$ gwrk define adr "Decision Records"
/…/docs/decisions/ADR-010-decision-records.md

[exit:0 | 3ms]
```

Four things land at once. The number is 010, so max+1 is computed over the `.md`-and-pattern filter and the stray directory and text file are ignored. The write reached the project root from three levels down, so the parent walk for `.gwrkrc.json` works. The `[exit:0 | 3ms]` line is the ADR-004 signal FR-001 requires and `define research` omits. The record carries `Status: Proposed`, the local date, the §1–§7 numbered sections, the four-row Decision Record table, and the empty `## Amendments` registry.

The registry heading is the literal unnumbered `## Amendments`, which is what plan AMBER-2 resolved. FR-003's "§8" is prose ordering, not a heading form.

## Error states

Every row of the FR-002 error table reproduces on the built CLI.

| Condition | Observed stderr | Exit |
|---|---|---|
| No `.gwrkrc.json` in any parent | `Not a gwrk project: no .gwrkrc.json found in <cwd> or any parent. Run: gwrk init` | 1 |
| Empty title | `Title is required: gwrk define adr "<title>"` | 1 |
| No title argument at all | `Title is required: gwrk define adr "<title>"` | 1 |
| `docs/decisions/` unwritable | `Cannot write docs/decisions/: EACCES` | 1 |
| Number taken by a racing run | `ADR-002 already exists: docs/decisions/ADR-002-beta-two.md` | 1 |

A read-only `docs/` parent produces the same `EACCES` message as a read-only `docs/decisions/`, which is the right call. The author cannot write there either way.

## Configuration and flags

`project.architecture.decisions: "docs/adr-custom"` writes to `docs/adr-custom/` and never creates `docs/decisions/`. FR-019 turns the dead seam live.

A `.gwrkrc.json` missing `project.name` exits 1 naming the config error and writes nothing. TC-002 holds. The message is a raw Zod dump rather than a sentence, which reads poorly, but it names `project.name` as required and it is the same shape the rest of the CLI emits. Not a Phase 2 defect.

`--print` writes nothing. No `docs/` directory is created. That is the dry-run affordance FR-008 asks for in place of `--dry-run`.

`define adr --help` declares `--print`, `--run` and `-h` only. Neither `--refs` nor `--dry-run` appears, so the nine-entry collision baseline needs no allowlist entry. `adr` appears in `define --help` under Commands, and `gwrk define adr "Decision Records"` appears in the parent Examples block.

## Tests and gate

| Command | Result |
|---|---|
| `pnpm build` | exit 0 |
| `adr-scaffold.test.ts` + `adr.test.ts` | 38 passed |
| `cli.ux` + `cli.e2e` + `cli.option-collisions` | 27 passed |
| Phase 2 Done-When, run literally | exit 0 |

The Done-When block leaves no artifacts behind. The working tree carries no stray `.adr-*.log` after the run.

## Out of scope, noted not tested

`--run` is declared on the command and appears in the help examples. Its dispatch is FR-007 and US-003, which belong to Phase 3. Phase 3 task T011 is still open. Nothing here evaluates it.
