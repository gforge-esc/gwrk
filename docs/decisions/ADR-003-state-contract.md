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

## 4. Data Flow and Decoupled Harvest

To ensure that distributed agents and local executions both reliably update the analytical state, the Harvest process is strictly decoupled from the Ship loop.

```
Agent (any) ──push──► GitHub ──merge──► (Poll) HarvestWatcher ──harvest──► gwrk.db

Agent writes:
  1. Code changes
  2. tasks.json mutations
  3. Execution manifest (runs/*.json)

Build Server (HarvestWatcher Daemon):
  1. Polls GitHub every 5 minutes for recently merged feature PRs.
  2. When a merged PR is detected, runs `gwrk harvest <feature>`.
  3. `harvest` parses the feature's `plan.md` (phaseless execution) and `.gwrk/runs/*.json` to upsert into `gwrk.db`.
  4. Automatic Backfilling: If a ship loop fails to produce an execution manifest (e.g., agent crash), Harvest synthesizes a run record with `status: 'merged'` to maintain ledger consistency.
```

The ship loop's role is strictly to prepare code, commit, and push. It **does not** run harvest. Harvest runs asynchronously via the `HarvestWatcher` background daemon or via manual `gwrk harvest` invocation.

---

## 5. Full Logs

> **Updated 2026-03-14**: Original assumption of 50KB–5MB per log was incorrect. Measured across 165 actual agent runs: **1.6 MB total, 10 KB average, 115 KB max**. At these sizes, git-tracking all logs is viable and valuable.

| Data | Location | Git? | Purpose |
|---|---|---|---|
| Structured facts | `.gwrk/runs/*.json` | ✅ | Analytics, routing, compression |
| Full agent output | `.gwrk/runs/*.log` | ✅ | Diagnostics, learning from success and failure |
| Digest (index) | `.digest[]` in manifest | ✅ | Quick triage without reading full log |

All logs are committed to `specs/<feature>/.gwrk/runs/` alongside execution manifests. This ensures:
- **Learning from all runs** — success patterns are as valuable as failure diagnostics
- **Survival across machines** — Codex Cloud ephemeral VMs lose local files on termination
- **Auditability** — full agent reasoning, review feedback, and gate output are preserved in git history

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
