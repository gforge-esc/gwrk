# R002 — Agent Backend Plugin Design

> **Status:** Draft — Awaiting Review
> **Initiative:** [R002 brief](file:///Users/gonzo/Code/gwrk/docs/research/R002-agent-backend-plugin/brief.md)
> **Consumer:** F014 spec expansion (Layer 1 FRs), architecture.md v5.0

---

## Executive Summary

The F014 Plugin System spec covers Layer 2 (Skills) thoroughly but has **zero functional requirements for Layer 1 (Agent Backends)**. ADR-006 defines the canonical `AgentBackend` interface — `dispatch()`, `parseResult()`, `syncGovernance()` — with stdin-first prompt delivery, POSIX-safe exit code normalization, and a dual-layer context strategy. This research synthesizes all existing sources into implementation-grade designs for the full agent backend plugin lifecycle.

**Three findings drive the design:**

1. **The manifest schema is distinct from skill manifests.** Agent manifests declare `type: agent`, `dispatchMode` (local-cli or github-integration), `contextFileName`, `managedConfig`, `exitCodeMap`, and per-task-type `preferredModel`. Skill manifests declare `prompt`, `composes`, `passes`. The shared fields are minimal: `type`, `name`, `version`, `description`.

2. **Codex Cloud requires a `dispatchMode` discriminator, not a separate interface.** ADR-006's interface was designed around `spawn()` semantics, but Codex Cloud dispatches via GitHub issue creation. The solution is a `dispatchMode` field in the manifest (`local-cli` vs `github-integration`) with a phased interface evolution: Phase 1 implements local-cli only (F014); Phase 2 adds `CloudAgentBackend` when Codex Cloud ships as a separate feature.

3. **The current `agent.ts` is a clean cut point.** The `dispatchToAgent()` facade (L287–313) already implements the exact contract ADR-006 describes. Migration is surgical: replace the `switch(backend)` dispatch in `buildCommand()` (L37–85) with `pluginRegistry.getAgentBackend().dispatch()`, and replace the hardcoded `EXIT_CODE_MAP` (L272–277) with `backend.parseResult()`.

---

## Q1: Agent Manifest Schema

### Findings

ADR-006 §2.1 defines the `AgentBackend` interface with three methods: `syncGovernance()`, `dispatch()`, and `parseResult()`. The cli-backend-research-report §7.1 proposes a sample `manifest.yaml` for Claude with `invocation` and `capabilities` fields. The F014 spec's DM-001/DM-002 define the skill manifest schema exclusively — no agent manifest schema exists in the spec.

**Shared fields** between agent and skill manifests:
- `type` — discriminator (`agent` vs `skill`)
- `name` — human-readable identifier
- `version` — semver
- `description` — one-line description

**Agent-specific fields** (derived from ADR-006 + cli-backend-research):
- `contextFileName` — CLI-specific governance file name (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`). Source: ADR-006 §2.1
- `managedConfig` — array of CLI config paths + keys the adapter manages. Source: ADR-006 §2.5
- `dispatchMode` — `local-cli` or `github-integration`. Source: R001 v3 §Q2, codex-cloud-research §7.5
- `invocation` — CLI flags for headless, yolo, model selection, structured output. Source: cli-backend-research §7.1
- `exitCodeMap` — proprietary exit codes to gwrk-normalized codes. Source: ADR-006 §2.4
- `capabilities` — declared features: `supportsStdin`, `supportsCostCap`, `supportsStructuredOutput`. Source: cli-backend-research §6.1
- `models` — per-task-type model preferences. Source: architecture.md §6.4 routing heuristics

**The manifest declares the CLI command template** in the `invocation` block. The adapter's TypeScript uses this declaratively — it does NOT hardcode CLI flags in code. This is a key difference from the current `buildCommand()` function (agent.ts L37–85) which hardcodes per-backend flag arrays.

**`preferredModel` per task type** is expressed as a `models` map in the manifest:

```yaml
models:
  default: claude-sonnet-4-6
  implement: claude-sonnet-4-6
  review: claude-sonnet-4-6
  define: claude-opus-4-6       # thinking model for definition work
  refactor: claude-opus-4-6
```

### Recommendation

The agent manifest schema should be a **separate Zod schema** from the skill manifest, sharing only the base plugin fields. The `type: agent` discriminator triggers a different validation path in the plugin loader.

### Sample Manifests

#### Claude Code Adapter

```yaml
# ~/.gwrk/plugins/agents/claude/manifest.yaml
type: agent
name: claude
version: 1.0.0
description: "Claude Code CLI backend"
dispatchMode: local-cli

contextFileName: CLAUDE.md

invocation:
  command: claude
  headless: ["-p"]
  yolo: ["--dangerously-skip-permissions"]
  safeAuto: ["--permission-mode", "auto"]
  model: ["--model"]
  structuredOutput: ["--output-format", "json"]
  costCap: ["--max-budget-usd"]
  workingDir: ["--add-dir"]

capabilities:
  supportsStdin: true        # Verified: stdin content visible alongside -p
  supportsCostCap: true
  supportsStructuredOutput: true
  supportsSystemPrompt: true
  supportsHooks: true
  supportsFallbackModel: true

models:
  default: claude-sonnet-4-6
  implement: claude-sonnet-4-6
  review: claude-sonnet-4-6
  define: claude-opus-4-6
  refactor: claude-opus-4-6

exitCodeMap:
  # Claude returns 0 for success, non-0 for failure
  # No known proprietary exit codes — all non-0 mapped to gwrk 1
  0: { exitCode: 0, errorType: null }

managedConfig:
  - path: ".claude/settings.json"
    keys: ["permissions", "hooks"]
  - path: ".claude/settings.local.json"
    keys: []    # local overrides, not managed
```

#### Codex CLI (Local) Adapter

```yaml
# ~/.gwrk/plugins/agents/codex/manifest.yaml
type: agent
name: codex
version: 1.0.0
description: "Codex CLI backend (local)"
dispatchMode: local-cli

contextFileName: AGENTS.md

invocation:
  command: codex
  headless: ["exec"]
  yolo: ["--dangerously-bypass-approvals-and-sandbox"]
  safeAuto: ["--full-auto"]
  model: ["--model"]
  structuredOutput: ["--output-schema"]
  workingDir: ["-C"]
  stdinPrompt: ["-"]          # reads from stdin when '-' is provided

capabilities:
  supportsStdin: true         # Stdin is first-class: codex exec --full-auto -
  supportsCostCap: false
  supportsStructuredOutput: true   # --output-schema <file>
  supportsSystemPrompt: false      # uses AGENTS.md only
  supportsHooks: false
  supportsFallbackModel: false
  supportsProfiles: true           # -p <profile> from config.toml

models:
  default: o3
  implement: o3-pro
  review: codex-1
  define: o3
  refactor: o3-pro

exitCodeMap:
  0: { exitCode: 0, errorType: null }
  # Codex exits non-0 on failure — no proprietary codes documented

managedConfig:
  - path: ".codex/"
    keys: []    # entire directory managed as local env
```

#### Codex Cloud Adapter

```yaml
# ~/.gwrk/plugins/agents/codex-cloud/manifest.yaml
type: agent
name: codex-cloud
version: 1.0.0
description: "Codex Cloud backend (GitHub integration)"
dispatchMode: github-integration    # NOT local-cli

contextFileName: AGENTS.md

# No invocation block — Codex Cloud does not use CLI spawn
# Dispatch is via GitHub issue creation with @codex mention

github:
  triggerPrefix: "@codex"
  labelPrefix: "gwrk-dispatch"
  completionEvent: "pull_request.opened"

capabilities:
  supportsStdin: false        # context delivered via issue body
  supportsCostCap: false
  supportsStructuredOutput: false
  supportsSystemPrompt: false
  supportsHooks: false
  supportsFallbackModel: false
  nativeParallelism: true     # Codex Cloud manages its own containers

models:
  default: gpt-5.4
  implement: gpt-5.4

exitCodeMap: {}    # Codex Cloud returns diffs/PRs, not exit codes

managedConfig:
  - path: ".codex/"
    keys: []
```

#### Gemini CLI Adapter

```yaml
# ~/.gwrk/plugins/agents/gemini/manifest.yaml
type: agent
name: gemini
version: 1.0.0
description: "Gemini CLI backend"
dispatchMode: local-cli

contextFileName: GEMINI.md

invocation:
  command: gemini
  headless: ["-p"]
  yolo: ["--yolo"]
  safeAuto: ["--approval-mode", "auto_edit"]
  model: ["--model"]
  structuredOutput: ["--output-format", "json"]
  workingDir: ["--include-directories"]

capabilities:
  supportsStdin: true         # Verified: stdin prepended to -p prompt
  supportsCostCap: false
  supportsStructuredOutput: true
  supportsSystemPrompt: false  # uses GEMINI.md
  supportsHooks: true          # AfterAgent lifecycle hooks
  supportsFallbackModel: false
  supportsExtensions: true     # MCP + playbooks
  supportsPolicyEngine: true

models:
  default: gemini-2.5-pro
  implement: gemini-2.5-pro
  review: gemini-2.5-pro
  define: gemini-2.5-pro
  refactor: gemini-2.5-pro

exitCodeMap:
  0: { exitCode: 0, errorType: null }
  1: { exitCode: 1, errorType: "task_failure" }
  42: { exitCode: 2, errorType: "usage_error" }      # Gemini input error
  53: { exitCode: 1, errorType: "turn_limit" }        # Gemini turn limit

managedConfig:
  - path: ".gemini/settings.json"
    keys: ["general.defaultApprovalMode", "tools.sandbox", "model.maxSessionTurns"]
  - path: ".gemini/sandbox-*.sb"
    keys: []
  - path: ".gemini/sandbox.Dockerfile"
    keys: []
```

---

## Q2: Adapter Lifecycle

### Findings

ADR-006 does not specify the full lifecycle explicitly, but the interface methods (§2.1–§2.5) plus the plugin-strategy-audit remediation path imply this sequence:

1. **Install**: `gwrk plugin install ./agents/codex` — validates `manifest.yaml` against the agent manifest Zod schema. Copies to `~/.gwrk/plugins/agents/<name>/`. Checks for `type: agent` discriminator. Validates `invocation.command` exists on PATH (for local-cli mode). Source: F014 spec FR-001, FR-002.

2. **Register**: The plugin loader (`src/plugins/loader.ts`) scans `~/.gwrk/plugins/agents/`, loads each `manifest.yaml`, validates schema, and registers as `AgentBackend` adapters in the plugin registry. The current `AgentBackendSchema = z.enum(["gemini", "claude", "codex", "codex-cloud"])` in `config.ts` (L5) is replaced by dynamic discovery from the registry. Source: F014 spec FR-003, architecture.md §7.5.

3. **`syncGovernance()`**: Called automatically by `gwrk define plan` and `gwrk define tasks` (ADR-006 §2.2). Generates CLI-specific context files from `.gwrk/agent-context.md`. For each registered agent backend, invokes `backend.syncGovernance(projectRoot, governance)` which writes the appropriate `<contextFileName>` to the project root.

4. **`dispatch()`**: Returns `{command, args, stdin, env, streamable}`. **gwrk core spawns the process** — the plugin does NOT spawn. Source: ADR-006 §3. The spawn pattern is:
   ```typescript
   const invocation = backend.dispatch(context);
   const child = spawn(invocation.command, invocation.args, { env: invocation.env });
   child.stdin.write(invocation.stdin);
   child.stdin.end();
   ```

5. **`parseResult()`**: Maps raw stdout/stderr/exitCode to `TaskResult`. Uses the `exitCodeMap` from the manifest. Source: ADR-006 §2.4, current agent.ts L272–277.

6. **Teardown**: On `gwrk plugin remove <agent>`, the adapter directory is deleted from `~/.gwrk/plugins/agents/<name>/`. The generated context file (`CLAUDE.md`, etc.) is NOT removed from project roots — it may be used by other tools. A warning is logged: `Warning: <contextFileName> was generated by the '<name>' adapter and may be stale.`

### Codex Cloud Exception

Codex Cloud does NOT fit the `spawn()` pattern. Source: R001 v3 §Q2, codex-cloud-research §7.

| Aspect | Local CLI (spawn) | Codex Cloud (github-integration) |
|--------|-------------------|----------------------------------|
| **Trigger** | `child_process.spawn()` | GitHub API: create issue with `@codex <prompt>` |
| **Execution** | Synchronous: await exit code | Asynchronous: poll for PR creation |
| **Result** | stdout/stderr/exitCode | PR diff + commit SHA |
| **Sandbox** | gwrk manages (worktree) | Codex manages (cloud container) |
| **Context** | stdin pipe | Issue body + AGENTS.md in repo |

**Recommendation**: The `AgentBackend` interface needs a `dispatchMode` discriminator. For Phase 1 (F014), implement `local-cli` only. Codex Cloud becomes a `CloudAgentBackend` extension in a separate feature. The dispatch function signature stays the same, but the return type is discriminated:

```typescript
// Phase 1: local-cli dispatch — returns spawn instructions
interface LocalDispatchResult {
  dispatchMode: 'local-cli';
  command: string;
  args: string[];
  stdin: string;
  env?: Record<string, string>;
  streamable: boolean;
}

// Phase 2 (separate feature): github-integration dispatch
interface CloudDispatchResult {
  dispatchMode: 'github-integration';
  issueNumber: number;
  issueUrl: string;
  // Completion detected via webhook, not exit code
}

type DispatchResult = LocalDispatchResult | CloudDispatchResult;
```

### Full Normalization Table

| Backend | Raw Exit | gwrk Normalized | errorType | Source |
|---------|----------|-----------------|-----------|--------|
| All | 0 | 0 | — | Universal |
| Claude | non-0 | 1 | `task_failure` | cli-backend-research §8.1 |
| Codex | non-0 | 1 | `task_failure` | cli-backend-research §8.1 |
| Gemini | 1 | 1 | `task_failure` | cli-backend-research §8.1 |
| Gemini | 42 | 2 | `usage_error` | cli-backend-research §8.1 — Gemini input error |
| Gemini | 53 | 1 | `turn_limit` | ADR-006 §2.4 — Gemini turn limit exceeded |
| All | 126 | 1 | `permission_denied` | POSIX — permission denied |
| All | 127 | 127 | `not_found` | ADR-006 §2.4 — POSIX reserved, command not found |
| All | 137 | 1 | `killed` | POSIX — SIGKILL |
| All | 143 | 1 | `terminated` | POSIX — SIGTERM |

---

## Q3: Config Conflict Detection

### Findings

ADR-006 §2.5 specifies that plugins declare config keys they manage via the `managedConfig` field in their manifest.

**Data structure for config ownership** (derived from ADR-006 §2.5):

```yaml
# In manifest.yaml
managedConfig:
  - path: ".gemini/settings.json"
    keys: ["general.defaultApprovalMode", "tools.sandbox", "model.maxSessionTurns"]
```

This produces an in-memory ownership map at install time:

```typescript
interface ConfigOwnership {
  pluginName: string;
  filePath: string;      // relative to project root
  managedKeys: string[]; // dot-notation config paths
}
```

**Conflict detection** operates at two points:

1. **Install-time** (ADR-006 §2.5 ¶1): When a new adapter is installed, `gwrk plugin install` checks if any `managedConfig` keys overlap with already-installed adapters. If overlap exists:
   ```
   ✗ Config conflict: key 'tools.sandbox' in .gemini/settings.json
     Already managed by plugin 'gemini-custom'.
     Run 'gwrk plugin check' to see all ownership.
   ```

2. **Dispatch-time** (ADR-006 §2.5 ¶3): Before each dispatch, the adapter reads the current CLI config and compares managed keys against expected values. Two outcomes:
   - **Warning** (non-breaking): e.g., user changed a preference. Log warning, proceed with flag override.
   - **Error** (breaking): e.g., user blocked a required tool. Exit 2 with corrective message.

**`gwrk plugin check` output** (per F013 contract):

**Text format (default):**
```
Config ownership report:
  .claude/settings.json
    permissions → claude (ok)
    hooks → claude (ok)
  .gemini/settings.json
    general.defaultApprovalMode → gemini (ok)
    tools.sandbox → gemini (⚠ modified externally: expected "docker", found "none")
    model.maxSessionTurns → gemini (ok)

1 warning, 0 conflicts
```

**JSON format (`--format json`):**
```json
{
  "files": [
    {
      "path": ".gemini/settings.json",
      "keys": [
        { "key": "tools.sandbox", "owner": "gemini", "status": "warning", "expected": "docker", "actual": "none" }
      ]
    }
  ],
  "warnings": 1,
  "conflicts": 0
}
```

### Recommendation

Config conflict detection should be **both** install-time and dispatch-time. Install-time catches inter-plugin conflicts. Dispatch-time catches external modifications. The cost is one `readFileSync()` + JSON compare per dispatch — negligible (per ADR-006 §2.5 ¶3).

---

## Q4: Governance Sync Mechanics

### Findings

ADR-006 §2.2 establishes `.gwrk/agent-context.md` as the single source of truth for durable governance.

**Canonical format of `.gwrk/agent-context.md`:**

```markdown
---
# Machine-readable metadata
version: 1
lastSync: 2026-03-18T16:00:00Z
adapters: [claude, codex, gemini]
---

# gwrk Agent Governance

## Architecture Rules
- Fail-fast: missing config → crash, never default
- No magic values: all values flow .env → config → applications
- TypeScript only: no .js or .jsx in src/

## Build/Test/Lint
- Build: `pnpm build`
- Test: `pnpm test`
- Lint: `pnpm lint`

## Directory Structure
- src/ — gwrk CLI source (TypeScript)
- specs/ — Feature specifications
- docs/ — Architecture, ADRs, reference

## gwrk Conventions
- Gate enforcement: every task has gates/T0xx-gate.sh
- Exit codes: 0=success, 1=failure, 2=usage, 127=not found
- Conventional commits: feat:, fix:, chore:

### [claude]
- Use XML tags for prompt sections (<context>, <constraints>, etc.)
- CLAUDE.md sections are hierarchical — project root + subdirectories

### [codex]
- AGENTS.md is behavioral guidance, not structural documentation
- Config profiles available via -p <profile>

### [gemini]
- GEMINI.md auto-loaded on session start
- Extensions and skills available via gemini extensions / gemini skills
```

**Bootstrap mechanism:**

1. **`gwrk init`** creates `.gwrk/agent-context.md` from a built-in template. The template includes a standard set of architecture rules, build commands, and per-adapter sections. Source: ADR-006 §2.2.

2. **Migration from `.agents/rules/workspace.md`**: `gwrk init` detects existing `.agents/rules/workspace.md` and imports its content into the corresponding sections of `agent-context.md`. The `.agents/` directory is NOT deleted (IDE agents like Antigravity read it directly — F014 TC-006).

**Per-adapter generation rules:**

Each adapter's `syncGovernance()` method:
1. Reads `.gwrk/agent-context.md`
2. Extracts the common sections (Architecture Rules, Build/Test/Lint, etc.)
3. Extracts the adapter-specific section (`### [claude]`, `### [gemini]`, etc.)
4. Renders the combined content into the CLI's expected format
5. Writes to the project root as `<contextFileName>` (e.g., `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`)

**Boundary marker strategy:**

The generated context files use boundary markers so that manual additions outside the gwrk-managed section are preserved:

```markdown
# CLAUDE Project Context

<!-- gwrk:begin — auto-generated from .gwrk/agent-context.md -->
## Architecture Rules
...
## gwrk Conventions
...
<!-- gwrk:end -->

## My Custom Claude Instructions
(user-added content preserved across sync)
```

`syncGovernance()` replaces only the content between `<!-- gwrk:begin -->` and `<!-- gwrk:end -->`, preserving anything outside those markers.

**Trigger points** (Source: ADR-006 §2.2):
- `gwrk define plan` — auto-calls `syncGovernance()` for all registered backends
- `gwrk define tasks` — auto-calls `syncGovernance()` for all registered backends
- `gwrk plugin sync-context` — manual invocation

### Recommendation

Boundary markers are the correct strategy. Full overwrite would destroy user customizations. The cost is a simple string split/replace — trivial to implement.

**For Codex Cloud `AGENTS.md`**: The `syncGovernance()` for the codex-cloud adapter should include cloud-specific guidance sections (verification commands, cloud task rules) as documented in codex-cloud-research §9.2. This is adapter-specific content that belongs in the `### [codex]` section of `agent-context.md`.

---

## Q5: Migration Path from Current Facade

### Findings

**Current `agent.ts` structure** (314 LOC):

| Function | Lines | Purpose |
|----------|-------|---------|
| `buildCommand()` | L22–88 | `switch(backend)` → CLI-specific command + args |
| `stampLine()` | L94–115 | Timestamp + log tee |
| `dispatchAgent()` | L117–237 | spawn + stream + collect |
| `dispatchToAgent()` | L287–313 | FR-019/020/021 facade — exit normalization |
| `EXIT_CODE_MAP` | L272–277 | Hardcoded normalization table |
| Interfaces | L245–266 | `TaskDispatch`, `TaskResult` |

**The exact cut points:**

1. **`buildCommand()` (L22–88) → DIES.** The entire `switch(backend)` block is replaced by `backend.dispatch(task)`. The plugin returns `{command, args, stdin, env, streamable}` — exactly the same shape that `buildCommand()` returns today. Source: ADR-006 §3.

2. **`EXIT_CODE_MAP` (L272–277) → DIES.** Replaced by `backend.parseResult(stdout, stderr, rawExitCode)`. Each adapter carries its own exit code mapping from the manifest's `exitCodeMap`.

3. **`dispatchToAgent()` (L287–313) → SURVIVES (modified).** The facade signature stays identical. Internals change from:
   ```typescript
   // BEFORE
   const opts = { backend, workflowPath, featureDir, prompt };
   const { exitCode, logPath } = await dispatchAgent(opts);
   const mapped = EXIT_CODE_MAP[rawExitCode];
   ```
   to:
   ```typescript
   // AFTER
   const backend = pluginRegistry.getAgentBackend(task.agent);
   const invocation = backend.dispatch(task);
   const { stdout, stderr, exitCode } = await spawnAndCollect(invocation);
   return backend.parseResult(stdout, stderr, exitCode);
   ```

4. **`dispatchAgent()` (L117–237) → SURVIVES (refactored).** The spawn + stream + collect logic stays — it's the gwrk core process runner. But it receives a `DispatchResult` from the plugin instead of building its own command. The log file creation, timestamping, and 429 squelching are gwrk-core concerns that survive.

5. **`AgentBackend` type in `config.ts` (L5) → DIES.** The Zod enum `z.enum(["gemini", "claude", "codex", "codex-cloud"])` is replaced by dynamic discovery from `pluginRegistry.listAgentBackends()`. The `.gwrkrc.json` `agents.define` and `agents.implement` fields reference plugin names by string, validated at runtime against the registry.

6. **The `codex-cloud` case in `buildCommand()` (L72–84) → DIES immediately.** This code uses `codex run --cloud` which is a fabrication — Codex Cloud has no such CLI command. Source: R001 v3, codex-cloud-research §1. This anti-pattern must be corrected even before F014 ships.

**Compatibility shim during migration:**

A thin shim wraps the new plugin call in the old function signature:

```typescript
// Compatibility shim — old API wraps new plugin call
export async function dispatchToAgent(task: TaskDispatch): Promise<TaskResult> {
  const backend = pluginRegistry.getAgentBackend(task.agent ?? 'gemini');
  const invocation = backend.dispatch(task);

  if (invocation.dispatchMode === 'local-cli') {
    // Use existing spawnAndCollect infrastructure
    const { stdout, stderr, exitCode, logPath } = await spawnAndCollect(invocation);
    return backend.parseResult(stdout, stderr, exitCode);
  }

  throw new Error(`Unsupported dispatchMode: ${invocation.dispatchMode}`);
}
```

**Does F005 need to care about this migration?** No. F005 sees only `dispatchToAgent()` — the function signature is unchanged. The migration is entirely internal to the dispatch layer. Source: architecture.md §6.1.

---

## Output Contract Deliverables

### 1. Agent Manifest Schema

See Q1 above for the complete YAML schema with sample manifests for Claude, Codex (local), Codex (cloud), and Gemini.

**Zod schema skeleton:**

```typescript
const AgentManifestSchema = z.object({
  type: z.literal('agent'),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string(),
  dispatchMode: z.enum(['local-cli', 'github-integration']),
  contextFileName: z.string(),
  invocation: z.object({
    command: z.string(),
    headless: z.array(z.string()),
    yolo: z.array(z.string()),
    safeAuto: z.array(z.string()).optional(),
    model: z.array(z.string()),
    structuredOutput: z.array(z.string()).optional(),
    costCap: z.array(z.string()).optional(),
    workingDir: z.array(z.string()).optional(),
    stdinPrompt: z.array(z.string()).optional(),
  }).optional(),  // optional for github-integration mode
  capabilities: z.object({
    supportsStdin: z.boolean(),
    supportsCostCap: z.boolean().default(false),
    supportsStructuredOutput: z.boolean().default(false),
    supportsSystemPrompt: z.boolean().default(false),
    supportsHooks: z.boolean().default(false),
    supportsFallbackModel: z.boolean().default(false),
    nativeParallelism: z.boolean().default(false),
  }),
  models: z.record(z.string()),
  exitCodeMap: z.record(z.object({
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(127)]),
    errorType: z.string().nullable(),
  })),
  managedConfig: z.array(z.object({
    path: z.string(),
    keys: z.array(z.string()),
  })).default([]),
});
```

### 2. Contrast Table: Agent Manifest vs Skill Manifest

| Field | Agent Manifest | Skill Manifest | Notes |
|-------|:---:|:---:|------|
| `type` | `agent` | `skill` | Discriminator |
| `name` | ✅ | ✅ | Shared |
| `version` | ✅ | ✅ | Shared |
| `description` | ✅ | ✅ | Shared |
| `dispatchMode` | ✅ | — | Agent-only: `local-cli` or `github-integration` |
| `contextFileName` | ✅ | — | Agent-only: CLI governance file |
| `invocation` | ✅ | — | Agent-only: CLI flag templates |
| `capabilities` | ✅ | — | Agent-only: feature declarations |
| `models` (per-task-type) | ✅ | — | Agent-only: model routing |
| `exitCodeMap` | ✅ | — | Agent-only: exit normalization |
| `managedConfig` | ✅ | — | Agent-only: config ownership |
| `tier` | — | ✅ | Skill-only: `atomic` or `compound` |
| `category` | — | ✅ | Skill-only: from taxonomy |
| `prompt` | — | ✅ | Skill-only: mode prompt |
| `composes` | — | ✅ | Skill-only: atomic refs |
| `passes` | — | ✅ | Skill-only: multi-pass definition |
| `interface` | — | ✅ | Skill-only: I/O + flags |
| `runtime` | — | ✅ | Skill-only: agent + model preferences |
| `outputContract` | — | ✅ | Skill-only: quality assertions |
| `tags` | Optional | ✅ | Both, but required only for skills |

**Why they differ**: Agent manifests describe an **adapter** for an external CLI tool — they are about invocation mechanics, config management, and result normalization. Skill manifests describe a **reasoning program** — they are about prompt injection, pass composition, and output quality. The only overlap is identity metadata.

### 3. Adapter Lifecycle Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Agent Backend Plugin Lifecycle                                      │
│                                                                      │
│  ┌──────────┐     ┌──────────────┐     ┌─────────────────────────┐  │
│  │ INSTALL   │────▶│ REGISTER     │────▶│ SYNC GOVERNANCE         │  │
│  │           │     │              │     │                         │  │
│  │ gwrk      │     │ Plugin       │     │ .gwrk/agent-context.md  │  │
│  │ plugin    │     │ loader scans │     │   → syncGovernance()    │  │
│  │ install   │     │ ~/.gwrk/     │     │   → CLAUDE.md           │  │
│  │ ./agents/ │     │ plugins/     │     │   → AGENTS.md           │  │
│  │ claude    │     │ agents/      │     │   → GEMINI.md           │  │
│  └──────────┘     └──────────────┘     └────────────┬────────────┘  │
│        │                │                            │               │
│        │ Validate       │ Build registry             │ Auto-called   │
│        │ manifest.yaml  │ from manifests             │ by gwrk       │
│        │ (Zod schema)   │                            │ define plan   │
│        │ Verify CLI     │                            │ define tasks  │
│        │ on PATH        │                            │               │
│        │                │                            ▼               │
│  ┌─────┴────────────────┴──────────────────────────────────────┐    │
│  │  DISPATCH                                                    │    │
│  │                                                              │    │
│  │  gwrk core:                                                  │    │
│  │    context = assembleContext(task, feature)                   │    │
│  │    backend = pluginRegistry.getAgentBackend()                │    │
│  │    invocation = backend.dispatch(context)                    │    │
│  │                                                              │    │
│  │  ┌─── local-cli ────────────────┐  ┌── github-integration ─┐│    │
│  │  │ child = spawn(cmd, args)     │  │ Create GitHub issue    ││    │
│  │  │ child.stdin.write(stdin)     │  │ with @codex <prompt>   ││    │
│  │  │ child.stdin.end()            │  │ Await PR via webhook   ││    │
│  │  │ collect stdout/stderr        │  │                        ││    │
│  │  └──────────┬───────────────────┘  └─────────┬──────────────┘│    │
│  │             │                                │               │    │
│  │             ▼                                ▼               │    │
│  │  ┌────────────────────┐           ┌──────────────────┐      │    │
│  │  │ PARSE RESULT       │           │ PARSE RESULT     │      │    │
│  │  │                    │           │                  │      │    │
│  │  │ backend.parseResult│           │ PR number,       │      │    │
│  │  │ (stdout, stderr,   │           │ diff, SHA →      │      │    │
│  │  │  rawExitCode)      │           │ TaskResult       │      │    │
│  │  │   → TaskResult     │           │                  │      │    │
│  │  └────────────────────┘           └──────────────────┘      │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌──────────┐                                                        │
│  │ TEARDOWN │  gwrk plugin remove <name>                             │
│  │          │  Delete ~/.gwrk/plugins/agents/<name>/                  │
│  │          │  Warn: "<contextFileName> may be stale"                 │
│  └──────────┘                                                        │
└─────────────────────────────────────────────────────────────────────┘
```

**Key difference between dispatch modes:**
- **local-cli**: gwrk spawns the CLI process, pipes stdin, collects output, calls `parseResult()`. Synchronous.
- **github-integration**: Plugin creates a GitHub issue with `@codex` mention. Completion detected via webhook (`pull_request.opened`). Asynchronous.

### 4. Config Conflict Detection Design

See Q3 above for the full design: data model, detection algorithm (install-time + dispatch-time), `gwrk plugin check` output format.

### 5. Governance Sync Design

See Q4 above for the full design: `.gwrk/agent-context.md` format spec, bootstrap mechanism, per-adapter generation rules, boundary marker strategy.

### 6. Exit Code Normalization Table

See Q2 table above for the complete per-backend mapping.

### 7. Migration Path

See Q5 above for the annotated cut-point analysis of `agent.ts`.

**Summary of what dies vs survives:**

| Component | Disposition | Replacement |
|-----------|-------------|-------------|
| `buildCommand()` | **Dies** | `backend.dispatch()` |
| `EXIT_CODE_MAP` | **Dies** | `backend.parseResult()` |
| `dispatchToAgent()` signature | **Survives** | Internals change, API stable |
| `dispatchAgent()` spawn logic | **Survives (refactored)** | Receives plugin output, same spawn |
| `stampLine()` + 429 squelch | **Survives** | gwrk-core concern |
| `AgentBackend` Zod enum | **Dies** | Dynamic discovery from registry |
| `codex-cloud` case in switch | **Dies immediately** | Fabricated CLI command |

### 8. `dispatchMode` Discriminator Design

**Phase 1 (F014 — immediate):** `local-cli` only. All three local backends (claude, codex, gemini) implement the `AgentBackend` interface with `dispatch()` returning `LocalDispatchResult`. gwrk core spawns the process.

**Phase 2 (separate feature — when Codex Cloud ships):** The `AgentBackend` interface gains an optional `CloudAgentBackend` extension:

```typescript
// Phase 1: base interface (F014)
interface AgentBackend {
  name: string;
  dispatchMode: 'local-cli';
  contextFileName: string;
  syncGovernance(projectRoot: string, governance: GovernanceContext): void;
  dispatch(task: TaskDispatch): LocalDispatchResult;
  parseResult(stdout: string, stderr: string, exitCode: number): TaskResult;
}

// Phase 2: cloud extension (separate feature)
interface CloudAgentBackend {
  name: string;
  dispatchMode: 'github-integration';
  contextFileName: string;
  syncGovernance(projectRoot: string, governance: GovernanceContext): void;
  createCloudTask(opts: CloudTaskOptions): Promise<{ issueNumber: number }>;
  awaitCompletion(issueNumber: number): Promise<TaskResult>;
}

// Discriminated union — gwrk core checks dispatchMode
type AnyAgentBackend = AgentBackend | CloudAgentBackend;
```

**Interface evolution path:**
1. F014 P3 ships with `AgentBackend` (local-cli only)
2. Codex Cloud feature extends with `CloudAgentBackend`
3. gwrk core dispatch checks `backend.dispatchMode` to route to spawn vs GitHub
4. `pluginRegistry.getAgentBackend()` returns `AnyAgentBackend` — callers check mode

This avoids breaking the F014 interface when Codex Cloud arrives.

### 9. F014 Spec Alignment Notes

The F014 spec needs these additions for Layer 1:

| ID | Requirement | Source |
|----|-------------|--------|
| **FR-L1-001** | System MUST define an `AgentBackend` plugin type with Zod-validated manifest schema distinct from skill manifests. | ADR-006 §2.1 |
| **FR-L1-002** | Agent adapter `dispatch()` MUST return stdin string for context delivery. gwrk core MUST pipe via `child.stdin.write()`. | ADR-006 §2.3 |
| **FR-L1-003** | Agent adapter `parseResult()` MUST normalize proprietary exit codes to gwrk standard (0/1/2/127) with `errorType` metadata. | ADR-006 §2.4 |
| **FR-L1-004** | Agent adapter `syncGovernance()` MUST generate CLI-specific context files from `.gwrk/agent-context.md`. Called by `gwrk define plan` and `gwrk define tasks`. | ADR-006 §2.2 |
| **FR-L1-005** | Agent manifests MUST declare `managedConfig` keys. `gwrk plugin check` MUST detect ownership conflicts at install-time and value drift at dispatch-time. | ADR-006 §2.5 |
| **FR-L1-006** | System MUST provide `gwrk plugin sync-context` command for manual governance sync. | ADR-006 §4 |
| **FR-L1-007** | Agent manifests MUST declare `dispatchMode: local-cli`. `github-integration` mode is reserved for future Codex Cloud feature. | R001 v3, codex-cloud-research |
| **FR-L1-008** | `gwrk init` MUST create `.gwrk/agent-context.md` from template. MUST support migration from existing `.agents/rules/workspace.md`. | ADR-006 §2.2 |

**Existing FRs that need updates:**

| FR | Current | Change |
|----|---------|--------|
| FR-001 | Validates skill manifests only | Add agent manifest validation path |
| FR-002 | Zod schema for skills only | Add `AgentManifestSchema` |
| FR-003 | `gwrk plugin list` shows skills | Add agent backends to list, grouped by type |
| FR-005 | "Skills, agents, channels are global-only" | Confirmed — agents are global (installed at `~/.gwrk/plugins/agents/`) |

### 10. Architecture.md Amendments

#### §7.2 — Add agent manifest schema reference

```diff
 ### 7.2 AgentBackend Interface (ADR-006 §2.1)
 
 ```typescript
 interface AgentBackend {
   name: string;
+  dispatchMode: 'local-cli';
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
+
+Agent adapter manifests (`type: agent` in manifest.yaml) are distinct from skill manifests.
+Key fields: `dispatchMode`, `contextFileName`, `managedConfig`, `invocation`,
+`exitCodeMap`, `capabilities`, per-task-type `models`. See R002 §Q1 for full schema.
```

#### §7.3 — Add bootstrap and boundary marker details

```diff
 ### 7.3 Durable Governance (ADR-006 §2.2)
 
 ```
 .gwrk/agent-context.md                 ← Single source of truth
     ↓  gwrk plugin sync-context
 GEMINI.md, CLAUDE.md, AGENTS.md        ← Generated per-CLI context files
 ```
 
 A single `.gwrk/agent-context.md` becomes the source of truth for durable governance.
+
+**Bootstrap:** `gwrk init` creates `.gwrk/agent-context.md` from template. Migration
+from existing `.agents/rules/workspace.md` is supported — content imported into
+appropriate sections. `.agents/` is NOT deleted (IDE compatibility — TC-006).
+
+**Boundary markers:** Generated context files use `<!-- gwrk:begin -->` / `<!-- gwrk:end -->`
+markers. User-added content outside these markers is preserved across sync operations.
```

#### §8 — Add agent config shape to `.gwrkrc.json`

```diff
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
-    "fallbackOrder": ["codex-cloud", "codex-local", "claude", "gemini"],
+    "fallbackOrder": ["codex-cloud", "codex", "claude", "gemini"],
```

Agent names in `.gwrkrc.json` reference plugin names from the registry, validated at runtime.

#### §14 — Add `.gwrk/agent-context.md` to provisioning matrix

```diff
 ## 14. CLI Provisioning Matrix
 
 `gwrk new` and `gwrk init` provision all detected AI CLIs:
 
 | File/Dir | Gemini | Claude | Codex | Purpose |
 |---|---|---|---|---|
+| `.gwrk/agent-context.md` | — | — | — | **Source of truth** for all CLI context files |
 | `GEMINI.md` | ✅ Required | — | — | Project context for Gemini CLI |
```

---

## Q6: Plugin Authoring, Packaging, and Distribution

### The Gap

The draft above defines *what* an agent backend plugin is (manifest schema, interface, lifecycle) but entirely hand-waves *how* one gets created, packaged, and installed. The F014 spec (FR-001) says `gwrk plugin install <path|url>` — accepting a local directory path, git URL, or zip file — but never defines:

- How an author creates a new plugin from scratch
- What the package structure looks like
- How plugins are versioned and distributed
- How the three built-in adapters (claude, codex, gemini) get bootstrapped
- Whether there's a registry, and if not, what replaces it

This section addresses all of these using decision-forge and architecture-stress-test reasoning.

### Decision Forge: Plugin Distribution Model

> **Decision**: How should gwrk plugins be packaged and distributed?

#### Pass 1 — Adversarial (Attack each option)

**Option A: Directory-only (current kludge)**
- `gwrk plugin install ./my-plugin` copies a directory. No packaging. No versioning.
- **Attack**: How do you share a plugin? Email a zip? How do you update? Delete and re-install? How do you know what version you have? You don't. This is a dev-time convenience, not a distribution model. It works for the initial `.agents/skills/` → `~/.gwrk/plugins/skills/` migration because those are local files, but it collapses the moment you want to install someone else's plugin or even reinstall your own on a fresh machine.

**Option B: npm-based registry**
- Plugins are npm packages. `gwrk plugin install gwrk-agent-claude` resolves from npm, runs `npm install`, extracts manifest.
- **Attack**: Violates "no phone home" (workspace.md). Every install makes a network call. Drags in the entire npm dependency graph problem. gwrk plugins are not Node.js libraries — they're YAML manifests + optional TypeScript. npm is extreme overkill. Also: supply-chain risk (architecture.md §7.6 explicitly requires `--ignore-scripts`, path containment). And: gwrk is a single-user PE tool, not a community platform — who are you distributing to?

**Option C: Git-native (repos as packages)**
- Plugins live in git repos. `gwrk plugin install https://github.com/gforge-esc/gwrk-agent-claude.git` clones, validates manifest, copies to `~/.gwrk/plugins/agents/<name>/`.
- **Attack**: Requires git on PATH (reasonable — gwrk already requires git). Version pinning via git tags. But: how do you handle updates? `gwrk plugin update <name>`? That means tracking the source URL somewhere. Also: what about the three built-in adapters? They ship with gwrk itself, not as separate repos.

#### Pass 2 — Steel-man (Strongest counter-argument)

**The strongest argument for npm** is dependency resolution. If a Codex Cloud adapter needs `@octokit/rest` for GitHub API calls, npm handles that. Git-native distribution doesn't solve transitive dependencies.

**Counter**: Agent backend plugins are **YAML manifests + optional TypeScript adapter shims**. They don't have dependencies. The dispatch logic lives in gwrk core, not in the plugin. If a hypothetical cloud adapter needs octokit, that dependency belongs in gwrk core (it's a core capability, not a plugin concern). The entire point of ADR-006 is that plugins return spawn instructions — gwrk core does the spawning. Plugins are data + light adapter code, not full applications.

**The strongest argument for directory-only** is simplicity. Single-user tool, no community, no registry. Just copy files.

**Counter**: This breaks the moment you want reproducibility. `gwrk init` on a fresh machine should be able to bootstrap the same agent backends. Without a source-of-truth for where plugins came from, you're back to "copy my dotfiles" — the exact anti-pattern gwrk exists to eliminate.

#### Pass 3 — Calibration

| Dimension | Confidence | Basis | What Changes Mind |
|-----------|:---:|-------|-------------------|
| Built-in adapters ship with gwrk | 9/10 | Evidence: gwrk is a single binary (TS compiled). Core adapters are not optional. | If a new CLI backend appears monthly (unlikely — there are 3 major ones) |
| Git-native is sufficient for distribution | 8/10 | Evidence: Homebrew taps, Packer plugins, Go modules all use git-native. gwrk has zero community right now. | If gwrk gains >10 users who need shared plugins |
| No npm registry needed | 9/10 | Evidence: "no phone home" rule, single-user, plugins have no deps | If plugins grow to include full applications with dependencies |
| `gwrk agent create` scaffolding is needed | 10/10 | Evidence: every plugin system worth using has a scaffold command | Nothing — this is table stakes |
| Plugin metadata must track source URL | 8/10 | Evidence: reproducibility requires knowing where a plugin came from | If all plugins are always built-in |

### Decision Record: Plugin Distribution Model

**Position**: Hybrid — built-in adapters ship with gwrk core + git-native distribution for third-party/custom plugins.

**Confidence**: 8.5/10

#### The Two-Track Model

**Track 1: Built-in adapters (claude, codex, gemini)**

Ship as part of gwrk. Located in `src/plugins/builtins/agents/`. At build time, their `manifest.yaml` files are embedded in the compiled output. At runtime, the plugin loader reads them before scanning `~/.gwrk/plugins/agents/`.

```
src/plugins/builtins/agents/
├── claude/
│   ├── manifest.yaml
│   └── adapter.ts       # implements AgentBackend interface
├── codex/
│   ├── manifest.yaml
│   └── adapter.ts
└── gemini/
    ├── manifest.yaml
    └── adapter.ts
```

**Why built-in**: These three adapters are the *entire reason gwrk exists*. Making them external plugins that must be separately installed is ceremony masquerading as architecture. A fresh `gwrk init` must work immediately with all three CLIs — no `gwrk plugin install` first.

**Override mechanism**: A user can install a custom adapter with the same name to `~/.gwrk/plugins/agents/<name>/`. The user-installed version takes precedence over the built-in. This is the standard pattern (Homebrew: formula override tap, npm: local > global).

```
Resolution order (per architecture.md §7.5):
1. ~/.gwrk/plugins/agents/<name>/manifest.yaml  → user override
2. src/plugins/builtins/agents/<name>/manifest.yaml → built-in default
```

**Track 2: Git-native distribution for custom adapters**

For new or custom backends (e.g., a hypothetical `ollama` adapter, or a custom `codex-cloud-v2`):

```bash
# Install from git repo
gwrk plugin install https://github.com/user/gwrk-agent-ollama.git

# Install from local directory (development)
gwrk plugin install ./my-agent-ollama

# Install from git tag (versioned)
gwrk plugin install https://github.com/user/gwrk-agent-ollama.git#v1.2.0
```

**What happens on install:**

1. If URL: `git clone --depth 1 <url>` to a temp directory. If tag/ref specified, checkout that ref.
2. Validate `manifest.yaml` exists and passes `AgentManifestSchema` (Zod).
3. If `manifest.type !== 'agent'`, reject: `Error: manifest type 'skill' does not match expected type 'agent'. Use 'gwrk plugin install --type skill' or 'gwrk skill install'.`
4. If `dispatchMode === 'local-cli'`, verify `invocation.command` exists on PATH: `which <command>`. Warn (don't error) if missing — user may install the CLI later.
5. Copy to `~/.gwrk/plugins/agents/<name>/`.
6. Write source metadata to `~/.gwrk/plugins/agents/<name>/.gwrk-source.json`:
   ```json
   {
     "installedFrom": "https://github.com/user/gwrk-agent-ollama.git#v1.2.0",
     "installedAt": "2026-03-18T22:00:00Z",
     "ref": "v1.2.0",
     "commitSha": "abc123def456"
   }
   ```
7. Register in plugin registry.

**What `.gwrk-source.json` enables:**
- `gwrk plugin list` shows source URL and version
- `gwrk plugin update <name>` re-clones from the stored URL (latest tag or HEAD)
- `gwrk plugin update --all` updates all git-sourced plugins
- Reproducibility: `gwrk plugin list --format json` exports installable manifest

### Plugin Package Structure

Every plugin — whether built-in, git-distributed, or locally developed — follows this directory structure:

```
<plugin-name>/
├── manifest.yaml         # REQUIRED — plugin identity, contract, schema
├── adapter.ts            # OPTIONAL — TypeScript adapter (compiled to .js)
├── README.md             # OPTIONAL — human documentation
├── LICENSE               # OPTIONAL — license file
└── templates/            # OPTIONAL — for governance file generation
    └── context.md.hbs    # Handlebars template for context file rendering
```

**Minimal viable agent plugin** (manifest-only, no adapter code):

If the `invocation` block in `manifest.yaml` is declarative enough, **no `adapter.ts` is needed**. The built-in generic adapter reads the manifest and constructs the spawn command from the `invocation` fields. This is the default path — custom `adapter.ts` is only needed for non-standard dispatch patterns (e.g., Codex Cloud's GitHub integration).

```yaml
# manifest.yaml — this IS the entire plugin for a standard local-cli agent
type: agent
name: ollama
version: 0.1.0
description: "Ollama local model backend"
dispatchMode: local-cli

contextFileName: OLLAMA.md

invocation:
  command: ollama
  headless: ["run"]
  yolo: []                    # ollama has no approval system
  model: []                   # model is first positional arg
  structuredOutput: []

capabilities:
  supportsStdin: true
  supportsCostCap: false
  supportsStructuredOutput: false

models:
  default: llama3.3

exitCodeMap:
  0: { exitCode: 0, errorType: null }

managedConfig: []
```

**This resolves Open Item #3** from earlier: the **default is declarative** (manifest-driven dispatch via generic adapter). Custom `adapter.ts` is the escape hatch for backends that need programmatic dispatch logic.

### `gwrk plugin create agent` — Scaffolding Command

> **Decision (naming-forge + decision-forge)**: All plugin operations live under the single `gwrk plugin` namespace. The plugin type (`agent`, `skill`) is a positional argument to `create`, not a flag. This eliminates split-brain (authoring under one namespace, management under another) and mirrors the instrument-family pattern: the *plugin* is the family, create/install/list/remove are actions on it.

```bash
# Scaffold a new agent backend plugin
gwrk plugin create agent my-llm-backend

# Scaffold with git init
gwrk plugin create agent my-llm-backend --git

# Scaffold for a non-standard dispatch mode
gwrk plugin create agent codex-cloud-v2 --dispatch-mode github-integration

# Future: scaffold other plugin types
gwrk plugin create skill my-analyzer
```

**What it generates:**

```
my-llm-backend/
├── manifest.yaml         # Pre-filled template with TODO markers
├── adapter.ts            # Skeleton implementing AgentBackend (if --dispatch-mode github-integration)
├── README.md             # Template with usage instructions
└── .gitignore            # If --git
```

**Generated `manifest.yaml` template:**

```yaml
# gwrk Agent Backend Plugin
# Generated by: gwrk plugin create agent my-llm-backend
# Docs: https://gwrk.dev/docs/plugins/agent-backends

type: agent
name: my-llm-backend                  # TODO: your adapter name
version: 0.1.0
description: "TODO: describe your agent backend"
dispatchMode: local-cli                # or: github-integration

contextFileName: MY_LLM.md            # TODO: CLI's context file name

invocation:
  command: my-llm                      # TODO: CLI binary name
  headless: ["-p"]                     # TODO: non-interactive flag
  yolo: ["--yes"]                      # TODO: auto-approve flag
  model: ["--model"]                   # TODO: model selection flag
  structuredOutput: []                 # TODO: structured output flags (if supported)
  costCap: []                          # TODO: cost cap flags (if supported)
  workingDir: []                       # TODO: working directory flag (if supported)

capabilities:
  supportsStdin: false                 # TODO: does the CLI accept stdin?
  supportsCostCap: false
  supportsStructuredOutput: false
  supportsSystemPrompt: false
  supportsHooks: false
  supportsFallbackModel: false

models:
  default: default-model               # TODO: default model name
  implement: default-model
  review: default-model
  define: default-model

exitCodeMap:
  0: { exitCode: 0, errorType: null }
  # TODO: add proprietary exit codes
  # Example: 42: { exitCode: 2, errorType: "usage_error" }

managedConfig: []
  # TODO: declare config files this adapter manages
  # Example:
  # - path: ".my-llm/config.json"
  #   keys: ["model", "sandbox"]
```

**Generated `adapter.ts` skeleton** (only when `--dispatch-mode github-integration`):

```typescript
// gwrk Agent Backend Adapter: my-llm-backend
// This file is only needed for non-standard dispatch patterns.
// For standard local-cli dispatch, the manifest.yaml is sufficient.

import type { AgentBackend, TaskDispatch, TaskResult, GovernanceContext } from '@gwrk/plugin-api';

export default class MyLlmBackend implements AgentBackend {
  name = 'my-llm-backend';
  dispatchMode = 'github-integration' as const;
  contextFileName = 'MY_LLM.md';

  syncGovernance(projectRoot: string, governance: GovernanceContext): void {
    // TODO: Generate context file from governance
    throw new Error('Not implemented');
  }

  dispatch(task: TaskDispatch): CloudDispatchResult {
    // TODO: Implement cloud dispatch
    throw new Error('Not implemented');
  }

  parseResult(stdout: string, stderr: string, exitCode: number): TaskResult {
    // TODO: Implement result parsing
    throw new Error('Not implemented');
  }
}
```

**F014 spec alignment — new FRs needed:**

| ID | Requirement | Source |
|----|-------------|--------|
| **FR-L1-009** | System MUST provide `gwrk plugin create agent <name>` that generates a scaffold plugin directory with `manifest.yaml` template. Supports `--git` and `--dispatch-mode`. Future: `gwrk plugin create skill <name>` for skill scaffolding. | This research |
| **FR-L1-010** | System MUST ship built-in adapters (claude, codex, gemini) in `src/plugins/builtins/agents/`. These MUST be available without `gwrk plugin install`. | This research |
| **FR-L1-011** | `gwrk plugin install <url>` MUST support git URLs with optional `#<ref>` for version pinning. MUST write `.gwrk-source.json` for update tracking. | This research |
| **FR-L1-012** | User-installed plugins at `~/.gwrk/plugins/agents/<name>/` MUST take precedence over built-in adapters with the same name. | architecture.md §7.5 |
| **FR-L1-013** | System MUST provide `gwrk plugin update <name>` that re-clones from the stored source URL. MUST support `--all` to update all git-sourced plugins. | This research |

### Architecture Stress Test: Plugin Packaging Pre-mortem

> **Assume this packaging design failed 6 months from now. What were the causes?**

#### Failure Scenario 1 — Built-in adapter staleness (Likelihood: HIGH)

**Cause**: Claude releases a new CLI version with different flags. The built-in adapter's `invocation` block is wrong. User can't fix it without upgrading gwrk itself.

**Mitigation**: Override mechanism. User installs a fixed manifest to `~/.gwrk/plugins/agents/claude/`. Override takes precedence. The user can also `gwrk plugin create agent claude-fixed` and test independently. When gwrk upgrades, the built-in catches up, and the user removes their override.

**Mitigation effectiveness**: 9/10 — proven pattern (Homebrew formula override).

#### Failure Scenario 2 — No adapter.ts validation (Likelihood: MEDIUM)

**Cause**: A custom adapter.ts has a runtime error. `gwrk plugin install` succeeds (manifest valid), but dispatch crashes at runtime.

**Mitigation**: `gwrk plugin install` MUST import and instantiate the adapter.ts, calling a `validate()` method if present. This catches import errors and obvious problems at install time, not dispatch time.

**Mitigation effectiveness**: 7/10 — can't catch all runtime errors, but catches the common ones.

#### Failure Scenario 3 — Version drift between manifest and adapter.ts (Likelihood: LOW)

**Cause**: Plugin author updates manifest.yaml but not adapter.ts, or vice versa. The two are out of sync.

**Mitigation**: For local-cli dispatch, `adapter.ts` is optional — the generic adapter drives from manifest alone. Only github-integration dispatch requires a custom adapter. Since there's only one such backend (codex-cloud), and it's a separate feature not in F014 P1, this risk is deferred.

**Mitigation effectiveness**: 8/10 — low risk because most plugins won't need adapter.ts.

#### Failure Scenario 4 — Air-gapped install fails (Likelihood: MEDIUM)

**Cause**: User is air-gapped (no internet). `gwrk plugin install <url>` fails because there's no git access.

**Mitigation**: Directory-based install always works: `gwrk plugin install ./my-plugin`. For air-gapped environments, plugins are distributed as tarballs or directories on USB/shared drives. Built-in adapters don't require install at all. The `.gwrk-source.json` tracks origin but doesn't require it for operation.

**Mitigation effectiveness**: 9/10 — aligns with gwrk's air-gapped readiness design (architecture.md §7.6).

#### Failure Scenario 5 — Plugin command taxonomy confusion (Likelihood: LOW → mitigated by single namespace)

**Cause**: User doesn't know whether to use `gwrk plugin install`, `gwrk agent create`, `gwrk skill install`, or just copy files. Too many entry points.

**Mitigation**: Single `gwrk plugin` namespace for ALL plugin operations. Type is a positional arg to `create`:

| What you want | Command |
|---------------|---------|
| Create a new agent plugin from scratch | `gwrk plugin create agent <name>` |
| Create a new skill plugin from scratch | `gwrk plugin create skill <name>` |
| Install an existing plugin (any type) | `gwrk plugin install <path\|url>` |
| List all plugins (all types) | `gwrk plugin list` |
| Update a git-sourced plugin | `gwrk plugin update <name>` |
| Remove a plugin | `gwrk plugin remove <name>` |
| Check plugin health | `gwrk plugin check` |
| Migrate old .agents/ skills | `gwrk plugin migrate` |
| Generate atomic skills from taxonomy | `gwrk plugin seed` |

No split brain. Everything under `gwrk plugin *`. Likelihood reduced from MEDIUM to LOW because the single namespace eliminates the confusion vector entirely.

**Mitigation effectiveness**: 9/10 — single namespace is the proven pattern (Homebrew, Packer, npm).

### Plugin Bootstrapping at `gwrk init`

When a user runs `gwrk init` in a project:

1. **Detect installed CLIs**: check `which gemini`, `which claude`, `which codex`
2. **For each detected CLI**: activate the corresponding built-in adapter
3. **Generate context files**: call `syncGovernance()` for each activated adapter
4. **Write `.gwrkrc.json`**: set `agents.define` and `agents.implement` based on detected CLIs
5. **Report**: `✓ Detected 3 agent backends: claude, codex, gemini`

No `gwrk plugin install` step. Built-ins just work.

### Built-in Adapter Compilation Model

> **Decision (decision-forge)**: Hybrid — adapter TypeScript compiles with gwrk (`pnpm build`). Manifest YAML ships as package data, read at runtime via `import.meta.dirname`. User overrides in `~/.gwrk/plugins/agents/` replace built-ins.

**Why hybrid**: The `adapter.ts` for built-in backends is **core gwrk functionality** — the Claude adapter's `dispatch()` method is called on every `gwrk ship`. Dynamically loading it from a loose file means your core dispatch path depends on filesystem state. That's the opposite of reliability. The *manifest* can be loose (it's data, it changes with CLI updates), but the *code* should be compiled in.

**Implementation:**

```
src/plugins/builtins/agents/
├── claude/
│   ├── manifest.yaml       # ships as data file in npm package
│   └── adapter.ts          # compiles with pnpm build
├── codex/
│   ├── manifest.yaml
│   └── adapter.ts
├── gemini/
│   ├── manifest.yaml
│   └── adapter.ts
└── index.ts                # static registry of built-in adapters
```

**`src/plugins/builtins/agents/index.ts`:**

```typescript
import { ClaudeAdapter } from './claude/adapter.js';
import { CodexAdapter } from './codex/adapter.js';
import { GeminiAdapter } from './gemini/adapter.js';

// Static registry — these are always available
export const BUILTIN_AGENTS = {
  claude: ClaudeAdapter,
  codex: CodexAdapter,
  gemini: GeminiAdapter,
} as const;
```

**Plugin loader resolution order:**

```typescript
function loadAgentBackends(): Map<string, AgentBackend> {
  const registry = new Map<string, AgentBackend>();

  // 1. Load built-in adapters (compiled in)
  for (const [name, AdapterClass] of Object.entries(BUILTIN_AGENTS)) {
    const manifestPath = resolve(import.meta.dirname, name, 'manifest.yaml');
    const manifest = parseYaml(readFileSync(manifestPath, 'utf8'));
    registry.set(name, new AdapterClass(manifest));
  }

  // 2. Load user-installed adapters (override built-ins)
  const userPluginsDir = resolve(homedir(), '.gwrk/plugins/agents');
  if (existsSync(userPluginsDir)) {
    for (const dir of readdirSync(userPluginsDir)) {
      const manifest = loadManifest(resolve(userPluginsDir, dir));
      // User override takes precedence — Map.set() overwrites
      registry.set(manifest.name, loadAdapter(manifest));
    }
  }

  return registry;
}
```

**Key properties:**
- `pnpm build` compiles `adapter.ts` alongside everything else — zero build complexity added
- `manifest.yaml` resolves via `import.meta.dirname` relative to compiled output — standard Node.js pattern
- User overrides in `~/.gwrk/plugins/agents/<name>/` replace built-ins completely (Map `.set()` overwrites)
- Three `readFileSync` calls of ~1KB each at startup — unmeasurable latency
- ESM compatibility: `import.meta.dirname` (Node 21+) replaces `__dirname`

### Unified Plugin Manifest Base Schema

For cohesion across all plugin types, define a shared base:

```typescript
// Base fields shared across ALL plugin types
const PluginBaseSchema = z.object({
  type: z.enum(['agent', 'skill', 'extension', 'channel']),
  name: z.string().min(1).regex(/^[a-z0-9-]+$/),    // kebab-case required
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
});

// Agent-specific (extends base)
const AgentManifestSchema = PluginBaseSchema.extend({
  type: z.literal('agent'),
  dispatchMode: z.enum(['local-cli', 'github-integration']),
  contextFileName: z.string(),
  invocation: InvocationSchema.optional(),
  capabilities: CapabilitiesSchema,
  models: z.record(z.string()),
  exitCodeMap: z.record(ExitCodeEntrySchema),
  managedConfig: z.array(ManagedConfigSchema).default([]),
});

// Skill-specific (extends base) — already defined in F014
const SkillManifestSchema = PluginBaseSchema.extend({
  type: z.literal('skill'),
  tier: z.enum(['atomic', 'compound']),
  // ... rest from F014 spec DM-001/DM-002
});

// Discriminated union — validated by plugin loader
const AnyManifestSchema = z.discriminatedUnion('type', [
  AgentManifestSchema,
  SkillManifestSchema,
  // Future: ExtensionManifestSchema, ChannelManifestSchema
]);
```

This ensures `gwrk plugin install` can validate ANY plugin type from a single schema, then route to the correct type-specific directory (`agents/`, `skills/`, etc.).

---

## Open Items

| # | Item | Status | Requires |
|---|------|--------|----------|
| ~~1~~ | ~~`codex-cloud` case in `buildCommand()` uses fabricated `codex run --cloud`~~ | **Cascaded** | Moved to [cascade.md](file:///Users/gonzo/Code/gwrk/docs/research/cascade.md) — downstream engineering action: delete dead code path before F014 P3. |
| ~~2~~ | ~~`config.ts` defaults `maxClones: 4` vs R001's `maxClones: 2`~~ | **Killed** | PM: don't care. Config drift is a minor cleanup, not an R002 concern. |
| ~~3~~ | ~~Agent manifest `invocation` block is declarative vs TypeScript dispatch~~ | **Resolved** | Default is declarative (manifest-driven via generic adapter). Custom `adapter.ts` is the escape hatch for non-standard dispatch. See Q6. |
| ~~4~~ | ~~`gwrk agent create` vs `gwrk plugin create --type agent`~~ | **Resolved** | `gwrk plugin create agent <name>` — single `plugin` namespace, type as positional arg. Eliminates split-brain. Applied naming-forge + decision-forge. See Q6. |
| ~~5~~ | ~~Built-in adapter compilation model~~ | **Resolved** | Hybrid: adapter TS compiled with `pnpm build`, manifest YAML read at runtime via `import.meta.dirname`. User overrides via `~/.gwrk/plugins/agents/`. Applied decision-forge. See Q6. |

---

## Source Lineage

| Source | Contribution |
|--------|-------------|
| [ADR-006](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-006-plugin-agent-backends.md) §2.1–2.5, §3–4 | **Canonical** AgentBackend interface, exit normalization, governance sync, config ownership |
| [F014 spec](file:///Users/gonzo/Code/gwrk/specs/014-plugin-system/spec.md) FR-001–013, DM-001–005 | L2 skill schema (contrast for L1), plugin infrastructure FRs, install/migrate/seed commands |
| [architecture.md](file:///Users/gonzo/Code/gwrk/docs/architecture.md) §7, §8, §14 | Plugin architecture, config contract, provisioning matrix, supply-chain guardrails |
| [R001 v3](file:///Users/gonzo/Code/gwrk/docs/research/R001-parallel-dispatch/draft.md) §Q2, §Q4 | Codex Cloud is separate feature, dispatchMode discriminator, resource gating |
| [codex-cloud-research](file:///Users/gonzo/Code/gwrk/docs/reference/codex-cloud-research-report.md) §1, §7 | NOT a CLI, GitHub integration model, AGENTS.md governance |
| [cli-backend-research](file:///Users/gonzo/Code/gwrk/docs/reference/cli-backend-research-report.md) §2–8 | Per-CLI invocation patterns, stdin support, exit codes, context files |
| [openclaw-research-report](file:///Users/gonzo/Code/gwrk/docs/reference/openclaw-research-report.md) §2.6, §6.1, §7 | Plugin types, ClawHub (killed for gwrk), supply-chain practices |
| [plugin-strategy-audit](file:///Users/gonzo/Code/gwrk/docs/reference/plugin-strategy-audit.md) | F008→F014 fold, remediation priority, three-layer architecture |
| [plugin-architecture-plan](file:///Users/gonzo/Code/gwrk/docs/reference/plugin-architecture-plan.md) | Plugin scoping (global + local), phasing, skill manifest samples |
| [skills-architecture](file:///Users/gonzo/Code/gwrk/docs/reference/skills-architecture.md) | L2 skill hierarchy, manifest boundary rule, execution model |
| [agent.ts](file:///Users/gonzo/Code/gwrk/src/utils/agent.ts) L22–313 | Current facade: buildCommand(), EXIT_CODE_MAP, dispatchToAgent() |
| [config.ts](file:///Users/gonzo/Code/gwrk/src/utils/config.ts) L1–118 | Zod schemas, AgentBackend enum, GwrkConfig shape |
| GEMINI.md, CLAUDE.md, AGENTS.md | Current governance stubs — 6 lines each, minimal kludge |
| [.gwrkrc.json](file:///Users/gonzo/Code/gwrk/.gwrkrc.json) | Current config shape — agents.define, agents.implement, parallelism |
| Primary research: Homebrew taps, Packer plugins, npm | Plugin scaffolding and distribution patterns in mature CLI ecosystems |
| Reasoning skills applied: [decision-forge](file:///Users/gonzo/Code/gwrk/.agents/skills/decision-forge/SKILL.md), [architecture-stress-test](file:///Users/gonzo/Code/gwrk/.agents/skills/architecture-stress-test/SKILL.md) | Distribution model decision, packaging pre-mortem analysis |
