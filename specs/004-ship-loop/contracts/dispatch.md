# Contract: Plugin Dispatch Boundary

> **FR-019 / FR-020 / FR-021 · ADR-006 §2.1**
> **File:** `src/utils/agent.ts`

## Purpose

Single dispatch facade for all agent work. Today wraps `spawn(cli, args)`. When F014 ships, internals are replaced by `pluginRegistry.getAgentBackend().dispatch()` — no other code changes.

## Signatures

### `dispatchToAgent(task: TaskDispatch): Promise<TaskResult>`

Dispatches a unit of agent work and returns a normalized result.

### `TaskDispatch` (input)

```typescript
interface TaskDispatch {
  prompt?: string;
  agent?: AgentBackend | string;
  workDir?: string;
  stdin?: string;               // FR-021: stdin pipe delivery
  env?: Record<string, string>;
  workflow?: string;
  featureDir?: string;
}
```

### `TaskResult` (output)

```typescript
interface TaskResult {
  exitCode: number;    // 0 = success, 1 = expected failure, 2 = usage error, 127 = not found
  errorType?: string;  // Classified: "turn_limit", "rate_limit", "auth", "timeout", etc.
  stdout: string;
  stderr: string;
  durationS: number;
  logPath?: string;
}
```

## exit code mapping (FR-020)

### errorTypes

| Raw Code | Mapped exitCode | errorType | Source |
|----------|----------------|-----------|--------|
| 0 | 0 | — | All CLIs |
| 1 | 1 | — | All CLIs |
| 2 | 2 | — | All CLIs |
| 53 | 1 | `turn_limit` | Gemini CLI |
| 126 | 1 | `permission_denied` | POSIX |
| 127 | 127 | — | POSIX (command not found) |
| 137 | 1 | `killed` | SIGKILL |
| 143 | 1 | `terminated` | SIGTERM |
| Other >2 | 1 | — | Unknown |

## Context delivery — stdin pipe (FR-021)

- **Required:** stdin pipe (`child.stdin.write()`)
- **Forbidden:** inline `-p "<prompt>"` for context >4096 bytes (ARG_MAX risk)
- All three CLIs accept stdin (verified)

## Invariants

1. Ship loop MUST NOT spawn CLI processes directly — all dispatch through `dispatchToAgent()`
2. Exit code 127 is POSIX-reserved for "command not found" — never overloaded
3. `errorType` is informational — caller decides retry/abort based on `exitCode`

## Plugin migration path

```
Today:     dispatchToAgent() → buildCommand() → spawn(cli, args)
F014:      dispatchToAgent() → pluginRegistry.getAgentBackend().dispatch()
```

No consumers change. Only the facade internals are swapped.
