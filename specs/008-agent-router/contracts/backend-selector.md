---
type: contract
feature: 008-agent-router
last_modified: "2026-05-07T15:48:00Z"
---

# Contract: Backend Selector

**Feature**: 008-agent-router
**Scope**: Two-dimension routing (provider + model) for the shipping triad

---

## `selectBackend(context): Promise<BackendSelection>`

**Source**: `src/server/backend-selector.ts`
**Consumed by**: 005 `DispatchOrchestrator`, 004 `src/commands/ship.ts`

Selects the best available backend AND model based on quota remaining and task classification.

```typescript
interface BackendSelector {
  selectBackend(context: TaskContext): Promise<BackendSelection>;
}

interface TaskContext {
  feature: string;
  phase: string;
  taskType: string;     // e.g. "implement", "test", "review", "define"
  language: string;     // Primary language of phase files
  taskSP: number;       // Story point weight
}

interface BackendSelection {
  backend: string;      // Registry key, e.g. "codex"
  model: string;        // e.g. "gemini-3.1-pro-preview"
  taskClassification: string;  // e.g. "thinking", "fast", "high-context"
  reason: string;       // e.g. "quota: 100% (fresh probe), model: thinking tier"
  quotaPercent: number;
  probeStatus: "fresh" | "cached" | "timeout-assumed-available";
  fallback?: string;    // Next backend if this one fails
  modelFailoverUsed: boolean;  // true if preferred model was in cooldown
}
```

### Selection Algorithm (Two-Level)
1. Load registry from `.gwrkrc.json`
2. Classify task → `TaskClassification` (thinking, fast, high-context)
3. Probe quota for each provider (cached or fresh)
4. Filter to available providers (quota > 0%, not in cooldown)
5. Sort by quota descending
6. If top candidates within 20% of each other → tiebreak by SQLite success rate
7. **Model selection (Dimension 2)**: Select model matching task tier from provider's `models[]`
8. If preferred-tier model is in cooldown (recent 429) → try next model in array (model failover)
9. If ALL models in provider are in cooldown → try next provider (provider failover)
10. Render command template: replace `{{model}}` with selected `modelFlag`
11. Return `BackendSelection` with provider + model
12. Record decision in `routing_decisions` table

### Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No backends configured | `No backends in registry` | 1 |
| All backends at 0% | `All backends quota-exhausted` | 1 |
| All models 429 + all providers exhausted | `All backends and models exhausted` | 1 |

---

## `loadRegistry(): AgentRegistry`

**Source**: `src/server/agent-registry.ts`
**Consumed by**: `backend-selector.ts`, `quota-prober.ts`

```typescript
interface AgentRegistry {
  backends: Record<string, AgentBackendConfig>;
  fallbackOrder: string[];
}

interface AgentBackendConfig {
  name: string;
  type: "local-cli" | "cloud";
  command: string;            // Template with {{model}} placeholder
  quotaProbe: QuotaProbeConfig;
  maxConcurrent: number;
  models: ModelEntry[];
  fallback?: string;
}

interface ModelEntry {
  name: string;               // Display name, e.g. "gemini-3.1-pro-preview"
  tier: "thinking" | "fast" | "high-context";
  modelFlag?: string;         // CLI flag value for {{model}} substitution
}

interface QuotaProbeConfig {
  method: "interactive-scrape" | "shared-pool" | "optimistic";
  command?: string;           // CLI to launch (e.g. "gemini")
  sendKeys?: string;          // Interactive command (e.g. "/stats session")
  parseRegex?: string;        // Regex to extract percentage
  invertPercent?: boolean;    // true for "N% used" → (100-N)% remaining
  sharedWith?: string;        // Backend key whose probe to reuse (e.g. "codex")
  cacheTTLMinutes: number;
}
```

---

## `probeQuota(backend): Promise<QuotaReading>`

**Source**: `src/server/quota-prober.ts`
**Consumed by**: `backend-selector.ts`

```typescript
interface QuotaReading {
  percent: number;            // 0-100, remaining
  resetsIn: string;           // e.g. "16h 5m"
  probedAt: string;           // ISO timestamp
  status: "fresh" | "cached" | "shared-pool" | "timeout-assumed-available";
}
```

### Probe Strategies (in order)
1. **Cache hit**: If cached reading within TTL → return immediately
2. **Interactive scrape**: Launch CLI in tmux → send keys → parse output → extract %
3. **Optimistic fallback**: On timeout (>5s) or parse failure → return `{ percent: 100, status: "timeout-assumed-available" }`

---

## `recordDecision(decision): void`

**Source**: `src/server/routing-decisions.ts`
**Consumed by**: `backend-selector.ts` (called after every selection)

Inserts a row into the `routing_decisions` SQLite table.

---

## `selectModel(models, classification, cooldowns): ModelEntry`

**Source**: `src/server/model-selector.ts`
**Consumed by**: `backend-selector.ts`

```typescript
interface ModelSelector {
  selectModel(
    models: ModelEntry[],
    classification: TaskClassification,
    cooldowns: Map<string, Date>  // model name → cooldown expiry
  ): ModelEntry | null;  // null = all models in cooldown
}

type TaskClassification = "thinking" | "fast" | "high-context";
```

### Selection Logic
1. Filter `models[]` to entries matching `classification` tier
2. If preferred-tier match is in cooldown → try other models in array order
3. If ALL models in cooldown → return `null` (triggers provider failover)

---

## `classifyTask(taskType): TaskClassification`

**Source**: `src/server/task-classifier.ts`
**Consumed by**: `backend-selector.ts`

```typescript
const TASK_TO_TIER: Record<string, TaskClassification> = {
  implement: "thinking",
  test: "fast",
  review: "thinking",
  define: "high-context",
  remediation: "thinking",
};
```

### Default Behavior
Unknown task types default to `"thinking"` (safest choice).

---

## `renderCommand(template, modelFlag): string`

**Source**: `src/server/model-selector.ts`
**Consumed by**: invocation strategy

Substitutes `{{model}}` in command template with selected model's `modelFlag`.

```typescript
renderCommand("gemini -p --model {{model}}", "gemini-3.1-pro-preview")
// → "gemini -p --model gemini-3.1-pro-preview"
```
