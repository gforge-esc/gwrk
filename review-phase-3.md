## Code Review: Phase 3 — NO-GO

### Results
| Task | Title | Verdict | Notes |
|------|-------|---------|-------|
| T016 | Implement src/commands/tasks.ts | FAIL | [BLOCKER] `tasks generate` is not idempotent (positional-dependent) and resets progress if plan structure shifts. While it tries to match by title, it is sensitive to the plan order and phase mapping. |
| T017 | Implement src/utils/state.ts | PASS | Solid implementation with Zod and atomic writes. |
| T018 | Implement src/utils/parser.ts | PASS | Plan parser correctly extracts phases and tasks. |
| T019 | Implement src/utils/gate-gen.ts | FAIL | [BUG] `gate-gen.ts` fails to generate working gates for negative assertions (e.g. `exits 1`) because it does not wrap them in logic that expects failure (e.g., `! command` or `|| true`). |
| T020 | Implement src/utils/history.ts | PASS | Correct JSONL history logging with Zod validation. |
| T021 | Implement test strategy for Phase 3 | FAIL | Verification failed because the generated gate (T021) contains assertions that correctly fail (as intended by the spec) but cause the gate script to exit due to `set -euo pipefail`. |

### Lint
- **Status**: CLEAN (Auto-fixed)
- **Note**: Applied `biome check --write` to fix formatting in `specs/001-cli-core/.gwrk/tasks.json`.

### Tests
- **Status**: PASS
- **Command**: `pnpm test`
- **Results**: 11 files passed, 30 tests passed (All Phase 3 tests: TR-004, TR-006, TR-007).

### Gates
- **Status**: NO-GO
- **T021**: FAIL (Bad gate generation logic for failure-path assertions).
- Others: PASS (T016-T020).

### Findings & Blockers
1. **[BLOCKER] Non-Idempotent `tasks generate`**: As identified in UAT, the implementation in `src/commands/tasks.ts` can be destructive if the plan structure changes. Even when matching by title, it is tied to specific phases and positional IDs.
2. **[BUG] Negative Assertions in Gates**: `src/utils/gate-gen.ts` blindly appends "Done When" assertions to the gate script. For assertions like `...exits 1`, this results in a command that terminates the script. The generator needs to handle `exits N` or similar phrases specifically.

### Next Steps
1. Re-open Phase 3 and task T016 to fix the idempotency/merge logic.
2. Re-open Task T019 to improve `gate-gen.ts` handling of complex/negative assertions.
3. Re-open Task T021 to ensure it can pass once the generator is fixed.
