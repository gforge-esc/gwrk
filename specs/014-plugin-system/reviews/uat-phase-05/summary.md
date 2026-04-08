# UAT Review: Phase 05 - DefineOrchestrator & CLI Rewiring

**Verdict**: NO-GO
**Date**: 2026-04-03

## Summary
Phase 05 UAT failed because the rewired CLI commands (`gwrk define spec`, `plan`, `tasks`) are unusable. A critical regression in `src/utils/agent.ts` causes them to fail with `ENOENT` when attempting to resolve built-in workflow names as local file paths. Furthermore, project-local workflow overrides are correctly resolved by the runtime but are NOT visible in `gwrk plugin list --project`.

## Findings

### 1. US-011 - Execute a Built-in Workflow — FAIL
- **Scenario**: Run `gwrk define spec my-feature` in a clean directory.
- **Expected**: `WorkflowRuntime` resolves `gwrk-specify` and executes it.
- **Actual**: `✗ [BLOCKED] ENOENT: no such file or directory, open '/private/tmp/gwrk-uat/gwrk-specify'`.
- **Root Cause**: `src/utils/agent.ts` > `dispatchAgent()` tries to `fs.readFileSync` the workflow name directly.
- **Remediation**: `dispatchAgent` MUST NOT attempt to read the workflow file if it's a plugin name, or MUST be passed the absolute path of the resolved plugin PROMPT.md.

### 2. US-013 - DefineOrchestrator Loop — FAIL
- **Scenario**: Run `gwrk define my-feature` to execute the full loop.
- **Expected**: Transitions through SPEC, PLAN, TASKS.
- **Actual**: Fails on the first stage (SPEC) due to the `ENOENT` issue described in US-011.

### 3. US-015 - Project-Local Workflow Override — PARTIAL PASS
- **Scenario**: Create an override in `.gwrk/plugins/workflows/gwrk-specify/manifest.yaml` and verify resolution.
- **Verification**: `PluginLoader.resolvePlugin()` correctly picks up the override (verified via script).
- **Actual (CLI)**: `gwrk plugin list --project` does NOT show the override version.
- **Root Cause**: `PluginLoader.listPlugins()` only scans global and built-in directories.
- **Remediation**: `PluginLoader.listPlugins()` MUST scan the project-local `.gwrk/plugins/` directory if `projectDir` is provided.

## Next Steps
1. Re-open Phase 03 / T017 (`src/utils/agent.ts`) to fix the `dispatchAgent` plugin resolution bug.
2. Re-open Phase 01 / T002 (`src/plugins/loader.ts`) to fix `listPlugins` project-local scanning.
3. Re-open Phase 05 / T029 (`src/commands/specify.ts` etc.) as they are currently unusable.
