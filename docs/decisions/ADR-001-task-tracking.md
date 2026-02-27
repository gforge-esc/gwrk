# ADR: Task Tracking — Beads (bd + Dolt) vs. Roll Our Own

> **Status:** Decided · **Date:** 2026-02-26  
> **Decision:** Option B (Roll Our Own — Flat JSON/JSONL)  
> **Author:** David Gonzalez · **Decision Scope:** gwrk core architecture

---

## 1. Context

gwrk needs a task tracking system for decomposed feature work. The pipeline is:

```
DUT → DUS → ZFG → WUD
dream → define → orchestrate → implement
```

At the DUS stage, specs are decomposed into phases and tasks. These tasks need to be:
- Created programmatically (by DUS from plan → beads)
- Queried for dispatch (by ZFG to find ready/blocked work)
- Updated on completion (by WUD when a phase PR merges)
- Reported on (by Pulse for velocity, by Compression for timing)

CodeRed currently uses **beads** (`bd` CLI backed by Dolt, a git-for-data MySQL-compatible database) for this. The question: should gwrk inherit this dependency, or build something lighter?

---

## 2. CodeRed's Beads Dependency Surface

### Scripts that call `bd`

| Script | bd commands used | Purpose |
|---|---|---|
| `bd-preflight.sh` (91 lines) | `bd show`, `bd ready`, `bd children` | Pre-flight validation: does bd exist? Is the feature in the DB? Is the phase READY? |
| `bd-next-task.sh` (30 lines) | `bd children --json` | Get next open task in a phase (for WUD dispatch) |
| `bd-get-context.sh` (48 lines) | `bd show --json` | Extract task title/notes for agent context injection |
| `import-all.sh` (41 lines) | `bd doctor` | Master runner that sanity-checks bd then runs import scripts |
| `00-create-phases.sh` (78 lines) | `bd show`, `bd children --json`, `bd create` | Create feature + phase hierarchy idempotently |
| `01-phase-1-tasks.sh` (246 lines) | `bd children --json`, `bd create` | Create individual tasks with rich descriptions |
| `define-until-solid.sh` (466 lines) | Calls `import-all.sh` | Final stage of DUS loop |
| `work-until-done.sh` | Via bd-next-task.sh | WUD task iteration |
| `wud-verdict.sh` | Via bd ops | Phase completion check |

### bd commands actually used (exhaustive)

```
bd show <id> [--json]          # Get task details
bd children <id> --json         # List child tasks
bd ready [--limit N] --json     # Get unblocked tasks
bd create --type --parent --title --description [--json] [--force] [--id]
bd doctor                       # Health check
```

**That's it.** Five commands. The entire beads integration is a thin CRUD + query layer over a hierarchical task tree.

### Data model (`.beads-id`)

```json
{
  "feature": "code-red-ag6",
  "phases": {
    "1": "code-red-ag6.1",
    "2": "code-red-ag6.2"
  }
}
```

Simple parent-child mapping. Feature → Phases → Tasks. Each task has: `id`, `title`, `description`, `status`, `created_at`, `parent`, `type`.

---

## 3. What Dolt Brings (and What It Costs)

### Dolt: Git for Data

Dolt is a MySQL-compatible database that supports `git diff`, `git log`, `git branch`, and `git merge` for data. Beads uses it as the storage backend.

**Strengths:**
- Versioned task history (you can diff task states across commits)
- SQL queries over tasks (though CodeRed never uses this — only the bd CLI)
- Theoretically branchable task state (parallel feature work)

**Costs:**
- **Heavy dependency.** Dolt is a Go binary (~150 MB). It runs a server process or uses embedded mode.
- **Global state.** Beads stores data in `~/.beads/default.db` by default. Agents frequently create beads in the wrong directory, polluting the global DB (noted specifically [on HN](https://news.ycombinator.com/item?id=46487580)).
- **The project is erratic.** Multiple HN commenters note the author's approach is hard to follow: *"beads is an incredibly difficult-to-follow mess for something that is at its core a pretty simple idea"*
- **Overhead for what's used.** CodeRed uses 5 bd commands. We're importing a full RDBMS for what amounts to a JSON tree.
- **Not git-native for the task data itself.** Ironically, despite Dolt's "git-for-data" pitch, the task data lives outside the git tree. You can't `git log` your task history. You can't see it in a PR diff.

---

## 4. Community Alternatives (from HN)

| Tool | Storage | Approach | Pros | Cons |
|---|---|---|---|---|
| **ticket** (`tk`) | Flat markdown files in `.tickets/` | Bash script, dependency graph, `tk ready`/`tk blocked` | Zero deps, git-native, agents understand markdown | No DB, basic querying |
| **beans** | `.beans.yml` + `.beans/` | Go CLI, GraphQL, labels, epics | Rich querying, agent-friendly GraphQL | Another Go binary dep |
| **git-bug** | Git blobs (refs/bugs) | Go binary, git-native storage | Truly git-native, syncs with push/pull | Heavy (250+ .go files), collaboration-focused |
| **Backlog.md** | Markdown + SQLite | TUI/WebUI + MCP for agents | Nice UI, MCP support | SQLite file in repo |
| **kanban-tui** | SQLite (external) | Python, TUI, MCP skill | No in-repo files | External state |
| **GitHub Issues** | GitHub API | `gh` CLI | Standard, agents know it well | HTTP latency, GitHub lock-in |

---

## 5. Options

### Option A: Adopt Beads As-Is

Keep `bd` as a required dependency. Ship gwrk with a `gwrk setup` that installs bd + Dolt.

| Pro | Con |
|---|---|
| Zero migration from CodeRed | 150 MB Dolt binary dependency |
| Existing scripts work unchanged | Global `~/.beads/default.db` pollution |
| Versioned task history via Dolt internals | Task data not visible in git diffs/PRs |
| | Community perceives beads as messy/erratic |
| | Dolt server process or embedded mode adds complexity |
| | Overkill: 5 commands used out of entire RDBMS |

### Option B: Roll Our Own (Flat Files, Git-Native)

Build a lightweight task system using JSON files in the repo tree, tracked by git.

```
specs/<feature>/
  ├── spec.md
  ├── plan.md
  └── .gwrk/
      ├── tasks.json          ← Feature + phase + task hierarchy
      ├── phases/
      │   ├── 01.json         ← Phase 1 tasks + status
      │   └── 02.json         ← Phase 2 tasks + status
      └── history/
          └── 2026-02-26.jsonl ← Status transitions (for Compression)
```

The `gwrk` CLI replaces `bd` with:

```
gwrk tasks list <feature>                  ← replaces bd children
gwrk tasks ready <feature>                 ← replaces bd ready
gwrk tasks next <feature> <phase>          ← replaces bd-next-task.sh
gwrk tasks create <feature> <phase> ...    ← replaces bd create
gwrk tasks done <feature> <task>           ← status update
gwrk tasks context <feature> <task>        ← replaces bd-get-context.sh
```

| Pro | Con |
|---|---|
| Zero external dependencies | 500-800 lines of new TypeScript to write |
| Task data is git-native: visible in diffs, PRs, `git log` | No SQL queries (just JSON parsing) |
| Files live in project, not global `~/.beads/` | No versioned task history beyond git history |
| Agents read/write Markdown/JSON natively | Need to build CLI commands |
| Timestamp data feeds directly into Compression engine | |
| Easy to inspect and debug (just read the JSON) | |
| No Dolt server process | |

### Local Flat Files vs. GitHub Issues

While `gh` CLI integration is powerful, GitHub Issues fail gwrk's "Principal Engineer OS" requirements in three ways:

| Feature | Local Flat JSON/JSONL | GitHub Issues (Gated) |
|---|---|---|
| **Branch Awareness** | ✅ **Atomic**. Task state follows the branch. | ❌ **Global**. Repo-level state; messy parallel branches. |
| **Latency/Throughput** | ✅ Instant. Zero API overhead. | ❌ HTTP Delay. Rate-limited at high parallelism. |
| **PR Context** | ✅ Visible in diffs. Gate code is in the repo. | ❌ Disconnected. State lives in a separate Web UI. |
| **Compression** | ✅ Commit-accurate timestamps. | ❌ API-accurate timestamps (less granular). |
| **Offline** | ✅ 100% functional on a plane/train. | ❌ Blocks implementation without internet. |

**The "Branch Problem" is decisive.** If Agent-ZFG dispatches three WUD agents to three different branches for a single feature (e.g., UI, Backend, API), each branch needs its own isolated task state. GitHub Issues are globals; a flat-file `.gwrk/tasks.json` is scoped to the branch context automatically.

---

## 6. The "Hard Gate" Architecture (Compliance Mandate)

A critical failure of pure markdown workflows (like `skills-connection`) is that agents can "interpret" compliance. `gwrk` solves this by inheriting CodeRed's **unwavering execution loop**.

### 1. Mandatory Gate Scripts
For every task `T0xx` defined in `.gwrk/tasks.json`, there **MUST** be a corresponding `gates/T0xx-gate.sh` in the feature directory. These are generated by the DUS agent during the `/plan-to-tasks` phase.

### 2. No Interpretation execution
A gate is a shell script that exits 0 (PASS) or non-zero (FAIL). $0 \to 1$ is the only transition allowed. Agents cannot "mark a task as done" via markdown. They MUST call:
```bash
gwrk tasks done <featureId> <taskId>
```
This command **internally executes** the corresponding gate script. If the gate fails, the CLI returns an error and the task state in `tasks.json` remains `open`.

### 3. The "Maniacal Commitment" Loop
The `gwrk implement` agent operates in a strict loop:
1. `gwrk tasks next` → Returns next unblocked task.
2. `gates/T0xx-gate.sh` → Must FAIL (verify state is RED).
3. **Execute Implementation**.
4. `gates/T0xx-gate.sh` → Must PASS (verify state is GREEN).
5. `gwrk tasks done` → Finalize state + commit.

This ensures that "shipping" is not a matter of opinion, but a matter of successful script execution.

---

## 7. Decision: Option B (Roll Our Own — Flat JSON/JSONL)

**We will implement a lightweight, zero-dependency task system using JSON for state and JSONL for append-only history, governed by the Hard Gate Architecture.**

### Implementation Detail

1. **`specs/<feature>/.gwrk/tasks.json`**: The canonical hierarchical state of the feature.
2. **`.gwrk/history.jsonl`**: A repo-wide append-only log of status transitions. Every time an agent updates a task, gwrk writes an entry with: `timestamp`, `featureId`, `taskId`, `fromStatus`, `toStatus`, `agentId`.
3. **No Beads Adapter**: The community's move away from beads justifies a clean break. gwrk will provide a simple `gwrk init` that bootstraps the new structure.

### Storage Location
Tasks will live alongside the specs in `specs/<feature>/.gwrk/tasks.json`. This ensures that when an agent is dispatched to a feature branch, the task state is exactly what the agent needs.

---

## 7. Next Steps

1. Implement `gwrk tasks` CLI commands in Phase 1.
2. Update `gwrk specify` to bootstrap the `.gwrk/tasks.json` file.
3. Integrate `gwrk compression` to read from `history.jsonl`.
