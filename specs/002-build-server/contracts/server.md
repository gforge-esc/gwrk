# Contract: Server Lifecycle

**Feature**: 002-build-server
**Scope**: Fastify daemon bootstrap, graceful shutdown, PID management

---

## `startServer(config: GwrkConfig): Promise<FastifyInstance>`

**Source**: `src/server/index.ts`
**Consumed by**: `src/commands/server.ts`

Bootstraps the Fastify server, registers all routes, binds to `config.server.host:config.server.port`, writes PID file, and returns the Fastify instance.

```typescript
async function startServer(config: GwrkConfig): Promise<FastifyInstance>
```

**Pre-conditions**:
- No existing server running (checked via PID file)
- Docker daemon reachable

**Post-conditions**:
- Server listening on configured host:port
- `.gwrk/server.pid` written with process ID
- `/health` returns HTTP 200

**Error states**:
| Condition | Behaviour |
|---|---|
| Port in use | Throws `ServerError('Port N already in use')` |
| Stale PID file (process dead) | Removes stale PID, starts normally |
| Docker unreachable | Throws `ServerError('Docker daemon not reachable')` |

---

## `stopServer(instance: FastifyInstance): Promise<void>`

**Source**: `src/server/index.ts`
**Consumed by**: `src/commands/server.ts` (via SIGTERM)

Graceful shutdown sequence:
1. Stop accepting new dispatch requests
2. Wait for running sandboxes to complete (30s timeout)
3. Destroy remaining containers via `destroyAllSandboxes()`
4. Remove `.gwrk/server.pid`
5. Close Fastify

```typescript
async function stopServer(instance: FastifyInstance): Promise<void>
```

---

## `writePid(pidPath: string): void`

**Source**: `src/server/pid.ts`
**Consumed by**: `src/server/index.ts`

Writes `process.pid` to the specified path. Creates parent directory if needed.

---

## `readPid(pidPath: string): number | null`

**Source**: `src/server/pid.ts`
**Consumed by**: `src/commands/server.ts`

Reads PID from file. Returns `null` if file doesn't exist. Validates the process is alive via `kill(pid, 0)`.

---

## `removePid(pidPath: string): void`

**Source**: `src/server/pid.ts`
**Consumed by**: `src/server/index.ts`

Removes the PID file. No-op if file doesn't exist.
