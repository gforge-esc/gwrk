## Code Review — Phase 2: Scaffolder and `gwrk define adr`

**Verdict: GO.** T006, T007, T008 completed. Build passes, gate assertions pass, 38 phase tests pass, no blocking findings.

### Mechanical baseline

| Check | Result |
|---|---|
| `pnpm build` | pass |
| `adr-scaffold.test.ts` + `adr.test.ts` | 26 pass |
| `cli.ux` + `cli.e2e` + `cli.option-collisions` | 27 pass |
| `define --help` lists `adr`, `define adr --help` has `Examples:` | pass |
| `gates/T008-gate.sh` | pass |
| `tsc --noEmit`, no `any`, MPL headers | pass |

Every US-001 named `-t` assertion runs live (`1 passed`, not `0`). All five `029 TR-010` e2e tests execute unskipped.

### Contract §3 error states, verified on the built CLI

| Condition | Observed |
|---|---|
| Empty title | `exit:1` · `Title is required: gwrk define adr "<title>"` |
| No `.gwrkrc.json` in any parent | `exit:1` · `Not a gwrk project: … Run: gwrk init` |
| `docs/decisions/` unwritable | `exit:1` · `Cannot write docs/decisions/: EACCES` |
| Taken number | `exit:1` · names the conflicting path, `writeFile` not called |

Happy path allocates 004 over a 001-003 corpus, works from `src/deep/nested`, and honours `project.architecture.decisions: "docs/adr"` (FR-019).

### Integration check the gate does not run

The rendered template was fed to the Phase 1 parser. It parses clean: `number 010`, `status Proposed`, `dependsOn []`, `supersedes []`, addresses `1, 2, 2.1, 3, 4, 5, 6, 7`, and `## Amendments` resolves as an unnumbered `depth: 2` heading. Plan AMBER-2 holds: the registry is invisible to a `## N.` max+1 scan, and the parser's header-row skip (`/^amending$/i`) matches the template's `| Amending | Section | Summary |`.

### Non-blocking observations

- **Repo lint baseline is red.** `pnpm lint` reports 357 biome errors, one of them a format error in `src/commands/define.ts:94-101`. Verified pre-existing: that block is absent from the Phase 2 diff (`0444738`). Not auto-fixed, because `biome lint --write` would touch 65+ files well outside this phase.
- **TR-009 landed as a dedicated block, not a list entry.** The plan asked for `"define adr"` in `commandsWithExamples`. The assertion instead lives in a `029 TR-009` describe block, with the deviation documented at `src/cli.ux.test.ts:73`. Coverage is equivalent.
- **Absolute config path.** `resolveDecisionsDir` uses `path.join(projectRoot, configured)`, so an absolute `project.architecture.decisions` would be mangled. Unspecified in the contract.
- **Empty slug.** A punctuation-only title writes `ADR-NNN-.md`. Numbering stays correct on the next run. Unspecified.
- **Table header cosmetics.** `## 3. Decision Record` renders `| Field | Value |` where research §4.1 shows `| | |`. The four row labels match the contract, so no fourth table shape is introduced.
- **For Phase 10.** `src/commands/adr.test.ts` carries bare `ADR-010` strings. FR-024 assertion 1 treats every bare `ADR-\d{3}` under `src/` as a citation that must resolve, and ADR-010 arrives in Phase 9. Correctly sequenced today; it becomes a failure only if Phase 9 slips past Phase 10.
