## UAT: Phase phase-05 — NO-GO

### User Story Results
| Story | Criterion | Verdict | Notes |
|-------|-----------|---------|-------|
| US-011 | Execute a Built-in Workflow | FAIL | WorkflowRuntime fails to parse agent output because `dispatchToAgent` in `src/utils/agent.ts` does not capture `stdout`/`stderr`. |
| US-013 | DefineOrchestrator Loop | FAIL | `DefineOrchestrator` still starts at `PLAN_TO_TASKS` and lacks `SPECIFY`/`PLAN` stages, despite T028 being marked completed. |
| US-014 | Provision Global Home | FAIL | `gwrk init` still creates `.agents/` and `.specify/` in the project root and does not provision `~/.gwrk/plugins/`. |

### Visual Fidelity
N/A (CLI tool)

### Evidence
- Error: `Workflow output failed schema constraint: Expected JSON object.`
- Log from `gwrk define my-feature`: `Starting Define Loop: PLAN_TO_TASKS`
- Directory check: `.agents/` created by `gwrk init`.

### Next Steps
1. FIX `dispatchToAgent` in `src/utils/agent.ts` to capture and return `stdout`/`stderr`. This is a BLOCKING bug.
2. Properly implement `DefineOrchestrator` stages as per previous review notes in T028.
3. Update `gwrk init` to match the new global plugin home mandate.
4. Stop mocking `WorkflowRuntime` in integration tests (T031).
