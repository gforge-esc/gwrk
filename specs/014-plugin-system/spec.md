---
type: specification
feature: 014-plugin-system
last_modified: "2026-03-19T14:45:00Z"
revision: 2
---

# Feature Specification: 014 Plugin System

**Feature Branch**: `feat/014-plugin-system`
**Created**: 2026-03-15
**Status**: Draft
**Input**: OpenClaw research, skills architecture analysis, manifest stress test (signal-cut)
**Reference**: [skills-architecture.md](file:///Users/gonzo/Code/gwrk/docs/reference/skills-architecture.md), [plugin-architecture-plan.md](file:///Users/gonzo/Code/gwrk/docs/reference/plugin-architecture-plan.md)

> **Positioning:** This is the plugin infrastructure spec. F008 (Agent Router), F012 (Knowledge Work), F016 (Domain Packs), and F017 (Channel Abstraction) depend on the manifest schema, plugin loader, and skill runtime established here.

---

## 1. Problem Statement

gwrk has plugin-shaped seams — skills, workflows, agent backends, Slack — but no plugin contract. Skills are markdown files pasted into agent context windows. Workflows are slash-command triggered documents. Agent backends are hardcoded dispatch logic. This blocks:

1. **Independent development** — skills can't declare version, dependencies, or agent compatibility
2. **Shareability** — no install/publish mechanism for friends or collaborators
3. **Composability** — skills can't be invoked as CLI commands, piped, or composed
4. **Knowledge work expansion** — no way to add domain-specific packs without editing core

The F013 agent-native interface proved that CLI-native contracts (stdin/stdout, `--format json`, signals, piping) are the right interface for both humans and agents. The same principle must apply to gwrk's extensibility: plugins should be CLI-native, not server-coupled (anti-MCP).

### Design Decisions (locked)

| Decision | Choice | Reference |
|----------|--------|-----------|
| Plugin scoping | Model C: global `~/.gwrk/plugins/` + local `.gwrk/plugins.yaml` override | plugin-architecture-plan.md |
| Config format | YAML for all user-facing config | Deliberation 2026-03-15 |
| Skill interface | CLI-native: `gwrk skill <name>` with full F013 contract | skills-architecture.md |
| Skill hierarchy | Two-tier: atomic (single mode) + compound (multi-pass) | Manifest stress test |
| Manifest boundary | manifest.yaml = contract, SKILL.md = reasoning program | skills-architecture.md |

---

## 2. User Scenarios & Testing

### US-001 - Install a Skill Plugin (Priority: P0)
As a Principal Engineer, I want `gwrk plugin install <path>` to install a skill to `~/.gwrk/plugins/skills/`, so that I can add new reasoning capabilities from a local directory, a git URL, or a zip file.

**Implements**: FR-001, FR-002

**Independent Test**: `gwrk plugin install ./my-skill && gwrk plugin list --format json | jq '.[].name' | grep my-skill`

**Acceptance Scenarios**:
1. **Given** a directory with `manifest.yaml` + `SKILL.md`, **When** `gwrk plugin install ./truth-extract` is run, **Then**:
   - `ls ~/.gwrk/plugins/skills/truth-extract/manifest.yaml` exits 0
   - `gwrk plugin list | grep truth-extract` exits 0
2. **Given** a plugin already installed, **When** `gwrk plugin install ./truth-extract` is run again, **Then**:
   - stderr: `Plugin 'truth-extract' already installed. Use --force to overwrite.`
   - Exit code: 1
3. **Given** a directory missing `manifest.yaml`, **When** `gwrk plugin install ./bad-dir` is run, **Then**:
   - stderr: `No manifest.yaml found in ./bad-dir. A valid plugin requires manifest.yaml.`
   - Exit code: 1

---

### US-002 - List Installed Plugins (Priority: P0)
As a Principal Engineer, I want `gwrk plugin list` to show all installed plugins, so that I can see what capabilities gwrk has.

**Implements**: FR-003

**Independent Test**: `gwrk plugin list --format json | jq '. | length'` returns ≥ 0.

**Acceptance Scenarios**:
1. **Given** plugins installed, **When** `gwrk plugin list` is run, **Then**:
   - Output lists each plugin with: name, type, tier (if skill), version
   - Grouped by type (skills, workflows, agents, channels, domains)
2. **Given** `--format json`, **When** `gwrk plugin list --format json` is run, **Then**:
   - `jq '.[0].name'` returns plugin name
   - `jq '.[0].type'` returns plugin type
3. **Given** a project with `.gwrk/plugins.yaml` disabling a plugin, **When** `gwrk plugin list --project` is run, **Then**:
   - Disabled plugins show `(disabled)` annotation
   - Only active plugins listed without `--project` flag

---

### US-003 - Remove a Plugin (Priority: P1)
As a Principal Engineer, I want `gwrk plugin remove <name>` to uninstall a plugin from `~/.gwrk/plugins/`, so that I can clean up unused capabilities.

**Implements**: FR-004

**Independent Test**: `gwrk plugin remove truth-extract && gwrk plugin list | grep truth-extract; echo $?` returns 1.

**Acceptance Scenarios**:
1. **Given** plugin installed, **When** `gwrk plugin remove truth-extract` is run, **Then**:
   - Directory `~/.gwrk/plugins/skills/truth-extract/` is deleted
   - stdout: `Removed plugin 'truth-extract'.`
2. **Given** plugin not installed, **When** `gwrk plugin remove nonexistent` is run, **Then**:
   - stderr: `Plugin 'nonexistent' not found. Run 'gwrk plugin list' to see installed plugins.`
   - Exit code: 1
3. **Given** compound skill that `composes` the removed atomic, **When** `gwrk plugin remove narrative` is run, **Then**:
   - stderr warns: `Warning: 'signal-cut' depends on 'narrative'. Remove anyway? Use --force to confirm.`
   - Without `--force`, exit code: 1

---

### US-004 - Disable/Enable Plugin per Project (Priority: P1)
As a Principal Engineer, I want `gwrk plugin disable <name>` to deactivate a plugin in the current project without uninstalling it globally, so that I can scope capabilities per project.

**Implements**: FR-005

**Independent Test**: `gwrk plugin disable domains/writing && cat .gwrk/plugins.yaml | grep writing`

**Acceptance Scenarios**:
1. **Given** a gwrk project, **When** `gwrk plugin disable domains/writing` is run, **Then**:
   - `.gwrk/plugins.yaml` is created/updated with `disable: [domains/writing]`
   - `gwrk plugin list --project` shows `writing (disabled)`
2. **Given** a disabled plugin, **When** `gwrk plugin enable domains/writing` is run, **Then**:
   - `.gwrk/plugins.yaml` removes entry from disable list
   - Plugin is active again in this project

---

### US-005 - Invoke an Atomic Skill (Priority: P0)
As a Principal Engineer, I want `gwrk skill narrative < brief.md` to invoke a single reasoning mode and produce output on stdout, so that I can use skills as composable CLI commands.

**Implements**: FR-006, FR-007, FR-008

**Independent Test**: `echo "test" | gwrk skill narrative --format json | jq .` exits 0.

**Acceptance Scenarios**:
1. **Given** atomic skill installed, **When** `echo "brief" | gwrk skill narrative` is run, **Then**:
   - stdout contains the skill's output (text or JSON per `--format`)
   - stderr contains `[exit:0 | Xs]`
   - Exit code: 0
2. **Given** `--format json`, **When** piped, **Then**:
   - stdout is valid JSON
   - JSON is pipeable: `gwrk skill narrative --format json < in.md | jq .`
3. **Given** skill not installed, **When** `gwrk skill nonexistent` is run, **Then**:
   - stderr: `Skill 'nonexistent' not found. Run 'gwrk skill --help' to list available skills.`
   - Exit code: 1

---

### US-006 - Invoke a Compound Skill (Priority: P0)
As a Principal Engineer, I want `gwrk skill signal-cut < brief.md` to execute a multi-pass compound skill in a single LLM call and return structured output.

**Implements**: FR-006, FR-007, FR-009

**Independent Test**: `echo "test product brief" | gwrk skill signal-cut --product gwrk` produces output.

**Acceptance Scenarios**:
1. **Given** compound skill with 3 passes, **When** invoked, **Then**:
   - All passes are assembled into a single prompt (1 LLM call, not 3)
   - Output reflects all passes applied sequentially
   - `[exit:0 | Xs]` on stderr
2. **Given** `--content-type blog`, **When** `gwrk skill signal-cut --content-type blog` is run, **Then**:
   - Skill uses the content type playbook from SKILL.md
3. **Given** a composed atomic is not installed, **When** compound is invoked, **Then**:
   - stderr: `Missing dependency: skill 'narrative' required by 'signal-cut'. Run 'gwrk plugin install <path>'.`
   - Exit code: 1

---

### US-007 - Pipe Skills Together (Priority: P0)
As a Principal Engineer, I want `gwrk skill A | gwrk skill B` to compose skills via Unix pipes, so that I can build ad-hoc reasoning chains without defining a compound skill.

**Implements**: FR-008

**Independent Test**: `echo "test" | gwrk skill narrative | gwrk skill practitioner` produces output.

**Acceptance Scenarios**:
1. **Given** two atomic skills, **When** piped, **Then**:
   - stdout of skill A is stdin of skill B
   - `[exit:N | Xs]` goes to stderr for EACH skill (not in the pipe)
   - Final stdout is skill B's output
2. **Given** `--format json` on the first skill, **When** piped, **Then**:
   - Second skill accepts JSON on stdin and processes it
   - Format flags are per-command (pipe-local)

---

### US-008 - Discover Skills via --help (Priority: P1)
As a Principal Engineer, I want `gwrk skill --help` to list all installed skills with their descriptions, and `gwrk skill <name> --help` to show a skill's full interface contract.

**Implements**: FR-010

**Independent Test**: `gwrk skill --help | grep narrative` exits 0.

**Acceptance Scenarios**:
1. **Given** skills installed, **When** `gwrk skill --help` is run, **Then**:
   - Lists all skills grouped by tier (atomic, compound)
   - Each entry shows: name, tier, description (from manifest)
2. **Given** a specific skill, **When** `gwrk skill signal-cut --help` is run, **Then**:
   - Shows: description, composed skills, flags, exit codes, runtime config
   - Pattern matches F013 help enrichment (FR-008)

---

### US-009 - Migrate Existing Skills (Priority: P0)
As a Principal Engineer, I want `gwrk plugin migrate` to move existing `.agents/skills/` and `.agents/workflows/` to `~/.gwrk/plugins/` with auto-generated manifests, so that my current skills work with the new system.

**Implements**: FR-011

**Independent Test**: `gwrk plugin migrate --dry-run` lists what would be migrated.

**Acceptance Scenarios**:
1. **Given** `.agents/skills/` exists with SKILL.md files, **When** `gwrk plugin migrate` is run, **Then**:
   - Each skill is copied to `~/.gwrk/plugins/skills/<name>/`
   - `manifest.yaml` is auto-generated from SKILL.md frontmatter
   - Original `.agents/skills/` is NOT deleted (stays for IDE compatibility)
2. **Given** `--dry-run`, **When** `gwrk plugin migrate --dry-run` is run, **Then**:
   - Lists what would be migrated without copying anything
3. **Given** skill already exists at destination, **When** migrate runs, **Then**:
   - Skips with message: `Skipping 'truth-extract' — already installed.`

---

### US-010 - Seed Atomic Skills from Taxonomy (Priority: P1)
As a Principal Engineer, I want `gwrk plugin seed` to generate atomic skill plugins for all reasoning modes in the taxonomy, so that the ~40 modes become invocable CLI commands.

**Implements**: FR-012

**Independent Test**: `gwrk plugin seed --dry-run | wc -l` returns ≥ 30.

**Acceptance Scenarios**:
1. **Given** `reasoning-modes.md` exists, **When** `gwrk plugin seed` is run, **Then**:
   - Atomic skill directories created at `~/.gwrk/plugins/skills/` for each mode
   - Each has `manifest.yaml` (type, name, tier: atomic, category, prompt) + `SKILL.md`
   - Categories preserved: reasoning, evaluative, creative, persona, communication, operational, meta
2. **Given** some atomics already installed, **When** seed runs, **Then**:
   - Skips existing skills, installs only new ones

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

Plugin operations are local filesystem only. No external service credentials. Skills invoke LLM agents via the agent backend (F008), which manages credentials independently.

---

## 4. Functional Requirements

### Plugin Infrastructure

- **FR-001**: System MUST provide `gwrk plugin install <path|url>` that validates `manifest.yaml` existence, copies the plugin directory to `~/.gwrk/plugins/<type>/<name>/`, and validates manifest schema. Supports `--force` for overwrite. (Implements: US-001)
- **FR-002**: System MUST validate manifest.yaml against a Zod schema on install. Invalid manifests MUST be rejected with specific error messages (missing fields, unknown type, invalid tier). (Implements: US-001)
- **FR-003**: System MUST provide `gwrk plugin list` that scans `~/.gwrk/plugins/` and displays installed plugins grouped by type. Supports `--format json` and `--project` (shows resolution with local overrides applied). (Implements: US-002)
- **FR-004**: System MUST provide `gwrk plugin remove <name>` that deletes the plugin directory. MUST warn if other plugins depend on it (via `composes` field) unless `--force` is used. (Implements: US-003)
- **FR-005**: System MUST provide `gwrk plugin disable <name>` and `gwrk plugin enable <name>` that manage `.gwrk/plugins.yaml` in the current project. Only workflows and domains can be disabled. Skills, agents, channels are global-only and reject disable attempts. (Implements: US-004)

### Skill Runtime

- **FR-006**: System MUST provide `gwrk skill <name>` command that resolves the skill from `~/.gwrk/plugins/skills/<name>/`, loads `manifest.yaml` and `SKILL.md`, assembles a prompt, and invokes the preferred agent CLI using its specific headless/YOLO execution format with the manifest's `preferredModel` passed as the `--model` argument. The exact invocation formats are explicitly defined as: `claude --dangerously-skip-permissions --model <model> -p "<prompt>"`, `gemini --yolo --model <model> -p "<prompt>"`, and `codex exec --dangerously-bypass-approvals-and-sandbox --model <model> "<prompt>"`. Compound skills require thinking models — the model version MUST be specific enough to guarantee multi-pass reasoning capability. (Implements: US-005, US-006)
- **FR-007**: Skill invocation MUST inherit the full F013 contract: `--format json` for structured output, `[exit:N | Xs]` on stderr, `--agent` mode for ANSI-free output, pipe-composable stdin/stdout. (Implements: US-005, US-006)
- **FR-008**: Compound skills MUST be executable as a single LLM call. The runtime assembles all passes from SKILL.md into one prompt. The `composes` field in manifest.yaml declares dependencies — runtime MUST verify all composed skills are installed before invocation. (Implements: US-006, US-007)
- **FR-009**: Compound skill manifest MUST declare `composes: [<skill-name>, ...]` and `passes: [{name, skill, summary}, ...]`. The runtime validates that every entry in `composes` resolves to an installed atomic skill. (Implements: US-006)
- **FR-010**: `gwrk skill --help` MUST list all installed skills grouped by tier (atomic, compound). `gwrk skill <name> --help` MUST display the skill's interface contract from manifest.yaml: description, composed skills (if compound), flags, exit codes, runtime. (Implements: US-008)

### Migration & Seeding

- **FR-011**: System MUST provide `gwrk plugin migrate` that copies `.agents/skills/` and `.agents/workflows/` to `~/.gwrk/plugins/` with auto-generated `manifest.yaml` from SKILL.md frontmatter. Supports `--dry-run`. Does NOT delete originals. (Implements: US-009)
- **FR-012**: System MUST provide `gwrk plugin seed` that parses `docs/reference/reasoning-modes.md` and generates atomic skill plugins for each mode. Each generated skill has `manifest.yaml` (with prompt from taxonomy) and a minimal `SKILL.md`. Supports `--dry-run`. (Implements: US-010)

### Agent Backend Adapters (Layer 1 — R002)

- **FR-L1-001**: Agent manifest (`manifest.yaml`) MUST declare: `type: agent`, `name`, `version`, `description`, `dispatchMode` (`local-cli` | `github-integration`), `contextFileName`, `invocation` block (command, headless, yolo, model, structuredOutput, costCap, workingDir), `capabilities`, `models`, `exitCodeMap`, and `managedConfig`. Validated by `AgentManifestSchema` (Zod). (Implements: US-L1-001)
- **FR-L1-002**: `AgentBackend.dispatch(task)` MUST return `{ command, args, stdin, env, streamable }`. gwrk core pipes stdin to the CLI process. The adapter decides HOW to invoke — gwrk core only knows WHAT to dispatch. (Implements: US-L1-001)
- **FR-L1-003**: `AgentBackend.parseResult(stdout, stderr, rawExitCode)` MUST normalize proprietary CLI exit codes to `TaskResult { exitCode: 0|1|2|127, errorType?, stdout, stderr, durationS }`. Mapping defined in manifest `exitCodeMap`. (Implements: US-L1-001)
- **FR-L1-004**: `AgentBackend.syncGovernance(projectRoot, governance)` MUST generate the CLI-specific context file (e.g., `GEMINI.md`) from `.gwrk/agent-context.md` using `<!-- gwrk:begin -->` / `<!-- gwrk:end -->` boundary markers. Content outside markers MUST be preserved. (Implements: US-L1-002)
- **FR-L1-005**: Agent manifests MUST declare `managedConfig` — an array of `{ path, keys }` describing which config files and keys the adapter owns. System MUST detect conflicts when two adapters claim the same key. Detection at install time and dispatch time. (Implements: US-L1-001)
- **FR-L1-006**: System MUST provide `gwrk plugin sync-context` that regenerates all CLI-specific context files from `.gwrk/agent-context.md` for all active agent backends. (Implements: US-L1-002)
- **FR-L1-007**: F014 Phase 1 MUST only support `dispatchMode: local-cli`. The `github-integration` mode (Codex Cloud) is a separate feature and MUST NOT block Phase 1. (Implements: US-L1-001)
- **FR-L1-008**: `gwrk init` MUST detect installed CLIs (`which gemini`, `which claude`, `which codex`), activate corresponding built-in adapters, generate `.gwrk/agent-context.md`, and call `syncGovernance()` for each detected backend. (Implements: US-L1-002)
- **FR-L1-009**: System MUST provide `gwrk plugin create agent <name>` that generates a scaffold plugin directory with `manifest.yaml` template and optional `adapter.ts` (when `--dispatch-mode github-integration`). Supports `--git` for init. Future: `gwrk plugin create skill <name>`. (Implements: US-L1-003)
- **FR-L1-010**: System MUST ship built-in adapters (claude, codex, gemini) in `src/plugins/builtins/agents/`. Adapter TypeScript compiles with `pnpm build`. Manifest YAML read at runtime via `import.meta.dirname`. Built-ins MUST be available without `gwrk plugin install`. (Implements: US-L1-001)
- **FR-L1-011**: `gwrk plugin install <url>` MUST support git URLs with optional `#<ref>` for version pinning. On install: clone repo, validate manifest, copy to `~/.gwrk/plugins/agents/<name>/`, write `.gwrk-source.json` with `{ url, ref, commitSha, installedAt }`. (Implements: US-L1-003)
- **FR-L1-012**: User-installed plugins at `~/.gwrk/plugins/agents/<name>/` MUST take precedence over built-in adapters with the same name. Resolution: built-in → user-installed (Map.set overwrites). (Implements: US-L1-001)
- **FR-L1-013**: System MUST provide `gwrk plugin update <name>` that re-clones from the stored source URL in `.gwrk-source.json`. Supports `--all` to update all git-sourced plugins. (Implements: US-L1-003)
### Workflow Runtime (Layer 2.5 — Execution Orbits)

- **FR-L25-001**: Workflows MUST be structurally distinct from Skills. A Workflow manifest (`type: workflow`) MUST declare an `outputSchema` defining the strict JSON structure the agent must return.
- **FR-L25-002**: The `WorkflowRuntime` MUST strictly decouple LLM reasoning from filesystem mutation. The runtime MUST parse the JSON Intent (e.g., `{ action: "WRITE_FILE", filePath: "...", content: "..." }`) and execute the local mutation natively in gwrk core. The Agent MUST NEVER mutate the filesystem directly via prompt engineering alone.
- **FR-L25-003**: `gwrk define` commands (plan, tasks, tests) MUST route their prompts through `WorkflowRuntime`, catching the structured JSON intent, explicitly eliminating reliance on raw bash IDE sandbox capabilities.

#### FR-L25-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Invalid JSON Intent | `Workflow output failed schema constraint: Expected JSON object.` | 1 |
| Attempted direct FS edit | `Workflow execution violation: Use WRITE_FILE JSON intent only.` | 1 |
#### FR-L1-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Invalid agent manifest | `Invalid agent manifest: <Zod error>. See 'gwrk plugin --help'.` | 1 |
| Unknown dispatchMode | `Unknown dispatchMode '<mode>'. Supported: local-cli, github-integration.` | 1 |
| CLI not found | `Agent backend '<name>' requires '<command>' CLI. Install it first.` | 127 |
| Config conflict | `Config conflict: '<key>' in '<path>' claimed by both '<a>' and '<b>'.` | 1 |

#### FR-L1-009 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Plugin name exists | `Plugin '<name>' already exists. Use a different name or --force.` | 1 |
| Invalid name | `Plugin name must be kebab-case (a-z, 0-9, hyphens only).` | 1 |

### Manifest Schema

- **FR-013**: Manifest schema (validated by Zod) MUST support three plugin geometries:
  - **Skill (Atomic)**: `type: 'skill'`, `name`, `tier: atomic`, `version`, `prompt`, `interface`
  - **Skill (Compound)**: `type: 'skill'`, `tier: compound`, `composes`
  - **Workflow**: `type: 'workflow'`, `name`, `outputSchema`
  - All user-facing config (manifest.yaml, plugins.yaml) MUST be YAML.

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| `manifest.yaml` not found | `No manifest.yaml found in <path>. A valid plugin requires manifest.yaml.` | 1 |
| Invalid manifest schema | `Invalid manifest: <Zod error>. See 'gwrk plugin --help' for schema.` | 1 |
| Plugin already exists | `Plugin '<name>' already installed. Use --force to overwrite.` | 1 |
| Unknown plugin type | `Unknown plugin type '<type>'. Supported: skill, workflow, agent, channel, domain.` | 1 |

#### FR-004 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Plugin not found | `Plugin '<name>' not found. Run 'gwrk plugin list' to see installed plugins.` | 1 |
| Dependency exists | `Warning: '<compound>' depends on '<name>'. Use --force to remove anyway.` | 1 |

#### FR-005 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Attempting to disable a skill | `Skills are global-only and cannot be disabled per-project.` | 1 |
| Not in a gwrk project | `Not a gwrk project. Run 'gwrk init' to add gwrk to this project.` | 1 |

#### FR-006 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Skill not found | `Skill '<name>' not found. Run 'gwrk skill --help' to list available skills.` | 1 |
| Missing dependency | `Missing dependency: skill '<dep>' required by '<compound>'. Run 'gwrk plugin install <path>'.` | 1 |
| No agent available | `No agent backend available. Preferred: <agent>. Run 'gwrk plugin list --type agents'.` | 1 |
| LLM invocation fails | `Skill invocation failed: <error>. Agent: <agent>, duration: <Xs>.` | 1 |

---

## 5. Data Model Requirements

### DM-001: Plugin Manifest (Atomic)

```typescript
interface AtomicManifest {
  type: 'skill';
  name: string;              // e.g., "narrative"
  tier: 'atomic';
  version: string;           // semver
  description: string;
  category: string;          // From taxonomy: reasoning, evaluative, creative, etc.
  prompt: string;            // The mode's prompt injection
  interface: PluginInterface;
  runtime: SkillRuntime;
  tags: string[];
}
```

### DM-002: Plugin Manifest (Compound)

```typescript
interface CompoundManifest {
  type: 'skill';
  name: string;              // e.g., "signal-cut"
  tier: 'compound';
  version: string;
  description: string;
  composes: string[];        // Names of atomic skills
  passes: SkillPass[];
  interface: PluginInterface;
  context: SkillContext;
  outputContract: string[];  // Quality assertions (LLM-enforced)
  runtime: SkillRuntime;
  tags: string[];
}

interface SkillPass {
  name: string;              // e.g., "narrative"
  skill: string;             // Reference to atomic skill name
  summary: string;           // One-line description of this pass
}

interface SkillContext {
  required: string[];        // e.g., ["input"]
  optional: string[];        // e.g., ["audience", "product"]
}
```

### DM-003: Plugin Interface (shared)

```typescript
interface PluginInterface {
  input: 'stdin';
  output: 'stdout';
  flags?: PluginFlag[];
  exitCodes: Record<number, string>;
}

interface PluginFlag {
  name: string;              // e.g., "--content-type"
  values?: string[];         // Enum values (empty = freeform)
  required?: boolean;
  default?: string;
  description?: string;
}
```

### DM-004: Skill Runtime Config

```typescript
interface SkillRuntime {
  preferredAgent: string;    // Agent CLI name: 'gemini', 'claude', 'codex'
  preferredModel: string;    // Exact or wildcard model: 'claude-opus-4-6', 'gemini-2.5-pro', 'o3-pro'
  fallbackAgent?: string;
  fallbackModel?: string;
  maxInputTokens: number;
  expectedLatency?: string;  // e.g., "10-30s"
}
```

### DM-005: Project Plugin Override

```typescript
// .gwrk/plugins.yaml schema
interface PluginsOverride {
  disable?: string[];          // Plugin paths to disable (e.g., "domains/writing")
  override?: Record<string, string>; // Plugin name → local path
}
```

No database entities. Plugin metadata is filesystem-only (manifest.yaml files). No SQLite interaction.

### DM-006: Plugin Base Schema (Unified — R002)

```typescript
// Base fields shared across ALL plugin types
const PluginBaseSchema = z.object({
  type: z.enum(['agent', 'skill', 'workflow', 'extension', 'channel']),
  name: z.string().min(1).regex(/^[a-z0-9-]+$/),    // kebab-case required
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
});

// Agent-specific (extends base)
const AgentManifestSchema = PluginBaseSchema.extend({
  type: z.literal('agent'),
  dispatchMode: z.enum(['local-cli', 'github-integration']),
  contextFileName: z.string(),
  invocation: InvocationSchema.optional(),     // local-cli only
  capabilities: CapabilitiesSchema,
  models: z.record(z.string()),
  exitCodeMap: z.record(ExitCodeEntrySchema),
  managedConfig: z.array(ManagedConfigSchema).default([]),
});

// Workflow-specific (extends base)
const WorkflowManifestSchema = PluginBaseSchema.extend({
  type: z.literal('workflow'),
  outputSchema: z.record(z.any()), // JSON Schema
});

// Discriminated union — validated by plugin loader
const AnyManifestSchema = z.discriminatedUnion('type', [
  AgentManifestSchema,
  SkillManifestSchema,         // DM-001 / DM-002
  WorkflowManifestSchema,
  // Future: ExtensionManifestSchema, ChannelManifestSchema
]);
```

`gwrk plugin install` validates ANY plugin type from `AnyManifestSchema`, then routes to the correct type-specific directory (`agents/`, `skills/`, etc.).

### DM-007: Git Source Tracking

```typescript
// ~/.gwrk/plugins/agents/<name>/.gwrk-source.json
interface PluginSource {
  url: string;           // git clone URL
  ref: string;           // branch or tag (default: 'main')
  commitSha: string;     // pinned commit at install time
  installedAt: string;   // ISO 8601
}
```

---

## 6. Technical Constraints

- **TC-001**: Air-Gapped — No external network calls for plugin loading. Install is local path or git URL. No plugin registry service.
- **TC-002**: Fail-Fast Config — Missing `manifest.yaml` → fail immediately. Invalid schema → fail immediately with Zod error.
- **TC-003**: TypeScript Only — No `.js` or `.jsx` in `src/`. ESM modules, ES2022 target.
- **TC-004**: Global-Only Skills — Skills, agents, and channels MUST only resolve from `~/.gwrk/plugins/`. The CLI MUST NOT look for these in `.gwrk/plugins/`. Local scope is exclusively for workflow additions and domain disables.
- **TC-005**: YAML Config — All user-facing config files (`manifest.yaml`, `.gwrk/plugins.yaml`) MUST be YAML. Machine-generated files (`.gwrk/tasks.json`) may remain JSON.
- **TC-006**: SKILL.md Preservation — `gwrk plugin migrate` MUST NOT delete `.agents/` originals. IDE agents (Antigravity, etc.) read `.agents/` directly.
- **TC-007**: Single LLM Call — Compound skill passes are assembled into one prompt, not executed as separate LLM calls. `expectedLatency` in manifest reflects one call.
- **TC-008**: F013 Contract — All `gwrk skill` invocations inherit: `--format json`, `[exit:N | Xs]` on stderr, `--agent` mode, pipe safety (signals on stderr only).
- **TC-009**: Resolution Order — Global → local override → local disable. `gwrk plugin list --project` shows resolved state.
- **TC-010**: Strict Isolation Rule *(Fracture 3 — wave-4-spec-audit)* — `AgentBackend.dispatch()` MUST NOT mutate global filesystem state (`~/.gemini/`, `~/.config/`, `~/.claude/`, etc.) during execution. All config mutations MUST be confined to the provided `projectRoot` (the sandbox worktree path). This prevents race conditions when parallel sandboxes (F005) run concurrently against the same global user directories. Plugins that violate this constraint MUST be rejected at manifest validation time if `managedConfig` references paths outside `projectRoot`.

---

## 7. Testing Requirements

- **TR-001**: `src/plugins/manifest.test.ts` — Unit test manifest Zod schema: valid atomic, valid compound, missing fields rejected, unknown type rejected, `composes` validates references. Vitest. (FR-002, FR-013)
- **TR-002**: `src/plugins/loader.test.ts` — Unit test plugin loader: scan `~/.gwrk/plugins/`, resolve by type, apply `.gwrk/plugins.yaml` overrides/disables, verify resolution order. Vitest. (FR-003, FR-005)
- **TR-003**: `src/commands/plugin.test.ts` — Unit test CLI commands: install (validates then copies), remove (warns on deps), list (groups by type), disable/enable (writes plugins.yaml). Vitest. (FR-001, FR-003, FR-004, FR-005)
- **TR-004**: `src/plugins/skill-runtime.test.ts` — Unit test skill runtime: load manifest + SKILL.md, assemble prompt, mock agent invocation, emit stdout/stderr per F013. Test atomic and compound paths. Vitest. (FR-006, FR-007, FR-008)
- **TR-005**: `src/plugins/migrate.test.ts` — Unit test migration: copy `.agents/skills/`, generate manifest from frontmatter, dry-run mode, skip existing. Vitest. (FR-011)
- **TR-006**: `src/plugins/seed.test.ts` — Unit test seeding: parse reasoning-modes.md, generate atomic skills, preserve categories, skip existing. Vitest. (FR-012)
- **TR-007**: Exit code audit — Shell test: `gwrk skill nonexistent; echo $?` returns 1. `gwrk plugin install ./bad; echo $?` returns 1. `gwrk skill narrative --bad-flag; echo $?` returns 2. (FR-006, FR-001)
- **TR-008**: Pipe composition — Shell test: `echo "test" | gwrk skill narrative 2>/dev/null | wc -c` returns > 0. Verify signals on stderr, content on stdout. (FR-007, FR-008)

---

## 8. Success Criteria

- **SC-001**: `gwrk plugin install ./truth-extract && gwrk skill truth-extract < input.md` produces output.
- **SC-002**: `gwrk skill --help` lists all installed skills with descriptions, grouped by tier.
- **SC-003**: `gwrk skill signal-cut --format json < brief.md | jq .` produces valid JSON.
- **SC-004**: `echo "test" | gwrk skill narrative | gwrk skill practitioner` composes via pipes.
- **SC-005**: `gwrk plugin list --format json | jq '.[0].name'` returns plugin name.
- **SC-006**: `gwrk plugin migrate --dry-run` lists existing skills from `.agents/skills/`.
- **SC-007**: `gwrk plugin seed --dry-run` lists ~40 atomic skills from reasoning-modes taxonomy.
- **SC-008**: `gwrk plugin disable domains/writing` writes `.gwrk/plugins.yaml` and `gwrk plugin list --project` shows it disabled.
- **SC-009**: All skill invocations emit `[exit:N | Xs]` on stderr (F013 contract).

---

## 9. Verification Requirements

- **VR-001**: E2E: Install a skill, invoke it, verify output on stdout and signal on stderr.
- **VR-002**: E2E: `gwrk plugin list --format json | jq .` exits 0 with valid JSON array.
- **VR-003**: E2E: `echo "brief" | gwrk skill narrative --format json | jq .` exits 0.
- **VR-004**: E2E: Pipe composition: `echo "test" | gwrk skill narrative 2>/dev/null | gwrk skill practitioner 2>/dev/null | wc -c` returns > 0.
- **VR-005**: Negative: `gwrk skill nonexistent` exits 1 with corrective message.
- **VR-006**: Negative: `gwrk plugin install ./no-manifest` exits 1 with `No manifest.yaml found`.
- **VR-007**: E2E: `gwrk plugin migrate --dry-run` in a project with `.agents/skills/` lists skills.
- **VR-008**: E2E: `gwrk plugin disable domains/writing && cat .gwrk/plugins.yaml | grep writing` succeeds.
- **VR-009**: Isolation: `gwrk plugin disable skills/narrative` exits 1 with `Skills are global-only`.
- **VR-010**: Unit: `pnpm test` passes all TR-001 through TR-008.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-002 | FR-001 | US-001 | TR-003, TR-007 |
| US-002 | FR-003 | FR-002 | US-001 | TR-001 |
| US-003 | FR-004 | FR-003 | US-002 | TR-002, TR-003 |
| US-004 | FR-005 | FR-004 | US-003 | TR-003 |
| US-005 | FR-006, FR-007, FR-008 | FR-005 | US-004 | TR-002, TR-003 |
| US-006 | FR-006, FR-007, FR-009 | FR-006 | US-005, US-006 | TR-004, TR-008 |
| US-007 | FR-008 | FR-007 | US-005, US-006 | TR-004 |
| US-008 | FR-010 | FR-008 | US-006, US-007 | TR-004, TR-008 |
| US-009 | FR-011 | FR-009 | US-006 | TR-004 |
| US-010 | FR-012 | FR-010 | US-008 | TR-003 |
| — | FR-013 | FR-011 | US-009 | TR-005 |
| — | — | FR-012 | US-010 | TR-006 |
| — | — | FR-013 | US-001, US-005, US-006 | TR-001 |
