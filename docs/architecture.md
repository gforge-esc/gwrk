# gwrk: Architecture & Workflow Specification

> **Status:** Authoritative · **Date:** 2026-02-26
> **Anchored to:** [GWRK-PRD-PRFAQ.md](file:///Users/gonzo/Code/gwrk/docs/GWRK-PRD-PRFAQ.md), [ADR-001-task-tracking.md](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-001-task-tracking.md)

---

## 1. Architecture Overview

**TypeScript CLI + Local Daemon + Multi-Agent Dispatch.** gwrk is the Principal Engineer's operating system — a CLI and build server that orchestrates fleets of AI coding agents through governed, spec-first pipelines.

```
┌── gwrk CLI ───────────────────────────────────────────────────────────┐
│  Commands: specify, plan, tasks, implement, wud, feature, pulse, …   │
│  npm install -g gwrk                                                  │
└───────────┬───────────────────────────────────────────────────────────┘
            │
            ▼
┌── gwrk server (localhost:18790) ──────────────────────────────────────┐
│                                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────────┐  │
│  │ Dispatch     │  │ Git Manager │  │ Telegram Channel (grammY)    │  │
│  │ Queue        │  │             │  │                              │  │
│  │ - Phase pool │  │ - Branch    │  │ - Status updates             │  │
│  │ - Agent pool │  │ - Merge     │  │ - Inline review buttons      │  │
│  │ - Retry +    │  │ - Conflict  │  │ - /status, /approve, /pulse  │  │
│  │   escalation │  │   resolution│  │ - DUT ideation threads       │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────────┬───────────────┘  │
│         │                │                         │                  │
│  ┌──────▼─────────────────▼─────────────────────────▼──────────────┐  │
│  │              Docker Sandbox Manager                              │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │  │
│  │  │ Phase 01 │  │ Phase 02 │  │ Phase 03 │  ...                  │  │
│  │  │ WUD #1   │  │ WUD #2   │  │ WUD #3   │                      │  │
│  │  └──────────┘  └──────────┘  └──────────┘                      │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌──────────────────┐  ┌──────────────────┐ ┌──────────────────────┐ │
│  │ Pulse Engine     │  │ Review & CI Gate │ │ Compression Engine   │ │
│  │ Git log scanner  │  │ /review-code     │ │ SP vs Git timestamps │ │
│  │ Snapshot gen     │  │ /review-uat      │ │ Point & Total ratios │ │
│  └──────────────────┘  └──────────────────┘ └──────────────────────┘ │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ Glass Dashboard (:18790/dashboard)                               │ │
│  │ Mobile-first SPA · SSE events · Ops/Pulse/Compression views     │ │
│  │ Tunnel: ngrok / cloudflared / tailscale                          │ │
│  │ Auth: Telegram magic link (time-limited JWT)                     │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
        │              │               │
        ▼              ▼               ▼
  ┌── Phone ──┐  ┌── Local ──┐  ┌── Agent Backends ──────────────────┐
  │ Telegram  │  │ Agent-ZFG │  │ Codex Cloud (true parallelism)     │
  │ interface │  │ owns orch │  │ Claude Code (deep context, local)  │
  │ Dashboard │  └───────────┘  │ Gemini CLI  (multi-file, local)    │
  │ via tunnel│                 └────────────────────────────────────┘
  └──────────┘
```

---

## 2. The Agent Family

| Agent | Name | Role | Environment | Hands Off To |
|---|---|---|---|---|
| **DUT** | Dream Until Told | Ideate, clarify, spec | Telegram | → DUS |
| **DUS** | Define Until Solid | Spec → plan → tasks → analyze | Local CLI | → ZFG |
| **ZFG** | Zero F*cks Given | Orchestrate, merge, resolve | Local daemon | → WUD |
| **WUD** | Work Until Done | Implement, test, PR | Cloud VM or local clone | → ✅ merge |

**Pipeline**: `DUT → DUS → ZFG → WUD → Done, Done!`

---

## 3. Project Structure

```bash
gwrk/
├── .agent/                        # Governance: rules, workflows, personas, scripts
│   ├── prompts/personas/          # PE, Senior Dev, PM persona definitions
│   ├── rules/                     # workspace.md, coding-style.md, etc.
│   ├── scripts/                   # Helper scripts
│   ├── templates/                 # monorepo-context.md, e2e-patterns.md
│   └── workflows/                 # specify.md, plan.md, implement.md, etc.
├── .specify/                      # Templates, scripts, memory
│   ├── scripts/bash/              # create-new-feature.sh, common.sh, etc.
│   └── templates/                 # spec-template.md, plan-template.md, etc.
├── docs/                          # Architecture, PRD, ADRs
├── scripts/dev/                   # Shell orchestrators (agent-run.sh, etc.)
├── specs/                         # Feature Specifications (Foxtrot Charlie)
│   ├── 000-build-plan.md          # Master dependency graph
│   └── NNN-feature-name/
│       ├── spec.md
│       ├── plan.md
│       ├── .gwrk/tasks.json       # Flat-file task state (ADR-001)
│       ├── contracts/             # Method-level interface contracts
│       ├── gates/                 # Hard Gate shell scripts (T0xx-gate.sh)
│       └── gap-analysis.md        # Code audit findings
├── src/                           # gwrk CLI source (TypeScript)
│   ├── cli.ts                     # Entry point + Commander routing
│   ├── commands/                  # Command implementations
│   │   ├── specify.ts
│   │   ├── plan.ts
│   │   ├── tasks.ts               # tasks list/ready/next/done
│   │   ├── implement.ts
│   │   ├── wud.ts                 # Work Until Done loop
│   │   ├── feature.ts             # End-to-end lifecycle
│   │   ├── pulse.ts               # Productivity dashboard
│   │   ├── compression.ts         # Effort vs. actual ratios
│   │   ├── effort.ts              # SP-driven estimation
│   │   └── server.ts              # Daemon start/stop
│   ├── server/                    # Build server (Fastify daemon)
│   │   ├── index.ts               # Server bootstrap
│   │   ├── dispatch.ts            # Agent dispatch queue
│   │   ├── git-manager.ts         # Branch, merge, conflict resolution
│   │   ├── sandbox.ts             # Docker container lifecycle
│   │   └── telegram.ts            # grammY bot integration
│   ├── engine/                    # Core computation engines
│   │   ├── pulse.ts               # Git log scanner + snapshot gen
│   │   ├── compression.ts         # Timestamp collection + ratio calc
│   │   ├── effort.ts              # SP extraction + role bracketing
│   │   └── router.ts              # Agent backend selection
│   └── utils/                     # Shared utilities
│       ├── exec.ts                # Shell command execution
│       ├── state.ts               # tasks.json read/write (Zod-validated)
│       ├── parser.ts              # Markdown → structured data
│       └── config.ts              # .gwrkrc.json loader (Zod, fail-fast)
├── .gwrkrc.json                   # Per-project agent config
├── package.json
├── tsconfig.json
├── biome.json
└── Makefile                       # Universal orchestrator
```

---

## 4. Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **CLI framework** | Commander.js | Lightweight, zero-opinion, npm-standard |
| **Build Server** | Fastify | Lightweight daemon, localhost:18790 |
| **Telegram** | grammY | Same lib as OpenClaw, production-proven |
| **Sandbox** | Docker | Per-phase container isolation |
| **Git Operations** | `gh` CLI + `git` | GitHub-native |
| **Agent: Codex** | `codex exec --full-auto` | Cloud microVMs, true parallelism |
| **Agent: Claude** | `claude -p --output-format json` | Deepest context window, local |
| **Agent: Gemini** | `gemini -p --json` | Multi-file reasoning, local |
| **Task Tracking** | Flat JSON/JSONL | `.gwrk/tasks.json`, branch-scoped (ADR-001) |
| **Configuration** | Zod schemas | Fail-fast validation, no graceful defaults |
| **Linting** | Biome | Lint + format |
| **Testing** | Vitest | Unit + integration |
| **Language** | TypeScript (ES2022) | `.ts` only, no `.js` in `src/` |
| **Glass Dashboard** | Vite SPA (React, embedded static assets) | Mobile-first, served at `:18790/dashboard` |
| **Dashboard Streaming** | Server-Sent Events (SSE) | Real-time ops events via Fastify |
| **Tunnel** | ngrok / cloudflared / tailscale | Provider abstraction, remote access |
| **Dashboard Auth** | JWT via Telegram magic link | Read-only, time-limited, zero-friction |

### Why Commander.js, Not Ink

Ink (React for the terminal) was considered and **rejected** for the CLI layer:

| Concern | Commander.js | Ink |
|---|---|---|
| **Command model** | gwrk commands are dispatch-and-exit (fork `gemini`, wait, done) | Ink is for persistent, interactive terminal UIs |
| **Weight** | ~50 KB, zero transitive deps | Pulls React, Yoga, reconciler (~5 MB) |
| **Agent compatibility** | Agents call `gwrk tasks done` — needs instant exit | Ink renders a persistent React tree |
| **Server output** | The daemon uses Telegram, not a TUI | Ink would compete with the TTY |
| **Appropriate for** | `gwrk pulse`, `gwrk status`, `gwrk tasks list` | A full-screen dashboard app |

**Ink is not off the table forever** — `gwrk pulse dashboard` could be a future Ink-based TUI. But the core CLI is Commander.js commands that exit cleanly.

### Why Glass Dashboard, Not Grafana

A Prometheus/Grafana/Loki stack was considered and **rejected** for v1:

| Concern | Glass Dashboard (embedded SPA) | Grafana Stack |
|---|---|---|
| **Weight** | Zero external deps — bundled into daemon | 3 separate services (Prometheus, Grafana, Loki) |
| **Remote access** | Single port + tunnel + Telegram magic link | Three ports to tunnel |
| **Auth** | JWT from Telegram (already paired) | Separate Grafana auth |
| **Mobile** | Mobile-first by design | Grafana has responsive views, but not mobile-first |
| **Appropriate for** | Single-user local daemon | Team build server, gwrk-as-a-service |

---

## 5. The Construction Pipeline

### 5.1 The "One Right Way" Loop

```
/specify → spec.md + checklists/
    ↓
/plan → plan.md + data-model.md + contracts/
    ↓
/plan-to-tasks → .gwrk/tasks.json + gates/T0xx-gate.sh
    ↓
/analyze → consistency audit
    ↓
/implement N → code + verify + commit + PR (gate-driven greedy loop)
    ↓
/review-code (PE) + /review-uat (PM) → GREEN or REJECT
```

### 5.2 Task Tracking (ADR-001: Flat JSON)

| Concept | Storage | Location |
|---|---|---|
| Feature hierarchy | `tasks.json` | `specs/<feature>/.gwrk/tasks.json` |
| Status transitions | `history.jsonl` (append-only) | `.gwrk/history.jsonl` |
| Task state | `open`, `in_progress`, `completed` | Per-task in `tasks.json` |
| Gate enforcement | `gates/T0xx-gate.sh` (exit 0 = pass) | `specs/<feature>/gates/` |

**Branch scoping is decisive.** When Agent-ZFG dispatches three WUD agents to three branches, each branch carries its own `.gwrk/tasks.json` — isolated state that follows the branch.

### 5.3 Hard Gate Architecture

For every task `T0xx`, there MUST be a corresponding `gates/T0xx-gate.sh`:

```bash
gwrk tasks next → T001
gates/T001-gate.sh → MUST FAIL (verify RED)
# ... agent implements ...
gates/T001-gate.sh → MUST PASS (verify GREEN)
gwrk tasks done → updates tasks.json
```

Gates are generated FROM contracts, not from prose. They contain `grep`, `test -f`, `jq` assertions.

### 5.4 Spec-First Invariants

| ID | Invariant | Consequence |
|---|---|---|
| **I-GW-S01** | No implementation without approved `spec.md` + `plan.md` | `Reject` |
| **I-GW-S02** | Every task MUST have a corresponding gate script | `Block tasks done` |
| **I-GW-S03** | Gate must FAIL before implementation begins (verify RED) | `Reject` |
| **I-GW-S04** | `gwrk tasks done` MUST execute the gate before updating state | `Enforce` |

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

### 6.2 Done, Done! Protocol

```
1. DISPATCH    → Agent receives phase context + governance rules
2. PRE-FLIGHT  → gates/T0xx-gate.sh must FAIL (verify RED)
3. EXECUTE     → Agent implements code + tests
4. POST-FLIGHT → gates/T0xx-gate.sh must PASS (verify GREEN)
5. VERIFY      → Tests pass, lint clean, build succeeds
6. PR          → gwrk opens PR, CI runs
7. RETRY?      → If checks fail: retry same agent (3×), then escalate to next backend
8. DONE, DONE! → PR merged, Telegram 🏆, compression recorded
```

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
| **Integration** | Vitest | End-to-end task lifecycle with real JSON | `pnpm test:integration` |
| **Gate validation** | Shell | `gates/T0xx-gate.sh` assertions | `gwrk tasks done` |
| **CLI smoke** | Shell | `gwrk --help`, `gwrk specify --help` | CI |

---

## 11. Implementation Phases

See [specs/000-build-plan.md](file:///Users/gonzo/Code/gwrk/specs/000-build-plan.md) for the authoritative build sequence.
