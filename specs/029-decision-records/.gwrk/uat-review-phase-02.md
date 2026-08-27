# UAT Review — 029 Decision Records, Phase 2

**Verdict: GO.** All five US-001 acceptance scenarios pass, all four FR-002 error
states match the spec text, and the concurrency defect that failed the previous
UAT no longer reproduces.

Reviewed at `16e2cff`. Scope is Phase 2 only: the scaffolder and `gwrk define adr`.

## Requirements in scope

| Requirement | Plain name | Result |
|---|---|---|
| US-001 | Engineer records a decision without choosing its number | PASS |
| FR-002 | Numbering, filtering, collision refusal, root walk | PASS |
| FR-001 | Command surface, Examples block, exit signal | PASS |
| FR-003 | Section-numbered template | PASS |
| FR-008 | Neither `--refs` nor `--dry-run` declared | PASS |
| FR-019 | `project.architecture.decisions` is the configuration point | PASS |
| TC-013 | Nine-entry collision baseline holds | PASS |
| TC-015 | No lock manager, loser fails loudly | PASS |
| SC-001 | Correct number from any subdirectory, refuses siblings | PASS |

## The previous NO-GO is closed

The last UAT re-opened T006. Two concurrent runs both exited 0 and wrote two
records at the same number.

Re-ran that reproducer five times against a real filesystem. Every round landed
exactly one `ADR-002-*.md`, the loser exited 1, and no claim or stage file
survived.

```
round 1: ADR-002-* count=1  leftovers=0  exits=[B=0 A=1]
round 2: ADR-002-* count=1  leftovers=0  exits=[B=1 A=0]
round 3: ADR-002-* count=1  leftovers=0  exits=[A=1 B=0]
round 4: ADR-002-* count=1  leftovers=0  exits=[B=1 A=0]
round 5: ADR-002-* count=1  leftovers=0  exits=[B=0 A=1]
```

The loser's message names the winner's path.

```
[exit:1 | 3ms] define adr: ADR-002 already exists: docs/decisions/ADR-002-beta-two.md
```

Which run wins alternates between rounds. That is the expected shape of an
atomic claim, not a fixed ordering.

## Golden path

Ran from `deep/nested/dir` inside a fixture project holding `ADR-001` through
`ADR-009`, plus a directory named `ADR-099-a-directory` and a file named
`ADR-500-notes.txt`.

```
$ gwrk define adr "Decision Records"
/private/tmp/adr-uat-S4R7vC/docs/decisions/ADR-010-decision-records.md
[exit:0 | 3ms]
```

Three things land at once here. The number is 010, so the directory and the
`.txt` were filtered out rather than driving the count to 100 or 501. The
project root was found by walking parents. The `[exit:0 | 3ms]` line is the
ADR-004 signal FR-001 requires, which `define research` omits.

## Error states

Every row of the FR-002 error-states table, run against the built CLI.

| Condition | Observed stderr | Exit |
|---|---|---|
| Number taken | `ADR-002 already exists: docs/decisions/ADR-002-beta-two.md` | 1 |
| No project root | `Not a gwrk project: no .gwrkrc.json found in <cwd> or any parent. Run: gwrk init` | 1 |
| Empty title | `Title is required: gwrk define adr "<title>"` | 1 |
| Unwritable directory | `Cannot write docs/decisions/: EACCES` | 1 |

A whitespace-only title is treated as empty and gets the same corrective
command. Every message names the fix.

## Help output

`define --help` lists `adr` and carries it in the parent `Examples:` block.

```
  adr [options] [title]    Author an architecture decision record (ADR-NNN)
...
  gwrk define adr "Decision Records"
```

`define adr --help` carries its own `Examples:` block with a write example and a
preview example. It declares `--print` and nothing else. No `--refs`, no
`--dry-run`, which is what keeps the collision baseline intact.

`src/cli.option-collisions.test.ts` is untouched on this branch. The baseline is
still eight `HANDLED` plus one `VERIFIED_BENIGN`. No allowlist entry was added.

## Configuration seam

A `.gwrkrc.json` setting `project.architecture.decisions` to `adr-custom` wrote
`adr-custom/ADR-001-custom-location.md` and created no `docs/decisions/`. The
field that was declared and read by nothing is now the configuration point.

## Template

The written record carries the blockquote header with `Status: Proposed` and
today's date, numbered sections 1 through 7, the four-row Decision Record table
used by ADR-004 through ADR-009, and a final `## Amendments` registry with
headers and no rows.

The heading is unnumbered. FR-003 calls it "§8 Amendments", but
`contracts/adr-engine.md:177-180` settles it: the literal unnumbered form is
authoritative, because the `--check` assertions grep `^## Amendments`. The
implementation follows the contract. Not a finding.

`--print` emitted the template and left the file count unchanged at 13.

## Test results

| Suite | Result |
|---|---|
| `adr-scaffold.test.ts` + `adr.test.ts` | 30 passed |
| `cli.ux` + `cli.e2e` + `cli.option-collisions` | 27 passed |
| T006 gate script, run verbatim | exit 0 |
| Full suite | 1555 passed, 1 failed |

`pnpm build` exits 0.

The one failure is `src/server/routes/status.test.ts`, where `startServer` calls
`process.exit(1)` on a bind failure. `src/server/` has no changes on this branch.
This is the known sandbox port-binding failure, not a Phase 2 regression.

## Done When

All fourteen commands in the Phase 2 gate script pass. Run as one script with
`bash -e`, the gate exits 0.

The AMBER-3 documentation checks pass too. `fs.link` appears in the scaffolder,
`AMBER-3` in the plan, `ADR-NNN.claim` in both the spec and the engine contract,
and neither of the two stale-wording guards fires.

## Tasks re-opened

None.
