# CLI Backend Research Report: Claude, Codex, Gemini

> **Status:** Research Report · **Date:** 2026-03-17
> **Purpose:** Primary reference for ADR-006 (Plugin System — Agent Backend Architecture)
> **Compatibility:** [ADR-004](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-004-agent-native-output.md), [013 Agent-Native Interface](file:///Users/gonzo/Code/gwrk/specs/013-agent-native-interface/spec.md), [014 Plugin System](file:///Users/gonzo/Code/gwrk/specs/014-plugin-system/spec.md)
> **Methodology:** Hands-on analysis of demo projects (`~/Code/cli-testing*`), CLI `--help` output, web research, and cross-reference with GPT-5.2 Prompting Guide
> **Model:** Opus 4.6

---

## 1. Executive Summary

gwrk dispatches work to three foundational model CLIs: **Claude Code** (Anthropic), **Codex CLI** (OpenAI), and **Gemini CLI** (Google). Each has a distinct project provisioning model, configuration architecture, and headless invocation format. This report documents each CLI's anatomy in detail to inform the plugin system's `AgentBackend` interface — specifically how gwrk's ship loop (004) will construct CLI-specific commands that result in successful implementation of features/phases/tasks.

### Core Finding

All three CLIs converge on common primitives — **project-root context file**, **headless/non-interactive mode**, and **extensibility mechanisms** — but diverge significantly in structure, naming, and capabilities. gwrk's plugin system must abstract these differences through a **context adapter layer** that:

1. Maintains CLI-specific governance files when they afford meaningful advantage
2. Composes context-rich prompts that are shaped for each CLI's cognitive model
3. Invokes each CLI with its exact headless command format

---

## 2. CLI Provisioning Anatomy

### 2.1 Claude Code (Anthropic)

**Demo directory:** `~/Code/cli-testing` (Claude)

#### Project Structure

```
project/
├── CLAUDE.md                    # Project root context file
├── .claude/                     # Configuration directory
│   ├── settings.json            # Permissions + hooks (committed)
│   ├── settings.local.json      # Local overrides (gitignored)
│   └── skills/                  # Custom slash commands
│       ├── new-feature.md       # /new-feature skill
│       └── review.md            # /review skill
└── (project files)
```

#### Context File: `CLAUDE.md`

- **Purpose:** Always-in-context document. Claude reads this on every session start.
- **Location:** Project root. Can also exist in subfolders for scoped context.
- **Content:** Project structure, stack, dev commands, conventions, what the project demonstrates.
- **Hierarchical:** Multiple `CLAUDE.md` files can be distributed in subdirectories — each scoped to its subtree.
- **Global:** `~/.claude/CLAUDE.md` provides user-wide defaults.

> **Key insight:** `CLAUDE.md` is the *most powerful* context injection mechanism across all three CLIs because it's always loaded — no flag needed. It's the equivalent of a `system_prompt` that persists across sessions.

#### Configuration: `.claude/`

| File | Purpose | Committed? |
|------|---------|-----------|
| `settings.json` | Permissions (allow/deny tool access), hooks (pre/post tool use) | ✅ Yes |
| `settings.local.json` | Local overrides (extra permissions, env-specific) | ❌ No (gitignored) |
| `skills/*.md` | Custom slash commands — markdown files that define multi-step procedures | ✅ Yes |

**Permissions model:** Fine-grained tool-level ACL. Example: `"Bash(node:*)"` allows node commands, `"Bash(git commit:*)"` allows git commits. This is *per-command* scoping, not sandbox-level.

**Hooks system:** Pre/post hooks on tool invocations. Deterministic shell commands at lifecycle points:
- `PostToolUse` with `"matcher": "Write|Edit"` → runs after any file write
- `PreToolUse` with `"matcher": "Bash"` → runs before any bash command

**Skills:** Markdown files in `.claude/skills/` that define slash-command procedures (e.g., `/new-feature` triggers a multi-step branch + scaffold workflow). Skills are the Claude equivalent of gwrk's workflows.

#### Headless Invocation

```bash
claude --dangerously-skip-permissions --model <model> -p "<prompt>"
```

| Flag | Purpose |
|------|---------|
| `-p, --print` | Non-interactive: print response and exit. Pipe-safe. |
| `--dangerously-skip-permissions` | Bypass all permission checks (YOLO mode) |
| `--model <model>` | Model selection (e.g., `sonnet`, `opus`, `claude-sonnet-4-6`) |
| `--system-prompt <prompt>` | Override/set system prompt |
| `--append-system-prompt <prompt>` | Append to default system prompt |
| `--allowedTools <tools>` | Restrict available tools |
| `--output-format <format>` | `text` (default), `json`, `stream-json` |
| `--max-budget-usd <amount>` | Cost cap (headless only) |
| `--json-schema <schema>` | Structured output validation |
| `--effort <level>` | `low`, `medium`, `high`, `max` |
| `--permission-mode <mode>` | `default`, `acceptEdits`, `bypassPermissions`, `plan`, `auto` |
| `--add-dir <dirs>` | Additional directories for tool access |

**Advanced features for gwrk:**
- `--agents` flag accepts JSON defining custom agent personas
- `--mcp-config` loads MCP server configurations
- `--worktree` creates isolated git worktrees per session
- `--fallback-model` enables automatic model fallback on overload
- Sessions can be continued (`--continue`) or resumed (`--resume`)

#### Prompting Best Practices (Claude-Specific)

1. **CLAUDE.md is your system prompt.** Invest heavily in it. It's always loaded.
2. **Hooks enforce standards deterministically.** Don't rely on the model to lint — hook a linter into `PostToolUse` on `Write|Edit`.
3. **Skills define procedures.** For gwrk, a skill like `/implement-phase` could encode the entire ship loop step sequence.
4. **`/clear` aggressively.** Claude's performance degrades with excessive conversation history. For headless calls, this is moot (each `-p` call is a fresh context).
5. **Provide verification mechanisms.** Claude performs best when it can self-check (tests, expected outputs, screenshots).
6. **Use XML-tagged prompt sections.** Claude responds well to `<context>`, `<constraints>`, `<output_format>` tagged prompts.

---

### 2.2 Codex CLI (OpenAI)

**Demo directory:** `~/Code/cli-testing-01` (Codex)

#### Project Structure

```
project/
├── AGENTS.md                    # Project root context file
├── .codex/                      # Configuration directory
│   ├── skills/                  # Skills with manifests
│   │   └── demo-scaffold/
│   │       ├── SKILL.md         # Skill instructions (with YAML frontmatter)
│   │       └── agents/
│   │           └── openai.yaml  # Agent-specific config for this skill
│   └── workflows/               # Multi-step procedures
│       └── ship-demo.md         # Workflow steps
├── .github/                     # GitHub integration
├── tests/                       # Test directory
└── (project files)
```

#### Context File: `AGENTS.md`

- **Purpose:** Behavioral guidance for the agent. Read before each task.
- **Location:** Project root + any subdirectory (layered resolution).
- **Content:** Purpose, working rules, when to extend, what good changes look like.
- **Hierarchical:** Codex reads `AGENTS.md` files globally (`~/.codex/`) and locally (layered from repo root).
- **Global:** `~/.codex/AGENTS.md` provides user-wide defaults.

> **Key insight:** `AGENTS.md` is more *behavioral* than `CLAUDE.md`. It defines rules and norms rather than project structure. Think "operating manual" vs. "project readme."

#### Configuration: `.codex/`

| File | Purpose |
|------|---------|
| `~/.codex/config.toml` | Global config: model, sandbox policy, features, profiles |
| `skills/<name>/SKILL.md` | Skill instructions with YAML frontmatter (`name`, `description`) |
| `skills/<name>/agents/openai.yaml` | Agent-specific config for a skill (display name, default prompt) |
| `workflows/<name>.md` | Multi-step procedures |

**Config profiles:** `config.toml` supports named profiles for different workflows:
```toml
[profiles.ship]
model = "o3-pro"
sandbox = "workspace-write"

[profiles.review]
model = "codex-1"
sandbox = "read-only"
```

Invoked via: `codex exec -p ship "<prompt>"`

**Skills architecture:** Skills in Codex are the most structured of the three:
- `SKILL.md` with YAML frontmatter defines the skill
- `agents/openai.yaml` provides agent-specific metadata (display name, default prompt)
- Progressive disclosure: only metadata loaded until activation
- Multi-scope: repository, user (`~/.codex/skills/`), or system

**Workflows:** Markdown files describing step-by-step procedures. Read when referenced by skills or prompted.

#### Headless Invocation

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --model <MODEL> "<prompt>"
```

| Flag | Purpose |
|------|---------|
| `exec` | Non-interactive subcommand |
| `--dangerously-bypass-approvals-and-sandbox` | Full YOLO: no approvals, no sandbox |
| `--full-auto` | Sandboxed but automatic (`-a on-request`, `--sandbox workspace-write`) |
| `--model <model>` | Model selection (e.g., `o3`, `o3-pro`, `codex-1`) |
| `-s, --sandbox <mode>` | `read-only`, `workspace-write`, `danger-full-access` |
| `-a, --ask-for-approval <policy>` | `untrusted`, `on-request`, `never` |
| `-C, --cd <dir>` | Set working directory |
| `-p, --profile <name>` | Load config profile from `config.toml` |
| `--output-schema <file>` | JSON Schema for structured output |
| `--add-dir <dir>` | Additional writable directories |
| `--ephemeral` | Don't persist session files |

**Stdin support:** If prompt not provided as argument (or `-` used), instructions are read from stdin. This is critical for context composition — gwrk can pipe context via stdin.

**Subcommands available within `exec`:**
- `exec resume` — resume a previous non-interactive session
- `exec review` — run a code review non-interactively

#### Prompting Best Practices (Codex-Specific)

1. **AGENTS.md is behavioral, not structural.** Keep it about rules and norms, not exhaustive project documentation.
2. **Config profiles for different modes.** Use profiles to pre-configure model+sandbox for gwrk's different dispatch scenarios (ship vs. review vs. define).
3. **Stdin for long prompts.** Codex accepts prompt from stdin — use this for context-rich dispatch rather than massive command-line strings.
4. **`--full-auto` is the production-safe YOLO.** Sandboxed but automatic. Prefer over `--dangerously-bypass-*` in production.
5. **GPT-5.2 prompting guide applies.** Structure prompts with `<persistence>`, `<exploration>`, `<verification>`, `<context_gathering>` tags. Use explicit stop conditions. Define safe vs. unsafe actions.
6. **Reasoning effort matters.** Higher reasoning = better for complex multi-step tasks. Lower = faster for focused tasks.
7. **Terminal-Bench style prompts work.** The `apply_patch` tool + structured exploration instructions from the GPT-5.2 guide are the canonical pattern.

---

### 2.3 Gemini CLI (Google)

**Demo directory:** `~/Code/cli-testing-02` (Gemini)

#### Project Structure

```
project/
├── GEMINI.md                    # Project root context file
└── (project files)
```

> **Key observation:** Gemini's provisioning is the leanest. No `.gemini/` directory in the demo. The CLI relies on `GEMINI.md` + global config + extensions/skills installed separately.

#### Context File: `GEMINI.md`

- **Purpose:** Persistent project-specific context. Read on session start.
- **Location:** Project root. Can also exist in subfolders.
- **Content:** Engineering standards, design conventions, workflows, skill descriptions.
- **Hierarchical:** `~/.gemini/GEMINI.md` provides global defaults; project-level files override.
- **Generation:** `/init` command auto-generates a starter `GEMINI.md`.

> **Key insight:** `GEMINI.md` is functionally identical to `CLAUDE.md` — always-in-context, hierarchical, global + local. The CLI reads it automatically.

#### Configuration

| Location | Purpose |
|----------|---------|
| `~/.gemini/settings.json` | Global settings |
| `GEMINI.md` | Project context (no config directory needed) |
| Extensions (installed globally) | MCP servers + playbooks + context files |
| Skills (installed globally/locally) | Reusable agent behaviors |
| Hooks (configured globally) | Lifecycle interceptors |

**Extensions:** The richest extensibility model of the three CLIs. Extensions are packages containing:
- MCP server definitions (tools)
- Context files (like `GEMINI.md` fragments)
- Custom commands
- Playbooks (teach the AI how to use the tools)
- Built-in `install`, `uninstall`, `list`, `update`, `link`, `validate` management

```bash
gemini extensions install <git-url-or-path>
gemini extensions list
gemini extensions enable/disable <name>
```

**Skills:** Native skill system with install/enable/disable/uninstall:
```bash
gemini skills install <source> [--scope user|project]
gemini skills list [--all]
gemini skills enable/disable <name>
gemini skills link <path>        # Live-linked for development
```

**Hooks:** Lifecycle hooks at specific agent interaction points:
- `AfterAgent` — post-completion hooks (e.g., "Ralph loop" for persistent work)
- Add context, validate actions, enforce policies, log/optimize, send notifications
- Can be bundled in extensions

**Policy Engine:** Rules-based system replacing deprecated `--allowed-tools`:
```bash
gemini --policy <file-or-dir>   # Load policy files
```

#### Headless Invocation

```bash
gemini --yolo --model <model> -p "<prompt>"
```

| Flag | Purpose |
|------|---------|
| `-p, --prompt <prompt>` | Non-interactive (headless) mode |
| `-y, --yolo` | Auto-accept all actions |
| `-m, --model <model>` | Model selection (e.g., `gemini-2.5-pro`, `gemini-3-pro`) |
| `--approval-mode <mode>` | `default`, `auto_edit`, `yolo`, `plan` |
| `-o, --output-format <format>` | `text`, `json`, `stream-json` |
| `--raw-output` | Disable output sanitization |
| `-e, --extensions <list>` | Specify which extensions to load |
| `--include-directories <dirs>` | Additional workspace directories |
| `--policy <files>` | Additional policy files/directories |

**Output format:** `--output-format json` provides structured data including token usage and latency — directly compatible with gwrk's `[exit:N | Xs]` signal philosophy.

#### Prompting Best Practices (Gemini-Specific)

1. **GEMINI.md + `/init`.** Use `/init` to bootstrap, then curate. Keep it lean and actionable.
2. **Extensions are the power play.** Gemini's extension system is the most capable — MCP servers + playbooks in one package. For gwrk, a `gwrk` extension could expose all gwrk commands as tools.
3. **`--output-format json` is native.** Gemini produces structured JSON with metadata — no need for `--format json` + signal parsing.
4. **Skills for reusable behaviors.** Gemini skills can be scoped to project or user level.
5. **Hooks for lifecycle control.** The "Ralph loop" pattern (AfterAgent hook → re-invoke) enables persistent autonomous work.
6. **`@` references for files.** Use `@src/main.js` or `@./utils/` to explicitly include content.
7. **Memory commands.** `/memory add` and `/memory refresh` for dynamic context updates.
8. **Checkpointing.** Enable checkpoints before risky changes. `/restore` for rollback.

---

## 3. Comparative Analysis

### 3.1 Configuration Model Comparison

| Dimension | Claude | Codex | Gemini |
|-----------|--------|-------|--------|
| **Root context file** | `CLAUDE.md` | `AGENTS.md` | `GEMINI.md` |
| **Config directory** | `.claude/` | `.codex/` | (none in project) |
| **Config format** | JSON | TOML (global), YAML (skills) | JSON (global) |
| **Global config** | `~/.claude/CLAUDE.md`, `~/.claude/settings.json` | `~/.codex/config.toml`, `~/.codex/AGENTS.md` | `~/.gemini/settings.json`, `~/.gemini/GEMINI.md` |
| **Skills** | `.claude/skills/*.md` (slash commands) | `.codex/skills/<name>/SKILL.md` + `agents/` | `gemini skills install` (managed) |
| **Workflows** | (via skills) | `.codex/workflows/*.md` | (via extensions) |
| **Hooks** | `.claude/settings.json` hooks | (not documented) | Lifecycle hooks (AfterAgent, etc.) |
| **Extensions** | Claude plugins (`--plugin-dir`) | (not a concept) | First-class: MCP + playbooks + commands |
| **Permissions** | Fine-grained tool ACL | Sandbox policies + approval modes | Policy Engine |

### 3.2 Headless Invocation Comparison

| Dimension | Claude | Codex | Gemini |
|-----------|--------|-------|--------|
| **Non-interactive flag** | `-p` / `--print` | `exec` subcommand | `-p` / `--prompt` |
| **YOLO flag** | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` | `--yolo` / `-y` |
| **Safe auto flag** | `--permission-mode auto` | `--full-auto` | `--approval-mode auto_edit` |
| **Prompt via stdin** | ❌ (prompt is positional arg) | ✅ (stdin if no arg or `-`) | ❌ (prompt is `-p` value) |
| **Structured output** | `--output-format json` | `--output-schema <file>` | `--output-format json` |
| **Working directory** | `--add-dir` | `-C, --cd <dir>` | `--include-directories` |
| **Model selection** | `--model` | `--model` / `-m` | `--model` / `-m` |
| **Cost cap** | `--max-budget-usd` | ❌ | ❌ |
| **System prompt** | `--system-prompt` / `--append-system-prompt` | ❌ (use AGENTS.md) | ❌ (use GEMINI.md) |

### 3.3 Extensibility Model Comparison

| Dimension | Claude | Codex | Gemini |
|-----------|--------|-------|--------|
| **Primary extension** | Skills (markdown slash commands) | Skills (SKILL.md + YAML) | Extensions (MCP + playbooks) |
| **Skill structure** | Flat `.md` file | Directory with `SKILL.md` + `agents/` | Managed via CLI (`gemini skills`) |
| **Skill scope** | Project (`.claude/skills/`) | Project (`.codex/skills/`) + user (`~/.codex/skills/`) | Project or user scope |
| **Skill invocation** | Slash commands in interactive mode | Referenced in prompts | Referenced in prompts |
| **Custom tools** | MCP via `--mcp-config` | (limited) | Extensions bundle MCP servers |
| **Package management** | `--plugin-dir` | (manual) | `gemini extensions install/list/update` |

---

## 4. Context Composition Strategy for gwrk

### 4.1 The Context Flow Architecture

gwrk's success depends on a **context composition pipeline** that produces CLI-specific invocations with the right shape and sufficient context:

```
┌──────────────────────────────────────────────────────────────────────┐
│  gwrk Context Pipeline                                               │
│                                                                       │
│  gwrk project discover ─→ spec.md ─→ plan.md ──→ tasks.json         │
│         │                    │           │             │               │
│         └──────── Context Assembler ─────┘             │               │
│                        │                               │               │
│                  ┌─────┴──────┐                        │               │
│                  │ Context    │ ←── gates, contracts,   │               │
│                  │ Adapter    │     source files         │               │
│                  │ (per CLI)  │                          │               │
│                  └──┬────┬───┘                          │               │
│                     │    │                              │               │
│              ┌──────┘    └──────┐                       │               │
│              ▼                  ▼                       │               │
│    CLI-Specific           CLI-Specific                  │               │
│    Governance             Prompt                        │               │
│    File Update            Assembly                      │               │
│              │                  │                       │               │
│              ▼                  ▼                       │               │
│    CLAUDE.md /            claude -p "..."               │               │
│    AGENTS.md /            codex exec "..."              │               │
│    GEMINI.md              gemini -p "..."               │               │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 When to Maintain CLI-Specific Directories

**Recommendation: Maintain the root context file. Optionally maintain CLI-specific config directories.**

| CLI Asset | Maintain? | Rationale |
|-----------|-----------|-----------|
| `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` | **Yes, always** | Free context injection. The CLI reads these automatically. gwrk should generate and maintain a CLI-specific context file that encodes project structure, conventions, and gwrk commands. |
| `.claude/settings.json` | **Yes, when Claude is primary** | Permissions + hooks enforce deterministic behavior (linting, formatting) without relying on the model. |
| `.claude/skills/` | **No** | gwrk's plugin system replaces this. Skills are gwrk-native, not Claude-native. |
| `.codex/config.toml` profiles | **Recommended** | Config profiles (ship, review, define) pre-configure model+sandbox per dispatch mode. Reduces command-line flag complexity. |
| `.codex/skills/`, `.codex/workflows/` | **No** | gwrk replaces these with its own plugin system. |
| Gemini extensions | **Maybe** | A gwrk extension for Gemini CLI could expose gwrk commands as MCP tools. High value but deferred. |

### 4.3 Context File Generation Strategy

gwrk should generate and maintain a **gwrk-specific section** in each CLI's context file. This section encodes:

1. **Project structure** — from `gwrk project discover`
2. **Available gwrk commands** — from `gwrk --help` (so the agent knows what CLI it can call)
3. **Current task context** — what feature/phase/task is being worked on
4. **Constraints** — what the agent can and cannot do
5. **Verification commands** — how to check work (gates)

Example generated `CLAUDE.md` fragment:

```markdown
## gwrk Context (auto-generated)

### Project: gwrk
This project uses gwrk for development lifecycle management.

### Current Task
- Feature: 004-ship-loop, Phase: 1, Task: T003
- Objective: Implement withSignal() wrapper for all commands
- Files to modify: src/utils/signal.ts, src/commands/*.ts

### Available Commands
- `gwrk project discover --json` — full project state
- `gwrk tasks next 004 p1 --json` — next task
- `gwrk gate-check T003 --json` — verify task
- `gwrk tasks done 004 T003` — mark done (gate-enforced)
- `gwrk test 004` — run feature tests
- `pnpm test` — run all tests
- `pnpm lint` — lint check

### Constraints
- Do NOT modify files outside src/ unless the task explicitly requires it
- Run `pnpm test` after each change
- All exit codes must follow ADR-004 (0=success, 1=failure, 2=usage, 127=not found)
```

### 4.4 Prompt Assembly Strategy

Each CLI dispatch requires a **composed prompt** that includes role, task, context, constraints, and verification criteria. The prompt structure follows the GPT-5.2 prompting guide patterns but is adapted per CLI:

#### Universal Prompt Template

```
<role>
You are implementing a gwrk feature task. You are a Principal Engineer.
</role>

<task>
Feature: {feature_name}
Phase: {phase_number} — {phase_title}
Task: {task_id} — {task_title}
Classification: {greenfield|change|refactor}
</task>

<context>
{spec excerpts relevant to this task}
{contract content}
{relevant source file content}
{discovery JSON excerpt}
</context>

<constraints>
{project conventions from spec}
{tech constraints from TC-* items}
{file-level constraints: what to touch, what not to touch}
</constraints>

<verification>
Run these commands to verify your work:
1. {gate command from gates/T0xx-gate.sh}
2. pnpm test
3. pnpm lint

Your task is ONLY complete when the gate passes.
</verification>

<persistence>
Keep going until the gate passes. Do not stop at uncertainty.
Do not ask for clarification — make the most reasonable assumption and proceed.
If verification fails, debug and fix. Do not yield back.
</persistence>
```

#### CLI-Specific Adaptations

| Adaptation | Claude | Codex | Gemini |
|------------|--------|-------|--------|
| **Prompt delivery** | `-p "<prompt>"` (arg) | Stdin pipe or arg | `-p "<prompt>"` (arg) |
| **Tag style** | XML tags (`<role>`, `<task>`) | XML tags (same) | Less tag-dependent; more natural language |
| **Persistence** | Add explicit persistence instructions | Built-in via GPT-5.2 patterns | Less needed; Gemini is naturally persistent with `--yolo` |
| **Verification emphasis** | Critical — provide tests and expected outputs | Critical — define output contract and deliverables | Moderate — provide commands but Gemini verifies naturally |
| **Context length** | Model-dependent; Opus handles long context | Large context (Codex optimized for code) | Gemini 3 Pro: massive context window |
| **System prompt** | Via `--system-prompt` or `CLAUDE.md` | Via `AGENTS.md` only | Via `GEMINI.md` only |

---

## 5. Concise Task Execution Format per CLI

### 5.1 Claude Code — Ship Task Command

**Current gwrk pattern (agent.ts):**
```bash
claude -p "<workflow_content>" --output-format json
```

**Recommended pattern for F014:**
```bash
claude \
  --dangerously-skip-permissions \
  --model claude-sonnet-4-6 \
  --output-format json \
  --max-budget-usd 5.00 \
  --add-dir /Users/gonzo/Code/gwrk \
  -p "$(cat /tmp/gwrk-task-context-T003.md)"
```

**Notes:**
- Prompt assembled to `/tmp/` file, read via `$(cat ...)` to avoid shell escaping
- `--output-format json` enables structured result parsing
- `--max-budget-usd` acts as circuit breaker
- `CLAUDE.md` provides persistent project context automatically
- For thinking models (Opus): `--model opus --effort high`

### 5.2 Codex CLI — Ship Task Command

**Current gwrk pattern (agent.ts):**
```bash
codex exec --full-auto <workflow_path> <feature_dir>
```

**Recommended pattern for F014:**
```bash
codex exec \
  --full-auto \
  --model o3-pro \
  -C /Users/gonzo/Code/gwrk \
  --output-schema /tmp/gwrk-output-schema.json \
  - < /tmp/gwrk-task-context-T003.md
```

**Notes:**
- Stdin pipe (`-`) enables long context delivery without shell escaping
- `--full-auto` = sandboxed + automatic (production-safe YOLO)
- `--output-schema` enables structured output matching gwrk's GateCheckResult
- `AGENTS.md` provides persistent behavioral context automatically
- Config profiles pre-set model+sandbox: `codex exec -p ship - < context.md`

### 5.3 Gemini CLI — Ship Task Command

**Current gwrk pattern (agent-run.sh + agent.ts):**
```bash
gemini -p "/implement specs/004-ship-loop 3" --approval-mode yolo
```

**Recommended pattern for F014:**
```bash
gemini \
  --yolo \
  --model gemini-3-pro \
  --output-format json \
  -p "$(cat /tmp/gwrk-task-context-T003.md)"
```

**Notes:**
- `--yolo` is the cleanest YOLO flag across all three CLIs
- `--output-format json` produces structured data with metadata
- `GEMINI.md` provides persistent project context automatically
- Extensions could expose gwrk commands as tool calls (future)

---

## 6. AgentBackend Plugin Interface

### 6.1 Interface Design

Based on this research, the `AgentBackend` plugin interface should abstract CLI differences:

```typescript
interface AgentBackend {
  name: string;                    // 'claude' | 'codex' | 'gemini'
  cli: string;                     // 'claude' | 'codex' | 'gemini'

  // Capabilities
  supportsStdin: boolean;          // codex: true, claude/gemini: false
  supportsStructuredOutput: boolean;
  supportsCostCap: boolean;        // claude: true, others: false

  // Invocation
  buildCommand(opts: DispatchOpts): string[];   // returns argv array
  buildContextFile(opts: ContextOpts): string;  // returns context file content

  // Context file management
  contextFileName: string;         // 'CLAUDE.md' | 'AGENTS.md' | 'GEMINI.md'
  updateContextFile(projectRoot: string, context: TaskContext): void;

  // Supported operational modes mapped from gwrk concepts
  approvalModes: {
    implement: string;    // e.g. 'yolo', '--permission-mode bypassPermissions', '--full-auto'
    review: string;       // e.g. 'yolo' (needs shell)
    analyze: string;      // e.g. 'plan' or 'read-only'
  };

  // Result parsing
  parseResult(stdout: string, stderr: string, exitCode: number): TaskResult;
}
```

### 6.2 Dispatch Options

```typescript
interface DispatchOpts {
  prompt: string | { file: string };  // inline or file path
  model: string;                       // model name
  workingDir: string;                  // project root
  mode: 'yolo' | 'safe-auto' | 'review';
  costCap?: number;                    // USD limit (Claude only)
  structuredOutput?: object;           // JSON Schema
  additionalDirs?: string[];           // extra writable paths
}
```

### 6.3 Context Options

```typescript
interface TaskContext {
  feature: string;
  phase: number;
  task: { id: string; title: string; classification: string };
  spec: string;        // spec.md excerpt
  contracts: string[]; // contract file contents
  gateCommand: string; // gate verification command
  discovery: object;   // project discover JSON
  constraints: string[];
}
```

---

## 7. Recommendations for 014 Plugin System

### 7.1 Agent Backend as Plugin Type

F008 (Agent Router) should dispatch to agent backends that are F014 plugins:

```yaml
# ~/.gwrk/plugins/agents/claude/manifest.yaml
type: agent
name: claude
version: 1.0.0
description: "Claude Code CLI backend"

cli: claude
contextFile: CLAUDE.md

invocation:
  headless: ["-p"]
  yolo: ["--dangerously-skip-permissions"]
  safeAuto: ["--permission-mode", "auto"]
  model: ["--model"]
  structuredOutput: ["--output-format", "json"]
  costCap: ["--max-budget-usd"]
  stdin: false

capabilities:
  maxContext: 200000
  supportsStdin: false
  supportsCostCap: true
  supportsSystemPrompt: true
  supportsHooks: true
  supportsFallbackModel: true

models:
  default: claude-sonnet-4-6
  thinking: claude-opus-4-6
  fast: claude-haiku-4
```

### 7.2 Context Adapter as Separate Concern

The context adaptation logic should be in the agent plugin, not in gwrk core:

| Concern | Location | Reason |
|---------|----------|--------|
| Context *assembly* (what context to include) | `gwrk core` (ship loop) | Same across all backends |
| Context *shaping* (how to format per CLI) | `agent plugin` | CLI-specific tag styles, prompt patterns |
| Context *delivery* (file vs. stdin vs. arg) | `agent plugin` | CLI-specific delivery mechanism |
| Context file *maintenance* (CLAUDE.md etc.) | `agent plugin` | CLI-specific file format |

### 7.3 Pipeline Integration

The ship loop (004) should call:
1. **Context assembly** → gather spec, plan, contracts, discovery, gates
2. **Agent selection** → router (008) picks backend based on task classification, history
3. **Context adaptation** → agent plugin shapes prompt + updates context file
4. **Invocation** → agent plugin builds CLI command, gwrk executes
5. **Result parsing** → agent plugin parses output, returns structured result
6. **Gate verification** → gwrk runs `gate-check`, records result in ledger

### 7.4 Critical Design Decisions for ADR-006

1. **Context files should be maintained.** The cost is near-zero (write a markdown file) and the benefit is significant (free context injection without prompt bloat).

2. **Prompt delivery must use files, not inline.** All three CLIs support reading prompts that reference file content. Shell escaping of multi-kilobyte prompts is fragile. Write to `/tmp/gwrk-context-<hash>.md` and use `$(cat ...)` or stdin pipe.

3. **Config profiles (Codex) should be maintained.** Writing `~/.codex/config.toml` with gwrk-specific profiles is cheap and reduces command-line complexity.

4. **CLI-specific directories (`.claude/`, `.codex/`) are optional.** Hooks and permissions in `.claude/settings.json` add value for Claude. Skills and workflows should NOT be maintained — gwrk replaces these.

5. **The agent plugin must own prompt shaping.** Different models respond differently to prompt structures. Claude likes XML tags. GPT-5.2 likes structured sections with explicit stop conditions. Gemini responds well to natural language with clear goals. The plugin system must allow each backend to shape prompts according to its model's cognitive preferences.

---

## 8. F013 Compatibility Matrix

| F013 Contract | Claude Support | Codex Support | Gemini Support |
|---------------|---------------|--------------|----------------|
| `[exit:N | Xs]` on stderr | gwrk emits, CLI independent | gwrk emits, CLI independent | gwrk emits, CLI independent |
| `--format json` | `--output-format json` | `--output-schema` | `--output-format json` |
| `--agent` mode | N/A (CLI is the agent) | N/A (CLI is the agent) | N/A (CLI is the agent) |
| stdin/stdout pipe safety | ✅ (`-p` keeps stdout clean) | ✅ (`exec` separates output) | ✅ (`-p` keeps stdout clean) |
| Error-as-navigation | Via prompt (include gwrk hints) | Via prompt | Via prompt |
| Exit code contract | CLI returns its own exit codes | CLI returns its own exit codes | CLI returns its own exit codes |
| Command classification | Via prompt context | Via prompt context | Via prompt context |

> **Key insight:** F013's contracts are about gwrk's *own* CLI output. When gwrk *dispatches* to a model CLI, the model CLI's output is an *input* to gwrk, not a gwrk contract. gwrk wraps the dispatch result in its own signal envelope: `[exit:0 | 45.2s] ship T003: agent completed`.

### 8.1 Exit Code Normalization

Each CLI has different exit code semantics. The adapter must normalize them to the gwrk contract:

| gwrk Exit | Meaning | Claude | Codex | Gemini |
|-----------|---------|--------|-------|--------|
| `0` | Success | `0` | `0` | `0` |
| `1` | Failure | non-0 | non-0 | `1` |
| `2` | Usage error | — | — | `42` |
| `127` | Command not found | `127` | `127` | — |
| `—` | Turn limit exceeded | — | — | `53` |

### 8.2 Open Questions

1. **Should gwrk maintain `.claude/settings.json` if the project backend isn't known yet?** Hooks enforce quality without model reliance, but create coupling to Claude.
2. **Is `--output-schema` (Codex) worth standardizing?** Building a shared JSON Schema for `TaskResult` could eliminate custom adapter parsing logic entirely.
3. **Workflows vs Prompt Injection:** Today gwrk workflows (`.agents/workflows/`) are native to Gemini via slash commands. Claude and Codex get workflow content injected as prompt text. Should F014 formalize a single execution pathway?
4. **Context budget management:** Each model has a different context window. Should adapters declare their token budget so gwrk can truncate discovery context gracefully?

---

## 9. Source Lineage

| Source | Contribution |
|--------|-------------|
| `~/Code/cli-testing/` (Claude demo) | `.claude/` structure, `CLAUDE.md` format, permissions, hooks, skills |
| `~/Code/cli-testing-01/` (Codex demo) | `.codex/` structure, `AGENTS.md` format, skills with agents/, workflows |
| `~/Code/cli-testing-02/` (Gemini demo) | `GEMINI.md` format, lean provisioning model |
| `claude --help` | Full CLI flag reference |
| `codex --help`, `codex exec --help` | Full CLI flag reference, stdin support |
| `gemini --help`, `gemini skills --help`, `gemini extensions --help` | Full CLI flag reference, native skill/extension system |
| [GPT-5.2 Prompting Guide](file:///Users/gonzo/Code/gwrk/docs/references/gpt-5-2-prompting-guide.md) | Agentic prompting patterns, persistence, verification, structured prompts |
| [agent-yolo-commands.md](file:///Users/gonzo/Code/gwrk/docs/reference/agent-yolo-commands.md) | Existing YOLO invocation formats (validated and extended) |
| [agent-native-cli.md](file:///Users/gonzo/Code/gwrk/docs/reference/agent-native-cli.md) | Two-layer architecture, F013 contracts, design imperatives |
| Web research (March 2026) | Latest CLI best practices, hooks, extensions, policy engine updates |

---

## Appendix A: Demo Project Provisioning Comparison

A forensic look at what each CLI generated securely in its demo repository (`cli-testing*`):

| What was created | Claude (`cli-testing`) | Codex (`cli-testing-01`) | Gemini (`cli-testing-02`) |
|------------------|----------------------|--------------------------|---------------------------|
| **Project memory** | `CLAUDE.md` (49 lines, detailed) | `AGENTS.md` (20 lines, concise) | `GEMINI.md` (24 lines, design-focused) |
| **Dot-directory** | `.claude/` with settings, skills/ | `.codex/` with skills/, workflows/ | None |
| **Skills** | 2 skills (new-feature, review) | 1 skill (demo-scaffold/) | None |
| **Workflows** | — (skills serve this purpose) | 1 workflow (ship-demo.md) | — |
| **Tests** | — | 1 test file (27 lines) | — |
| **CI** | — | `.github/workflows/ci.yml` | — |
| **App** | Express server + vanilla JS SPA | Zero-dep Node.js server + vanilla SPA | Single `index.html` inline |
| **Dependencies** | 1 (express) | 0 | 0 |
| **Total files** | 8 | 12 | 2 |

**Observations:**
- **Codex was the most thorough provisioner:** Tests, CI, workflows, skills, zero-dependency code. Highly aligned with gwrk's TDD mandate.
- **Claude was the most structured for governance:** Hooks via `settings.json` for quality enforcement, skills immediately actionable.
- **Gemini was the most minimal:** Relies on existing ecosystem (`.agents/` via antigravity) rather than creating its own scaffolding.
