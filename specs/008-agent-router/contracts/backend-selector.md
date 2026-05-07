---
type: contract
feature: 008-agent-router
last_modified: "2026-05-07T16:25:00Z"
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
  docs?: ProviderDocs;        // Documentation URLs for human/agent reference
  discoveryMethod?: "manual" | "cli-scrape";  // Default: "manual"
  quotaProbe: QuotaProbeConfig;
  maxConcurrent: number;
  models: ModelEntry[];       // Array order = priority (first match wins per tier)
  reviewModel?: string;       // Optional: override model for review/test tasks (e.g. Codex review_model)
  fallback?: string;
}

interface ProviderDocs {
  models: string;             // URL to model listing/docs
  routing?: string;           // URL to routing/fallback docs (if applicable)
  configuration?: string;     // URL to configuration reference
}

interface ModelEntry {
  name: string;               // Display name, e.g. "gemini-3.1-pro-preview"
  tier: "thinking" | "fast" | "high-context";
  modelFlag?: string;         // CLI flag value for {{model}} substitution
  effort?: string;            // CLI-native effort flag (e.g. Claude --effort "max")
  lastVerified?: string;      // ISO date — when this model was confirmed available
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
2. **Array order defines priority** — first matching model is preferred
3. If preferred-tier match is in cooldown → try next same-tier model, then any model in array order
4. If ALL models in cooldown → return `null` (triggers provider failover)

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
If the model has an `effort` value, appends `--effort <value>` to the rendered command.
If the provider has `reviewModel` set and the task is `review` or `test`, uses the `reviewModel` instead.

```typescript
renderCommand("gemini -p --model {{model}}", "gemini-3.1-pro-preview")
// → "gemini -p --model gemini-3.1-pro-preview"

renderCommand("claude -p --model {{model}} --output-format json", "claude-sonnet-4.6", { effort: "max" })
// → "claude -p --model claude-sonnet-4.6 --output-format json --effort max"
```
