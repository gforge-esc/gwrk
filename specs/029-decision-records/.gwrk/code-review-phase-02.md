## Code Review — Phase 2 (Scaffolder and `gwrk define adr`) — GO

The pass-3 blocking finding is fixed. No new blocking finding. T006 completed.

| Task | Gate | Finding | Status |
|---|---|---|---|
| T006 `adr-scaffold.ts` | passes | none | completed |
| T007 `adr.ts` | passes | none | completed |
| T008 `define.ts` | passes | none | completed |

### The config error now propagates

`resolveDecisionsDir` at `src/engine/adr-scaffold.ts:240-262` re-throws every `loadConfig` error whose message does not match `CONFIG_ABSENT` (`:70`). Only an absent `.gwrkrc.json` falls back to `docs/decisions`.

Reproduced against a temp project whose `.gwrkrc.json` sets `decisions` to `docs/adr` and omits the required `project.name`.

| Invocation | Exit | Written |
|---|---|---|
| `define adr "Bad"` | 1, names `project.name Required` | nothing |
| `define adr --print` | 1, same error | nothing |
| `define adr "Bad" --run` | 1, same error | nothing |

The split verdict is closed. `scaffold` and `draftRecord` reach the same `loadConfig` and now agree, so `--run` can no longer write a record to the default directory and then exit 1.

### Verified working

| Check | Result |
|---|---|
| FR-019 configured dir | valid config wrote `docs/adr/ADR-001-configured-dir.md`, no `docs/decisions` |
| US-001 AC-3 subdirectory walk | `ADR-002` from `a/b/c` landed in the configured dir |
| FR-002 concurrent allocation | 5/5 races landed exactly one record, loser exited 1 naming the winner |
| FR-002 claim and stage litter | none left behind in any run |
| T006 gate | exit 0, including the new invalid-config assertion |
| T007 gate, T008-gate.sh | exit 0 |
| Phase unit tests | 39/39 green across `adr-scaffold`, `adr`, `define` |
| Build and typecheck | `tsc` clean |
| Lint on phase files | biome clean |

### New test coverage closes the gate hole

`src/engine/adr-scaffold.test.ts` splits the old mocked test into absent-defaults plus two present-but-invalid rejects. A new non-mocked `029 FR-019/TC-002: real config resolution` block drives real `scaffold()` calls against real temp projects for configured-dir, schema-invalid and malformed-JSON.

The T006 gateScript now scaffolds against a temp project with a schema-invalid config carrying a `decisions` field and fails on exit 0 or on a created `docs/decisions`. It also fails on a literal `catch {}` and requires AMBER-4 in `plan.md` and `contracts/adr-engine.md`.

### Documentation

AMBER-4 is recorded in `plan.md:128` Resolved Ambiguities, the TC-002 governance row, the traceability table, and the `resolveDecisionsDir` contract at `contracts/adr-engine.md:154-160`.

### Non-blocking observation, carried forward

A title of only non-alphanumeric characters still slugifies to nothing and writes `ADR-001-.md`. `gwrk define adr "日本語"` exits 0 with an empty slug. No spec text covers this. Worth a decision before the Phase 5 index reads the corpus.

### Pre-existing, outside this phase

`pnpm lint` reports 357 errors repo-wide. None are in the phase-02 files.
