## UAT: Phase phase-05 — NO-GO

### User Story Results
| Story | Criterion | Verdict | Notes |
|-------|-----------|---------|-------|
| US-011 | Execute a Built-in Workflow | FAIL | `gwrk-plan-to-tasks` produces invalid `tasks.json` schema (missing featureId, gateScript, etc.). `gwrk-analyze` plugin is missing or not resolvable. |
| US-012 | Decoupled Filesystem Mutation | PASS | `WorkflowRuntime` correctly executed `WRITE_FILE` and `CREATE_DIR` intents via the native `IntentEngine`. |
| US-013 | DefineOrchestrator Loop | FAIL | `DefineOrchestrator` skips `SPECIFY` and `PLAN` stages, starting directly at `PLAN_TO_TASKS`. It also crashes (process.exit(1)) when `tasks.json` validation fails. |

### Visual Fidelity
N/A (CLI-only feature)

### Evidence
- Log from `gwrk define dummy-feature`:
  ```
  Starting Define Loop: PLAN_TO_TASKS
  Stage: PLAN_TO_TASKS
  ...
  Stage: ANALYZE
    Warning: ANALYZE stage skipped or failed: Plugin 'gwrk-analyze' not found.
  Stage: DEFINE_TESTS
  Task state error in .../tasks.json: [
    { "code": "invalid_type", "expected": "string", "received": "undefined", "path": ["featureId"], "message": "Required" },
    ...
  ]
  Exit Code: 1
  ```

### Next Steps
1. **Fix Orchestrator (T028)**: Update `src/engine/define-orchestrator.ts` to include `SPECIFY` and `PLAN` stages in `initializeState` and `getNextStage`.
2. **Harden Schema (T028)**: Improve error handling in `DefineOrchestrator` when `tasks.json` is invalid instead of allowing `process.exit(1)`.
3. **Expand Tests (T030)**: Add coverage for `SPECIFY` and `PLAN` stages in `src/engine/define-orchestrator.test.ts`.
4. **Fix Test Boundary (T031)**: Update `specify.test.ts` and `plan.test.ts` to use actual `WorkflowRuntime` and mock only `AgentBackend` to catch integration bugs.
5. **Prompt Engineering (T024 - Phase 4)**: The `gwrk-plan-to-tasks` workflow must be instructed (via PROMPT.md) to generate `tasks.json` that strictly matches the `TaskStateSchema` (including `featureId`, `createdAt`, `gateScript`, etc.).
