# ADR: Task Storage & Execution Ledger — Flat JSON → SQLite

> **Status:** Decided · **Date:** 2026-03-05
> **Decision:** SQLite via `better-sqlite3` (global `~/.gwrk/gwrk.db`)
> **Supersedes:** [ADR-001](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-001-task-tracking.md) (storage mechanism only)
> **Author:** David Gonzalez · **Decision Scope:** gwrk core architecture

---

## 1. Context

ADR-001 (2026-02-26) chose flat JSON/JSONL over Beads/Dolt. That decision was sound for the MVP task tracker — 5 CRUD commands, zero dependencies, git-native state.

The system has since grown beyond task CRUD. The PRD now envisions:

| Capability | Data Need | Flat JSON Fitness |
|---|---|---|
| **Compression Engine** (§16) | Cross-feature timestamp aggregation, session detection | ❌ O(n) JSONL scanning |
| **Agent Router Learning** (§8, Open Q #11) | Historical success rates by backend × task type × SP | ❌ No structured execution metadata |
| **Done, Done! Protocol** (§8) | Retry counts, escalation chains, fallback history | ❌ `history.jsonl` records transitions only |
| **Slack App Home Tab** | Real-time queries: active agents, queue depth, feature progress | ❌ Scanning JSON per SSE tick is not viable |
| **Leading Compression Indicators** | Convergence, density, spec quality metrics | ❌ No join surface between effort and execution data |

**The system needs a learning engine. Flat JSON cannot be a learning engine.**

---

## 2. What's Preserved from ADR-001

| ADR-001 Decision | Status |
|---|---|
| Gate architecture (`gates/T0xx-gate.sh`) | ✅ **Unchanged** |
| `gwrk tasks done` executes gate before state change | ✅ **Unchanged** |
| Task state visible to agents via `gwrk tasks list --json` | ✅ **Unchanged** (agents never touch DB directly) |
| No external dependencies (Dolt/Beads rejected) | ✅ **Unchanged** (`better-sqlite3` is embedded, no server) |
| Branch scoping | ⚠️ **Modified** — see §4 |

---

## 3. Decision: Global SQLite

### Storage Location

```
~/.gwrk/gwrk.db          ← Global execution ledger (telemetry & metrics)
specs/<feature>/.gwrk/tasks.json ← Local operational ledger (state & intent)
```

**The Division of Labor:**
- **Git (`tasks.json`) is the operational source of truth.** Task state is fundamentally bound to the git commit hash. Agents working in air-gapped or remote VMs (like Codex Cloud) only need standard Git credentials to report progress. Task state mutations (`[x] completed`) are atomic with the code mutations that satisfy the task.
- **SQLite (`gwrk.db`) is the analytical execution ledger.** It tracks cross-project execution history, attempt durations, gate flaps, agent routing preferences, and compression indicators.

### Branch Scoping

ADR-001 correctly argued that `.gwrk/tasks.json` follows the branch automatically. 
- When a developer switches branches, their task board time-travels perfectly to match their code.
- `gwrk tasks list` reads solely from the local JSON file.
- `gwrk tasks done` mutates the local JSON file and commits it.

### The Learning Loop Extraction

When an agent pushes a completed task or phase, the Build Server (or the agent itself) writes the execution telemetry into SQLite. This data powers the Agent Router and Compression Engine.

---

## 4. Schema

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL UNIQUE,
  github_repo TEXT,
  slack_channel TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         TEXT,
  feature_id      TEXT NOT NULL,
  phase_id        TEXT NOT NULL,
  project_id      TEXT REFERENCES projects(id),
  agent_backend   TEXT NOT NULL,
  model           TEXT,
  workflow        TEXT NOT NULL,
  attempt         INTEGER NOT NULL DEFAULT 1,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  exit_code       INTEGER,
  duration_s      INTEGER,
  gate_result     TEXT,
  review_verdict  TEXT,
  retry_reason    TEXT,
  tool_calls      INTEGER,
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  files_changed   INTEGER,
  lines_added     INTEGER,
  lines_deleted   INTEGER,
  test_coverage_delta REAL,
  gate_flap_count INTEGER DEFAULT 0,
  log_file        TEXT
);

CREATE TABLE compression (
  feature_id          TEXT NOT NULL,
  project_id          TEXT REFERENCES projects(id),
  total_sp            INTEGER,
  estimated_hours     REAL,
  estimated_days      REAL,
  spec_created_at     TEXT,
  plan_approved_at    TEXT,
  first_impl_commit   TEXT,
  last_impl_commit    TEXT,
  pr_merged_at        TEXT,
  active_coding_mins  REAL,
  delivery_window_hrs REAL,
  point_compression   REAL,
  total_compression   REAL,
  dormancy_days       INTEGER,
  PRIMARY KEY (feature_id, project_id)
);

CREATE TABLE history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL,
  project_id  TEXT REFERENCES projects(id),
  feature_id  TEXT NOT NULL,
  task_id     TEXT,
  from_status TEXT,
  to_status   TEXT,
  agent_id    TEXT,
  run_id      INTEGER REFERENCES runs(id),
  metadata    TEXT
);
```

---

## 5. Technology

| Component | Choice | Rationale |
|---|---|---|
| Driver | `better-sqlite3` | Synchronous API, zero external deps, already in CodeRed stack |
| Migration | SQL files in `src/db/migrations/` | Versioned, deterministic |
| Testing | In-memory DB (`:memory:`) | Fast, isolated, no cleanup |
| Backup | `gwrk db export` → JSON dump | Human-readable, restorable |

---

## 6. Impact on Existing Code

| Component | Change |
|---|---|
| `src/utils/state.ts` (built) | **No change required.** Continues to read/write JSON. |
| `src/utils/history.ts` (not yet built) | Inserts into `history` table |
| `src/commands/init.ts` (built) | Also registers project in `~/.gwrk/gwrk.db` |
| `scripts/dev/agent-run.sh` (built) | Gains: writes run metadata to DB after execution |
| Everything else | No impact (gate scripts, parser, config unchanged) |

---

## 7. Next Steps

1. Add `better-sqlite3` to `package.json`
2. Create `src/db/` with schema and migration runner
3. Update `gwrk init` to register project in global DB
4. Implement `src/utils/state.ts` against SQLite (Phase 3 of 001-cli-core)
