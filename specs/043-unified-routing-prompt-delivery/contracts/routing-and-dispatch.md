# Routing and dispatch contracts

Domain policy owns pure backend and model selection. The agent port, workflow runtime and built-in adapters enforce complete prompt transport and equivalent output normalization. Blocked: none.

## Unified routing policy and agent port

Source: `src/domain/agent-routing.ts`, `src/ports/agent-port.ts` and `src/adapters/agents/index.ts`

Phase: Phase 1, Phase 2 and Phase 3

```typescript
export interface BackendQuotaSnapshot {
  percent: number;
  probeStatus: "fresh" | "cached" | "optimistic" | "failed";
}

export interface HistoricalBackendStat {
  backend: string;
  runs: number;
  successRate: number;
}

export interface RoutingFacts {
  explicitBackend?: string;
  explicitModel?: string;
  pillarConfig?: Partial<Record<string, string>>;
  availableBackends?: string[];
  registry?: AgentRegistry;
  quotas?: Record<string, BackendQuotaSnapshot>;
  history?: HistoricalBackendStat[];
  cooledDownModels?: Readonly<Record<string, readonly string[]>>;
  defaultBackend?: string;
}

export interface RouteSelectionDecision {
  backend: string;
  model: string;
  mode: "selected" | "provider-default";
  reason: string;
  effort?: string;
  quotaPercent?: number;
  probeStatus?: "fresh" | "cached" | "optimistic" | "failed";
  fallbackUsed: boolean;
  modelFailoverUsed: boolean;
}

export interface RoutingContext {
  type: string;
  runId?: string;
  skillName?: string;
  feature?: string;
  phase?: string;
  preferredAgent?: string;
  explicitModel?: string;
  language?: string;
  taskSP?: number;
}

export interface SelectedAgentRoute {
  backend: string;
  model: string;
  mode: "selected" | "provider-default";
  reason: string;
  effort?: string;
  quotaPercent?: number;
  probeStatus?: "fresh" | "cached" | "optimistic" | "failed";
  fallbackUsed?: boolean;
  modelFailoverUsed?: boolean;
}

export interface AgentPortAdapterOptions {
  projectRoot?: string;
  db?: Database.Database;
  recordDecisions?: boolean;
}

export function selectAgentRoute(
  context: RoutingContext,
  facts: RoutingFacts,
): RouteSelectionDecision;

export function createAgentPortAdapter(
  options?: AgentPortAdapterOptions,
): AgentPort;
```

The pure `selectAgentRoute` function lives in `src/domain/agent-routing.ts`. It touches no files or databases. It evaluates explicit overrides and skill preferences first. It then checks historical success rates and configured pillar defaults. Next it applies registry quota tiebreakers and `fallbackOrder`. Model cooldown failover runs through `ModelSelector`. Runtime callers build `AgentPort` via `createAgentPortAdapter`. That adapter reads config, `tryLoadRegistry` and `QuotaProber`. It also reads SQLite history before calling `selectAgentRoute`. Existing helpers such as `resolveAgent` and `resolveModelForTask` call `selectAgentRoute`. Both `selectBackend` and `BackendSelector` call `selectAgentRoute` too. Server routing shims stay until every caller imports domain or adapter modules directly. The adapter owns invocation commands and flags. An explicit backend still resolves an eligible model for the role. An explicit model failure reports the reason and any configured fallback that the caller permits.

## Workflow runtime and prompt payload transport

Source: `src/plugins/workflow-runtime.ts`, `src/engine/ship-orchestrator.ts` and `src/utils/agent.ts`

Prompts: `src/plugins/builtins/workflows/gwrk-plan/PROMPT.md` and `src/plugins/builtins/workflows/gwrk-implement/PROMPT.md`

Phase: Phase 4

```typescript
export interface WorkflowExecutionOptions {
  projectRoot?: string;
  agent?: string;
  model?: string;
  effort?: string;
  featureDir?: string;
  quiet?: boolean;
  tolerant?: boolean;
  nativeOnly?: boolean;
  reportOnly?: boolean;
  recordedResult?: TaskResult;
  allowedPaths?: string[];
  dispatcher?: (task: TaskDispatch) => Promise<TaskResult>;
}

export interface WorkflowExecutionResult {
  summary: string;
  intents: Intent[];
  summaries: string[];
  logPath?: string;
  output?: unknown;
  taskResult?: TaskResult;
}
```

The workflow runtime resolves `PROMPT.md` and expands `@include` directives. It conditions the prompt for the detected project profile. It attaches user input and populates `task.stdin` before dispatch. When `nativeOnly` is `true`, `WorkflowRuntime` skips `IntentEngine` execution and returns `taskResult`. That mode lets `ShipOrchestrator` keep post-dispatch scope validation, source reversion and gate verification. Meanwhile `SkillRuntime.executeSkill` keeps its separate stdin pipe and raw stdout contract. During transport, `dispatchToAgent` combines `task.prompt` and `task.stdin` into one payload. It expands enforcement skills before adding grounding files and `<command_safety>`. Inline prompts are never duplicated.

## Cross-adapter output parity and recorded recovery

Source: `src/ports/agent-port.ts` and `src/plugins/builtins/agents/{agy,claude,codex}/adapter.ts`

Consumers: `src/plugins/workflow-runtime.ts` and `src/commands/assess.ts`

Phase: Phase 5

```typescript
export interface UnwrappedStreamResult {
  text: string;
  structuredOutput?: Record<string, unknown>;
  isTurnLimit?: boolean;
  isError?: boolean;
  errorMessage?: string;
  usage?: {
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
  };
}

export function unwrapStreamJson(stdout: string): UnwrappedStreamResult;
```

`AgyAdapter`, `ClaudeAdapter` and `CodexAdapter` set `status` to `"success"` or `"failure"` in `parseResult`. Stream-json or Antigravity envelopes can report failure even when raw exit code is `0`. Each adapter recognizes its provider's terminal protocol. An explicit failure terminal takes precedence over generated content and the raw process status. The review fixture contains an Antigravity error terminal with a valid-looking GO result. On terminal failure, `parseResult` sets `status: "failure"` and `exitCode: 1`. Both `WorkflowRuntime.executeWorkflow` and `assessProject` reject `status === "failure"` and non-zero exit codes. Recorded Antigravity responses recover validated assessment findings through `WorkflowRuntime` with zero live dispatches.

Record backend, requested model, requested effort and route mode separately from observed model. Use an unknown observation when the provider omits identity. These fields are the dispatch contract for model qualification.
