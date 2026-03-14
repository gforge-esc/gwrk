# gwrk: Architecture & Workflow Specification

> **Status:** Authoritative · **Date:** 2026-03-08 (v3)
> **Anchored to:** [GWRK-PRD-PRFAQ.md](file:///Users/gonzo/Code/gwrk/docs/GWRK-PRD-PRFAQ.md), [ADR-001-task-tracking.md](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-001-task-tracking.md), [ADR-002-sqlite-execution-ledger.md](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-002-sqlite-execution-ledger.md)

---

## 1. Architecture Overview

**TypeScript CLI + Local Daemon + Multi-Agent Dispatch.** gwrk is the Principal Engineer's operating system — a CLI and build server that orchestrates fleets of AI coding agents through governed, spec-first pipelines. Comms via Slack (Socket Mode). Dashboard via Slack App Home Tab.

```
┌── gwrk CLI ───────────────────────────────────────────────────────────┐
│  Commands: new, init, specify, plan, tasks, implement, ship, pulse, discover, kw, … │
│  npm install -g gwrk                                                  │
└───────────┬───────────────────────────────────────────────────────────┘
            │
            ▼
┌── gwrk server (localhost:18790) ──────────────────────────────────────┐
│                                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────────┐  │
│  │ Dispatch     │  │ Git Manager │  │ Slack Channel (@slack/bolt)  │  │
│  │ Queue        │  │             │  │                              │  │
│  │ - Phase pool │  │ - Branch    │  │ - Socket Mode (no public URL)│  │
│  │ - Agent pool │  │ - Merge     │  │ - Slash commands             │  │
│  │ - Retry +    │  │ - Conflict  │  │ - Interactive messages       │  │
│  │   escalation │  │   resolution│  │ - DUT threads                │  │
│  └──────┬──────┘  └──────┬──────┘  │ - App Home Tab (dashboard)   │  │
│         │                │         └──────────────┬───────────────┘  │
│         │                │                         │                  │
│  ┌──────▼─────────────────▼─────────────────────────▼──────────────┐  │
│  │              Docker Sandbox Manager                              │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │  │
│  │  │ Ship #1  │  │ Ship #2  │  │ Ship #3  │                      │  │
│  │  └──────────┘  └──────────┘  └──────────┘                      │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌──────────────────┐  ┌──────────────────┐ ┌──────────────────────┐ │
│  │ Pulse Engine     │  │ Review & CI Gate │ │ Compression Engine   │ │
│  │ Git log scanner  │  │ /review-code     │ │ SP vs Git timestamps │ │
│  │ Snapshot gen     │  │ /review-uat      │ │ Point & Total ratios │ │
│  └──────────────────┘  └──────────────────┘ │ Leading indicators   │ │
│                                              └──────────────────────┘ │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ SQLite Execution Ledger (~/.gwrk/gwrk.db)                       │ │
│  │ projects · runs · compression · history                         │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
        │              │               │
        ▼              ▼               ▼
  ┌── Phone ──┐  ┌── Local ──┐  ┌── Agent Backends ──────────────────┐
  │ Slack     │  │ Agent-ZFG │  │ Codex Cloud (true parallelism)     │
  │ channels  │  │ owns orch │  │ Codex Local (local CLI)            │
  │ App Home  │  └───────────┘  │ Claude Code (deep context, local)  │
  │ via tunnel│                 │ Gemini CLI  (multi-file, local)    │
  └──────────┘                 └────────────────────────────────────┘
```

---

## 2. The Agent Family

| Agent | Name | Role | Environment | Hands Off To |
|---|---|---|---|---|
| **DUT** | Dream Until Told | Ideate, clarify, spec | Slack threads | → DUS |
| **DUS** | Define Until Solid | Spec → plan → tasks → analyze | Local CLI | → ZFG |
| **ZFG** | Zero F*cks Given | Orchestrate, merge, resolve | Local daemon | → WUD |
| **WUD** | Work Until Done | Implement, test, PR | Cloud VM or local clone | → ✅ merge |

**Pipeline**: `DUT → DUS → ZFG → WUD → Done, Done!`

> **Naming note:** The WUD agent identity stays as "Work Until Done" internally. The user-facing CLI command is `gwrk ship` (aligned to Foxtrot Charlie Pillar 3: Shipping).

---

## 3. Project Structure

```bash
gwrk/
├── .agents/                        # Governance: rules, workflows, personas, scripts
│   ├── prompts/personas/          # PE, Senior Dev, PM persona definitions
│   ├── rules/                     # workspace.md, coding-style.md, etc.
│   ├── scripts/                   # Helper scripts
│   ├── templates/                 # monorepo-context.md, e2e-patterns.md
│   └── workflows/                 # specify.md, plan.md, implement.md, etc.
├── .specify/                      # Templates, scripts, memory
│   ├── scripts/bash/              # create-new-feature.sh, common.sh, etc.
│   └── templates/                 # spec-template.md, plan-template.md, etc.
├── GEMINI.md                      # Project context for Gemini CLI (refs .agents/)
├── CLAUDE.md                      # Project context for Claude Code (refs .agents/)
├── AGENTS.md                      # Project rules for Codex (refs .agents/)
├── .gemini/settings.json          # Gemini CLI model routing + tool config
├── .claude/settings.json          # Claude Code model preferences + permissions
├── docs/                          # Architecture, PRD, ADRs
│   └── references/                # Agent backend constraints, provisioning guides
├── scripts/dev/                   # Shell orchestrators (agent-run.sh, etc.)
├── specs/                         # Feature Specifications (Foxtrot Charlie)
│   ├── 000-build-plan.md          # Master dependency graph
│   └── NNN-feature-name/
│       ├── spec.md
│       ├── plan.md
│       ├── .gwrk/tasks.json       # Source of truth for task state
│       ├── contracts/             # Method-level interface contracts
│       ├── gates/                 # Hard Gate shell scripts (T0xx-gate.sh)
│       └── gap-analysis.md        # Code audit findings
├── src/                           # gwrk CLI source (TypeScript)
│   ├── cli.ts                     # Entry point + Commander routing
│   ├── commands/                  # Command implementations
│   │   ├── new.ts                 # Full project provisioning
│   │   ├── init.ts                # Add gwrk to existing project
│   │   ├── specify.ts
│   │   ├── plan.ts
│   │   ├── tasks.ts               # tasks list/ready/next/done
│   │   ├── implement.ts
│   │   ├── ship.ts                 # Ship loop (was: wud.ts)
│   │   ├── feature.ts             # End-to-end lifecycle
│   │   ├── discover.ts            # Discovery: fieldnote, compile, list
│   │   ├── kw.ts                  # Knowledge work: specify, plan, build-plan
│   │   ├── pulse.ts               # Productivity dashboard
│   │   ├── compression.ts         # Effort vs. actual ratios
│   │   ├── effort.ts              # SP-driven estimation
│   │   ├── server.ts              # Daemon start/stop
│   │   ├── setup-slack.ts         # Automated Slack app provisioning
│   │   └── tunnel.ts              # Tunnel start/stop/status
│   ├── db/                        # SQLite execution ledger (ADR-002)
│   │   ├── index.ts               # Connection + schema init
│   │   └── migrations/            # Versioned schema files
│   ├── server/                    # Build server (Fastify daemon)
│   │   ├── index.ts               # Server bootstrap
│   │   ├── dispatch.ts            # Agent dispatch queue
│   │   ├── git-manager.ts         # Branch, merge, conflict resolution
│   │   ├── sandbox.ts             # Docker container lifecycle
│   │   ├── slack.ts               # Bolt SDK Socket Mode integration
│   │   ├── slack-commands.ts      # Slash command handlers
│   │   ├── slack-actions.ts       # Interactive message handlers
│   │   └── tunnel.ts              # Cloudflare Tunnel / Tailscale Funnel
│   ├── engine/                    # Core computation engines
│   │   ├── pulse.ts               # Git log scanner + snapshot gen
│   │   ├── compression.ts         # Timestamp collection + ratio calc
│   │   ├── effort.ts              # SP extraction + role bracketing
│   │   └── router.ts              # Agent backend selection (learns from DB)
│   └── utils/                     # Shared utilities
│       ├── exec.ts                # Shell command execution
│       ├── state.ts               # Task read/write via local JSON
│       ├── history.ts             # History inserts via SQLite
│       ├── parser.ts              # Markdown → structured data
│       └── config.ts              # .gwrkrc.json loader (Zod, fail-fast)
├── .gwrkrc.json                   # Per-project agent config
├── package.json
├── tsconfig.json
├── biome.json
└── Makefile                       # Universal orchestrator
```

**Global state:** `~/.gwrk/gwrk.db` — SQLite execution ledger (ADR-002)

---

## 4. Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **CLI framework** | Commander.js | Lightweight, zero-opinion, npm-standard |
| **Build Server** | Fastify | Lightweight daemon, localhost:18790 |
| **Comms** | `@slack/bolt` (Socket Mode) | Channel-per-project, threads, App Home Tab |
| **Sandbox** | Docker | Per-feature-phase container isolation |
| **Git Operations** | `gh` CLI + `git` | GitHub-native |
| **Agent: Codex** | `codex exec --full-auto` | Cloud microVMs, true parallelism |
| **Agent: Claude** | `claude -p --output-format json` | Deepest context window, local |
| **Agent: Gemini** | `gemini -p --json` | Multi-file reasoning, local |
| **Execution Ledger** | `better-sqlite3` | Global DB, embedded, no server (ADR-002) |
| **Configuration** | Zod schemas | Fail-fast validation, no graceful defaults |
| **Linting** | Biome | Lint + format |
| **Testing** | Vitest | Unit + integration |
| **Language** | TypeScript (ES2022) | `.ts` only, no `.js` in `src/` |
| **Dashboard** | Slack App Home Tab (Block Kit) | Mobile-first, no separate SPA |
| **Tunnel** | Cloudflare Tunnel (default) / Tailscale Funnel | Remote Slack dashboard access |

### Why Commander.js, Not Ink

Ink (React for the terminal) was considered and **rejected** for the CLI layer:

| Concern | Commander.js | Ink |
|---|---|---|
| **Command model** | gwrk commands are dispatch-and-exit | Ink is for persistent, interactive TUIs |
| **Weight** | ~50 KB, zero transitive deps | Pulls React, Yoga, reconciler (~5 MB) |
| **Agent compatibility** | Agents call `gwrk tasks done` — needs instant exit | Ink renders a persistent React tree |
| **Appropriate for** | `gwrk pulse`, `gwrk status`, `gwrk tasks list` | A full-screen dashboard app |

### Why Slack App Home Tab, Not Glass Dashboard SPA

A separate Vite SPA served by the daemon was the original plan. Replaced by Slack App Home Tab:

| Concern | App Home Tab | Glass Dashboard SPA |
|---|---|---|
| **Weight** | Zero — Slack renders Block Kit | Vite + React + SSE consumer |
| **Auth** | Already authenticated via Slack | Needs JWT magic link |
| **Mobile** | Already mobile via Slack app | Separate tunnel + browser |
| **Build cost** | Block Kit JSON (~200 LOC) | Full SPA (~2000 LOC) |
| **Appropriate for** | Single-user ops view | Future: multi-user team dashboard |

---

## 5. The Construction Pipeline

### 5.1 The "One Right Way" Loop

```
/specify → spec.md + checklists/
    ↓         ← analyze perspective active (embedded, not separate)
/plan → plan.md + data-model.md + contracts/
    ↓         ← analyze perspective active
/plan-to-tasks → .gwrk/tasks.json + gates/T0xx-gate.sh + task_types
    ↓         ← analyze perspective active
/implement N → code + verify + commit + PR (gate-driven greedy loop)
    ↓
/review-code (PE) + /review-uat (PM) → GREEN or REJECT
```

### 5.2 Task Tracking (ADR-002: SQLite)

| Concept | Storage | Location |
|---|---|---|
| Execution ledger | SQLite | `~/.gwrk/gwrk.db` (global) |
| Task state export | Generated `tasks.json` | `specs/<feature>/.gwrk/tasks.json` |
| Gate enforcement | `gates/T0xx-gate.sh` (exit 0 = pass) | `specs/<feature>/gates/` |
| Run history | `runs` table | `~/.gwrk/gwrk.db` |
| Compression data | `compression` table | `~/.gwrk/gwrk.db` |

### 5.3 Hard Gate Architecture

For every task `T0xx`, there MUST be a corresponding `gates/T0xx-gate.sh`:

```bash
gwrk tasks next → T001
gates/T001-gate.sh → MUST FAIL (verify RED)
# ... agent implements ...
gates/T001-gate.sh → MUST PASS (verify GREEN)
gwrk tasks done → updates SQLite + regenerates tasks.json
```

Gates are generated FROM contracts, not from prose.

#### Gate Quality Standard

A gate is **hardened** when it invokes `pnpm vitest run <test-file>` to verify behavior — not just `test -f` to check file existence. Structural checks (`test -f`, `grep`) are scaffolding; behavioral checks (vitest) are the standard.

| Gate Quality | Assertion Type | TDD Hardened? |
|---|---|---|
| **Stub** | `test -f`, `grep` only | ❌ |
| **Structural** | `test -f` + `grep` + build check | ❌ |
| **Behavioral** | `pnpm vitest run <file>` + build | ✅ |
| **Authored** | `# AUTHORED` + behavioral + E2E | ✅✅ |

Reference implementation: `specs/013-agent-native-interface/gates/` — all 17 AUTHORED, 7 invoke vitest.

### 5.4 Spec-First Invariants

| ID | Invariant | Consequence |
|---|---|---|
| **I-GW-S01** | No implementation without approved `spec.md` + `plan.md` | `Reject` |
| **I-GW-S02** | Every task MUST have a corresponding gate script | `Block tasks done` |
| **I-GW-S03** | Gate must FAIL before implementation begins (verify RED) | `Reject` |
| **I-GW-S04** | `gwrk tasks done` MUST execute the gate before updating state | `Enforce` |
| **I-GW-S05** | Feature SP = Σ Phase SP = Σ Task SP | `Validate on plan-to-tasks` |

---

## 6. Multi-Agent Dispatch

### 6.1 Agent Router

| Task Type | Preferred Backend | Rationale |
|---|---|---|
| **Autonomous implementation** | Codex Cloud | True parallelism, no local resources |
| **Code review** | Codex (`@codex review`) | First-class GitHub integration |
| **Long-context refactoring** | Claude Code (local clone) | Deepest context window |
| **Multi-file generation** | Gemini CLI (local clone) | Strong parallel tool use |
| **Definition work** | Gemini CLI | Best at structured document generation |

Router learns from SQLite `runs` table: historical success rate × task SP × language → backend selection.

### 6.2 Ship Loop (Feature 004)

The autonomous coding cycle. Ends when a PR is issued and Slack is notified.

```
1. DISPATCH     → Agent receives phase context + governance rules
2. PRE-FLIGHT   → gates/T0xx-gate.sh must FAIL (verify RED)
3. EXECUTE      → Agent implements code + tests
4. POST-FLIGHT  → gates/T0xx-gate.sh must PASS (verify GREEN)
5. VERIFY       → Tests pass, lint clean, build succeeds
6. PR           → gwrk opens PR, CI runs
7. NOTIFY       → Slack: "PR ready for review" + summary
```

Retry logic: If checks fail at step 5, retry same agent (3×), then escalate to next backend in `fallbackOrder`. If all backends exhausted, Slack escalation to human.

### 6.3 Harvest (Feature 011)

Post-merge lifecycle. Triggered by GitHub webhook when PR is merged. Separate concern from Ship Loop.

```
8.  PR MERGED      → Build server receives GitHub webhook
9.  LOG RETRIEVAL  → Raw logs rehomed to specs/<feature>/.gwrk/runs/, git-committed
10. DB UPDATE      → SQLite run record finalized (exit code, duration, agent, phase)
11. COMPRESSION    → Point + Total compression calculated from Git timestamps vs effort
12. DONE, DONE!    → Slack: "🏆 Feature shipped" + compression summary
```

Ship Loop (004) produces the PR and logs. Harvest (011) consumes them after merge.

---

## 7. Git Branching Model

```
develop
  └── feature/<feature-name>-wip          (owned by ZFG)
        ├── phase/<feature-name>-phase-01  (owned by WUD #1)
        ├── phase/<feature-name>-phase-02  (owned by WUD #2)
        └── phase/<feature-name>-phase-03  (owned by WUD #3)
```

---

## 8. Config Contract

### `.gwrkrc.json` (Per-project)

```json
{
  "agents": {
    "defaults": {
      "implement": "codex-cloud",
      "review": "codex-github",
      "define": "gemini",
      "refactor": "claude"
    },
    "fallbackOrder": ["codex-cloud", "codex-local", "claude", "gemini"],
    "parallelism": {
      "local": { "maxClones": 3, "maxCpu": 80, "maxMem": 70 },
      "cloud": { "maxConcurrent": 10 }
    }
  }
}
```

### `~/.gwrkrc.json` (Global / user-level)

```json
{
  "defaults": {
    "projectsDir": "~/Code",
    "github": { "org": "gforge-esc", "visibility": "private" },
    "slack": { "createChannelOnNew": true },
    "tunnel": { "provider": "cloudflare" }
  }
}
```

### Environment Variables

All config validated by Zod with **no `.default()` calls** — missing var → `process.exit(1)`.

---

## 9. Coding Standards

| Standard | Tool | Rule |
|---|---|---|
| `.ts` only | Biome | No `.js` in `src/` |
| No `any` | Biome | Strict TypeScript |
| Zod for all schemas | Code review | Config, task state, API |
| Vitest for unit tests | `pnpm test` | Required |
| Files < 400 lines | Code review | Split by responsibility |
| Conventional commits | CI check | `feat:`, `fix:`, `chore:` |
| No magic values | Code review | All config from `.gwrkrc.json` or env |
| Fail-fast | Architecture | Missing config → crash, never default |

---

## 10. Testing Strategy

| Layer | Tool | What | Trigger |
|---|---|---|---|
| **Unit** | Vitest | Command logic, parser, state management | `pnpm test` |
| **Integration** | Vitest | End-to-end task lifecycle with SQLite (`:memory:`) | `pnpm test:integration` |
| **Gate validation** | Shell | `gates/T0xx-gate.sh` assertions | `gwrk tasks done` |
| **CLI smoke** | Shell | `gwrk --help`, `gwrk specify --help` | CI |

---

## 11. Implementation Features

See [specs/000-build-plan.md](file:///Users/gonzo/Code/gwrk/specs/000-build-plan.md) for the authoritative feature build sequence.

---

## 12. CLI Provisioning Matrix

`gwrk new` and `gwrk init` provision all detected AI CLIs:

| File/Dir | Gemini | Claude | Codex | Purpose |
|---|---|---|---|---|
| `GEMINI.md` | ✅ Required | — | — | Project context for Gemini CLI |
| `.gemini/settings.json` | ✅ Required | — | — | Model routing, tool config |
| `CLAUDE.md` | — | ✅ Required | — | Project context for Claude Code |
| `.claude/settings.json` | — | ✅ Required | — | Model prefs, permissions |
| `AGENTS.md` | — | — | ✅ Required | Project rules for Codex |
| `.agents/rules/` | Ref'd by GEMINI.md | Ref'd by CLAUDE.md | Ref'd by AGENTS.md | **Shared** governance |
| `.agents/workflows/` | Ref'd by GEMINI.md | Ref'd by CLAUDE.md | Ref'd by AGENTS.md | **Shared** workflows |

All context files reference the shared `.agents/` directory — governance rules are written once, consumed by all backends.
