# Code Review — Phase 2: Scaffolder and `gwrk define adr`

**Verdict: GO.** All three tasks pass. No blocking findings.

## Mechanical baseline

| Check | Result | Detail |
|---|---|---|
| Build | PASS | `pnpm build`, `tsc` clean |
| Gates | PASS | `run-all-gates.sh` 11/11 |
| Phase tests | PASS | 65/65 across 5 files |
| Lint | PASS | Phase files clean under biome |

Repo-wide `pnpm lint` reports 357 errors. Every one is in files outside this phase and predates it. No auto-fix applied.

## Prior findings, re-verified

| Finding | Task | State |
|---|---|---|
| `--print` stamped a UTC date | T007 | Fixed |
| Concurrent runs both wrote at one number | T006 | Fixed |

The `--print` date fix landed exactly as the note specified. `todayLocal()` is exported from `src/engine/adr-scaffold.ts:365` and imported by `src/commands/adr.ts:11`. Both call sites now render from one helper. `src/commands/adr.test.ts:98-119` asserts the `date:` call argument under a faked clock at `2026-08-31T04:00Z` with `TZ=America/Denver`, and gets `2026-08-30`.

The concurrency fix is the `.ADR-NNN.claim` published by `fs.link`.

## Reproduced against the built CLI

I ran these myself rather than reading the tests.

| Probe | Expected | Observed |
|---|---|---|
| 8 concurrent `define adr` in one empty project | one record, no duplicate number | 1 exit 0, 7 exit 1, one `ADR-001` |
| Loser message | names the winner's path | `ADR-001 already exists: docs/decisions/ADR-001-race-candidate-6.md` |
| Leftover litter after the race | none | no `.claim`, no `.stage` |
| Stale `.ADR-001.claim`, no records | next run steps to 002 | wrote `ADR-002-after-crash.md`, exit 0 |
| `chmod 555 docs/decisions` | `Cannot write docs/decisions/: EACCES` | exact match, exit 1 |
| No `.gwrkrc.json` in any parent | `Not a gwrk project: … Run: gwrk init` | exact match, exit 1 |
| `define adr` with no title | `Title is required: gwrk define adr "<title>"` | exact match, exit 1 |
| Write and `--print` from `a/b/` | resolves the real project root | both resolved, numbers continued |
| Scaffolded record through `parseRecord` | header and §1-§7 tree resolve | parsed, `status: Proposed`, addresses `1`…`7` |

The round-trip through the Phase 1 parser is the check the plan's Phase 2 dependency line asks for. The template the scaffolder writes is the shape the parser reads.

## Contract conformance

`scaffold()` follows the order `adr-engine.md` §3 contracts: root discovery, decisions dir, allocation, mkdir, claim, existence check, write, release. All four error rows in that section reproduce with the exact contracted text.

`renderTemplate` emits the ten §4.1 elements in order, with `## Amendments` last, literal and unnumbered per AMBER-2.

`--print` declares no `--format`, per `adr-command.md` §2. Phase 2 declares `--print` only.

Neither `--refs` nor `--dry-run` is declared. `cli.option-collisions.test.ts` still passes with no allowlist entry.

No `any` in either new source file. MPL headers present on both, per VR-004.

## Non-blocking observation

A title of pure punctuation produces an empty slug. `gwrk define adr "!!! ???"` writes `docs/decisions/ADR-001-.md`. The filename still matches FR-002's `/^ADR-(\d{3})-/`, the record parses, and no spec clause requires a non-empty slug. Recording it because a later phase's index rendering may want a fallback slug. Not a Phase 2 defect and not re-opened.
