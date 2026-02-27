# Contract: System Monitor

**Feature**: 002-build-server
**Scope**: System resource sampling, dispatch throttle decisions

---

## `class SystemMonitor`

**Source**: `src/server/monitor.ts`
**Consumed by**: `src/server/dispatch.ts`, `src/server/routes/status.ts`

Periodically samples system resources and exposes throttle decisions based on `.gwrkrc.json` parallelism limits.

### `constructor(config: GwrkConfig)`

Initializes the monitor with configured thresholds from `config.parallelism.local`.

### `sample(): SystemResources`

Returns current system resources snapshot.

```typescript
interface SystemResources {
  cpuPercent: number;      // 0-100
  memPercent: number;      // 0-100
  diskFreeGb: number;      // Free disk in GB
}
```

Implementation: Uses `os.cpus()` for CPU, `os.freemem()/os.totalmem()` for memory, `child_process.execSync('df -BG /')` for disk.

### `isThrottled(): boolean`

Returns `true` if any resource exceeds configured limits:
- `cpuPercent > config.parallelism.local.maxCpu`
- `memPercent > config.parallelism.local.maxMem`
- `diskFreeGb < config.parallelism.local.minDiskGb`

### `startPolling(intervalMs: number): void`

Starts periodic sampling at the specified interval (default: 10000ms). Resources are cached between samples.

### `stopPolling(): void`

Stops the polling interval. Called during graceful shutdown.

### `getStatus(): SystemStatus`

Returns the full `SystemStatus` object for the `/api/status` route.

```typescript
function getStatus(): SystemStatus
```

See spec DM-003 for the `SystemStatus` interface definition.
