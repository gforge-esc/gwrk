# Feature Specification: 008 Agent Router

**Feature Branch**: `008-agent-router`
**Created**: 2026-03-10
**Revised**: 2026-03-10
**Status**: Settled
**Input**: Agent router, backend selection based on quota remaining, fallback chain, quota probing, SQLite-backed learning, agent registry schema.

---

> [!IMPORTANT]
> **Routing is about QUOTA, not context.** All target backends (Codex 1M, Gemini 1M, Claude 200K) have sufficient context windows for gwrk's reduced-context tasks (spec + plan + contracts + gate). The real routing problem is: *which backend has enough quota remaining to complete this task?* The router farms work to where capacity exists.

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

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: System MUST provide a `BackendSelector` that accepts a `TaskContext` (feature, phase, language, taskSP) and returns a `BackendSelection` (backend, model, reason, quotaPercent, fallback). The primary selection criterion is **quota remaining**, with historical success rate as tiebreaker. (Implements: US-001)
- **FR-002**: System MUST implement a `QuotaProber` per backend type. Probing strategies, in order of preference: (a) cached reading from last probe within TTL (default 5 min), (b) headless interactive session scraping (tmux-based, inspired by ccquota pattern), (c) shared-pool lookup (e.g. `codex-cloud` reads the `codex` local probe — they share the same 5h window), (d) optimistic assumption (100%). The probe MUST return `{ percent: number, resetsIn: string, probeStatus: "fresh" | "cached" | "shared-pool" | "timeout-assumed-available" }`. (Implements: US-001, US-003)
- **FR-003**: System MUST check backend availability before selection. A backend is available if: (a) configured in registry, (b) quota > 0% (or probe assumed available), (c) not in cooldown from a recent failure. (Implements: US-001)
- **FR-004**: System MUST implement a fallback chain. If the selected backend has 0% quota, fails, or times out, the router MUST select the next backend from `agents.fallbackOrder`. Max 3 fallback attempts. (Implements: US-002)
- **FR-005**: System MUST load the agent registry from `.gwrkrc.json` under `agents.registry`. The schema MUST be Zod-validated with fail-fast on invalid config. Registry schema per backend: `{ name, type: "local-cli" | "cloud", command, quotaProbe: { command, parseFormat }, maxConcurrent, models, fallback? }`. (Implements: US-004)
- **FR-006**: System MUST query the SQLite `runs` table to calculate per-backend success rates. Used as tiebreaker when multiple backends have similar quota (within 20% of each other). (Implements: US-005)
- **FR-007**: System MUST handle probe failures gracefully. If a quota probe times out (> 5s) or returns unparseable output, the backend MUST be assumed available (100%) with `probeStatus: "timeout-assumed-available"`. The router MUST NOT block on a broken probe. (Implements: US-006)
- **FR-008**: System MUST record every routing decision in a `routing_decisions` SQLite table with columns: `id`, `run_id`, `feature`, `phase`, `selected_backend`, `selected_model`, `reason`, `quota_percent`, `probe_status`, `task_sp`, `fallback_used`, `created_at`. (Implements: US-007)

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
        "command": "codex exec --full-auto",
        "quotaProbe": {
          "method": "interactive-scrape",
          "command": "codex",
          "sendKeys": "/status",
          "parseRegex": "5h limit:\\s+\\[.*\\]\\s+(\\d+)% left",
          "cacheTTLMinutes": 5
        },
        "maxConcurrent": 1,
        "models": ["gpt-5.3-codex", "gpt-5.1-codex-mini"]
      },
      "gemini": {
        "type": "local-cli",
        "command": "gemini -p --output-format json",
        "quotaProbe": {
          "method": "interactive-scrape",
          "command": "gemini",
          "sendKeys": "/stats session",
          "parseRegex": "Usage remaining\\s+(\\d+\\.?\\d*)%",
          "cacheTTLMinutes": 5
        },
        "maxConcurrent": 2,
        "models": ["gemini-3.1-pro-preview", "gemini-3-flash-preview"]
      },
      "claude": {
        "type": "local-cli",
        "command": "claude -p --output-format json --effort high",
        "quotaProbe": {
          "method": "interactive-scrape",
          "command": "claude",
          "sendKeys": "/usage",
          "parseRegex": "(\\d+)% used",
          "invertPercent": true,
          "cacheTTLMinutes": 5
        },
        "maxConcurrent": 2,
        "models": ["claude-sonnet-4.6"]
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
        "models": ["gpt-5.3-codex"]
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
  reason TEXT NOT NULL,
  quota_percent INTEGER,
  probe_status TEXT NOT NULL,
  task_sp REAL,
  fallback_used BOOLEAN DEFAULT FALSE,
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
- **TR-003**: `src/server/agent-registry.test.ts` — Verify Zod schema validation of `.gwrkrc.json` registry including `quotaProbe` config. Assert fail-fast on missing fields. Vitest. (FR-005)
- **TR-004**: `src/server/backend-selector.test.ts` — Verify SQLite tiebreaker: given two backends with equal quota, assert the one with higher historical success rate is preferred. Vitest. (FR-006)
- **TR-005**: `src/server/quota-prober.test.ts` — Verify probe timeout handling: mock a probe that hangs for 10s, assert router assumes 100% and returns within 6s. Vitest. (FR-002, FR-007)
- **TR-006**: `src/server/routing-decisions.test.ts` — Verify every selection is recorded in `routing_decisions` table with `quota_percent` and `probe_status` columns. Vitest. (FR-008)
- **TR-007**: `src/server/quota-prober.test.ts` — Verify cache: probe once, check cache hit on second call within TTL, verify re-probe after TTL expires. Vitest. (FR-002)

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
| US-001 | FR-001, FR-002, FR-003 | FR-001 | US-001 | TR-001 |
| US-002 | FR-004 | FR-002 | US-001, US-003 | TR-005, TR-007 |
| US-003 | FR-002 | FR-003 | US-001 | TR-001 |
| US-004 | FR-005 | FR-004 | US-002 | TR-002 |
| US-005 | FR-006 | FR-005 | US-004 | TR-003 |
| US-006 | FR-007 | FR-006 | US-005 | TR-004 |
| US-007 | FR-008 | FR-007 | US-006 | TR-005 |
| | | FR-008 | US-007 | TR-006 |
