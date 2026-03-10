---
type: contract
feature: 008-agent-router
last_modified: "2026-03-10T22:30:00Z"
---

# Contract: Backend Selector

**Feature**: 008-agent-router
**Scope**: Quota-based backend selection for the shipping triad

---

## `selectBackend(context): Promise<BackendSelection>`

**Source**: `src/server/backend-selector.ts`
**Consumed by**: 005 `DispatchOrchestrator`, 004 `src/commands/ship.ts`

Selects the best available backend based on quota remaining.

```typescript
interface BackendSelector {
  selectBackend(context: TaskContext): Promise<BackendSelection>;
}

interface TaskContext {
  feature: string;
  phase: string;
  language: string;     // Primary language of phase files
  taskSP: number;       // Story point weight
}

interface BackendSelection {
  backend: string;      // Registry key, e.g. "codex"
  model: string;        // e.g. "gpt-5.3-codex"
  reason: string;       // e.g. "quota: 100% (fresh probe)"
  quotaPercent: number;
  probeStatus: "fresh" | "cached" | "timeout-assumed-available";
  fallback?: string;    // Next backend if this one fails
}
```

### Selection Algorithm
1. Load registry from `.gwrkrc.json`
2. Probe quota for each backend (cached or fresh)
3. Filter to available backends (quota > 0%, not in cooldown)
4. Sort by quota descending
5. If top candidates within 20% of each other → tiebreak by SQLite success rate
6. Return `BackendSelection` with top candidate
7. Record decision in `routing_decisions` table

### Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No backends configured | `No backends in registry` | 1 |
| All backends at 0% | `All backends quota-exhausted` | 1 |

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
  command: string;
  quotaProbe: QuotaProbeConfig;
  maxConcurrent: number;
  models: string[];
  fallback?: string;
}

interface QuotaProbeConfig {
  method: "interactive-scrape" | "optimistic";
  command?: string;           // CLI to launch (e.g. "gemini")
  sendKeys?: string;          // Interactive command (e.g. "/stats session")
  parseRegex?: string;        // Regex to extract percentage
  invertPercent?: boolean;    // true for "N% used" → (100-N)% remaining
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
  status: "fresh" | "cached" | "timeout-assumed-available";
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
