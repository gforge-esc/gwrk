# gwrk: Architecture & Workflow Specification

> **Status:** Authoritative · **Date:** 2026-03-17 (v4.1)
> **Anchored to:** [GWRK-PRD-PRFAQ.md](file:///Users/gonzo/Code/gwrk/docs/GWRK-PRD-PRFAQ.md), [ADR-001-task-tracking.md](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-001-task-tracking.md), [ADR-002-sqlite-execution-ledger.md](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-002-sqlite-execution-ledger.md), [ADR-003-state-contract.md](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-003-state-contract.md), [ADR-004-agent-native-output.md](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-004-agent-native-output.md), [ADR-005-tdd-gate-architecture.md](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-005-tdd-gate-architecture.md), [ADR-006-plugin-agent-backends.md](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-006-plugin-agent-backends.md)

---

> **Update 2026-03-17 (v4.1):** OpenClaw integration audit. Added §6.5 Event Bus & Scheduler (F015 — WebSocket hybrid architecture, Zod-typed event frames, cron scheduler), expanded §6.2 Ship Loop with active interrupt model (`dispatch:cancel`), added §7.6 Plugin Supply-Chain Guardrails, added dispatch idempotency guard to §11, updated §10 tech stack with `@fastify/websocket` and `@fastify/schedule`. Derived from [openclaw-research-report.md](file:///Users/gonzo/Code/gwrk/docs/reference/openclaw-research-report.md).
>
> **Update 2026-03-17 (v4.0):** Aligned with all six ADRs and keystone features 000-TDD, 004 Ship Loop, 013 Agent-Native Interface, and 014 Plugin System. Key changes: added Agent-Native Output Protocol (§3), Plugin Architecture (§7), TDD Triad Model (§5.3–5.5), updated Project Structure (§4), Construction Pipeline (§5), Ship Loop dispatch boundary (§6.2), and Config Contract (§8). Previous v3.1 anchored only ADR-001, ADR-002, and ADR-006.

### Document Inventory

| Document | Path | Relevance |
|---|---|---|
| Build Plan | [specs/000-build-plan.md](file:///Users/gonzo/Code/gwrk/specs/000-build-plan.md) | Feature dependency graph, wave strategy, effort |
| ADR-001 Task Tracking | [docs/decisions/ADR-001-task-tracking.md](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-001-task-tracking.md) | Hard Gate Architecture |
| ADR-002 SQLite Ledger | [docs/decisions/ADR-002-sqlite-execution-ledger.md](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-002-sqlite-execution-ledger.md) | Execution ledger schema |
| ADR-003 State Contract | [docs/decisions/ADR-003-state-contract.md](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-003-state-contract.md) | Two-tier state: git manifests + SQLite harvest |
| ADR-004 Agent-Native Output | [docs/decisions/ADR-004-agent-native-output.md](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-004-agent-native-output.md) | Signal protocol, Layer 2, command classification |
| ADR-005 TDD Gate Architecture | [docs/decisions/ADR-005-tdd-gate-architecture.md](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-005-tdd-gate-architecture.md) | LLM-authored gates, Triad Model, deterministic vitest gates |
| ADR-006 Plugin Agent Backends | [docs/decisions/ADR-006-plugin-agent-backends.md](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-006-plugin-agent-backends.md) | AgentBackend interface, stdin delivery, exit normalization |
| F000-TDD Spec | [specs/000-tdd-infrastructure/spec.md](file:///Users/gonzo/Code/gwrk/specs/000-tdd-infrastructure/spec.md) | TDD mandate, gap matrix, deterministic gates |
| F004 Ship Loop Spec | [specs/004-ship-loop/spec.md](file:///Users/gonzo/Code/gwrk/specs/004-ship-loop/spec.md) | Autonomous execution kernel, dispatch boundary |
| F013 Agent-Native Spec | [specs/013-agent-native-interface/spec.md](file:///Users/gonzo/Code/gwrk/specs/013-agent-native-interface/spec.md) | Signal protocol, discovery, gate-check, Layer 2 |
| F014 Plugin System Spec | [specs/014-plugin-system/spec.md](file:///Users/gonzo/Code/gwrk/specs/014-plugin-system/spec.md) | Three-layer plugin architecture, skills, manifests |
| Plugin Strategy Audit | [docs/reference/plugin-strategy-audit.md](file:///Users/gonzo/Code/gwrk/docs/reference/plugin-strategy-audit.md) | F008→F014 P4 absorption analysis |
| Skills Architecture | [docs/reference/skills-architecture.md](file:///Users/gonzo/Code/gwrk/docs/reference/skills-architecture.md) | Two-tier skill hierarchy |
| OpenClaw Research Report | [docs/reference/openclaw-research-report.md](file:///Users/gonzo/Code/gwrk/docs/reference/openclaw-research-report.md) | Plugin architecture, WebSocket hybrid, adoption dynamics, reconciled integration decisions |

---

## 1. Architecture Overview

**TypeScript CLI + Local Daemon + Multi-Agent Dispatch.** gwrk is the Principal Engineer's operating system — a CLI and build server that orchestrates fleets of AI coding agents through governed, spec-first pipelines. Comms via Slack (Socket Mode). Dashboard via Slack App Home Tab.

```
┌── gwrk CLI ───────────────────────────────────────────────────────────┐
│  Commands: new, init, specify, plan, tasks, implement, ship, pulse,   │
│           discover, kw, project, gate-check, skill, plugin, test, …   │
│  npm install -g gwrk                                                  │
│  Agent-Native: [exit:N | Xs] on stderr, --format json, --agent mode   │
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
│  ┌── Event Bus (F015 — future) ────────────────────────────────────┐ │
│  │ WebSocket /ws    │ Cron (@fastify/schedule)                     │ │
│  │ dispatch:*       │ pulse (4h), compression (daily), heartbeat   │ │
│  │ gate:*, agent:*  │ (5min), stale-dispatch (30min)               │ │
│  │ dispatch:cancel  │ Event taxonomy: Zod-validated frames         │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ SQLite Execution Ledger (~/.gwrk/gwrk.db)                       │ │
│  │ projects · runs · compression · history                         │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
        │              │               │
        ▼              ▼               ▼
  ┌── Phone ──┐  ┌── Local ──┐  ┌── Agent Backend Plugins (ADR-006) ─┐
  │ Slack     │  │ Agent-ZFG │  │ F014 Layer 1: AgentBackend adapters │
  │ channels  │  │ owns orch │  │                                     │
  │ App Home  │  └───────────┘  │ dispatchToAgent(TaskDispatch)       │
  └──────────┘                 │   → stdin pipe (context delivery)   │
                               │   → exit code normalization         │
                               │                                     │
                               │ Adapters:                           │
                               │   Codex Cloud (true parallelism)    │
                               │   Codex Local  (local CLI)          │
                               │   Claude Code  (deep context)       │
                               │   Gemini CLI   (multi-file)         │
                               └─────────────────────────────────────┘
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

## 3. Agent-Native Output Protocol (ADR-004)

Every gwrk command is dual-mode: humans and LLM agents consume the same CLI. Three layers provide agent optimization without changing the output format.

### 3.1 Operational Signal Envelope

Every command emits on **stderr** on completion:

```
[exit:0 | 42ms]
[exit:1 | 3.2s] tasks list: Feature not found
```

- Always on stderr (pipe-safe — never contaminates stdout)
- Duration via `performance.now()`
- MUST be the **last line** on stderr (parseable by `tail -1`)

### 3.2 Output Modes

| Flag | stdout Format | Layer 2 | Activation |
|---|---|---|---|
| (default) | Human prose, ANSI colors | Off | Default |
| `--format json` | Structured JSON | Off | Explicit flag |
| `--agent` | Human prose, **ANSI-stripped** + protections | **On** | Flag or `GWRK_AGENT=1` |
| `--agent --format json` | Structured JSON + protections | On | Both flags |

`--agent` and `--format json` are **independent**. Text is the LLM's native format; JSON is opt-in.

### 3.3 Layer 2: Agent Presentation Processing

When `--agent` is active:

| Mechanism | Behavior |
|---|---|
| **ANSI stripping** | Remove all escape codes |
| **Binary guard** | Null bytes or >30% non-printable → `[binary content, <N> bytes]` |
| **Overflow mode** | >8KB → truncate to 100 lines + file reference |
| **Error navigation** | Exit ≥ 1 → `hint: <corrective action>` |

### 3.4 Command Classification

| Type | Meaning | Agent Safety |
|---|---|---|
| `query` | Returns facts, no side effects | Safe to call freely |
| `generator` | Produces a canonical artifact | Safe but expensive |
| `verifier` | Runs a gate, returns pass/fail | Safe, may be slow |
| `mutator` | Changes project state | Requires intent confirmation |

### 3.5 Exit Code Standard (ADR-004 §2.2)

| Code | Meaning | Agent Implication |
|---|---|---|
| 0 | Success | Proceed |
| 1 | Expected failure | Read stderr for guidance |
| 2 | Usage error | Re-read `--help` |
| 127 | Unknown command | Run `gwrk --help` |

### 3.6 Error-as-Navigation (F013 FR-007)

Every error includes what to run instead: `<what failed>. Run '<fix command>' to <resolution>.`

---

## 4. Project Structure

```bash
gwrk/
├── .agents/                        # Governance: rules, workflows, personas, scripts
│   ├── prompts/personas/          # PE, Senior Dev, PM persona definitions
│   ├── rules/                     # workspace.md, coding-style.md, etc.
│   ├── scripts/                   # Helper scripts
│   ├── skills/                    # Compound reasoning skills (IDE-native)
│   ├── templates/                 # monorepo-context.md, e2e-patterns.md
│   └── workflows/                 # specify.md, plan.md, implement.md, etc.
├── .specify/                      # Templates, scripts, memory
│   ├── scripts/bash/              # create-new-feature.sh, common.sh, etc.
│   └── templates/                 # spec-template.md, plan-template.md, etc.
├── GEMINI.md                      # Project context for Gemini CLI
├── CLAUDE.md                      # Project context for Claude Code
├── AGENTS.md                      # Project rules for Codex
├── .gemini/settings.json          # Gemini CLI model routing + tool config
├── .claude/settings.json          # Claude Code model preferences + permissions
├── docs/                          # Architecture, PRD, ADRs
│   ├── decisions/                 # ADR-001 through ADR-006
│   └── reference/                 # Agent backend research, plugin strategy audit
├── scripts/dev/                   # Shell orchestrators
│   ├── work-until-done.sh         # Phase orchestrator (ship loop core)
│   ├── wud-branch.sh              # Branch creation/checkout
│   ├── wud-verdict.sh             # Review verdict extraction
│   ├── wud-ci-wait.sh             # CI status polling
│   └── validate-staging.sh        # Out-of-scope file rejection (Design Mandate)
├── specs/                         # Feature Specifications (Foxtrot Charlie)
│   ├── 000-build-plan.md          # Master dependency graph
│   └── NNN-feature-name/
│       ├── spec.md
│       ├── plan.md
│       ├── .gwrk/tasks.json       # Source of truth for task state
│       ├── .gwrk/runs/            # Git-tracked execution manifests + logs (ADR-003)
│       ├── contracts/             # Method-level interface contracts (ADR-005)
│       ├── gates/                 # Hard Gate shell scripts (T0xx-gate.sh)
│       ├── gap-matrix.md          # Coverage audit: FR→test type→file→exists (ADR-005 §8)
│       └── gap-analysis.md        # FR-by-FR classification: ✅/⚠️/❌
├── src/                           # gwrk CLI source (TypeScript)
│   ├── cli.ts                     # Entry point + Commander routing
│   ├── commands/                  # Command implementations
│   │   ├── new.ts                 # Full project provisioning
│   │   ├── init.ts                # Add gwrk to existing project
│   │   ├── specify.ts
│   │   ├── plan.ts
│   │   ├── tasks.ts               # tasks list/ready/next/done
│   │   ├── tasks-generate.ts      # define tasks → tasks.json + gates (ADR-005)
│   │   ├── tests-generate.ts      # define tests → gap-matrix.md + RED tests (ADR-005 §8)
│   │   ├── implement.ts
│   │   ├── ship.ts                # Ship loop CLI (F004)
│   │   ├── test-cmd.ts            # gwrk test <feature> (F000-TDD FR-009)
│   │   ├── feature.ts             # End-to-end lifecycle
│   │   ├── discover.ts            # Discovery: fieldnote, compile, list
│   │   ├── kw.ts                  # Knowledge work: specify, plan, build-plan
│   │   ├── project.ts             # gwrk project discover/specs/gates (F013)
│   │   ├── gate-check.ts          # gwrk gate-check <task_id> (F013 FR-006)
│   │   ├── plugin.ts              # gwrk plugin install/remove/list (F014)
│   │   ├── skill.ts               # gwrk skill <name> (F014 Layer 2)
│   │   ├── pulse.ts               # Productivity dashboard
│   │   ├── compression.ts         # Effort vs. actual ratios
│   │   ├── effort.ts              # SP-driven estimation
│   │   ├── server.ts              # Daemon start/stop
│   │   └── setup-slack.ts         # Automated Slack app provisioning
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
│   │   └── slack-actions.ts       # Interactive message handlers
│   ├── engine/                    # Core computation engines
│   │   ├── pulse.ts               # Git log scanner + snapshot gen
│   │   ├── compression.ts         # Timestamp collection + ratio calc
│   │   ├── effort.ts              # SP extraction + role bracketing
│   │   ├── discover.ts            # Project discovery engine (F013 FR-004)
│   │   └── router.ts              # Backend selection (→ F014 P4)
│   ├── plugins/                   # Plugin infrastructure (F014)
│   │   ├── manifest.ts            # Manifest Zod schema (YAML)
│   │   ├── loader.ts              # Plugin scanner + resolver
│   │   ├── skill-runtime.ts       # Atomic + compound skill execution
│   │   └── migrate.ts             # .agents/skills/ → ~/.gwrk/plugins/ migration
│   └── utils/                     # Shared utilities
│       ├── exec.ts                # Shell command execution
│       ├── agent.ts               # dispatchToAgent() facade (→ F014 AgentBackend)
│       ├── signal.ts              # withSignal() HOF (ADR-004)
│       ├── output.ts              # CommandOutput: human/json formatting
│       ├── agent-layer.ts         # Layer 2: stripAnsi, guardBinary, truncateOverflow
│       ├── gate-gen.ts            # GateBrief generator + generateVitestGates() (ADR-005)
│       ├── state.ts               # Task read/write via local JSON
│       ├── history.ts             # History inserts via SQLite
│       ├── parser.ts              # Markdown → structured data
│       └── config.ts              # .gwrkrc.json loader (Zod, fail-fast)
├── .gwrkrc.json                   # Per-project agent config (Zod validated)
├── .gwrk/                         # Local project state + plugin overrides
│   ├── agent-context.md           # Single source of truth for agent governance (ADR-006 §2.2)
│   ├── plugins.yaml               # Per-project plugin overrides (disable/override)
│   ├── dispatches.jsonl            # Dispatch log (append-only, gitignored)
│   └── tasks.json                 # (per-feature: specs/NNN/.gwrk/tasks.json)
├── package.json
├── tsconfig.json
├── biome.json
└── Makefile                       # Universal orchestrator
```

**Global state (`~/.gwrk/`):**

```
~/.gwrk/
├── gwrk.db                            # SQLite execution ledger (ADR-002)
├── plugins/                           # Installed plugins (F014)
│   ├── skills/                        # Global only — operator capabilities
│   │   ├── narrative/                 # Atomic skill
│   │   │   ├── manifest.yaml          # Contract: identity, interface, runtime
│   │   │   └── SKILL.md               # Reasoning program: instructions, context
│   │   ├── signal-cut/                # Compound skill (multi-pass)
│   │   │   ├── manifest.yaml
│   │   │   └── SKILL.md
│   │   └── ...
│   ├── agents/                        # AgentBackend adapters (F014 P3, ADR-006)
│   │   ├── claude/manifest.yaml       # Claude Code adapter
│   │   ├── codex/manifest.yaml        # Codex adapter (local + cloud)
│   │   └── gemini/manifest.yaml       # Gemini CLI adapter
│   └── domains/                       # Domain packs (F016 — future)
│       ├── writing/manifest.yaml
│       └── client-engagement/manifest.yaml
└── config.yaml                        # Global plugin config (future)
```

**Resolution order:** Global `~/.gwrk/plugins/` → local `.gwrk/plugins.yaml` override → local disable. See §7.5.

---

## 5. The Construction Pipeline

### 5.1 The "One Right Way" Loop

```
/specify → spec.md + checklists/
    ↓         ← analyze perspective active (embedded, not separate)
/plan → plan.md + data-model.md + contracts/
    ↓         ← analyze perspective active
/define-tests → gap-matrix.md + *.test.ts (RED)           ← ADR-005 §8.4
    ↓         ← analyze perspective active
/plan-to-tasks → .gwrk/tasks.json + gates/T0xx-gate.sh + task_types
    ↓         ← deterministic vitest gates from gap matrix (primary)
    ↓         ← LLM-authored gates from contracts (fallback — ADR-005 §2.3)
/implement N → code + verify + commit + PR (gate-driven greedy loop)
    ↓
/review-code (PE) + /review-uat (PM) → GREEN or REJECT
```

> **Pipeline reorder (ADR-005 §8.4):** `define tests` runs BEFORE `define tasks`. The gap matrix feeds deterministic gate generation — most gates become `pnpm vitest run <file> --grep "<FR>"` with no LLM reasoning needed.

### 5.2 Task Tracking (ADR-002 + ADR-003)

| Concept | Storage | Location |
|---|---|---|
| **Tier 1: Operational** (git) | `tasks.json` + execution manifests | `specs/<feature>/.gwrk/` |
| **Tier 2: Analytical** (SQLite) | Runs, history, compression | `~/.gwrk/gwrk.db` (global) |
| Gate enforcement | `gates/T0xx-gate.sh` (exit 0 = pass) | `specs/<feature>/gates/` |
| Full agent logs | `.gwrk/runs/<timestamp>_<stage>.log` | `specs/<feature>/.gwrk/runs/` (git-tracked) |

**Two-tier state (ADR-003):** Agents write Tier 1 (git) — manifests and task state. Build server harvests Tier 1 into Tier 2 (SQLite) via `gwrk harvest`. Agents in Codex Cloud VMs have git access only — no SQLite, no build server.

### 5.3 TDD Triad Model (ADR-005 §8)

Three layers, each with a distinct job:

| Layer | Artifact | Producer | Purpose |
|---|---|---|---|
| **Gap Matrix** | `gap-matrix.md` | `gwrk define tests` | Coverage audit: every AC → test type, file, status |
| **Test Inventory** | `*.test.ts` (RED) | `gwrk define tests` | Describe blocks labeled by FR-###, failing pre-impl |
| **Gates** | `gates/T0xx-gate.sh` | `gwrk define tasks` | Deterministic vitest invocations from gap matrix |

### 5.4 Hard Gate Architecture (ADR-001 + ADR-005)

For every task `T0xx`, there MUST be a corresponding `gates/T0xx-gate.sh`:

```bash
gwrk tasks next → T001
gates/T001-gate.sh → MUST FAIL (verify RED)
# ... agent implements ...
gates/T001-gate.sh → MUST PASS (verify GREEN)
gwrk tasks done → updates SQLite + regenerates tasks.json
```

Gates are generated from **contracts** (ADR-005), not from prose. `GATE_STUB` is abolished.

#### Gate Generation Strategy (ADR-005 §8.3)

| Task has... | Gate strategy | Generator |
|---|---|---|
| Test file in gap matrix | Deterministic: `pnpm vitest run <file> --grep "<AC>"` | `generateVitestGates()` |
| No test file, has contracts | LLM-authored via `dispatchAgent()` | `/author-gates` workflow |
| No test file, no contracts | Honest failure: `echo "FAIL: cannot gate" && exit 1` | Skip |

#### Gate Quality Standard

| Gate Quality | Assertion Type | TDD Hardened? |
|---|---|---|
| **Stub** | `test -f`, `grep` only | ❌ |
| **Structural** | `test -f` + `grep` + build check | ❌ |
| **Behavioral** | `pnpm vitest run <file>` + build | ✅ |
| **Authored** | `# AUTHORED` + behavioral + E2E | ✅✅ |

`# AUTHORED` gates are never overwritten by `--force` or `--reconcile`.

### 5.5 Spec-First Invariants

| ID | Invariant | Consequence |
|---|---|---|
| **I-GW-S01** | No implementation without approved `spec.md` + `plan.md` | `Reject` |
| **I-GW-S02** | Every task MUST have a corresponding gate script | `Block tasks done` |
| **I-GW-S03** | Gate must FAIL before implementation begins (verify RED) | `Reject` |
| **I-GW-S04** | `gwrk tasks done` MUST execute the gate before updating state | `Enforce` |
| **I-GW-S05** | Feature SP = Σ Phase SP = Σ Task SP | `Validate on plan-to-tasks` |
| **I-GW-S06** | Contracts MUST exist for gate authoring (ADR-005 §2.1) | `Exit 1 with corrective` |
| **I-GW-S07** | Gap matrix → deterministic gate (primary); LLM → fallback | `ADR-005 §8.3` |

---

## 6. Multi-Agent Dispatch

### 6.1 Dispatch Boundary (F004 FR-019–021, ADR-006)

All agent work flows through a single facade:

```typescript
dispatchToAgent(task: TaskDispatch): Promise<TaskResult>
```

| Contract | Type | Fields |
|---|---|---|
| **TaskDispatch** | Input | `prompt`, `agent`, `workDir`, `stdin`, `env` |
| **TaskResult** | Output | `exitCode` (0/1/2/127), `errorType?`, `stdout`, `stderr`, `durationS` |

**Context delivery:** Stdin pipe is the **required** delivery mechanism (ADR-006 §2.3). Inline `-p "<prompt>"` MUST NOT be used for context >4096 bytes (ARG_MAX risk). All three CLIs accept stdin (verified).

**Exit code normalization:** Proprietary codes (e.g., Gemini `53` for turn limit) are mapped to `exitCode: 1` with `errorType: "turn_limit"`. Code `127` is POSIX-reserved for "command not found" — never overloaded.

> **Plugin migration (ADR-006):** The `dispatchToAgent()` facade today wraps `spawn(cli, args)`. When F014 ships, the internals are replaced by `pluginRegistry.getAgentBackend().dispatch()` — no other code changes. See §7.1.

### 6.2 Ship Loop (Feature 004)

The autonomous coding cycle. Ends when a PR is issued and Slack is notified.

```
1. DISPATCH     → Agent receives phase context + governance rules (via stdin)
2. PRE-FLIGHT   → gates/T0xx-gate.sh must FAIL (verify RED)
3. EXECUTE      → Agent implements code + tests
4. POST-FLIGHT  → gates/T0xx-gate.sh must PASS (verify GREEN)
5. VERIFY       → Tests pass, lint clean, build succeeds
6. PR           → gwrk opens PR, CI runs
7. NOTIFY       → Slack Incoming Webhook: "PR ready for review" + summary
```

**Notification architecture** (step 7): Ship loop runs in Codex Cloud VMs with no `localhost` access. Uses **Slack Incoming Webhook** (003 FR-014) as primary notify path — a single HTTPS POST to a Slack-provided URL. Works from any environment. Build server `/api/notify` is the enhanced path (adds presence-awareness, batching) used when available. Config: `SLACK_WEBHOOK_URL` env var → `.gwrkrc.json slack.webhookUrl` → `/api/notify` fallback.

**Retry logic:** If checks fail at step 5, retry same agent (3×), then escalate to next backend in `fallbackOrder`. If all backends exhausted, Slack escalation to human.

**Staging validation:** `validate-staging.sh` runs after agent completes, before push. Rejects out-of-scope files, orphan spec dirs, and build plan modifications.

**Interrupt model — two layers:**

| Mechanism | Type | Granularity | Trigger |
|---|---|---|---|
| **Circuit breaker** (FR-007) | Passive | Per-phase | `MAX_ITERATIONS` exceeded (default 3). Exit 1. `CIRCUIT_BREAK` state persisted with structured `failureContext` (open tasks, last verdict, iteration timeline, digest). |
| **`dispatch:cancel`** (F015 — future) | Active | Per-stage | Operator sends cancel via WebSocket (e.g., Slack "Cancel Ship" button → `/ws` → cancel flag). Orchestrator checks flag between stage transitions (same points where FR-008 persists state). Graceful stop at next stage boundary — no mid-agent-run interruption. |

The passive circuit breaker exhausts all iterations before stopping (up to 3 × 30 min = 90 min). The active cancel enables operator-initiated abort at the next stage boundary (≤30 min). Both mechanisms complement each other: circuit breaker catches unattended runaway loops; active cancel lets the operator cut short runs they already know are failing. `dispatch:redirect` (backend swap mid-run) is deferred — requires F014 P4 routing intelligence.

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

### 6.5 Event Bus & Scheduler (Feature 015 — Decided, Not Built)

> **Source:** [openclaw-research-report.md §2/§6.2/§7](file:///Users/gonzo/Code/gwrk/docs/reference/openclaw-research-report.md). Registered in build plan v9 (2026-03-15), 8 SP, Wave 5.

**Architecture decision: Hybrid HTTP + WebSocket.** HTTP for commands/queries (preserves `curl` CLI compatibility). WebSocket for events/streaming (real-time monitoring without polling). Primary rationale: for a single-user local service on macOS, WebSocket overhead is effectively zero — no load balancer, no proxy traversal, no TLS complexity (localhost), ~50KB memory for one persistent connection.

**WebSocket endpoint:** `/ws` via `@fastify/websocket`.

**Event taxonomy (Zod-validated frames):**

| Event | Direction | Payload | Consumer |
|---|---|---|---|
| `dispatch:started` | server → client | featureId, phaseId, backend, timestamp | Slack, dashboard |
| `dispatch:progress` | server → client | stage, iteration, summary | Slack App Home Tab |
| `dispatch:cancel` | client → server | featureId, phaseId | Ship loop orchestrator |
| `gate:result` | server → client | taskId, result (PASS/FAIL), durationMs | Slack, dashboard |
| `review:verdict` | server → client | featureId, phaseId, verdict, reviewer | Slack |
| `cron:pulse` | server → client | snapshotId, summary | Dashboard |
| `heartbeat` | bidirectional | timestamp, uptimeS | Connection health |
| `agent:status` | server → client | agentId, status (idle/running/error) | Dashboard |

**Cron scheduler:** `@fastify/schedule` (toad-scheduler). Jobs: `pulse` (4h), `compression` (daily), `heartbeat` (5min), `stale-dispatch` check (30min).

**Zod-typed event frames:** All events validated at emission and on receipt using Zod discriminated unions — consistent with gwrk's existing Zod-everywhere pattern. No cross-platform codegen (gwrk is TypeScript-only). If non-TS clients are needed later, `zod-to-json-schema` generates JSON Schema from Zod definitions.

**Consumers:** Slack App Home Tab (internal WS subscriber), future web dashboard, agent heartbeats from Docker sandboxes, Ship Loop monitoring (replaces hundreds of polling connections with one persistent WS).

### 6.4 Agent Router (→ F014 Phase 4)

> **Retirement (2026-03-17):** F008 (Agent Router) folded into F014 Phase 4: Routing Intelligence. The agent registry conflicted with F014's plugin registry. Quota probing is CLI-specific knowledge that belongs in AgentBackend adapter plugins (ADR-006). See [plugin-strategy-audit.md](file:///Users/gonzo/Code/gwrk/docs/reference/plugin-strategy-audit.md).

**Current routing heuristics** (survive as `src/engine/router.ts`, consumed by F014 P4):

| Task Type | Preferred Backend | Rationale |
|---|---|---|
| **Autonomous implementation** | Codex Cloud | True parallelism, no local resources |
| **Code review** | Codex (`@codex review`) | First-class GitHub integration |
| **Long-context refactoring** | Claude Code (local clone) | Deepest context window |
| **Multi-file generation** | Gemini CLI (local clone) | Strong parallel tool use |
| **Definition work** | Gemini CLI | Best at structured document generation |

Router learns from SQLite `runs` table: historical success rate × task SP × language → backend selection.

---

## 7. Plugin Architecture (F014, ADR-006)

### 7.1 Three-Layer Plugin Architecture

```
Layer 1: Agent Backend Plugins              ← ADR-006
         (Claude, Codex, Gemini adapters)
         Consumers: F004 Ship Loop, F005 Parallel Dispatch
         Contract: AgentBackend interface, stdin delivery, exit normalization

Layer 2: Skill Plugins                      ← F014
         (Atomic reasoning modes, compound compositions)
         Consumers: gwrk skill <name>, pipe composition
         Contract: manifest.yaml, SKILL.md, F013 signals

Layer 3: Extension Plugins                  ← Not yet specified
         (Domain Packs, Channel Adapters)
         Consumers: F012 Knowledge Work, F017 Channel Abstraction
         Contract: TBD
```

All plugins are CLI-native, pipe-composable, and inherit the F013 contract (`--format json`, `[exit:N | Xs]`, `--agent` mode). **Anti-MCP**: Unix-native, not server-coupled.

### 7.2 AgentBackend Interface (ADR-006 §2.1)

```typescript
interface AgentBackend {
  name: string;
  contextFileName: string;
  syncGovernance(projectRoot: string, governance: GovernanceContext): void;
  dispatch(task: TaskDispatch): {
    command: string; args: string[];
    stdin: string; env?: Record<string, string>;
    streamable: boolean;
  };
  parseResult(stdout: string, stderr: string, rawExitCode: number): TaskResult;
}
```

**Key principle:** `dispatch()` returns a stdin string. gwrk core pipes it to the CLI process. The plugin decides HOW to invoke — gwrk core only knows WHAT to dispatch.

### 7.3 Durable Governance (ADR-006 §2.2)

```
.gwrk/agent-context.md                 ← Single source of truth
    ↓  gwrk plugin sync-context
GEMINI.md, CLAUDE.md, AGENTS.md        ← Generated per-CLI context files
```

A single `.gwrk/agent-context.md` becomes the source of truth for durable governance. CLI-specific context files are generated from it via `gwrk plugin sync-context`. This prevents governance drift across CLIs.

### 7.4 Skill Hierarchy

| Tier | Description | LLM Calls | Example |
|---|---|---|---|
| **Atomic** | Single reasoning mode | 1 | `gwrk skill narrative < brief.md` |
| **Compound** | Multi-pass composition of atomics | 1 (assembled) | `gwrk skill signal-cut < brief.md` |

- **manifest.yaml** = contract (identity, interface, runtime): machine-readable
- **SKILL.md** = reasoning program (instructions, context): LLM-readable
- Skills are **global only** (`~/.gwrk/plugins/skills/`)
- Config format: **YAML** for all user-facing plugin config

### 7.5 Plugin Discovery

```
~/.gwrk/plugins/                       # Global plugin root
├── skills/                            # Atomic + compound skills
│   ├── narrative/manifest.yaml
│   ├── signal-cut/manifest.yaml
│   └── ...
├── agents/                            # AgentBackend adapters (F014 P3)
└── domains/                           # Domain packs (F016)

.gwrk/plugins.yaml                     # Per-project overrides (disable/override)
```

Resolution order: Global → local override → local disable.

### 7.6 Plugin Supply-Chain Guardrails

> **Source:** [openclaw-research-report.md §2.6/§7](file:///Users/gonzo/Code/gwrk/docs/reference/openclaw-research-report.md), OpenClaw integration audit (2026-03-17).

Layer 1 (AgentBackend) and future Layer 3 plugins include executable TypeScript. Supply-chain risks:

| Guardrail | Mechanism | Scope |
|---|---|---|
| **`--ignore-scripts`** | Plugin install MUST use `npm install --ignore-scripts` (or pnpm equivalent) to prevent arbitrary code execution during install | All npm-based plugins |
| **Path containment** | Plugin adapters MUST only read/write within their declared workspace (`projectRoot`). File operations outside the workspace are rejected. | Layer 1 AgentBackend |
| **Manifest validation** | `manifest.yaml` MUST pass Zod schema validation before the plugin is loaded. Invalid manifest → plugin rejected with error-as-navigation. | All layers |
| **Version pinning** | Installed plugins are pinned by version in `~/.gwrk/plugins/`. No floating versions, no auto-update. Operator explicitly runs `gwrk plugin update`. | All layers |

Layer 2 (Skills) are lower risk — they're markdown + YAML that invoke agent CLIs in YOLO mode. The agent CLI's own safety interlocks provide the boundary. Skills never execute code directly.

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
    "slack": { "createChannelOnNew": true }
  }
}
```

### `.gwrk/agent-context.md` (Durable governance — ADR-006)

Single source of truth for agent governance. CLI-specific context files (`GEMINI.md`, `CLAUDE.md`, `AGENTS.md`) are generated from it via `gwrk plugin sync-context`.

### `.gwrk/plugins.yaml` (Per-project plugin overrides — F014)

```yaml
disable:
  - domains/writing
override:
  truth-extract: ./local-skills/truth-extract
```

### Environment Variables

All config validated by Zod with **no `.default()` calls** — missing var → `process.exit(1)`.

---

## 9. Git Branching Model

```
develop
  └── feature/<feature-name>-wip          (owned by ZFG)
        ├── phase/<feature-name>-phase-01  (owned by WUD #1)
        ├── phase/<feature-name>-phase-02  (owned by WUD #2)
        └── phase/<feature-name>-phase-03  (owned by WUD #3)
```

---

## 10. Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **CLI framework** | Commander.js | Lightweight, zero-opinion, npm-standard |
| **Build Server** | Fastify | Lightweight daemon, localhost:18790 |
| **Event Bus** | `@fastify/websocket` | WebSocket `/ws` for event streaming (F015 — future). ~50KB, zero deps |
| **Scheduler** | `@fastify/schedule` (toad-scheduler) | Cron: pulse 4h, compression daily, heartbeat 5min (F015 — future) |
| **Comms** | `@slack/bolt` (Socket Mode) | Channel-per-project, threads, App Home Tab |
| **Sandbox** | Docker | Per-feature-phase container isolation |
| **Git Operations** | `gh` CLI + `git` | GitHub-native |
| **Agent Dispatch** | `dispatchToAgent()` facade | F014 `AgentBackend` plugins (ADR-006). Today wraps `spawn(cli)`, tomorrow calls plugin adapter |
| **Agent: Codex** | `codex exec --full-auto` | Cloud microVMs, true parallelism |
| **Agent: Claude** | `claude -p --output-format json` | Deepest context window, local |
| **Agent: Gemini** | `gemini -p --json` | Multi-file reasoning, local |
| **Execution Ledger** | `better-sqlite3` | Global DB, embedded, no server (ADR-002) |
| **Configuration** | Zod schemas | Fail-fast validation, no graceful defaults |
| **Plugin Config** | YAML (`manifest.yaml`, `plugins.yaml`) | Human-readable, machine-parseable (F014) |
| **Linting** | Biome | Lint + format |
| **Testing** | Vitest | Unit + integration + gate runner |
| **Language** | TypeScript (ES2022) | `.ts` only, no `.js` in `src/` |
| **Dashboard** | Slack App Home Tab (Block Kit) | Mobile-first, no separate SPA |

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
| **Mobile** | Already mobile via Slack app | Separate browser |
| **Build cost** | Block Kit JSON (~200 LOC) | Full SPA (~2000 LOC) |
| **Appropriate for** | Single-user ops view | Future: multi-user team dashboard |

---

## 11. Coding Standards

| Standard | Tool | Rule |
|---|---|---|
| `.ts` only | Biome | No `.js` in `src/` |
| No `any` | Biome | Strict TypeScript |
| Zod for all schemas | Code review | Config, task state, API, manifests |
| Vitest for unit tests | `pnpm test` | Required |
| Files < 400 lines | Code review | Split by responsibility |
| Conventional commits | CI check | `feat:`, `fix:`, `chore:` |
| No magic values | Code review | All config from `.gwrkrc.json` or env |
| Fail-fast | Architecture | Missing config → crash, never default |
| Dispatch idempotency | `dispatch.ts` | `enqueue()` deduplicates by featureId+phaseId; returns existing record if queued/running |
| `withSignal()` wrapping | ADR-004 | All command `.action()` callbacks |
| Error-as-navigation | F013 | Every error includes `Run '<command>'` suggestion |

---

## 12. Testing Strategy

| Layer | Tool | What | Trigger |
|---|---|---|---|
| **Unit** | Vitest | Command logic, parser, state, signal, Layer 2 | `pnpm test` |
| **Integration** | Vitest | End-to-end task lifecycle with SQLite (`:memory:`) | `pnpm test:integration` |
| **E2E** | Vitest + Shell | Ship loop scripts, branch/verdict/CI-wait | `scripts-e2e.test.ts` |
| **Gate validation** | Shell | `gates/T0xx-gate.sh` assertions | `gwrk tasks done` |
| **Feature test** | CLI | `gwrk test <feature> [--phase N]` | Manual / pre-ship |
| **CLI smoke** | Shell | `gwrk --help`, `gwrk specify --help` | CI |

---

## 13. Implementation Features

See [specs/000-build-plan.md](file:///Users/gonzo/Code/gwrk/specs/000-build-plan.md) for the authoritative feature build sequence.

---

## 14. CLI Provisioning Matrix

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

> **Plugin migration (ADR-006 §2.2):** A single `.gwrk/agent-context.md` will become the source of truth for durable governance. CLI-specific context files (`GEMINI.md`, `CLAUDE.md`, `AGENTS.md`) will be generated from it via `gwrk plugin sync-context`. Plugin agents declare which CLI config keys they manage; conflicts are detected pre-dispatch (ADR-006 §2.5). See §7.3.

All context files reference the shared `.agents/` directory — governance rules are written once, consumed by all backends.

### Config Ownership (ADR-006 §2.5)

| CLI | Plugin-Managed Artifact | Committed? |
|---|---|---|
| Claude | `.claude/settings.json` | ✅ Yes |
| Claude | `.claude/settings.local.json` | ❌ No |
| Codex | `.codex/` (local env) | ✅ Yes |
| Gemini | `.gemini/settings.json` | ✅ Yes |
| Gemini | `.gemini/sandbox-*.sb` / `.gemini/sandbox.Dockerfile` | ✅ Yes |
| All | `<CLI>.md` at project root | ✅ Yes (generated from `.gwrk/agent-context.md`) |
