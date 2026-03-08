# ADR-003: Execution State Contract — Git-Native Manifests

> **Status:** Decided · **Date:** 2026-03-08
> **Decision:** Git-native execution manifests + build-server-side SQLite harvest
> **Supersedes:** Partial aspects of ADR-002 §3 (Learning Loop Extraction)
> **Author:** David Gonzalez · **Decision Scope:** gwrk state architecture

---

## 1. Context

ADR-002 established SQLite as the analytical query surface. However, gwrk dispatches work to distributed agents (Codex local, Codex Cloud, Gemini CLI, Claude CLI) that:

- Have **git access only** — they push commits, that's it
- **Cannot reach the build server** — it runs on macOS, may be sleeping, has no public API
- **Cannot write to `~/.gwrk/gwrk.db`** — it doesn't exist on their machines (especially Codex Cloud ephemeral VMs)

The original ADR-002 §3 assumed the agent or build server would write execution telemetry directly to SQLite. This is not possible in a distributed execution model.

Additionally, three gaps were identified:

1. **Phantom data**: `.runs/` logs are never committed, making execution history ephemeral
2. **Merge safety**: `tasks.json` has no protection against squash merge state loss or JSON merge corruption
3. **Dual history**: `history.jsonl` (git) and `gwrk.db history` (SQLite) both record transitions with no reconciliation

---

## 2. Decision: Two-Tier State Architecture

### Tier 1: Operational State (Git)

The **source of truth** for what work has been done and what remains.

| File | Purpose | Merge Strategy |
|---|---|---|
| `specs/<feature>/.gwrk/tasks.json` | Task status, phase structure, gate refs | `merge=ours` (manual reconciliation) |
| `specs/<feature>/.gwrk/runs/*.json` | Execution manifests (post-run structured metadata) | `merge=binary` (both sides survive) |

### Tier 2: Analytical State (SQLite)

The **query surface** for learning, routing, and metrics. Populated exclusively by the build server.

| Table | Purpose | Source |
|---|---|---|
| `runs` | Execution history (duration, exit code, agent, model) | Harvested from `.gwrk/runs/*.json` |
| `history` | Task transition log | `gwrk tasks done` (local runs only) |
| `compression` | SP vs actual delivery ratios | Computed from `runs` data |
| `projects` | Project registry | `gwrk init` |

---

## 3. Execution Manifest Schema

Every agent run produces a manifest committed to `specs/<feature>/.gwrk/runs/`:

```json
{
  "runId": "2026-03-08T14:02:33Z_ship_p01",
  "feature": "001-cli-core",
  "phase": "phase-01",
  "command": "ship",
  "agent": "codex-cloud",
  "model": "o4-mini",
  "startedAt": "2026-03-08T14:02:33Z",
  "finishedAt": "2026-03-08T14:18:02Z",
  "durationS": 929,
  "exitCode": 0,
  "attempt": 1,
  "gateResult": "PASS",
  "reviewVerdict": "GO",
  "filesChanged": 4,
  "linesAdded": 127,
  "linesDeleted": 33,
  "gitCommit": "abc1234",
  "gitBranch": "feat/001-cli-core-wip"
}
```

**File naming:** `<ISO-timestamp>_<command>_<phase>_<agent>.json`

**Size:** ~500 bytes per manifest. A 10-phase feature with 3 attempts per phase = 30 files, ~15KB total.

---

## 4. Data Flow

```
Agent (any) ──push──► GitHub ──pull──► Build Server ──harvest──► gwrk.db

Agent writes:
  1. Code changes
  2. tasks.json mutations
  3. Execution manifest (runs/*.json)

Build Server reads:
  1. gwrk harvest → scan runs/*.json → upsert into gwrk.db
  2. Idempotent (dedup by runId)
  3. Triggered by: git poll, ship done, manual invocation
```

---

## 5. What About Full Logs?

| Data | Location | Git? | Purpose |
|---|---|---|---|
| Structured facts | `.gwrk/runs/*.json` | ✅ | Analytics, routing, compression |
| Full agent output | `.runs/*.log` | ❌ (`.gitignore`) | Local debugging only |

Full logs are too large for git (50KB–5MB each). The structured manifest captures everything the analytical engine needs. Raw logs remain on the machine that ran the agent.

---

## 6. Merge Safety

### `.gitattributes`

```gitattributes
specs/**/.gwrk/tasks.json    merge=ours
specs/**/.gwrk/runs/*.json   merge=binary
```

### Post-Merge Verification

`gwrk tasks verify <feature>`:
1. Validates `tasks.json` schema (Zod)
2. Checks every `completed` task has a corresponding manifest
3. Reports orphaned or regressed tasks

---

## 7. Deprecation: `history.jsonl`

`history.jsonl` is superseded by:
1. **`gwrk.db history`** — the analytical query surface
2. **`git log --follow tasks.json`** — the auditable transition history
3. **Execution manifests** — the per-run analytical record

`history.jsonl` will be removed in a future phase after `gwrk harvest` is operational.

---

## 8. Impact on Existing Code

| Component | Change |
|---|---|
| `agent-run.sh` | Gains: write manifest to `.gwrk/runs/` on completion |
| `work-until-done.sh` | Gains: write manifest per stage |
| `ship.ts`, `define.ts` | Gains: write manifest via shared utility |
| `gwrk harvest` (new) | Build-server-only: scan manifests → upsert into gwrk.db |
| `gwrk tasks verify` (new) | Post-merge validation |
| `.runs/` | Added to `.gitignore` |
| `.gitattributes` | Created with merge strategies |
