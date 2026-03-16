# Gap Analysis: 004 Ship Loop

**Generated**: 2026-03-15 (via `/plan-to-tasks` Step 4)
**Method**: Every file in `plan.md` was read and compared field-by-field against `contracts/`.

## File-by-File Assessment

### `src/commands/ship.ts` (vs `contracts/ship.md`)

| Contract Method | Classification | Finding |
|---|---|---|
| `shipPhase()` | ✅ implemented | Dispatches WUD, records SQLite, writes manifest. Fully functional. |
| `shipCommand` action (FR-013) | ✅ implemented | All-phases sequential dispatch with stop-on-failure. |
| `isPhaseComplete()` (FR-014) | **missing** | Phase-skip logic exists inline but only checks `status === "completed"`. Spec requires `"cancelled"` to also count as terminal. Not extracted as a reusable function. |
| `assembleDigest()` (FR-012, FR-017) | **greenfield** | Does not exist. No code reads `.events` sidecar or produces `digest[]`. |
| Manifest `digest[]` field | **missing** | `ExecutionManifestSchema` in `manifest.ts` lacks `digest` field. `writeManifest()` call in `ship.ts` does not pass `digest`. |
| `--format json` (FR-015) | **greenfield** | No JSON output mode exists. Output is human-only via `utils/format.js`. |
| `[exit:N \| Xs]` wrapper (FR-015) | **greenfield** | ADR-004 output wrapper not implemented. |
| FR-009 fail-fast | **wrong** | Falls through to undefined config silently when `.gwrkrc.json` is missing `agents.implement`. Should crash via Zod fail-fast. |

---

### `src/utils/manifest.ts` (vs `contracts/ship.md` § Manifest Schema)

| Item | Classification | Finding |
|---|---|---|
| `ExecutionManifestSchema` | **missing** | Schema lacks `digest: z.array(z.string())`. All other fields present and correct. |
| `writeManifest()` | ✅ implemented | Writes to `specs/<feature>/.gwrk/runs/`, validates via Zod. |
| `loadManifests()` | ✅ implemented | Reads and validates all manifests for a feature. |
| `generateRunId()` | ✅ implemented | Produces `<timestamp>_<command>_p<phase>`. |

---

### `scripts/dev/work-until-done.sh` (vs `contracts/wud.md`)

| Contract Item | Classification | Finding |
|---|---|---|
| State machine (FR-004) | ✅ implemented | `BRANCH_SETUP → IMPLEMENTING → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE`. |
| State persistence (FR-008) | ✅ implemented | `save_state()` / `load_state()` to `.state` JSON. |
| `run_implement()` (FR-004) | ✅ implemented | Agent dispatch, SIGINT handling, retry on failure. |
| `run_code_review()` (FR-005) | ✅ implemented | Agent dispatch + verdict check. |
| `run_uat_review()` (FR-005) | ✅ implemented | Agent dispatch + verdict check. |
| `run_pr_and_ci()` (FR-006) | ✅ implemented | `gh pr create`, CI wait. |
| Circuit breaker (FR-007) | ✅ implemented | `MAX_ITERATIONS` check at each NO-GO. |
| Log file (FR-010) | ✅ implemented | `$WUD_LOG` in `$RUNS_DIR/`. |
| Pre-flight gate check (FR-003) | **greenfield** | No code reads `tasks.json` gate scripts or executes them before implementation. |
| Staging validation call (FR-016) | **missing** | `validate-staging.sh` exists but WUD never calls it. |
| `.events` sidecar emission (FR-017) | **greenfield** | No `emit_event()` function. No sidecar file produced. |
| `failureContext` on CIRCUIT_BREAK (FR-018) | **missing** | `save_state("CIRCUIT_BREAK", ...)` writes only `stage` and `iteration`. No `failureContext` object. |

---

### `scripts/dev/wud-branch.sh` (vs `contracts/branch.md`)

| Contract Item | Classification | Finding |
|---|---|---|
| Branch resolution | ✅ implemented | Local → remote → create from develop. |
| Push action | ✅ implemented | `--force-with-lease` with retry. |
| Dirty-tree guard (FR-002) | **greenfield** | No `git status --porcelain` check exists. |

---

### `scripts/dev/validate-staging.sh` (vs `contracts/implement.md`)

| Contract Item | Classification | Finding |
|---|---|---|
| Orphan file check | ✅ implemented | |
| Orphan spec dir check | ✅ implemented | |
| Out-of-scope file check | ✅ implemented | |
| Build plan protection | ✅ implemented | |
| Integration with WUD | **missing** | Script works correctly in isolation but is never invoked by any orchestrator. |

---

### `scripts/dev/wud-verdict.sh` (vs `contracts/verdict.md`)

| Contract Item | Classification | Finding |
|---|---|---|
| GO/NO-GO verdict | ✅ implemented | Reads `tasks.json`, checks phase task statuses. |

---

## Summary of Gaps

| Classification | Count | Items |
|---|---|---|
| **greenfield** | 5 | `assembleDigest()`, `--format json`, `[exit:N\|Xs]` wrapper, pre-flight gate runner, dirty-tree guard, `.events` sidecar |
| **missing** | 4 | `isPhaseComplete()` cancelled handling, manifest `digest[]` field, staging validation call in WUD, `failureContext` in state |
| **wrong** | 1 | FR-009 config fail-fast (silent fallthrough instead of crash) |
| **implemented** | 19 | Core state machine, dispatch, reviews, PR/CI, logging, manifest writes, branch management |

**Next**: User approval of this gap analysis, then proceed to Step 3 (tasks.json + gates generation).
