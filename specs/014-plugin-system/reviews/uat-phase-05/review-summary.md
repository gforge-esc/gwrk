## UAT: Phase phase-05 — NO-GO

### User Story Results
| Story | Criterion | Verdict | Notes |
|-------|-----------|---------|-------|
| US-011 | Execute a Built-in Workflow | FAIL | `gwrk define spec` fails with `ENOENT` in `dispatchAgent` (src/utils/agent.ts:99) when resolving built-in workflows by name. |
| US-013 | DefineOrchestrator Loop | FAIL | `gwrk define` fails with `ENOENT` when attempting to invoke the `PLAN_TO_TASKS` workflow. |
| US-015 | Project-Local Workflow Override | PASS | Project-local overrides in `.gwrk/plugins/workflows/` are correctly resolved by the `PluginLoader`. |

### Visual Fidelity
N/A (CLI project)

### Evidence
- `specs/014-plugin-system/reviews/uat-phase-05/failure-US-011.log`
- `specs/014-plugin-system/reviews/uat-phase-05/failure-US-013.log`

### Next Steps
1. Fix `dispatchAgent` in `src/utils/agent.ts` to skip `readFileSync` if `workflowPath` is a plugin name instead of a file path (already tracked in T017).
2. Update E2E tests in `src/commands/specify.test.ts` and `src/commands/plan.test.ts` to verify real dispatch without mocking the `WorkflowRuntime` boundary.
3. Re-run `/gwrk-review-uat specs/014-plugin-system Phase phase-05`.
