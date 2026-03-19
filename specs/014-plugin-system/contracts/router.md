# Contract: Agent Router

This contract defines the intelligence layer for selecting the optimal agent backend for a given task.

## Service: `AgentRouter`

### `selectBackend(task: TaskRequest): Promise<AgentBackend>`

Determines the optimal backend for a specific task based on heuristics and historical data.

- **TaskRequest**: Contains `type` (implementation, review, definition, refactor), `size` (SP), `priority`.
- **Heuristics**:
  - `implement` -> Codex Cloud (parallelism).
  - `refactor` -> Claude Code (context window).
  - `definition` -> Gemini CLI (structured generation).
- **Fallback Chain**: MUST follow the `fallbackOrder` defined in `.gwrkrc.json`.
- **Historical Learning**:
  - Query SQLite `runs` table: success rate x task type x backend.
  - Penalize backends with recent failures (exponential backoff).
- **Returns**: `AgentBackend` instance.
- **Errors**: `NoAvailableBackendError` (when all fallbacks exhausted).

### `probeQuota(backend: AgentBackend): Promise<QuotaStatus>`

Asks the backend adapter for its current capacity.

- **Returns**: `QuotaStatus { available: boolean, reason?: string, retryAfter?: number }`.
- **Logic**: Each adapter knows how to probe its own CLI (e.g., Gemini `429` status).

## Service: `RoutingLedger`

### `recordDecision(decision: RoutingDecision): Promise<void>`

Inserts a record into the `routing_decisions` SQLite table.

- **Decision**: `taskId`, `backend`, `reason`, `attempts`.
