# Agent-Native CLI Architecture

> **Status:** Authoritative · **Date:** 2026-03-13
> **Supersedes:** `why-nix.md`, `planning-cli-project-model.md`, `ship-loop-why-nix.md`
> **Decision:** [ADR-004](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-004-agent-native-output.md)
> **Anchored to:** [architecture.md](file:///Users/gonzo/Code/gwrk/docs/architecture.md), [FOXTROT-CHARLIE.md](file:///Users/gonzo/Code/gwrk/docs/FOXTROT-CHARLIE.md)

---

## 1. Core Thesis

LLM agents operate most effectively through Unix-style CLI interfaces. gwrk's CLI is not just a command set that agents happen to call — it is the **agent's operating environment**: a system that teaches agents how to operate, corrects their mistakes, and adapts its interface to their cognitive constraints.

This architecture is informed by the Manus "Why Nix" production findings and validated against their `agent-clip` reference implementation. Where agent-clip proves patterns conceptually, gwrk implements them end-to-end and extends them with governance, institutional memory, and a four-pillar operating model.

### 1.1 Foundational Claims

| Claim | Origin | Validation Status |
|---|---|---|
| CLI is the LLM's native tool interface | Manus production (500K+ agents) | ✅ Proven at scale |
| Single `run()` tool outperforms function catalogs | agent-clip source + Manus metrics | ✅ Implemented and measured |
| Pipe/chain composition is natively understood by LLMs | Pre-training on Unix corpus | ✅ Proven via chain.go |
| `--help` is the discovery protocol LLMs prefer | Manus production | ✅ Implemented in agent-clip |
| `[exit:N \| Xs]` operational signals teach agents cost awareness | Manus post (conceptual) | ⚠️ Not implemented in agent-clip. gwrk builds this. |
| Binary guard and overflow mode prevent context corruption | Manus post (conceptual) | ⚠️ Not implemented in agent-clip. gwrk builds this. |

### 1.2 The Two-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 2: Agent Presentation (active when --agent)                  │
│  ┌───────────┬──────────────┬─────────────┬───────────────────────┐ │
│  │ ANSI      │ Binary       │ Overflow    │ Error                 │ │
│  │ stripping │ guard        │ truncation  │ navigation            │ │
│  └───────────┴──────────────┴─────────────┴───────────────────────┘ │
│                                                                      │
│  Layer 1: Unix Execution (always active)                             │
│  ┌───────────┬──────────────┬─────────────┬───────────────────────┐ │
│  │ Commander │ Exit code    │ Pipe/chain  │ [exit:N | Xs]         │ │
│  │ dispatch  │ contract     │ composition │ signal (stderr)       │ │
│  └───────────┴──────────────┴─────────────┴───────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

- **Layer 1** always runs. Human users get standard terminal output plus the operational signal on stderr.
- **Layer 2** activates with `--agent` flag or `GWRK_AGENT=1`. Produces clean, bounded, machine-parseable output.
- Pipes operate at Layer 1: `gwrk project discover --json | gwrk define plan --json` keeps raw data in the pipe. Layer 2 processes only the final output.

---

## 2. The Six Design Imperatives

### Imperative 1: CLI-as-Operating-Language

Agents interact with gwrk through **stable CLI commands**, not arbitrary shell access. WUD does not run `ls`, `grep`, `cat` against the project — it calls `gwrk project discover`, `gwrk tasks next`, `gwrk gate-check`.

**Before (script runner)**:
```bash
# WUD has full shell, improvises discovery
ls specs/004-ship-loop/
cat specs/004-ship-loop/.gwrk/tasks.json | jq '.phases[0].tasks[] | select(.status=="open")'
bash specs/004-ship-loop/gates/T001-gate.sh
```

**After (CLI consumer)**:
```bash
gwrk project discover --json           # structured project state
gwrk tasks next 004-ship-loop p1 --json # next open task
gwrk gate-check T001 --json             # structured gate result
gwrk tasks done 004-ship-loop T001      # complete (gate enforced)
```

Any LLM backend (Codex, Claude, Gemini) can run this loop because the interface is stable, discoverable, and self-documenting.

### Imperative 2: Project-as-Queryable-Directory

The project directory is not a passive filesystem — it is a **command-line database** that agents interrogate. `gwrk project discover` returns the full project state as structured JSON:

```json
{
  "project": {
    "name": "gwrk",
    "root": "/Users/gonzo/Code/gwrk",
    "git": { "branch": "feat/004-ship-loop", "clean": false }
  },
  "specs": [
    { "id": "004", "name": "ship-loop", "status": "defining", "phases": 3, "tasks_open": 12 }
  ],
  "gates": { "total": 24, "passing": 18, "failing": 4 },
  "build": { "test_command": "pnpm test", "lint_command": "pnpm biome check" }
}
```

Data sources: `.git/`, `specs/*/spec.md`, `.gwrk/tasks.json`, `gates/T*-gate.sh`, `pnpm test --coverage`, `.gwrkrc.json`.

### Imperative 3: Planning-as-Gap-Analysis

Planning is a computable function:

```
plan = f(spec, discover(project))
delta = spec - project_state
phases = decompose(delta)
```

`gwrk define plan` accepts discovery JSON on stdin and produces a plan that addresses only the delta between specification and current state. No re-implementing what exists. No guessing about project structure.

### Imperative 4: Phases-as-Planned-Output

Every phase has:
- **Objective**: Single coherent sentence describing the goal
- **Scope**: Explicit `in_scope` / `out_of_scope` declarations
- **Classification**: Each task is greenfield | change | refactor | noop
- **Gates**: Verification assertions that must pass for completion
- **Dependencies**: Phase ordering via predecessor declarations

### Imperative 5: Gates-as-Verification

Gates are binary assertions (exit code 0 or 1). `gwrk gate-check` is the first-class command:

```bash
gwrk gate-check T001 --json
# stdout: { "task": "T001", "result": "FAIL", "assertions": 5, "passing": 3, "failing": 2, "details": [...] }
# stderr: [exit:1 | 850ms]
```

### Imperative 6: Operational Signals for Learning

Every command emits `[exit:N | Xs]` on stderr. This creates a learnable cost model:

| Duration | Classification | Agent Behavior |
|---|---|---|
| < 50ms | Probe | Safe for discovery loops |
| 50ms – 5s | Work | Normal operation |
| 5s – 60s | Heavy | Gate-level, plan around it |
| > 60s | Agent dispatch | Use circuit breakers |

Signals flow into the SQLite execution ledger (ADR-002/003), enabling the agent router (P8) to learn optimal backend selection from accumulated data.

---

## 3. Command Surface

### 3.1 Foxtrot Charlie Pillars

| Command | Type | Description |
|---|---|---|
| `gwrk define spec` | generator | Produce specification from discovery |
| `gwrk define plan` | generator | Produce plan via gap analysis (accepts stdin) |
| `gwrk define tasks` | generator | Decompose plan into tasks.json |
| `gwrk define analyze` | generator | Run cross-artifact consistency check |
| `gwrk ship` | mutator | Autonomous implement → review → PR loop |
| `gwrk test` | verifier | Run scoped vitest suite |
| `gwrk measure pulse` | query | Git-based productivity snapshot |
| `gwrk measure effort` | query | SP-driven estimation |
| `gwrk measure compression` | query | Delivery speed measurement |

### 3.2 Project Discovery

| Command | Type | Description |
|---|---|---|
| `gwrk project discover` | query | Full project state JSON |
| `gwrk project specs` | query | Spec inventory with status |
| `gwrk project gates` | query | Aggregate gate results |
| `gwrk project files` | query | Structured source tree with intent markers |

### 3.3 Execution

| Command | Type | Description |
|---|---|---|
| `gwrk tasks list` | query | List tasks for a feature |
| `gwrk tasks next` | query | Next open task in phase |
| `gwrk tasks done` | mutator | Complete task (gate enforced) |
| `gwrk gate-check` | verifier | Run gate script, return structured result |

### 3.4 Operations

| Command | Type | Description |
|---|---|---|
| `gwrk init` | mutator | Add gwrk to existing project |
| `gwrk status` | query | Active agents, system state |
| `gwrk server start/stop` | mutator | Daemon lifecycle |
| `gwrk setup slack` | mutator | Slack app provisioning |
| `gwrk db runs/stats` | query | Execution ledger queries |

### 3.5 Help Contract

Every `--help` includes agent-useful information in standard text:

```
gwrk gate-check <task_id>

  Run a gate script and return structured result.

  Type: verifier (read-only, no side effects)

  Arguments:
    task_id       Task ID, e.g. T001 (required)

  Options:
    -f, --feature  Feature directory path
    --format json  Output as structured JSON

  Exit codes:
    0  gate passed
    1  gate failed
    2  usage error
```

Agents discover `--format json` naturally through `--help` — the same way a human engineer discovers flags. No special metadata format is needed; LLMs parse help text natively.
```

---

## 4. Foxtrot Charlie Mapping

The three Why-nix heuristic techniques map directly to gwrk's four-pillar operating model:

```
Technique         Pillar          gwrk Manifestation
──────────────────────────────────────────────────────────────────
--help discovery → Discovery(P1) → gwrk project discover ("What exists?")
Error navigation → Definition(P2) → gwrk define plan ("What needs to change?")
[exit:N | Xs]    → Shipping(P3)  → gwrk gate-check + tasks done ("Is it done?")
(no equivalent)  → Delivery(P4)  → gwrk measure compression ("Did it create value?")
```

gwrk extends the Why-nix model with a fourth dimension: **institutional memory**. Every operational signal flows into the execution ledger, creating a compounding advantage that makes agents smarter with each session.

---

## 5. What agent-clip Proves vs. What gwrk Builds

| Capability | agent-clip Status | gwrk Plan |
|---|---|---|
| Single `run()` tool | ✅ Proven | Apply via CLI-as-operating-language |
| Chain parser (pipe/&&/||) | ✅ Proven | Layer 1 pipe composition |
| Progressive `--help` | ✅ Proven | Agent-negotiation surface with I/O contracts |
| Error-as-navigation | ⚠️ Partial (~5 places) | Systematic across all commands |
| stdout/stderr separation | ✅ At Output layer | At both Output and command layer |
| `[exit:N \| Xs]` signal | ❌ Conceptual only | **gwrk implements from scratch** |
| Binary guard | ❌ Does not exist | **gwrk implements from scratch** |
| Overflow mode | ❌ Does not exist | **gwrk implements from scratch** |
| Layer 2 presentation | ❌ Conceptual only | **gwrk implements: `--agent` mode** |
| Spec-first governance | N/A (not a dev tool) | Foxtrot Charlie pillars |
| Project discovery engine | N/A | `gwrk project discover` |
| Planning as gap analysis | N/A | `gwrk define plan` with stdin |
| Execution ledger + learning | N/A | ADR-002/003 + agent router |

---

## 6. Strategic Value

### Why gwrk Is the Most Powerful Expression

agent-clip gives an agent a CLI and says "figure it out." The agent has `cat`, `ls`, `grep`, `write`. But it has no concept of what should exist (spec), what does exist (discovery), what's the delta (plan), what's done (gate), or what worked before (ledger).

gwrk fills every gap. When WUD calls `gwrk project discover --json`, it gets a structured representation of reality. When it calls `gwrk define plan --json`, it gets a structured representation of intent. The delta is the work. The gate is the proof. The ledger is the memory.

This is the algebra: `reality + intent → delta → phases → gates → ledger → learning → better routing`.

Nobody else is building this.

---

## 7. Source Lineage

This document synthesizes and supersedes:

| Document | Key Contribution | Status |
|---|---|---|
| `why-nix.md` | Single-tool thesis, three heuristic techniques, two-layer architecture | Absorbed: §1, §2 |
| `planning-cli-project-model.md` | Six design imperatives, command taxonomy, phase schema | Absorbed: §2, §3 |
| `ship-loop-why-nix.md` | WUD-as-CLI-consumer question, phase/gate definitions | Absorbed: §2.1, §2.5 |
| `agent-clip` source audit | Literal vs conceptual validation, compliance scorecard | Absorbed: §1.1, §5 |
