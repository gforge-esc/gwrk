# Port and adapter contracts

Ports declare pure boundaries over domain types. Adapters own runtime state, file handles and output streams. Blocked: none.

## Toolchain boundary

Source: `src/ports/toolchain-port.ts` and `src/adapters/toolchain/index.ts`

Phase: Phase 1

```typescript
export interface ToolchainPort {
  readonly language: string;
  readonly sourceExtension: string;
  readonly testExtension: string;
  isSourceFile(filePath: string): boolean;
  isTestFile(filePath: string): boolean;
  colocatedTestCandidates(srcPath: string): string[];
  getBuildCommand(cwd: string): string | null;
  getTestCommand(files?: string[], grepPattern?: string): string | null;
}

export function createToolchainAdapter(
  profile: ProjectProfile,
): ToolchainPort;
```

`src/ports/toolchain-port.ts` exports `ToolchainPort` only. Callers import pure file-classification helpers from `src/domain/test-rules.ts`. `createToolchainAdapter` lives in `src/adapters/toolchain/index.ts` and defaults build discovery to `getBuildCommand(profile, cwd)`.

## Notification and boundary contracts

Source: `src/ports/notification-port.ts` and `src/adapters/notifications/index.ts`

Gate: `tests/helpers/architecture-boundary.ts`

Phase: Phase 2

```typescript
export interface NotificationPayload {
  text: string;
  channel?: string;
  blocks?: unknown[];
  opsOnly?: boolean;
}

export interface NotificationPort {
  notify(payload: NotificationPayload): Promise<void>;
}

export function dispatchNotification(
  payload: NotificationPayload,
  notifier?: NotificationPort,
): Promise<void>;
export function notifyHarvestComplete(
  report: CompressionReport,
  notifier?: NotificationPort,
): Promise<void>;
```

`src/ports/` files import only `type` declarations from `src/domain/` and contracts from `src/ports/`. Notification callers can supply a notifier. The adapter owns the existing Slack default. Remove the unused process-wide registration path after checking its call sites. Adapter barrels in `src/adapters/` expose explicit adapter factories. They do not re-export legacy infrastructure modules.

## SQLite store adapters

Source: `src/db/index.ts` and `src/ports/store-port.ts`

Implementation: `src/adapters/sqlite/index.ts` and `src/engine/plan-store.ts`

Phase: Phase 3

```typescript
export interface SqliteDatabaseOptions {
  dbPath?: string;
  migrationsDir?: string;
}

export interface SqliteStoreOptions extends SqliteDatabaseOptions {
  db?: Database.Database;
}

export interface SqlitePlanStoreOptions extends SqliteStoreOptions {
  projectId: string;
}

export interface PlanStorePort {
  initFromSpecs(
    specsDir: string,
  ): Promise<{ added: number; skipped: number; phases: number }>;
  renderToMarkdown(outputPath: string): Promise<void>;
  close(): void;
}

export interface RunStorePort {
  recordCompression(report: CompressionReport, projectId: string): void;
  close(): void;
}

export function openDatabase(options?: SqliteDatabaseOptions): Database.Database;
export function createSqlitePlanStoreAdapter(
  options: SqlitePlanStoreOptions,
): PlanStorePort;
export function createSqliteRunStoreAdapter(
  options?: SqliteStoreOptions,
): RunStorePort;
```

Each adapter preserves its `Database.Database` handle on the instance. Adapters that open their own connection close it on `close()`. Adapters that receive an external `db` handle leave that handle open on `close()`. `PlanStore` accepts an optional `Database.Database` handle and forwards it only when supplied.

## Scoped CLI output

Source: `src/adapters/cli/output-scope.ts` and `src/cli.ts`

Consumers: `src/utils/output.ts`, `src/utils/format.ts` and `src/utils/signal.ts`

Phase: Phase 4

```typescript
export interface CliOutputScope {
  agentMode: boolean;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
}

export interface RunCliOptions {
  agentMode?: boolean;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
}

export function runWithOutputScope<T>(
  scope: CliOutputScope,
  fn: () => Promise<T> | T,
): Promise<T> | T;
export function getOutputScope(): CliOutputScope | undefined;
export function writeScopedStdout(chunk: string): void;
export function writeScopedStderr(chunk: string): void;
export function writeScopedLine(line: string): void;
export function createCliProgram(): Command;
export function runCli(argv: string[], options?: RunCliOptions): Promise<number>;
```

`src/cli.ts` never mutates `process.stdout.write`. `runWithOutputScope` applies `processForAgent` only inside an active `agentMode` scope. Normal commands in the same process emit unmodified ANSI text and full output. Operational `[exit:N | Xs]` signals stay on stderr.

Each invocation owns its parser and output scope. All CLI output paths honor that scope. Concurrent command tests exercise raw output and formatted output. The process working directory stays fixed.
