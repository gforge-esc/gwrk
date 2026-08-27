## Code Review — Phase 3 (`gwrk-adr-record` builtin and `--run` dispatch)

**Verdict: NO-GO.** One blocking finding on T011. T009 and T010 pass.

### Task verdicts

| Task | File | Verdict |
|---|---|---|
| T011 | `src/commands/adr.ts` | **open** — `--run` breaks from any subdirectory |
| T009 | `manifest.yaml` | completed |
| T010 | `PROMPT.md` | completed |

### Mechanical baseline — all green

`pnpm build` passes. All ten `gateScript` lines pass. All 59 tests pass across `adr-dispatch.test.ts`, `adr-parser.test.ts`, `adr-scaffold.test.ts`, `adr.test.ts`. `biome check src/commands/adr.ts` exits 0.

The two findings from the previous review are fixed. `PROMPT.md` now names the seven numbered sections and the `## Amendments` registry, and `adr-dispatch.test.ts:175-207` is a real regression test that reads `renderTemplate()` headings and asserts the prompt names each one. The `noImplicitAnyLet` and formatter errors on `adr.ts` are gone.

### Finding: `loadConfig` receives the working directory, not the project root

`src/commands/adr.ts:98`

```
const config = loadConfig(cwd);          // :98
const model  = resolveModelForTask("define", backend, cwd);   // :105
const projectRoot = await findProjectRoot(cwd);               // :107  ← two statements too late
```

`loadConfig` reads `path.join(projectRoot, ".gwrkrc.json")` and does not walk parents (`src/utils/config.ts:315-321`). The walk FR-002 mandates is `findProjectRoot`, and it is already computed on the next line.

Reproduced. Project at `/tmp/adrrepro` with `agents.define: "claude"`, handler driven with `cwd` set to `/tmp/adrrepro/sub/deeper` and `run: true`:

- the scaffold succeeded and wrote `/tmp/adrrepro/docs/decisions/ADR-001-repro-from-subdir.md`
- the handler then threw `Configuration file .gwrkrc.json not found at /tmp/adrrepro/sub/deeper/.gwrkrc.json. Run 'gwrk init' to initialize this project.`

Impact. `gwrk define adr "<title>" --run` fails from every subdirectory. US-001 acceptance scenario 3 and SC-001 both require the command to work from any subdirectory. FR-002 exists to fix the research allocator's habit of joining `process.cwd()` with literals; this reintroduces it one layer up. The record is written and left undrafted, and the user is told to run `gwrk init` on an already-initialized project. That is a fourth error state absent from the FR-007 Error States table.

`resolveModelForTask` carries the same defect quietly. `loadRegistry(cwd)` is caught and returns `undefined`, so a project-local model registry is invisible from a subdirectory and `model` drops out of the dispatch. That is the exact class of invisibility this phase passes `projectRoot` to `executeWorkflow` to avoid.

Fix. Hoist `findProjectRoot` above `:98`, pass `projectRoot` to both `loadConfig` and `resolveModelForTask`, delete the duplicate at `:107`. Order matters: the root walk must throw its own declared `Not a gwrk project: …` message before any config read.

### Gate coverage hole

The gate is green over this defect. `adr-dispatch.test.ts:44-51` mocks `../engine/adr-scaffold.js` so `findProjectRoot` returns a constant `/repo`, and mocks `loadConfig` as `vi.fn(() => ({agents:{define:"claude"}}))`, which ignores its argument. No mock can observe which path the real `loadConfig` receives.

Add, driven with `cwd: "/repo/src/deep"` so the two paths differ:

```ts
expect(vi.mocked(loadConfig)).toHaveBeenCalledWith("/repo");
expect(vi.mocked(resolveModelForTask)).toHaveBeenCalledWith("define", "claude", "/repo");
```

### Out of scope, noted only

`pnpm lint` reports 357 errors repo-wide, almost all `noExplicitAny` in `tests/**` and other pre-existing files. None are in phase-03 files and none were touched.
