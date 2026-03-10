# Feature Specification: 008 Agent Router

**Feature Branch**: `008-agent-router`
**Created**: 2026-03-10
**Status**: Settled
**Input**: Agent router, backend selection, fallback chain, tandem dispatch, context size estimator, SQLite-backed learning, agent registry schema.

---

## 2. User Scenarios & Testing

### US-001 - Automatic Backend Selection (Priority: P0)
As a Principal Engineer, I want the system to automatically select the best available agent backend for each task based on context size, historical success rate, and current availability, so I don't have to manually specify `--agent` on every ship.

**Implements**: FR-001, FR-002, FR-003

**Independent Test**: Configure 3 backends in `.gwrkrc.json` registry. Submit a task with 500K estimated tokens. Verify the router selects the backend with the largest context window that is currently available.

**Acceptance Scenarios**:
1. **Given** a task estimated at 500K tokens and backends `codex` (1M ctx), `gemini` (1M ctx), `claude` (200K ctx), **When** the router selects, **Then**:
   - `jq -r '.backend' .runs/latest_selection.json` outputs `codex` or `gemini` (not `claude`)
   - `jq -r '.reason' .runs/latest_selection.json | grep -q 'context fit'` exits 0

### US-002 - Fallback Chain on Failure (Priority: P0)
As the ship engine, I want the router to automatically try the next backend in a fallback chain if the primary backend fails or is rate-limited, so that a single backend outage doesn't block shipping.

**Implements**: FR-004

**Independent Test**: Mock the primary backend returning exit code 1. Verify the router retries with the fallback backend.

**Acceptance Scenarios**:
1. **Given** a primary backend `codex` that fails with exit 1 and a fallback `claude`, **When** the router retries, **Then**:
   - `jq -r '.attempts | length' .runs/latest_selection.json` outputs `2`
   - `jq -r '.attempts[1].backend' .runs/latest_selection.json` outputs `claude`

### US-003 - Context Size Estimation (Priority: P0)
As the router, I want to estimate the token count of a task's input files before dispatching, so I can avoid sending oversized contexts to backends with small context windows.

**Implements**: FR-002

**Independent Test**: Point the estimator at a directory with known file sizes. Verify the token estimate is within 20% of actual.

**Acceptance Scenarios**:
1. **Given** a directory with 50KB of TypeScript source, **When** the estimator runs, **Then**:
   - `node -e "require('./dist/server/context-estimator').estimate('specs/001-cli-core')" | jq '.estimatedTokens'` outputs a number between 10000 and 25000

### US-004 - Agent Registry Configuration (Priority: P0)
As a Principal Engineer, I want to define available backends, their capabilities, and rate limits in `.gwrkrc.json` under an `agents.registry` key, so the router has a structured source of truth.

**Implements**: FR-005

**Independent Test**: Write a `.gwrkrc.json` with 3 backends. Verify the router loads and validates the registry.

**Acceptance Scenarios**:
1. **Given** a `.gwrkrc.json` with `agents.registry` containing `codex`, `gemini`, `claude`, **When** the router loads, **Then**:
   - `node -e "require('./dist/server/agent-registry').loadRegistry()" | jq '.backends | length'` outputs `3`

### US-005 - SQLite Learning from History (Priority: P1)
As the router, I want to query the SQLite execution ledger for historical success rates per backend, task language, and story-point weight, so my selections improve over time.

**Implements**: FR-006

**Independent Test**: Seed SQLite with 10 runs (7 codex successes, 3 claude successes). Verify the router prefers codex for similar tasks.

**Acceptance Scenarios**:
1. **Given** 10 historical runs where codex has 90% success and claude has 60%, **When** the router selects for a similar task, **Then**:
   - `jq -r '.reason' .runs/latest_selection.json | grep -q 'historical success'` exits 0
   - `jq -r '.backend' .runs/latest_selection.json` outputs `codex`

### US-006 - Mini-Model Pre-flight (Priority: P1)
As a cost-conscious engineer, I want the router to attempt small tasks with a mini-model first (e.g., `gpt-5.1-codex-mini`) before escalating to a full model, so I consume fewer rate-limit tokens on trivial work.

**Implements**: FR-007

**Independent Test**: Submit a task with estimated SP ≤ 1. Verify the router selects the mini model.

**Acceptance Scenarios**:
1. **Given** a task with SP=1 and a configured mini model `gpt-5.1-codex-mini`, **When** the router selects, **Then**:
   - `jq -r '.backend' .runs/latest_selection.json` outputs `codex`
   - `jq -r '.model' .runs/latest_selection.json` outputs `gpt-5.1-codex-mini`

### US-007 - Selection Recording (Priority: P0)
As a Principal Engineer, I want every routing decision logged to SQLite with the selection reason, so I can audit and debug routing behavior.

**Implements**: FR-008

**Independent Test**: Run a selection. Query the SQLite `routing_decisions` table. Verify the record exists.

**Acceptance Scenarios**:
1. **Given** a completed routing decision, **Then**:
   - `sqlite3 ~/.gwrk/gwrk.db "SELECT count(*) FROM routing_decisions WHERE run_id IS NOT NULL"` outputs `>= 1`

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: System MUST provide a `BackendSelector` that accepts a `TaskContext` (feature, phase, estimatedTokens, language, taskSP) and returns a `BackendSelection` (backend, model, reason, fallback). This is the interface consumed by 005-parallel-dispatch. (Implements: US-001)
- **FR-002**: System MUST estimate context size in tokens for a given task by scanning the relevant source files (from `plan.md` phase file lists) and applying a bytes-to-tokens heuristic (1 token ≈ 4 bytes for code). (Implements: US-001, US-003)
- **FR-003**: System MUST check backend availability before selection. Availability means: (a) backend is configured in registry, (b) current concurrency < `maxConcurrent`, (c) no active rate-limit cooldown. (Implements: US-001)
- **FR-004**: System MUST implement a fallback chain. If the primary backend fails (non-zero exit, timeout, or rate limit), the router MUST select the next backend in the chain from `agents.registry[backend].fallback`. Max 3 fallback attempts. (Implements: US-002)
- **FR-005**: System MUST load the agent registry from `.gwrkrc.json` under `agents.registry`. The schema MUST be Zod-validated with fail-fast on invalid config. Registry schema per backend: `{ name, type: "local-cli" | "cloud", command, contextWindow, maxConcurrent, rateLimit, models, fallback? }`. (Implements: US-004)
- **FR-006**: System MUST query the SQLite `runs` table to calculate per-backend success rates, filtered by language and SP range. The learning weight MUST decay over time (exponential decay, half-life 30 days). (Implements: US-005)
- **FR-007**: System MUST attempt tasks with SP ≤ 1 on a configured mini-model before escalating. If the mini-model fails, the router MUST escalate to the full model automatically. (Implements: US-006)
- **FR-008**: System MUST record every routing decision in a `routing_decisions` SQLite table with columns: `id`, `run_id`, `feature`, `phase`, `selected_backend`, `selected_model`, `reason`, `estimated_tokens`, `task_sp`, `fallback_used`, `created_at`. (Implements: US-007)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No backends available | `No available backends in registry` | 1 |
| All backends rate-limited | `All backends rate-limited — retry after cooldown` | 1 |

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
        "contextWindow": 1000000,
        "maxConcurrent": 3,
        "rateLimit": { "requests": 30, "windowMinutes": 300 },
        "models": ["gpt-5.3-codex", "gpt-5.1-codex-mini"],
        "fallback": "claude"
      },
      "claude": {
        "type": "local-cli",
        "command": "claude --dangerously-skip-permissions",
        "contextWindow": 200000,
        "maxConcurrent": 5,
        "models": ["claude-4-sonnet"],
        "fallback": "gemini"
      },
      "gemini": {
        "type": "local-cli",
        "command": "gemini",
        "contextWindow": 1000000,
        "maxConcurrent": 5,
        "models": ["gemini-3-pro"]
      },
      "codex-cloud": {
        "type": "cloud",
        "command": "@codex",
        "contextWindow": 1000000,
        "maxConcurrent": 10,
        "rateLimit": { "requests": 60, "windowMinutes": 300 },
        "models": ["gpt-5.3-codex"]
      }
    }
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
  estimated_tokens INTEGER,
  task_sp REAL,
  fallback_used BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 6. Technical Constraints

- **TC-001**: Determinism — Given identical inputs (registry, history, task context), the router MUST produce the same selection. No random tie-breaking.
- **TC-002**: Air-Gapped — The router MUST NOT make network calls. It reads local config and local SQLite only.
- **TC-003**: Fail-Fast Config — Zod validation with no `.default()` calls. Missing registry → `process.exit(1)`.
- **TC-004**: Pure Selection — The router MUST NOT execute agents. It returns a `BackendSelection` object; the caller (005) is responsible for execution.
- **TC-005**: No Side Effects — `selectBackend()` MUST be a pure query function aside from the `routing_decisions` INSERT. It MUST NOT modify task state.

---

## 7. Testing Requirements

- **TR-001**: `src/server/backend-selector.test.ts` — Verify selection logic: given 3 backends and a 500K-token task, assert the backend with the largest available context window is selected. Vitest. (FR-001, FR-002, FR-003)
- **TR-002**: `src/server/backend-selector.test.ts` — Verify fallback chain: mock primary failure, assert fallback is selected, assert max 3 attempts. Vitest. (FR-004)
- **TR-003**: `src/server/agent-registry.test.ts` — Verify Zod schema validation of `.gwrkrc.json` registry. Assert fail-fast on missing fields, invalid types. Vitest. (FR-005)
- **TR-004**: `src/server/backend-selector.test.ts` — Verify SQLite learning: seed runs table, assert backend with higher success rate is preferred. Vitest. (FR-006)
- **TR-005**: `src/server/backend-selector.test.ts` — Verify mini-model selection for SP ≤ 1 tasks. Assert escalation on mini-model failure. Vitest. (FR-007)
- **TR-006**: `src/server/routing-decisions.test.ts` — Verify every selection is recorded in `routing_decisions` table with all required columns. Vitest. (FR-008)
- **TR-007**: `src/server/context-estimator.test.ts` — Verify token estimation accuracy against known file sizes. Assert within 20% of expected. Vitest. (FR-002)

---

## 8. Success Criteria

- **SC-001**: `selectBackend()` returns a valid `BackendSelection` for any task context without human intervention.
- **SC-002**: Fallback chain recovers from primary backend failure in < 5 seconds.
- **SC-003**: SQLite learning demonstrably improves selection accuracy after 20+ historical runs.
- **SC-004**: Context estimator prevents oversized dispatch (no tasks sent to backends with insufficient context windows).

---

## 9. Verification Requirements

- **VR-001**: Configure 3 backends in `.gwrkrc.json`. Run `gwrk ship` on a multi-phase feature. Verify `routing_decisions` table contains one row per phase with reason and backend.
- **VR-002**: Disable the primary backend (remove from registry). Run `gwrk ship`. Verify the fallback backend is used and logged.
- **VR-003**: Seed 20 historical runs with varying success rates. Run selection. Verify the router prefers the historically successful backend.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-002, FR-003 | FR-001 | US-001 | TR-001 |
| US-002 | FR-004 | FR-002 | US-001, US-003 | TR-001, TR-007 |
| US-003 | FR-002 | FR-003 | US-001 | TR-001 |
| US-004 | FR-005 | FR-004 | US-002 | TR-002 |
| US-005 | FR-006 | FR-005 | US-004 | TR-003 |
| US-006 | FR-007 | FR-006 | US-005 | TR-004 |
| US-007 | FR-008 | FR-007 | US-006 | TR-005 |
| | | FR-008 | US-007 | TR-006 |
