# Code Review: NO-GO
## Phase 04: WorkflowRuntime (Layer 2.5 - F014-R)

### Summary
The core components of the WorkflowRuntime and IntentEngine have been implemented, and all basic functional gates pass. However, several critical architectural and security requirements from the spec and plan are currently unmet, specifically regarding strict schema validation, test isolation, and plugin resolution.

### Task Verdicts
- **T022: Implement src/plugins/workflow-runtime.ts** -> **FAIL**
  - Missing strict Zod/JSON Schema validation for agent output against `manifest.outputSchema`.
  - Presence of `any` types in critical paths.
- **T023: Implement src/engine/intent-engine.ts** -> **FAIL**
  - Presence of `any` types in catch blocks and type casting.
- **T024: Implement src/plugins/builtins/workflows/** -> **PASS**
  - All 10 core workflows are present with valid manifests and prompts.
- **T025: Implement src/plugins/workflow-runtime.test.ts** -> **FAIL**
  - Mocks hide the lack of required local directory scanning in the underlying `PluginLoader`.
- **T026: Implement src/engine/intent-engine.test.ts** -> **FAIL**
  - **CRITICAL**: Missing mocks for `fs` and `child_process`. Tests perform actual mutations on `/tmp/intent-test`.
- **T027: Implement test strategy for Phase 4** -> **PASS** (Bookkeeping)

### Detailed Findings

#### 1. Missing Strict Schema Validation (FR-L25-001)
The `WorkflowRuntime` currently only performs basic manual checks for the presence of the `intents` array. The spec requires that agent output be strictly validated against the Zod-backed `outputSchema` defined in the manifest.
**Remediation**: Integrate `ajv` or a similar validator to enforce the `outputSchema` contract before executing intents.

#### 2. Test Isolation Violation (TR-011)
`src/engine/intent-engine.test.ts` is currently executing as an integration test with side effects on the host filesystem. This violates the isolation requirements for unit tests and poses a risk to the development environment.
**Remediation**: Mock `node:fs/promises` and `node:child_process` in the test file.

#### 3. Plugin Resolution Gap (FR-L25-006)
While `WorkflowRuntime` is intended to support local workflow overrides in `.gwrk/plugins/workflows/`, the current `PluginLoader` implementation does not scan this directory automatically.
**Remediation**: Update `PluginLoader.ts` to include the project-local plugin directory in its resolution scan.

### Next Steps
1. Fix the critical test isolation issue in `intent-engine.test.ts`.
2. Implement strict output validation in `workflow-runtime.ts`.
3. Resolve the `any` type violations across Phase 4 files.
4. Update `PluginLoader` to support automatic local workflow discovery.
5. Run `/implement specs/014-plugin-system phase-04` to address these re-opened tasks.
