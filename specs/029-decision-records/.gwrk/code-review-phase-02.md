## Code Review — Phase 2 (Scaffolder and `gwrk define adr`) — NO-GO

One blocking finding. T006 re-opened. T007 and T008 pass.

| Task | Gate | Finding | Status |
|---|---|---|---|
| T006 `adr-scaffold.ts` | passes | config error swallowed, wrong write path | open |
| T007 `adr.ts` | passes | none | completed |
| T008 `define.ts` | passes | none | completed |

### Blocking: `resolveDecisionsDir` hides a config error and writes to the wrong directory

`src/engine/adr-scaffold.ts:242-244` catches every `loadConfig` error and returns the `docs/decisions` default.

Reproduced on the built CLI. `.gwrkrc.json` sets a valid `decisions` field and omits the required `project.name`:

```json
{"project":{"architecture":{"decisions":"docs/adr"}}}
```

`gwrk define adr "Configured Dir"` exits 0 and writes `docs/decisions/ADR-001-configured-dir.md`. The configured `docs/adr` is ignored with no message. That is FR-019 unmet and TC-002 fail-fast bypassed.

Under `--run` the same config splits the verdict. `draftRecord` at `src/commands/adr.ts:104` calls the same `loadConfig` unguarded, so the record lands at the wrong path and the command then exits 1 with the zod error.

The catch is justified as TC-014 bare-clone in both the code comment and the test comment. It never handles that case. `scaffold` calls `findProjectRoot` first, which guarantees `.gwrkrc.json` exists before `resolveDecisionsDir` runs. The catch can only fire on invalid JSON or a schema violation. Both are TC-002 conditions.

`src/engine/adr-scaffold.test.ts:525` asserts the defect. Its mock throws the file-not-found message, which is the one case that cannot reach this code.

### Gate coverage hole

The T006 gateScript passes in full. 30/30 unit tests green, build clean, every AMBER-3 documentation grep satisfied. No assertion drives a config that is present but invalid.

### Verified working

| Check | Result |
|---|---|
| FR-002 concurrent allocation | 8/8 races landed exactly one record, loser exited 1 naming the winner |
| FR-002 claim and stage litter | none left behind in any run |
| FR-019 configured decisions dir | honoured with a valid config |
| US-001 AC-3 subdirectory walk | works from a nested subdirectory |
| FR-008 `--print` | template to stdout, nothing written |
| FR-001 `withSignal` | `[exit:N \| Xs]` on stderr for every invocation |
| TC-015 documentation departure | AMBER-3 recorded in spec, plan, contract, checklists |
| Build and typecheck | clean |
| Lint on phase files | clean |

### Non-blocking observation

A title of only non-alphanumeric characters slugifies to nothing and writes `ADR-001-.md`. `gwrk define adr "日本語"` exits 0 with an empty slug. No spec text covers this, so it is not a blocking finding. Worth a decision before the Phase 5 index reads the corpus.

### Pre-existing, outside this phase

`pnpm lint` reports 357 errors repo-wide. None are in the phase-02 files.
