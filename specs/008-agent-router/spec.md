# Feature Specification: 008 Agent Router

**Feature Branch**: `008-agent-router`
**Created**: 2026-03-10
**Revised**: 2026-05-07
**Status**: Settled
**Input**: Agent router, backend selection based on quota remaining, fallback chain, quota probing, SQLite-backed learning, agent registry schema.

---

> [!IMPORTANT]
> **Routing operates on two dimensions.** Dimension 1 (provider): which provider has capacity? Dimension 2 (model): which model within that provider fits this task? The router farms work to where capacity exists AND selects the right model class (thinking vs fast) based on task classification. All target backends have sufficient context windows — the real problems are quota remaining and transient capacity exhaustion (429s).

## 2. User Scenarios & Testing

### US-001 - Quota-Aware Backend Selection (Priority: P0)
As a Principal Engineer, I want the system to automatically select the backend with the most quota remaining, so work is routed to wherever has capacity rather than requiring manual `--agent` switching.

**Implements**: FR-001, FR-002, FR-003

**Independent Test**: Mock quota data for 3 backends (codex: 100%, gemini: 68%, claude: 12%). Verify the router selects codex.

**Acceptance Scenarios**:
1. **Given** quota readings `codex: 100%`, `gemini: 68%`, `claude: 12%`, **When** the router selects, **Then**:
   - `jq -r '.backend' .runs/latest_selection.json` outputs `codex`
   - `jq -r '.reason' .runs/latest_selection.json | grep -q 'quota'` exits 0

### US-002 - Fallback Chain on Failure (Priority: P0)
As the ship engine, I want the router to automatically try the next backend in the fallback chain if the primary backend fails, is exhausted, or reports 0% quota remaining, so a single backend outage doesn't block shipping.

**Implements**: FR-004

**Independent Test**: Mock the primary backend with 0% quota. Verify the router skips it and selects the next with available quota.

**Acceptance Scenarios**:
1. **Given** `codex: 0%` and `gemini: 68%`, **When** the router selects, **Then**:
   - `jq -r '.backend' .runs/latest_selection.json` outputs `gemini`
   - `jq -r '.reason' .runs/latest_selection.json | grep -q 'fallback.*quota exhausted'` exits 0

### US-003 - Quota Probing (Priority: P0)
As the router, I want to probe each backend's remaining quota before making a selection, using the best available method per backend (interactive command scraping, cached readings, or optimistic assumption).

**Implements**: FR-002

**Independent Test**: Mock a quota probe that returns structured JSON. Verify the router parses the percentage and reset time correctly.

**Acceptance Scenarios**:
1. **Given** a gemini quota probe returning `{ "percent": 68, "resetsIn": "16h 5m" }`, **When** the router parses, **Then**:
   - `jq -r '.quotaPercent' .runs/latest_selection.json` outputs `68`

### US-004 - Agent Registry Configuration (Priority: P0)
As a Principal Engineer, I want to define available backends, their quota probe commands, and fallback order in `.gwrkrc.json` under `agents.registry`, so the router has a structured source of truth.

**Implements**: FR-005

**Independent Test**: Write a `.gwrkrc.json` with 4 backends. Verify the router loads and validates the registry.

**Acceptance Scenarios**:
1. **Given** a `.gwrkrc.json` with `agents.registry` containing `codex`, `gemini`, `claude`, `codex-cloud`, **When** the router loads, **Then**:
   - `node -e "require('./dist/server/agent-registry').loadRegistry()" | jq '.backends | length'` outputs `4`

### US-005 - SQLite Learning from Outcomes (Priority: P1)
As the router, I want to track success/failure outcomes per backend in the SQLite ledger, so my selection prefers backends with higher historical success rates for similar tasks.

**Implements**: FR-006

**Independent Test**: Seed SQLite with 10 runs (7 codex successes, 3 claude successes). Verify the router prefers codex when quota is equal.

**Acceptance Scenarios**:
1. **Given** equal quota (both 80%) and codex has 90% historical success vs claude 60%, **When** the router selects, **Then**:
   - `jq -r '.backend' .runs/latest_selection.json` outputs `codex`
   - `jq -r '.reason' .runs/latest_selection.json | grep -q 'historical'` exits 0

### US-006 - Graceful Degradation on Probe Failure (Priority: P0)
As the router, if I cannot determine a backend's quota (probe fails, timeout, or unsupported), I want to assume optimistic availability and proceed, so a broken probe doesn't block shipping.

**Implements**: FR-007

**Independent Test**: Mock a probe that times out. Verify the router assumes 100% and proceeds.

**Acceptance Scenarios**:
1. **Given** a quota probe that times out after 5s, **When** the router selects, **Then**:
   - `jq -r '.quotaPercent' .runs/latest_selection.json` outputs `100`
   - `jq -r '.probeStatus' .runs/latest_selection.json` outputs `timeout-assumed-available`

### US-007 - Selection Recording (Priority: P0)
As a Principal Engineer, I want every routing decision logged to SQLite with the quota readings and selection reason, so I can audit and debug routing behavior.

**Implements**: FR-008

**Independent Test**: Run a selection. Query the SQLite `routing_decisions` table. Verify the record exists with quota columns.

**Acceptance Scenarios**:
1. **Given** a completed routing decision, **Then**:
   - `sqlite3 ~/.gwrk/gwrk.db "SELECT count(*) FROM routing_decisions WHERE quota_percent IS NOT NULL"` outputs `>= 1`

### US-008 - Model Selection Within Provider (Priority: P0)
As a Principal Engineer, I want the router to select the appropriate model within a provider based on the task type — thinking models for implementation/remediation, fast models for tests/reviews — so I get the right capability without manual `--model` flags.

**Implements**: FR-009, FR-011

**Independent Test**: Given a gemini backend with models `["gemini-3.1-pro-preview", "gemini-3-flash-preview"]`, route an `implement` task. Verify it selects `gemini-3.1-pro-preview`.

**Acceptance Scenarios**:
1. **Given** gemini with two models and task type `implement`, **When** the router selects, **Then**:
   - `jq -r '.selectedModel' .runs/latest_selection.json` outputs `gemini-3.1-pro-preview`
   - `jq -r '.reason' .runs/latest_selection.json | grep -q 'thinking'` exits 0
2. **Given** gemini with two models and task type `test`, **When** the router selects, **Then**:
   - `jq -r '.selectedModel' .runs/latest_selection.json` outputs `gemini-3-flash-preview`

### US-009 - Transient 429 Model Failover (Priority: P0)
As the ship engine, I want the router to distinguish between quota depletion (0% remaining) and transient capacity exhaustion (429 on a specific model), so it tries another model within the same provider before failing over to a different provider entirely.

**Implements**: FR-010

**Independent Test**: Mock `gemini-3-flash-preview` returning 429 `MODEL_CAPACITY_EXHAUSTED`. Verify the router tries `gemini-3.1-pro-preview` before falling to claude.

**Acceptance Scenarios**:
1. **Given** gemini-flash returns 429 and gemini-pro is available, **When** the router selects, **Then**:
   - `jq -r '.backend' .runs/latest_selection.json` outputs `gemini`
   - `jq -r '.selectedModel' .runs/latest_selection.json` outputs `gemini-3.1-pro-preview`
   - `jq -r '.reason' .runs/latest_selection.json | grep -q 'model-failover'` exits 0

### US-010 - Task Classification (Priority: P1)
As the router, I want a formalized task classification that maps task types to model capability tiers (thinking, fast, high-context), so model selection is deterministic and auditable.

**Implements**: FR-011

**Independent Test**: Classify task types `implement`, `test`, `review`, `define`, `remediation`. Verify each maps to expected tier.

**Acceptance Scenarios**:
1. **Given** task type `implement`, **When** classified, **Then** tier is `thinking`
2. **Given** task type `test`, **When** classified, **Then** tier is `fast`

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: System MUST provide a `BackendSelector` that accepts a `TaskContext` (feature, phase, taskType, language, taskSP) and returns a `BackendSelection` (backend, model, reason, quotaPercent, fallback). Selection operates on two dimensions: (1) provider selection based on quota remaining, (2) model selection within provider based on task classification. Historical success rate is tiebreaker. (Implements: US-001, US-008)
- **FR-002**: System MUST implement a `QuotaProber` per backend type. Probing strategies, in order of preference: (a) cached reading from last probe within TTL (default 5 min), (b) headless interactive session scraping (tmux-based, inspired by ccquota pattern), (c) shared-pool lookup (e.g. `codex-cloud` reads the `codex` local probe — they share the same 5h window), (d) optimistic assumption (100%). The probe MUST return `{ percent: number, resetsIn: string, probeStatus: "fresh" | "cached" | "shared-pool" | "timeout-assumed-available" }`. (Implements: US-001, US-003)
- **FR-003**: System MUST check backend availability before selection. A backend is available if: (a) configured in registry, (b) quota > 0% (or probe assumed available), (c) not in cooldown from a recent failure. (Implements: US-001)
- **FR-004**: System MUST implement a two-level fallback chain. Level 1 (model failover): if the selected model within a provider returns a transient 429, try the next model in the same provider's `models[]` array. Level 2 (provider failover): if all models within a provider are exhausted or quota is 0%, select the next provider from `agents.fallbackOrder`. Max 3 provider-level fallback attempts. (Implements: US-002, US-009)
- **FR-005**: System MUST load the agent registry from `.gwrkrc.json` under `agents.registry`. The schema MUST be Zod-validated with fail-fast on invalid config. Registry schema per backend: `{ name, type: "local-cli" | "cloud", command, quotaProbe, maxConcurrent, models: [{ name, tier, modelFlag? }], fallback? }`. Each model entry specifies its capability `tier` ("thinking" | "fast" | "high-context") and optional `modelFlag` for CLI injection. (Implements: US-004, US-008)
- **FR-006**: System MUST query the SQLite `runs` table to calculate per-backend AND per-model success rates. Used as tiebreaker when multiple backends have similar quota (within 20% of each other). (Implements: US-005)
- **FR-007**: System MUST handle probe failures gracefully. If a quota probe times out (> 5s) or returns unparseable output, the backend MUST be assumed available (100%) with `probeStatus: "timeout-assumed-available"`. The router MUST NOT block on a broken probe. (Implements: US-006)
- **FR-008**: System MUST record every routing decision in a `routing_decisions` SQLite table with columns: `id`, `run_id`, `feature`, `phase`, `selected_backend`, `selected_model`, `task_classification`, `reason`, `quota_percent`, `probe_status`, `task_sp`, `fallback_used`, `model_failover_used`, `created_at`. (Implements: US-007)
- **FR-009**: System MUST implement a `ModelSelector` that picks from a provider's `models[]` based on `TaskClassification`. The selector matches task tier to model tier. If the preferred-tier model is unavailable (cooldown from 429), it falls to the next model in the array. (Implements: US-008)
- **FR-010**: System MUST distinguish between quota depletion (provider-level, 0% remaining in rate window) and transient capacity exhaustion (model-level, 429 `MODEL_CAPACITY_EXHAUSTED`). Quota depletion triggers provider failover (FR-004 Level 2). Transient 429 triggers model failover (FR-004 Level 1) with per-model cooldown (default 60s). (Implements: US-009)
- **FR-011**: System MUST define a `TaskClassification` enum: `implement` → `thinking`, `test` → `fast`, `review` → `thinking`, `define` → `high-context`, `remediation` → `thinking`. Classification is derived from `TaskContext.taskType`. The command string MUST support `{{model}}` template substitution so the selected model's `modelFlag` is injected at invocation time. (Implements: US-010)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No backends configured | `No backends in registry` | 1 |
| All backends at 0% quota | `All backends quota-exhausted — retry after reset` | 1 |

#### FR-004 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| All fallbacks exhausted | `Fallback chain exhausted after 3 attempts` | 1 |

#### FR-005 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Registry missing from config | `Missing required config: agents.registry` | 1 |
| Invalid backend schema | `Invalid agent registry entry` | 1 |

#### FR-009 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No models matching tier | `No model with tier 'thinking' in backend 'gemini'` | _(falls to next model, not fatal)_ |
| All models in cooldown | `All models for 'gemini' in cooldown — provider failover` | _(triggers FR-004 Level 2)_ |

#### FR-010 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| All models 429 + all providers exhausted | `All backends and models exhausted — retry after cooldown` | 1 |

---

## 5. Data Model Requirements

### DM-001: Agent Registry Schema (`.gwrkrc.json`)

```json
{
  "agents": {
    "implement": "codex",
    "registry": {
      "codex": {
        "type": "local-cli",
        "command": "codex exec --full-auto --model {{model}}",
        "quotaProbe": {
          "method": "interactive-scrape",
          "command": "codex",
          "sendKeys": "/status",
          "parseRegex": "5h limit:\\s+\\[.*\\]\\s+(\\d+)% left",
          "cacheTTLMinutes": 5
        },
        "maxConcurrent": 1,
        "models": [
          { "name": "gpt-5.3-codex", "tier": "thinking", "modelFlag": "gpt-5.3-codex" },
          { "name": "gpt-5.1-codex-mini", "tier": "fast", "modelFlag": "gpt-5.1-codex-mini" }
        ]
      },
      "gemini": {
        "type": "local-cli",
        "command": "gemini -p --model {{model}}",
        "quotaProbe": {
          "method": "interactive-scrape",
          "command": "gemini",
          "sendKeys": "/stats session",
          "parseRegex": "Usage remaining\\s+(\\d+\\.?\\d*)%",
          "cacheTTLMinutes": 5
        },
        "maxConcurrent": 2,
        "models": [
          { "name": "gemini-3.1-pro-preview", "tier": "thinking", "modelFlag": "gemini-3.1-pro-preview" },
          { "name": "gemini-3-flash-preview", "tier": "fast", "modelFlag": "gemini-3-flash-preview" }
        ]
      },
      "claude": {
        "type": "local-cli",
        "command": "claude -p --model {{model}} --output-format json",
        "quotaProbe": {
          "method": "interactive-scrape",
          "command": "claude",
          "sendKeys": "/usage",
          "parseRegex": "(\\d+)% used",
          "invertPercent": true,
          "cacheTTLMinutes": 5
        },
        "maxConcurrent": 2,
        "models": [
          { "name": "claude-sonnet-4.6", "tier": "thinking", "modelFlag": "claude-sonnet-4.6" }
        ]
      },
      "codex-cloud": {
        "type": "cloud",
        "command": "@codex",
        "quotaProbe": {
          "method": "shared-pool",
          "sharedWith": "codex",
          "cacheTTLMinutes": 0
        },
        "maxConcurrent": 3,
        "models": [
          { "name": "gpt-5.3-codex", "tier": "thinking", "modelFlag": "gpt-5.3-codex" }
        ]
      }
    },
    "fallbackOrder": ["codex", "gemini", "claude", "codex-cloud"]
  }
}
```

### DM-002: Routing Decisions Table (SQLite)

```sql
CREATE TABLE IF NOT EXISTS routing_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  phase TEXT NOT NULL,
  selected_backend TEXT NOT NULL,
  selected_model TEXT,
  task_classification TEXT,
  reason TEXT NOT NULL,
  quota_percent INTEGER,
  probe_status TEXT NOT NULL,
  task_sp REAL,
  fallback_used BOOLEAN DEFAULT FALSE,
  model_failover_used BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### DM-003: Quota Probe Cache (in-memory, persisted to `.runs/quota-cache.json`)

```json
{
  "codex": { "percent": 100, "resetsIn": "4h 22m", "probedAt": "2026-03-10T16:00:00Z", "status": "fresh" },
  "gemini": { "percent": 68, "resetsIn": "16h 5m", "probedAt": "2026-03-10T16:00:00Z", "status": "fresh" },
  "claude": { "percent": 88, "resetsIn": "3h 0m", "probedAt": "2026-03-10T16:00:00Z", "status": "fresh" }
}
```

---

## 6. Technical Constraints

- **TC-001**: Determinism — Given identical inputs (registry, quota cache, history), the router MUST produce the same selection. No random tie-breaking.
- **TC-002**: Air-Gapped — The router MUST NOT make external API calls. Quota probing uses local CLI commands only.
- **TC-003**: Fail-Fast Config — Zod validation with no `.default()` calls. Missing registry → `process.exit(1)`.
- **TC-004**: Pure Selection — The router MUST NOT execute agents. It returns a `BackendSelection` object; the caller (005) is responsible for execution.
- **TC-005**: Probe Resilience — Quota probing is best-effort. Probes MUST NOT block routing for more than 5 seconds. Failure → optimistic assumption.
- **TC-006**: No Probe Dependency — The router MUST function correctly even if ALL probes fail (all backends assumed available, selection falls through to historical success rate or fallback order).

---

## 7. Testing Requirements

- **TR-001**: `src/server/backend-selector.test.ts` — Verify selection logic: given 3 backends with different quota percentages, assert the highest-quota backend is selected. Vitest. (FR-001, FR-003)
- **TR-002**: `src/server/backend-selector.test.ts` — Verify fallback chain: mock primary at 0% quota, assert fallback is selected, assert max 3 attempts. Vitest. (FR-004)
- **TR-003**: `src/server/agent-registry.test.ts` — Verify Zod schema validation of `.gwrkrc.json` registry including `quotaProbe` config and `models[]` with tier/modelFlag. Assert fail-fast on missing fields. Vitest. (FR-005)
- **TR-004**: `src/server/backend-selector.test.ts` — Verify SQLite tiebreaker: given two backends with equal quota, assert the one with higher historical success rate is preferred. Vitest. (FR-006)
- **TR-005**: `src/server/quota-prober.test.ts` — Verify probe timeout handling: mock a probe that hangs for 10s, assert router assumes 100% and returns within 6s. Vitest. (FR-002, FR-007)
- **TR-006**: `src/server/routing-decisions.test.ts` — Verify every selection is recorded in `routing_decisions` table with `quota_percent`, `probe_status`, `selected_model`, `task_classification`, and `model_failover_used` columns. Vitest. (FR-008)
- **TR-007**: `src/server/quota-prober.test.ts` — Verify cache: probe once, check cache hit on second call within TTL, verify re-probe after TTL expires. Vitest. (FR-002)
- **TR-008**: `src/server/model-selector.test.ts` — Verify model selection: given gemini with `[thinking, fast]` models and task type `implement`, assert `gemini-3.1-pro-preview` selected. Given task type `test`, assert `gemini-3-flash-preview` selected. Vitest. (FR-009, FR-011)
- **TR-009**: `src/server/backend-selector.test.ts` — Verify model failover: mock `gemini-3-flash-preview` in cooldown (429), assert `gemini-3.1-pro-preview` selected before provider failover. Vitest. (FR-010)
- **TR-010**: `src/server/model-selector.test.ts` — Verify command template injection: given command `gemini -p --model {{model}}` and selected model `gemini-3.1-pro-preview`, assert rendered command is `gemini -p --model gemini-3.1-pro-preview`. Vitest. (FR-011)

---

## 8. Success Criteria

- **SC-001**: `selectBackend()` returns a valid `BackendSelection` without human intervention, routing to the backend with the most available quota.
- **SC-002**: Fallback chain recovers from primary backend exhaustion in < 1 second (cached probes) or < 10 seconds (fresh probes).
- **SC-003**: A completely broken probe environment (all probes fail) still allows shipping via optimistic assumptions.
- **SC-004**: Historical success data demonstrably breaks ties when multiple backends have similar quota.

---

## 9. Verification Requirements

- **VR-001**: Configure 3 backends. Run `gwrk ship` on a multi-phase feature. Verify `routing_decisions` table contains one row per phase with `quota_percent` populated.
- **VR-002**: Deplete one backend's quota (use it until `/stats` or `/usage` shows < 5%). Run `gwrk ship`. Verify the router selects an alternative and logs `fallback.*quota exhausted`.
- **VR-003**: Kill/disable all quota probes. Run `gwrk ship`. Verify the router still selects a backend (optimistic mode) and logs `timeout-assumed-available`.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-002, FR-003 | FR-001 | US-001, US-008 | TR-001 |
| US-002 | FR-004 | FR-002 | US-001, US-003 | TR-005, TR-007 |
| US-003 | FR-002 | FR-003 | US-001 | TR-001 |
| US-004 | FR-005 | FR-004 | US-002, US-009 | TR-002, TR-009 |
| US-005 | FR-006 | FR-005 | US-004 | TR-003 |
| US-006 | FR-007 | FR-006 | US-005 | TR-004 |
| US-007 | FR-008 | FR-007 | US-006 | TR-005 |
| US-008 | FR-009, FR-011 | FR-008 | US-007 | TR-006 |
| US-009 | FR-010 | FR-009 | US-008 | TR-008 |
| US-010 | FR-011 | FR-010 | US-009 | TR-009 |
| | | FR-011 | US-010 | TR-008, TR-010 |
