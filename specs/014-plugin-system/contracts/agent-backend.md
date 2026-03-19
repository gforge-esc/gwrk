# Contract: Agent Backend

This contract defines the interface for AgentBackend plugins, as established in ADR-006.

## Service: `AgentBackend`

Plugins implementing this interface must provide an adapter for a specific LLM CLI (Claude, Codex, Gemini).

### `syncGovernance(projectRoot: string, governance: GovernanceContext): Promise<void>`

Generates the CLI-specific context file from the project's source of truth.

- **projectRoot**: Path to the project.
- **governance**: The parsed `.gwrk/agent-context.md` content.
- **Assertion**: MUST use `<!-- gwrk:begin -->` / `<!-- gwrk:end -->` boundary markers.
- **Assertion**: MUST preserve user content outside the markers.

### `dispatch(task: TaskDispatch): { command: string, args: string[], stdin: string, env?: Record<string, string>, streamable: boolean }`

Prepares the execution context for a single agent run.

- **task**: Contains `prompt`, `agent`, `workDir`, `stdin`, `env`.
- **Assertion**: MUST deliver the bulk of context via the `stdin` field ( stdin pipe).
- **Assertion**: MUST NOT use inline `-p "<prompt>"` for large context.

### `parseResult(stdout: string, stderr: string, rawExitCode: number): Promise<TaskResult>`

Normalizes the proprietary CLI output and exit codes into gwrk standard.

- **stdout/stderr/rawExitCode**: Captured from the CLI process.
- **Returns**: `TaskResult` with standardized `exitCode` and `errorType`.
- **Normalization Rules**:
  - Exit `0` -> `success: true`.
  - Exit `1` -> `success: false`.
  - Gemini exit `53` -> `exitCode: 1`, `errorType: "turn_limit"`.
  - Gemini exit `42` -> `exitCode: 2`, `errorType: "usage_error"`.

## Service: `BackendRegistry`

### `getAgentBackend(name: string): AgentBackend`

Resolves the adapter instance for a given agent backend.

- **Resolution Order**:
  1. User-installed plugin at `~/.gwrk/plugins/agents/<name>/`.
  2. Built-in adapter in `src/plugins/builtins/agents/`.
- **Returns**: `AgentBackend` instance.
- **Errors**: `BackendNotFoundError`.

### `syncAllBackends(projectRoot: string): Promise<void>`

Calls `syncGovernance()` for all active/detected backends.

- **Assertion**: Typically called during `gwrk init` and before dispatching.
