# ADR-004: Agent-Native Output Protocol

> **Status:** Decided · **Date:** 2026-03-13
> **Decision:** Dual-mode CLI output with operational signal protocol and Layer 2 presentation
> **Depends on:** ADR-002 (SQLite execution ledger), ADR-003 (execution manifests)
> **Author:** David Gonzalez · **Decision Scope:** gwrk CLI contract for agent consumption

---

## 1. Context

gwrk dispatches work to LLM agents (Codex, Gemini CLI, Claude CLI) that interact with the project through shell commands. Current agent interaction is unstructured: agents receive raw terminal output, parse human-formatted text, and have no signal about command cost, success criteria, or corrective action on failure.

Research into the Manus "Why Nix" architecture and its reference implementation (agent-clip) establishes that LLM agents work best with Unix-style CLI interfaces. The reference implementation proves three patterns in production:

1. **Single `run()` tool** — agents call commands via one tool, not function catalogs
2. **Progressive `--help` discovery** — agents learn command contracts on demand
3. **Consistent output semantics** — commands emit structured results with operational metadata

However, the reference implementation lacks the operational signal protocol, binary guard, and overflow mode it describes conceptually. gwrk implements these from scratch.

### Forces

- Agents waste context window tokens parsing ANSI color codes and human-formatted tables
- Agents have no cost awareness — they cannot distinguish a 5ms probe from a 60s agent dispatch
- Errors produce stack traces instead of corrective guidance
- Gate scripts return exit codes but agents don't reliably interpret them
- No command classifies itself as safe (query) vs. destructive (mutator)

---

## 2. Decision: Dual-Mode Output Protocol

### 2.1 Operational Signal Envelope

Every gwrk command emits an operational signal to **stderr** on completion:

```
[exit:0 | 42ms]
[exit:1 | 3.2s]
[exit:1 | 12.4s] task T003: gate failed (3 of 5 assertions)
```

Format: `[exit:<code> | <duration>] <optional context>`

- Always on stderr (pipe-safe — never contaminates stdout)
- Always emitted, in both human and agent mode
- Duration measured via `performance.now()` from command entry to exit

### 2.2 Exit Code Contract

| Code | Meaning | Agent Implications |
|---|---|---|
| 0 | Success | Proceed |
| 1 | Failure (expected) | Read stderr for guidance, retry or adjust |
| 2 | Usage error | Re-read `--help`, fix arguments |
| 127 | Unknown command | Run `gwrk --help` to discover available commands |

### 2.3 Output Modes

| Flag | stdout Format | Layer 2 | Activation |
|---|---|---|---|
| (default) | Human prose, ANSI colors | Off | Default behavior |
| `--format json` | Structured JSON | Off | Explicit flag |
| `--agent` | Human prose, **ANSI-stripped** + Layer 2 protections | **On** | Explicit flag or `GWRK_AGENT=1` |
| `--agent --format json` | Structured JSON + Layer 2 protections | On | Both flags |

`--agent` and `--format json` are **independent**. `--agent` activates Layer 2 protections (ANSI strip, binary guard, overflow, error navigation) but does not change the output format. `--format json` changes output to structured JSON but does not activate Layer 2.

Agents discover `--format json` via `--help` like any other flag. LLMs have deep pre-training on CLI tools — they will use `--format json | jq` when structured parsing is useful, just as a human engineer would. We do not prescribe this; we make it available.

### 2.4 Layer 2: Agent Presentation Processing

When `--agent` is active, a post-processing layer activates between command output and stdout:

| Mechanism | Behavior |
|---|---|
| **ANSI stripping** | Remove all ANSI escape codes from output |
| **Binary guard** | If output contains null bytes or >30% non-printable characters, replace with: `[binary content, <N> bytes, use 'gwrk project files <path>' for metadata]` |
| **Overflow mode** | If output exceeds 8KB (~200 lines): truncate to first 100 lines + `... (truncated, <N> total lines. Full output: /tmp/gwrk-output-<hash>.txt)` |
| **Error navigation** | On exit code ≥ 1, append stderr suggestion: `hint: <corrective action>` |

### 2.5 Command Classification

Every command self-declares its type via metadata:

| Type | Meaning | Agent Safety |
|---|---|---|
| `query` | Returns facts, no side effects | Safe to call freely |
| `generator` | Produces a canonical artifact from inputs | Safe but expensive |
| `verifier` | Runs a gate, returns pass/fail | Safe, may be slow |
| `mutator` | Changes project state | Requires intent confirmation |

Classification is discoverable via `gwrk <command> --help`. Agents learn command types through standard help text, not special metadata formats.

---

## 3. Technical Implementation

### 3.1 Signal Wrapper

```typescript
// src/utils/signal.ts
export async function withSignal(
  commandName: string,
  fn: () => Promise<void>
): Promise<never> {
  const start = performance.now();
  try {
    await fn();
    const ms = performance.now() - start;
    process.stderr.write(`[exit:0 | ${formatDuration(ms)}]\n`);
    process.exit(0);
  } catch (err) {
    const ms = performance.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[exit:1 | ${formatDuration(ms)}] ${commandName}: ${msg}\n`);
    process.exit(1);
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
```

### 3.2 Global Flags (Commander.js)

```typescript
program
  .option('--format <type>', 'Output format (json)')
  .option('--agent', 'Enable agent mode: ANSI-stripped output with Layer 2 protections');
```

### 3.3 Layer 2 Middleware

```typescript
// src/utils/agent-layer.ts
export function processForAgent(output: string): string {
  let result = stripAnsi(output);
  result = guardBinary(result);
  result = truncateOverflow(result, 8192);
  return result;
}
```

Applied at the Commander action boundary, not inside individual commands. Commands remain pure — they return strings or objects. The wrapper handles presentation.

---

## 4. Data Flow

```
Command handler → raw output (string | object)
       ↓
  --format json? → JSON.stringify()
       ↓
  --agent? → Layer 2 (ANSI strip + binary guard + overflow truncate)
       ↓
  stdout.write(output)
  stderr.write([exit:N | Xs])      ← always, regardless of mode
```

Pipe composition is preserved: `[exit:N | Xs]` goes to stderr and never enters the pipe. Agents can compose commands naturally:

```bash
# Text mode (default) — agent reads output as prose
gwrk project discover

# JSON mode — agent chose this because it wants to parse with jq
gwrk project discover --format json | jq '.specs[] | select(.status=="defining")'

# Agent mode — same text output but clean (no ANSI, bounded, guarded)
GWRK_AGENT=1 gwrk project discover
```

The key insight from Why-nix: LLMs are pre-trained on billions of lines of CLI text output. Plain text IS the native format. JSON is a tool agents reach for when they need it, not something we impose.

---

## 5. Integration with Execution Ledger (ADR-002/003)

The `[exit:N | Xs]` signal is emitted by the CLI. The execution manifest (ADR-003) captures the same data via `gwrk harvest`:

| Signal | CLI (real-time) | Manifest (post-hoc) |
|---|---|---|
| Exit code | `[exit:1 | ...]` on stderr | `exitCode: 1` in runs/*.json |
| Duration | `[... | 3.2s]` on stderr | `durationS: 3` in runs/*.json |
| Context | Inline message | `gateResult`, `reviewVerdict` fields |

They are complementary: the signal teaches the agent in-session, the manifest teaches the router across sessions.

---

## 6. Scope Boundary

### In Scope
- Operational signal wrapper on all existing commands
- `--format json` global flag
- `--agent` mode with Layer 2 processing
- Exit code standardization
- Command classification metadata
- Error-as-navigation guidance strings

### Out of Scope (Deferred)
- New `gwrk project` command group (separate spec: 013-project-discovery)
- Phase schema enrichment (tasks.json evolution)
- stdin pipe acceptance on `define plan`
- Classification inference (greenfield/change/refactor)

---

## 7. Impact on Existing Code

| Component | Change |
|---|---|
| `src/cli.ts` | Add `--format`, `--agent` global options |
| `src/utils/signal.ts` (new) | `withSignal()` HOF |
| `src/utils/agent-layer.ts` (new) | Layer 2: `stripAnsi()`, `guardBinary()`, `truncateOverflow()` |
| `src/utils/format.ts` | Add JSON formatting utilities |
| All `src/commands/*.ts` | Wrap action handlers with `withSignal()` |
| `.gwrkrc.json` schema | Add optional `agent.overflow_limit`, `agent.layer2_default` |

---

## 8. Decision Record

**Position**: Text-native CLI with operational signals, opt-in agent protections, and independent JSON formatting.

**Confidence**: 9/10

**Key rationale**: The operational signal (`[exit:N | Xs]`) is the cheapest, highest-leverage change. It requires ~50 LOC and immediately makes every gwrk command learnable by any LLM agent. Layer 2 (`--agent`) is opt-in and protective only — it strips ANSI, guards against binary, and truncates overflow, but does not change the output format. `--format json` is discoverable via `--help` and independent of agent mode. This follows the Why-nix finding that plain text is the LLM's native interface. The architecture is additive — no existing behavior changes.

**Reversibility**: Trivial. Remove the wrapper. Remove the flags. Cost: ~2 hours.
