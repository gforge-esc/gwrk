# Contract: Dispatch Queue

**Feature**: 002-build-server
**Scope**: FIFO dispatch queue with retry and backend escalation

---

## `class DispatchQueue`

**Source**: `src/server/dispatch.ts`
**Consumed by**: `src/server/routes/dispatch.ts`

Manages the lifecycle of all dispatch requests: queuing, execution, retry, and escalation.

### `constructor(deps: DispatchDeps)`

```typescript
interface DispatchDeps {
  config: GwrkConfig;
  sandbox: { createSandbox, destroySandbox };
  gitManager: { createPhaseBranch, mergePhaseBack };
  context: { compileContext, writeContextToSandbox };
  monitor: { isThrottled };
  persist: { persistDispatch };
}
```

### `enqueue(request: DispatchRequest): DispatchRecord`

Validates the request, creates a `DispatchRecord` with `status: "queued"`, persists to `dispatches.jsonl`, and triggers `processNext()`.

```typescript
interface DispatchRequest {
  featureId: string;
  phaseId: string;
  backend: AgentBackend;
}

function enqueue(request: DispatchRequest): DispatchRecord
```

**Error states**:
| Condition | Throws |
|---|---|
| Invalid backend | `DispatchError('Unknown agent backend: <backend>')` |
| Feature not found | `DispatchError('Feature <featureId> not found in specs/')` |

### `processNext(): Promise<void>`

Dequeues the next `queued` dispatch if under `maxClones` limit and system is not throttled. Creates the sandbox and starts the agent. Updates status to `running`.

If throttled: no-op (the queued dispatch stays in queue; `processNext()` will be called again on next monitor tick).

### `handleCompletion(dispatchId: string, exitCode: number, stderr: string): Promise<void>`

Called when an agent sandbox exits. Records the attempt. If `exitCode !== 0`:
1. Retry up to 3× on the same backend
2. On 4th failure, escalate to next backend in `config.agents.fallbackOrder`
3. If all backends exhausted, set status to `failed`

If `exitCode === 0`, set status to `completed`, trigger `mergePhaseBack()`.

### `getQueue(): { active: DispatchRecord[]; queued: DispatchRecord[]; throttled: boolean }`

Returns the current queue state for the `/api/dispatch/queue` endpoint.

### `getDispatch(featureId: string, phaseId: string): DispatchRecord | null`

Returns the dispatch record for a specific feature/phase combination.

---

## `persistDispatch(record: DispatchRecord): void`

**Source**: `src/server/persistence.ts`
**Consumed by**: `src/server/dispatch.ts`

Appends a JSON line to `.gwrk/dispatches.jsonl`. Creates the file if it doesn't exist.

```typescript
function persistDispatch(record: DispatchRecord): void
```
