# CLI Grammar & Command Governance

> **Status:** Authoritative · **Date:** 2026-05-12
> **Decision:** [US-025](file:///Users/gonzo/Code/gwrk/specs/001-cli-core/spec.md)
> **Anchored to:** [architecture.md](file:///Users/gonzo/Code/gwrk/docs/architecture.md), [001-cli-core/spec.md](file:///Users/gonzo/Code/gwrk/specs/001-cli-core/spec.md)

---

## 1. Core Grammar Principles

The `gwrk` CLI is designed as an **agent-native operating environment**. Its grammar is optimized for both human clarity and LLM parseability.

### 1.1 The Pillar-Based Hierarchy
Commands are organized into three primary pillars representing the software delivery lifecycle:

1.  **Clarity (Define):** Specifying, planning, and decomposing work.
2.  **Throughput (Ship):** Autonomous implementation and verification.
3.  **Value (Measure):** Quantifying impact, effort, and compression.

### 1.2 Canonical Command Syntax
All commands follow a strict positional grammar:

```bash
gwrk <verb> [subverb] <feature> [phase] [arguments] [options]
```

-   **Verb:** The primary action or pillar (e.g., `define`, `ship`, `measure`).
-   **Subverb:** The specific operation within the pillar (e.g., `spec`, `plan`, `pulse`).
-   **Feature:** The target feature ID (e.g., `001-cli-core`). Supports prefix resolution (e.g., `001`).
-   **Phase:** Optional phase identifier for implementation tasks (e.g., `phase-1`).
-   **Options:** Double-dash flags (e.g., `--json`, `--agent`).

---

## 2. Command Inventory

### 2.1 Clarity Pillar (`define`)
| Command | Type | Description |
|---|---|---|
| `gwrk define spec <feature>` | generator | Produce specification from discovery |
| `gwrk define plan <feature>` | generator | Produce plan via gap analysis |
| `gwrk define tasks <feature>` | generator | Decompose plan into tasks.json and gate scripts |
| `gwrk define analyze <feature>` | generator | Run cross-artifact consistency check |
| `gwrk define tests <feature>` | generator | Generate test files based on plan |

### 2.2 Throughput Pillar (`ship`, `tasks`, `test`)
| Command | Type | Description |
|---|---|---|
| `gwrk ship <feature> <phase>` | mutator | Full autonomous implement → review → PR loop |
| `gwrk tasks list <feature>` | query | List tasks for a feature |
| `gwrk tasks next <feature> <phase>` | query | Next open task in phase |
| `gwrk tasks done <feature> <task_id>` | mutator | Complete task (gate enforced) |
| `gwrk tasks verify <feature>` | verifier | Post-merge task state integrity check |
| `gwrk test <feature>` | verifier | Run scoped vitest suite |

### 2.3 Value Pillar (`measure`)
| Command | Type | Description |
|---|---|---|
| `gwrk measure pulse` | query | Git-based productivity snapshot |
| `gwrk measure effort <feature>` | query | SP-driven estimation |
| `gwrk measure compression <feature>` | query | Delivery speed measurement |

### 2.4 Operational & Data Commands
| Command | Type | Description |
|---|---|---|
| `gwrk init` | mutator | Initialize gwrk in a project |
| `gwrk setup` | mutator | Interactive workstation provisioning |
| `gwrk status` | query | System state and active agents |
| `gwrk db runs <feature>` | query | Execution ledger history |
| `gwrk db stats` | query | Aggregate success rates by command/agent |

---

## 3. I/O & Presentation Contract

### 3.1 The Two-Layer Architecture
gwrk implements a layered output model to serve both humans and agents.

-   **Layer 1: Unix Execution (Default)**
    -   Standard terminal output.
    -   ANSI colors for readability.
    -   Operational signal on `stderr`: `[exit:N | Xs]` (Exit code and duration).
-   **Layer 2: Agent Presentation (`--agent` / `GWRK_AGENT=1`)**
    -   ANSI stripping (clean text).
    -   Binary guard and overflow truncation (prevents context corruption).
    -   Machine-parseable error navigation.

### 3.2 Structured Data (`--json`)
Commands that produce data for downstream consumption MUST support the `--json` flag. When active:
-   `stdout` contains a single valid JSON object.
-   No conversational filler or progress bars are emitted to `stdout`.

### 3.3 Exit Codes
| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General failure / Gate failure |
| 2 | Usage error / Invalid arguments |
| 126 | Command found but not executable |
| 127 | Command not found |

---

## 4. Design Imperatives for New Commands

1.  **Verb-Noun Alignment:** Ensure the command follows the `gwrk <verb> <noun>` or `gwrk <pillar> <verb> <noun>` pattern.
2.  **Feature Consistency:** If the command is scoped to a feature, the `<feature>` ID must be the first positional argument.
3.  **Discovery via `--help`:** Every command must include a description and concrete `Examples:` in its help text.
4.  **No Side Effects on Query:** Commands of type `query` or `verifier` must not mutate project state.
5.  **Gate-Enforced Mutation:** Mutators that change task state must be protected by binary verification (Gates).
