# Contract: Workflow Runtime

This contract defines the methods for executing gwrk workflows via the JSON Intent engine (Layer 2.5), as established in F014-R.

## Service: `WorkflowRuntime`

### `executeWorkflow(name: string, input: string, options?: WorkflowOptions): Promise<WorkflowResult>`

Resolves a workflow from built-ins or project-local overrides and executes it via an agent.

- **name**: Workflow name (e.g., `gwrk-specify`).
- **input**: Initial prompt/context for the workflow.
- **Options**: `projectRoot`, `agent`, `model`.
- **Assertion**: MUST resolve workflow following order: `.gwrk/plugins/workflows/` -> `~/.gwrk/plugins/workflows/`.
- **Assertion**: MUST validate agent output against the workflow's `outputSchema`.
- **Returns**: `WorkflowResult` containing the summary and list of executed intents.

### `resolveWorkflow(name: string, projectRoot?: string): Promise<WorkflowManifest>`

Internal method to find the manifest for a workflow.

- **Returns**: `WorkflowManifest`.
- **Errors**: `WorkflowNotFoundError`.

## Service: `IntentEngine`

### `executeIntents(intents: JsonIntent[], projectRoot: string): Promise<IntentSummary[]>`

Executes a list of JSON intents (filesystem mutations) natively.

- **intents**: Array of `{ action: 'WRITE_FILE' | 'CREATE_DIR' | 'RUN_COMMAND', ... }`.
- **projectRoot**: Root directory for relative paths.
- **Assertion**: MUST block any file operation outside the `projectRoot`.
- **Assertion**: `WRITE_FILE` MUST create parent directories if missing.
- **Assertion**: `RUN_COMMAND` MUST execute in the context of the `projectRoot`.

## Service: `DefineOrchestrator`

### `runLoop(specPath: string): Promise<void>`

A TypeScript state machine that manages the development loop.

- **States**: `SPEC`, `PLAN`, `TASKS`, `ANALYZE`.
- **Workflow Mapping**:
  - `SPEC` -> `gwrk-specify`
  - `PLAN` -> `gwrk-plan`
  - `TASKS` -> `gwrk-plan-to-tasks`
- **Assertion**: MUST use `WorkflowRuntime` for all stage transitions.
- **Assertion**: MUST allow the user to confirm/cancel after each stage.
