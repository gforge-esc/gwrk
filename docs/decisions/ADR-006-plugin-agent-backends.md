# ADR-006: Plugin Agent Backends

> **Status:** Proposed · **Date:** 2026-03-17
> **Decision:** Agent backends are F014 plugins that present a clean service interface to gwrk core, hiding all CLI-specific nuance behind a normalized dispatch contract.
> **Depends on:** ADR-004 (Agent-Native Output), 013-Agent-Native-Interface, 014-Plugin-System
> **Author:** Antigravity · **Decision Scope:** gwrk plugin system, agent dispatch, task execution

---

## 1. Context

gwrk dispatches work to three foundational model CLIs: **Gemini CLI** (Google), **Claude Code** (Anthropic), and **Codex CLI** (OpenAI).

Currently, `gwrk` dispatches to these CLIs using a mostly uniform `spawn(CLI, ["-p", prompt])` pattern in `agent.ts` and `agent-run.sh`. However, as established in the [CLI Backend Research Report](../reference/cli-backend-research-report.md), each CLI has fundamentally different strategies for context retention, permission scoping, non-interactive output, and structured responses.

A one-size-fits-all dispatch is insufficient and brittle. We must reliably pipe context from the Foxtrot Charlie loop into any CLI and get correct, gate-passing implementations back. The Plugin System (F014) needs a formalized contract for how it interacts with these CLIs.

### Forces

- **Contradictory instructions destroy reasoning tokens.** If gwrk's dispatch prompt contradicts a CLI's internal governance file, the model wastes computation resolving the conflict instead of implementing.
- **`ARG_MAX` limits shell arguments.** On macOS, the combined size of `argv + envp` is capped at ~256KB. A gwrk dispatch prompt routinely exceeds this when it includes spec fragments, contracts, gate scripts, and discovery JSON. Inline `-p "<prompt>"` and even `$(cat file)` command substitution both expand into argv and are both subject to this limit.
- **Extensibility vs Unification.** We want to leverage Claude's deterministic hooks, Codex's structured output schemas, and Gemini's extension system — but cannot hardcode those into gwrk's core loop.
- **Signal Normalization.** Each CLI has proprietary exit codes (Gemini `42` for input error, `53` for turn limit). gwrk needs to interpret these correctly for retry logic.

### Verified: All Three CLIs Accept Stdin

Exploratory testing (2026-03-17) confirms:

```bash
# Claude: stdin content is visible alongside -p prompt
echo "context" | claude -p "prompt" --output-format text  # ✅ sees stdin

# Gemini: stdin content is prepended to -p prompt
echo "context" | gemini -p "prompt" --output-format text  # ✅ sees stdin

# Codex: stdin is first-class prompt source (use '-' or omit prompt arg)
echo "context" | codex exec --full-auto -                 # ✅ reads from stdin
```

This eliminates the `ARG_MAX` concern. **Stdin pipe is the universal delivery path.**

---

## 2. Decision: Agent Adapters as a Clean Service Layer

The F014 Plugin System will introduce `AgentBackend` as a plugin interface. The rest of gwrk interacts with agent backends through a single, CLI-agnostic service. **Only the plugin knows about CLI-specific flags, config files, and exit codes.** gwrk core never references `claude`, `codex`, or `gemini` by name.

### 2.1 The AgentBackend Interface

Every agent plugin must implement the following contract:

```typescript
interface AgentBackend {
  /** Internal identifier */
  name: string;

  /** Context file management */
  contextFileName: string;
  syncGovernance(projectRoot: string, governance: GovernanceContext): void;

  /** Dispatch: gwrk passes WHAT, plugin decides HOW */
  dispatch(task: TaskDispatch): {
    command: string;
    args: string[];
    stdin: string;          // context delivered via stdin pipe — REQUIRED
    env?: Record<string, string>;
    streamable: boolean;    // if true, gwrk can meter output in real-time
  };

  /** Result parsing: plugin normalizes CLI output to gwrk types */
  parseResult(stdout: string, stderr: string, rawExitCode: number): TaskResult;
}

interface TaskResult {
  success: boolean;
  exitCode: 0 | 1 | 2 | 127;           // gwrk-normalized (POSIX-safe)
  errorType?: 'gate_failure' | 'turn_limit' | 'auth_error' | 'usage_error' | 'not_found';
  output: string;
  structuredOutput?: Record<string, unknown>;  // if CLI supports --output-format json
  tokenUsage?: { input: number; output: number };
  durationMs?: number;
}
```

**Key design principle:** `dispatch()` returns a **stdin string**, not an inline prompt argument. gwrk core pipes this to the CLI process via `child.stdin.write()`. The `-p` argument, if needed, carries only a minimal task instruction (well under `ARG_MAX`). The bulk of context flows through stdin.

### 2.2 Dual-Layer Context Strategy

Context is split into two layers with distinct lifecycles:

**Layer 1 — Durable Governance (Project Memory Files)**

Agent plugins MUST auto-generate their CLI-specific project memory files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) from a single central source of truth: `.gwrk/agent-context.md`.

This prevents governance drift between CLIs. The `syncGovernance()` method renders the central source into the CLI's expected format. Contents include:
- Architecture rules (fail-fast, no magic values, TypeScript only)
- Build/test/lint commands
- Directory structure
- gwrk-specific conventions (gate contracts, exit codes, ADR compliance)

`syncGovernance()` is called automatically by `gwrk define plan` and `gwrk define tasks`.

**Layer 2 — Ephemeral Task Context (Stdin Pipe)**

The task-specific context (spec fragments, contracts, gate scripts, discovery JSON) is assembled by gwrk core and delivered to the plugin as `TaskDispatch`. The plugin's `dispatch()` method formats this into the `stdin` string using CLI-appropriate prompt structures. gwrk core never knows whether the plugin uses XML tags, markdown headers, or raw text.

### 2.3 Stdin-First Prompt Delivery

Agent plugins MUST deliver the bulk of context via stdin pipe. This is a hard constraint, not a preference.

**Why not `-p "<prompt>"`?**
- `ARG_MAX` on macOS is ~256KB for `argv + envp` combined
- `$(cat /tmp/file)` command substitution expands into argv — same limit applies
- A gwrk dispatch with spec + contracts + gates + discovery routinely exceeds 256KB

**Stdin delivery pattern:**

```typescript
// gwrk core pipes context to CLI process
const result = plugin.dispatch(taskDispatch);
const child = spawn(result.command, result.args, { env: result.env });
child.stdin.write(result.stdin);
child.stdin.end();
```

**Output metering:** If `dispatch()` returns `streamable: true`, gwrk MAY attach a line-by-line reader to `child.stdout` for real-time progress logging and log capture. If `--output-format json` is used, output can be piped through `jq` for structured streaming.

### 2.4 Exit Code Normalization

Agent plugins MUST catch proprietary CLI exit codes and normalize them to gwrk's POSIX-safe contract:

| gwrk Normalized Exit | Semantic Meaning | Source Examples |
|----------------------|------------------|-----------------|
| `0` | Success | All CLIs: `0` |
| `1` | Task/Gate Failure | Claude: non-0, Codex: non-0, Gemini: `1`. **Also:** Gemini `53` (turn limit) — mapped to `1` with `errorType: "turn_limit"` |
| `2` | Usage / Config Error | Gemini: `42` (input error), auth failures, missing config |
| `127` | Command not found | **POSIX reserved.** Only when the CLI binary itself is missing. Never mapped from application-level errors. |

> **POSIX Compliance:** Exit `127` has strict POSIX meaning ("command not found"). It MUST NOT be overloaded with application-level semantics like turn limits or rate limits. The `errorType` field in `TaskResult` carries the semantic distinction.

### 2.5 Project-Local Configuration Only

If a plugin maintains CLI-specific configuration (e.g., `.claude/settings.json`, `.codex/` local environment), it MUST be scoped to the project directory, never the user's global config (`~/.codex/config.toml`, `~/.claude/`).

**Rationale:** gwrk should not modify files that affect the user's other projects. All CLI-specific configuration produced by gwrk plugins lives inside the project repo (or is gitignored within it). This enables per-project and even per-instantiation tuning without global side effects.

**Approved project-local artifacts:**

| CLI | Artifact | Purpose | Committed? |
|-----|----------|---------|-----------|
| Claude | `.claude/settings.json` | Permissions + hooks (linting on save, etc.) | ✅ Yes |
| Claude | `.claude/settings.local.json` | Local overrides | ❌ No |
| Codex | `.codex/` (local env) | Setup scripts, actions | ✅ Yes |
| Gemini | `.gemini/settings.json` | Project-local settings: approval mode defaults, sandbox config, MCP servers, model config, checkpointing, tool restrictions | ✅ Yes |
| Gemini | `.gemini/sandbox-*.sb` / `.gemini/sandbox.Dockerfile` | Custom sandbox profiles (macOS seatbelt or Docker) | ✅ Yes |
| All | `<CLI>.md` at project root | Auto-generated from `.gwrk/agent-context.md` | ✅ Yes |

#### Config Ownership and Conflict Detection

When a gwrk agent plugin opts to leverage CLI-specific configuration (e.g., `.claude/settings.json`, `.gemini/settings.json`), the following rules apply:

**1. Declared Ownership.** The plugin's manifest MUST declare which CLI config keys it manages. Example:

```yaml
# manifest.yaml (gemini adapter)
managedConfig:
  - path: ".gemini/settings.json"
    keys: ["general.defaultApprovalMode", "tools.sandbox", "model.maxSessionTurns"]
```

**2. Setup Alert.** When a plugin is first configured for a project (or when a new managed key is added), gwrk MUST alert the user:

```
⚠ gwrk will maintain the following CLI config:
  .gemini/settings.json → general.defaultApprovalMode, tools.sandbox, model.maxSessionTurns
  
  Manual changes to these keys may conflict with gwrk dispatch.
  Run 'gwrk plugin check' to validate config at any time.
```

**3. Runtime Validation.** Before each dispatch, the plugin MUST read the current CLI config and compare managed keys against expected values. If a managed key has been externally modified:

- **Warning** (non-breaking change): e.g., user changed `tools.sandbox` from `"docker"` to `"none"`. gwrk logs a warning and proceeds with its flag override.
- **Error** (breaking conflict): e.g., user added a `tools.exclude` entry that blocks a tool gwrk requires. gwrk exits `2` (usage error) with error-as-navigation:

```
✗ Config conflict in .gemini/settings.json
  tools.exclude contains "write_file" — gwrk dispatch requires write access.
  Remove this entry or run 'gwrk plugin sync-context' to reconcile.
```

This is not real-time file watching — it's a pre-dispatch validation check. The cost is one `readFileSync()` + JSON compare per dispatch, which is negligible.

**4. Skills and Workflows — Superseded.**

All three CLIs have native skill systems (Claude: `.claude/skills/*.md`, Codex: `.codex/skills/SKILL.md` + `agents/`, Gemini: `SKILL.md` + `scripts/` + `references/` + `assets/`). gwrk plugins MUST NOT create or maintain CLI-native skills. These are superseded by gwrk's own plugin system. If existing CLI-native skills are detected in a project, gwrk SHOULD warn the user about potential instruction conflicts during dispatch.

---

## 3. The Plugin as Service — What gwrk Core Sees

gwrk core interacts with agent backends through a single function. It never references CLI names, flags, or config formats:

```typescript
// gwrk core (ship loop)
async function dispatchTask(task: Task, feature: Feature): Promise<TaskResult> {
  const backend = pluginRegistry.getAgentBackend();   // router picks the backend
  const context = assembleContext(task, feature);      // gwrk core assembles WHAT
  const invocation = backend.dispatch(context);        // plugin decides HOW

  const child = spawn(invocation.command, invocation.args, {
    env: invocation.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdin.write(invocation.stdin);
  child.stdin.end();

  if (invocation.streamable) {
    teeToLogStream(child.stdout, runLog);    // real-time metering
  }

  const { stdout, stderr, exitCode } = await collect(child);
  return backend.parseResult(stdout, stderr, exitCode);  // plugin normalizes
}
```

**What gwrk core knows:** TaskDispatch objects, TaskResult objects, and the `AgentBackend` interface.
**What gwrk core does NOT know:** That Claude uses `--permission-mode bypassPermissions` while Gemini uses `--yolo`. That Codex supports `--output-schema`. That Gemini exits `53` on turn limits. All of this is plugin-internal.

---

## 4. Impact on Existing Code

| Component | Change |
|---|---|
| `src/utils/agent.ts` | Deprecate hardcoded CLI dispatch modes. Replace with `pluginRegistry.getAgentBackend().dispatch()`. |
| `scripts/dev/agent-run.sh` | Refactor to consume `TaskResult` from the plugin layer rather than matching regex on stderr. |
| `specs/014-plugin-system/spec.md` | Add `AgentBackend` interface to the formalized plugin surfaces. |
| `gwrk` CLI | Add `gwrk plugin sync-context` command to regenerate project memory files from `.gwrk/agent-context.md`. |
| `.gwrk/agent-context.md` | New file: single source of truth for durable governance shared across all CLI backends. |

---

## 5. What Dies

- Hardcoded `switch(cli)` statements in the dispatch loop.
- Raw `-p "<prompt>"` shell escaping for long context.
- `$(cat /tmp/file)` command substitution as a delivery mechanism.
- Disconnected project context files (`CLAUDE.md` and `GEMINI.md` possessing different rules).
- User-global config modifications (`~/.codex/config.toml` profiles).

## 6. What Survives

- The CLI tools themselves (Claude, Codex, Gemini) as the reasoning engines.
- Existing gwrk workspaces — automatically synced with `.gwrk/agent-context.md` upon next dispatch.
- F013 `[exit:N | Xs]` signaling, now insulated from proprietary CLI exit code changes.
- CLI-specific project-local config (`.claude/settings.json`, `.codex/` local env) when it provides deterministic enforcement value.

## 7. Three-Layer Plugin Architecture

This ADR covers **Layer 1**. Full surface contact analysis: [plugin-strategy-audit.md](../reference/plugin-strategy-audit.md).

```
Layer 1: Agent Backend Plugins     ← THIS ADR (ADR-006)
         (Claude, Codex, Gemini adapters)
         Consumers: F004 Ship Loop, F008 Agent Router, F005 Parallel Dispatch
         Contract: AgentBackend interface, stdin delivery, exit normalization

Layer 2: Skill Plugins             ← F014 spec (existing)
         (Atomic reasoning modes, compound compositions)
         Consumers: gwrk skill <name>, pipe composition
         Contract: manifest.yaml, SKILL.md, F013 signals

Layer 3: Extension Plugins         ← Not yet specified
         (Domain Packs, Channel Adapters)
         Consumers: F012 Knowledge Work (--domain), F017 Channel Abstraction
         Contract: TBD — requires F012 spec + F003 ChannelPlugin refactor
```

**Scope boundary:** Layer 1 is the only layer that interacts with external CLI processes. Layers 2 and 3 are gwrk-internal plugin types.

---

## 8. Decision Record

**Position**: Agent CLIs must be abstracted behind F014 `AgentBackend` plugins that present a clean service interface to gwrk core. Plugins own context shaping, stdin delivery, and exit code normalization. gwrk core never references CLI names or flags.

**Confidence**: 9/10

**Key rationale**: 
1. `ARG_MAX` limits make inline prompts and `$(cat)` substitution unsafe for production-scale context. Stdin pipe is the only reliable delivery path — and all three CLIs support it (verified).
2. Proprietary exit codes (`42`, `53`, `127`) have conflicting semantics across CLIs. Normalization with structured `errorType` metadata prevents retry logic corruption.
3. A single `.gwrk/agent-context.md` source of truth prevents governance drift across three separate project memory files.
4. The clean service boundary means gwrk core is CLI-agnostic — adding a fourth backend (e.g., Aider, Devin) requires only a new plugin, no core changes.

**Reversibility**: Moderate. Reverting means restoring hardcoded CLI dispatch in `agent.ts`. The stdin delivery and governance sync patterns would survive as utilities. Cost: ~4 hours.
