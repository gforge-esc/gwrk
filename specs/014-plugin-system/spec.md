---
type: specification
feature: 014-plugin-system
last_modified: "2026-06-03T12:00:00Z"
revision: 5
---

# Feature Specification: 014 Plugin System

**Feature Branch**: `feat/014-plugin-system`
**Created**: 2026-03-15
**Status**: Draft
**Input**: OpenClaw research, skills architecture analysis, manifest stress test, R006 (Pluginable Research), R007 (Project Perspective), ADR-009 (Domain Ontology)
**Reference**: [skills-architecture.md](file:///Users/gonzo/Code/gwrk/docs/reference/skills-architecture.md), [plugin-architecture-plan.md](file:///Users/gonzo/Code/gwrk/docs/reference/plugin-architecture-plan.md)

> **Positioning:** This is the plugin infrastructure spec. F008 (Agent Router), F012 (Knowledge Work), F016 (Domain Packs), and F017 (Channel Abstraction) depend on the manifest schema, plugin loader, and skill runtime established here. Research workflows (R006) and Domain Grounding (ADR-009) execute on top of this layer.

---

## 1. Problem Statement

gwrk has plugin-shaped seams — skills, workflows, agent backends, Slack — but no plugin contract. Skills are markdown files pasted into agent context windows. Workflows are slash-command triggered documents. Agent backends are hardcoded dispatch logic. This blocks:

1. **Independent development** — skills can't declare version, dependencies, or agent compatibility
2. **Shareability** — no install/publish mechanism for friends or collaborators
3. **Composability** — skills can't be invoked as CLI commands, piped, or composed
4. **Knowledge work expansion** — no way to add domain-specific packs without editing core
5. **Research flexibility** — methodologies like JTBD or Ontology modeling require distinct prompts and workflows, not a single hardcoded script.
6. **Project-specific constraints** — non-gwrk projects currently receive gwrk-specific linting and rules because enforcement routing lacks language/framework awareness.

The F013 agent-native interface proved that CLI-native contracts (stdin/stdout, `--format json`, signals, piping) are the right interface for both humans and agents. The same principle must apply to gwrk's extensibility: plugins should be CLI-native, not server-coupled (anti-MCP).

### Design Decisions (locked)

| Decision | Choice | Reference |
|----------|--------|-----------|
| Plugin scoping | Model C: global `~/.gwrk/plugins/` + local `.gwrk/` override | plugin-architecture-plan.md, R004 |
| Workflow Home | `~/.gwrk/plugins/workflows/` (shipped as built-ins) | R004 Decisions |
| JSON Intent Engine | Mandatory: `WorkflowRuntime` executes `WRITE_FILE`, `CREATE_DIR`, `RUN_COMMAND` | R004 Decision #1 |
| Config format | YAML for all user-facing config | Deliberation 2026-03-15 |
| Skill interface | CLI-native: `gwrk skill <name>` with full F013 contract | skills-architecture.md |
| Skill hierarchy | Two-tier: atomic (single mode) + compound (multi-pass) | Manifest stress test |
| Manifest boundary | manifest.yaml = contract, SKILL.md = reasoning program | skills-architecture.md |
| Define Orchestrator | TypeScript state machine replacing `define-until-solid.sh` | R004 Decision #4 |
| Research Methodologies | Implemented as Workflow Plugins with `category: research` | R006 |
| Grounding Context | Domain Ontology, Hierarchy, and UX injected dynamically at dispatch | ADR-009 |

---

## 1.1. F014-R: WorkflowRuntime Rework Addendum (Layer 2.5)

The F014-R rework internalizes workflows into the gwrk product, ending the reliance on personal `.agents/` directories and hardcoded shell scripts. This introduces **Layer 2.5: WorkflowRuntime**, a strict execution engine that decouples LLM reasoning from filesystem mutation.

### Architectural Layer Model (Updated)
- **Layer 1: Agent Backend Plugins** (Claude, Codex, Gemini, Antigravity adapters) - *SHIPPED*
- **Layer 2: Skill Plugins** (Atomic reasoning, compound compositions, Enforcement standards) - *SHIPPED*
- **Layer 2.5: WorkflowRuntime** (JSON intent execution, built-in workflows, research methodologies, grounding injection) - **F014-R**
- **Layer 3: Extension Plugins** (Domain Packs, Channel Adapters) - *FUTURE*

### Core Components of F014-R:
1. **The JSON Intent Engine**: Parses agent output against a Zod-backed `outputSchema` and executes local actions (`WRITE_FILE`, `RUN_COMMAND`) natively.
2. **Built-in Workflow Plugins**: 10 core workflows (specify, plan, implement, research, etc.) shipped in `builtins/workflows/`.
3. **CLI Command Rewiring**: Moving `gwrk specify`, `plan`, `define`, and `research` commands to the `WorkflowRuntime`.
4. **DefineOrchestrator**: A TypeScript state machine for the `spec -> plan -> tasks` loop.
5. **Context Grounding**: Dynamic injection of `.gwrk/ontology/domain.md` and perspective documents.

---

## 2. User Scenarios & Testing

### US-001 - Install a Skill Plugin (Priority: P0)
As a Principal Engineer, I want `gwrk plugin install <path>` to install a skill to `~/.gwrk/plugins/skills/`, so that I can add new reasoning capabilities from a local directory, a git URL, or a zip file.
**Implements**: FR-001, FR-002
**Acceptance Scenarios**:
1. **Given** a directory with `manifest.yaml` + `SKILL.md`, **When** `gwrk plugin install ./truth-extract` is run, **Then**:
   - `ls ~/.gwrk/plugins/skills/truth-extract/manifest.yaml` exits 0

### US-002 - List Installed Plugins (Priority: P0)
As a Principal Engineer, I want `gwrk plugin list` to show all installed plugins, so that I can see what capabilities gwrk has.
**Implements**: FR-003
**Acceptance Scenarios**:
1. **Given** `--format json`, **When** `gwrk plugin list --format json` is run, **Then**:
   - `gwrk plugin list --format json | jq '.[0].name'` exits 0 and returns plugin name

### US-003 - Remove a Plugin (Priority: P1)
As a Principal Engineer, I want `gwrk plugin remove <name>` to uninstall a plugin from `~/.gwrk/plugins/`, so that I can clean up unused capabilities.
**Implements**: FR-004
**Acceptance Scenarios**:
1. **Given** plugin installed, **When** `gwrk plugin remove truth-extract` is run, **Then**:
   - `test ! -d ~/.gwrk/plugins/skills/truth-extract/` exits 0

### US-004 - Disable/Enable Plugin per Project (Priority: P1)
As a Principal Engineer, I want `gwrk plugin disable <name>` to deactivate a plugin in the current project without uninstalling it globally, so that I can scope capabilities per project.
**Implements**: FR-005
**Acceptance Scenarios**:
1. **Given** a gwrk project, **When** `gwrk plugin disable domains/writing` is run, **Then**:
   - `grep "domains/writing" .gwrk/plugins.yaml` exits 0

### US-005 - Invoke an Atomic Skill (Priority: P0)
As a Principal Engineer, I want `gwrk skill narrative < brief.md` to invoke a single reasoning mode and produce output on stdout, so that I can use skills as composable CLI commands.
**Implements**: FR-006, FR-007, FR-008
**Acceptance Scenarios**:
1. **Given** atomic skill installed, **When** `echo "brief" | gwrk skill narrative` is run, **Then**:
   - `echo "test" | gwrk skill narrative > /dev/null` exits 0

### US-006 - Invoke a Compound Skill (Priority: P0)
As a Principal Engineer, I want `gwrk skill signal-cut < brief.md` to execute a multi-pass compound skill in a single LLM call and return structured output.
**Implements**: FR-006, FR-007, FR-009
**Acceptance Scenarios**:
1. **Given** compound skill, **When** invoked, **Then**:
   - `echo "test" | gwrk skill signal-cut > /dev/null` exits 0

### US-007 - Pipe Skills Together (Priority: P0)
As a Principal Engineer, I want `gwrk skill A | gwrk skill B` to compose skills via Unix pipes, so that I can build ad-hoc reasoning chains without defining a compound skill.
**Implements**: FR-008
**Acceptance Scenarios**:
1. **Given** two atomic skills, **When** piped, **Then**:
   - `echo "test" | gwrk skill narrative | gwrk skill practitioner > /dev/null` exits 0

### US-008 - Discover Skills via --help (Priority: P1)
As a Principal Engineer, I want `gwrk skill --help` to list all installed skills with their descriptions, and `gwrk skill <name> --help` to show a skill's full interface contract.
**Implements**: FR-010
**Acceptance Scenarios**:
1. **Given** skills installed, **When** `gwrk skill --help` is run, **Then**:
   - `gwrk skill --help | grep narrative` exits 0

### US-009 - Migrate Existing Skills (Priority: P0)
As a Principal Engineer, I want `gwrk plugin migrate` to move existing `.agents/skills/` and `.agents/workflows/` to `~/.gwrk/plugins/` with auto-generated manifests, so that my current skills work with the new system.
**Implements**: FR-011
**Acceptance Scenarios**:
1. **Given** `.agents/skills/` exists, **When** `gwrk plugin migrate --dry-run` is run, **Then**:
   - `gwrk plugin migrate --dry-run` exits 0

### US-010 - Seed Atomic Skills from Taxonomy (Priority: P1)
As a Principal Engineer, I want `gwrk plugin seed` to generate atomic skill plugins for all reasoning modes in the taxonomy, so that the ~40 modes become invocable CLI commands.
**Implements**: FR-012
**Acceptance Scenarios**:
1. **Given** taxonomy exists, **When** `gwrk plugin seed --dry-run` is run, **Then**:
   - `gwrk plugin seed --dry-run` exits 0

### US-011 - Execute a Built-in Workflow (Priority: P0)
As a Principal Engineer, I want `gwrk specify` to use the built-in `gwrk-specify` workflow from `~/.gwrk/plugins/workflows/`, so that I can define requirements without needing a local `.agents/` folder.
**Implements**: FR-L25-001, FR-L25-003
**Acceptance Scenarios**:
1. **Given** a project, **When** `gwrk specify my-feature` is run, **Then**:
   - `ls specs/my-feature/spec.md` exits 0

### US-012 - Decoupled Filesystem Mutation (Priority: P0)
As a Principal Engineer, I want workflows to execute file changes via JSON intents (e.g., `WRITE_FILE`), so that the agent's reasoning is strictly separated from the execution of those changes.
**Implements**: FR-L25-002
**Acceptance Scenarios**:
1. **Given** valid JSON intent output, **When** executed, **Then**:
   - `gwrk specify dummy-feature` writes the file and exits 0

### US-013 - DefineOrchestrator Loop (Priority: P0)
As a Principal Engineer, I want `gwrk define` to run a TypeScript state machine loop (spec -> plan -> tasks), so that I have a robust, predictable development experience that doesn't rely on shell scripts.
**Implements**: FR-L25-004
**Acceptance Scenarios**:
1. **Given** a valid specification, **When** `gwrk define` is run, **Then**:
   - `gwrk define --dry-run` exits 0

### US-014 - Provision Global Home (Priority: P1)
As a Principal Engineer, I want `gwrk init` to populate `~/.gwrk/plugins/` with built-in workflows and skills, so that my global environment is ready for use immediately.
**Implements**: FR-L1-008, FR-L25-005
**Acceptance Scenarios**:
1. **When** `gwrk init` is run, **Then**:
   - `ls ~/.gwrk/plugins/workflows/` exits 0

### US-015 - Project-Local Workflow Override (Priority: P1)
As a Principal Engineer, I want to override a built-in workflow by placing a custom version in `.gwrk/plugins/workflows/`, so that I can tailor the development process to my specific project needs.
**Implements**: FR-005, FR-L25-006
**Acceptance Scenarios**:
1. **Given** local override exists, **When** `gwrk specify" is run, **Then**:
   - `gwrk specify dummy 2>&1 | grep "override"` exits 0

### US-016 - Enforcement Skills for Code Quality with Language Filtering (Priority: P1) — **SHIPPED**
As a Principal Engineer, I want coding standards to be shipped as builtin enforcement skills and filtered by my project's language/framework profile, so that a Python project doesn't receive TypeScript standards.
**Implements**: FR-014
**Acceptance Scenarios**:
1. **Given** a Python project, **When** an agent is dispatched, **Then**:
   - `gwrk plugin list --project --type skills | grep typescript-standards; echo $?` returns 1

### US-020 - Define Project Ontology (Priority: P0)
As a Principal Engineer, I want `gwrk define ontology` to scaffold the project knowledge structure, so that the agent has a clear understanding of the domain, hierarchy, and UX posture.
**Implements**: FR-L25-009
**Acceptance Scenarios**:
1. **Given** a new project, **When** `gwrk define ontology` is run, **Then**:
   - `ls .gwrk/ontology/domain.md` exits 0
   - `ls .gwrk/perspective/hierarchy.md` exits 0
   - `ls .gwrk/perspective/ux-posture.md` exits 0

### US-021 - Automated Ontology Construction (Priority: P0)
As a Principal Engineer, I want `gwrk define ontology --run` to construct the ontology using the Five Primitives methodology, so that the domain model is grounded in actual codebase and spec evidence.
**Implements**: FR-L25-010, FR-L25-012
**Acceptance Scenarios**:
1. **Given** existing specs and code, **When** `gwrk define ontology --run` is run, **Then**:
   - `grep "## Classes" .gwrk/ontology/domain.md` exits 0
   - `grep "## Axioms" .gwrk/ontology/domain.md` exits 0

### US-022 - Source Material Grounding for Ontology (Priority: P0)
As a Principal Engineer, I want the ontology construction workflow to scan source material (codebase, specs, architecture docs), so that the model reflects the technical reality of the project.
**Implements**: FR-L25-011
**Acceptance Scenarios**:
1. **Given** a project with `docs/grounding/architecture.md`, **When** `gwrk define ontology --run` is executed, **Then**:
   - The agent output reflects concepts found in the architecture document.

### US-023 - Toolchain Detection (Priority: P0)
As a Principal Engineer, I want `gwrk project info` to report the detected toolchain (primary linter/formatter, test runner) alongside the language and build system, so that agents can use the correct tools (like Biome or Ruff) without manual configuration.
**Implements**: FR-015
**Acceptance Scenarios**:
1. **Given** a TypeScript project with a `biome.json` file, **When** `gwrk project info --format json` is run, **Then**:
   - `gwrk project info --format json | jq -e '.toolchain.primary == "biome"' > /dev/null` exits 0

### US-024 - Mandatory Context Gathering (Priority: P0)
As a Principal Engineer, I want the `gwrk ship` (implement) workflow to start with a mandatory context-gathering preamble, so that agents actively read the project profile, toolchain, and status before writing any code.
**Implements**: FR-L25-013
**Acceptance Scenarios**:
1. **Given** the built-in implement workflow, **When** it is executed, **Then**:
   - `cat src/plugins/builtins/workflows/gwrk-implement/PROMPT.md | grep -q "gwrk project info"` exits 0

### US-017 - Scaffold Research Initiative (Priority: P0)
As a Principal Engineer, I want `gwrk define research "User Switching Behavior" --methodology jtbd` to scaffold a new research directory so that I have a structured brief ready to fill out.
**Implements**: FR-R006-001
**Acceptance Scenarios**:
1. **Given** no existing R008, **When** `gwrk define research "New Thing"` is run, **Then**:
   - `ls docs/research/R008-new-thing/brief.md` exits 0

### US-018 - Execute Research Workflow (Priority: P0)
As a Principal Engineer, I want `gwrk define research R008 --run` to execute the appropriate methodology plugin so that an agent can draft the research output based on my brief.
**Implements**: FR-R006-002
**Acceptance Scenarios**:
1. **Given** R008 brief exists, **When** run, **Then**:
   - `ls docs/research/R008-*/draft.md` exits 0

### US-019 - Inject Domain Ontology and Posture (Priority: P1)
As a Principal Engineer, I want project knowledge (ontology, hierarchy, UX posture) to automatically ground the agent so that it understands my project's specific domain context without manual prompting.
**Implements**: FR-ADR009-001
**Acceptance Scenarios**:
1. **Given** `.gwrk/ontology/domain.md` exists, **When** a workflow is dispatched, **Then**:
   - `gwrk project discover --json | grep "domain.md"` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

Plugin operations are local filesystem only. No external service credentials. Skills invoke LLM agents via the agent backend (F008), which manages credentials independently.

---

## 4. Functional Requirements

### Plugin Infrastructure

- **FR-001**: System MUST provide `gwrk plugin install <path|url>` that validates `manifest.yaml`. (Implements: US-001)
- **FR-002**: System MUST validate manifest.yaml against a Zod schema on install. (Implements: US-001)
- **FR-003**: System MUST provide `gwrk plugin list` that scans `~/.gwrk/plugins/" and displays installed plugins. (Implements: US-002)
- **FR-004**: System MUST provide `gwrk plugin remove <name>`. (Implements: US-003)
- **FR-005**: System MUST provide `gwrk plugin disable <name>` and `enable`. (Implements: US-004)

### Skill Runtime & Enforcement

- **FR-006**: System MUST provide `gwrk skill <name>` command. (Implements: US-005, US-006)
- **FR-007**: Skill invocation MUST inherit the full F013 contract. (Implements: US-005, US-006)
- **FR-008**: Compound skills MUST be executable as a single LLM call. (Implements: US-006, US-007)
- **FR-009**: Compound skill manifest MUST declare `composes`. (Implements: US-006)
- **FR-010**: `gwrk skill --help` MUST list all installed skills. (Implements: US-008)
- **FR-014**: System MUST ship builtin enforcement skills (`tier: enforcement`). Enforcement skills MUST support `language` and `framework` manifest fields. `resolveEnforcementSkills()` MUST filter built-in enforcement skills to match the detected `ProjectProfile` language/framework. Project-local enforcement skills MUST always load. (Implements: US-016) — **SHIPPED**
- **FR-015**: System MUST detect `toolchain.primary`, `toolchain.formatter`, and `toolchain.test` from filesystem signals (config files, devDependencies). The `ProjectProfile` object MUST surface this data via the `gwrk project info` command. (Implements: US-023)

### Migration & Seeding

- **FR-011**: System MUST provide `gwrk plugin migrate`. (Implements: US-009)
- **FR-012**: System MUST provide `gwrk plugin seed`. (Implements: US-010)

### Agent Backend Adapters (Layer 1 — R002)

- **FR-L1-001** to **FR-L1-013**: See F014 Base Spec.

### Workflow Runtime (Layer 2.5) & Research (R006) & Grounding (ADR-009)

- **FR-L25-001**: System MUST provide a `WorkflowRuntime` that resolves workflows. (Implements: US-011)
- **FR-L25-002**: `WorkflowRuntime` MUST strictly decouple LLM reasoning from filesystem mutation via JSON Intent. (Implements: US-012)
- **FR-L25-003**: All core `gwrk` commands (`specify`, `plan`, `define tasks`, `ship/implement`, `research`) MUST route prompts through `WorkflowRuntime`. (Implements: US-011)
- **FR-L25-004**: System MUST provide a `DefineOrchestrator` for spec -> plan -> tasks. (Implements: US-013)
- **FR-L25-005**: `gwrk init` MUST provision core workflows and project grounding dirs (`.gwrk/ontology`, `.gwrk/perspective`). (Implements: US-014)
- **FR-L25-006**: `WorkflowRuntime` MUST follow local → global resolution. (Implements: US-015)
- **FR-L25-007**: `WorkflowRuntime" MUST support multi-action intents.
- **FR-L25-008**: `WorkflowRuntime` MUST dynamically inject project knowledge documents (`.gwrk/ontology/domain.md`, `.gwrk/perspective/hierarchy.md`, `.gwrk/perspective/ux-posture.md`) into the agent prompt if they exist on disk. (Implements: US-019)
- **FR-R006-001**: System MUST provide `gwrk define research <initiative>` command that creates a new research initiative in `docs/research/R0XX-<slug>/` with a templated `brief.md` based on the `--methodology` provided (default: `technical`). (Implements: US-017)
- **FR-R006-002**: System MUST support executing research methodologies via `gwrk define research <initiative> --run`. The `WorkflowRuntime` MUST resolve the workflow plugin specified by the `methodology" field in the brief's YAML frontmatter. (Implements: US-018)
- **FR-L25-009**: System MUST provide `gwrk define ontology` command that scaffolds `.gwrk/ontology/` and `.gwrk/perspective/` directories. (Implements: US-020)
- **FR-L25-010**: System MUST provide `gwrk-ontology-construct` builtin workflow plugin for automated ontology generation. (Implements: US-021)
- **FR-L25-011**: System MUST provide a source material scanner utility that discovers and reads codebase structure, feature specifications, and architecture documents for agent grounding. (Implements: US-022)
- **FR-L25-012**: Ontology construction MUST enforce the Five Primitives methodology (Classes, Properties, Relations, Individuals, Axioms) as defined in ADR-009. (Implements: US-021)
- **FR-L25-013**: The `WorkflowRuntime` built-in `implement` workflow MUST include a mandatory context-gathering preamble requiring the agent to execute `gwrk project info` and `gwrk project discover` before initiating code changes. (Implements: US-024)

#### FR-L25-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Invalid JSON Intent | `Workflow output failed schema constraint: Expected JSON object.` | 1 |
| Attempted direct FS edit | `Workflow execution violation: Use WRITE_FILE JSON intent only.` | 1 |
| Workflow not found | `Workflow '<name>' not found.` | 1 |

### Manifest Schema

- **FR-013**: Manifest schema MUST support Plugin geometries: Skill (Atomic, Compound, Enforcement) and Workflow.

---

## 5. Data Model Requirements

### DM-006: Plugin Base Schema (Unified)

```typescript
const PluginBaseSchema = z.object({
  type: z.enum(['agent', 'skill', 'workflow', 'extension', 'channel']),
  name: z.string().min(1).regex(/^[a-z0-9-]+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(1),
});

const EnforcementSkillManifestSchema = PluginBaseSchema.extend({
  type: z.literal('skill'),
  tier: z.literal('enforcement'),
  scope: z.enum(['implementation', 'review', 'all']),
  language: z.string().optional(),     // R007 Profile Filtering
  framework: z.string().optional(),    // R007 Profile Filtering
});

const WorkflowManifestSchema = PluginBaseSchema.extend({
  type: z.literal('workflow'),
  category: z.enum(['research']).optional(), // R006 Research
  methodology: z.string().optional(),        // R006
  brief_template: z.string().optional(),     // R006
  outputSchema: z.record(z.any()),
});

const AnyManifestSchema = z.discriminatedUnion('type', [
  AgentManifestSchema,
  SkillManifestSchema,
  EnforcementSkillManifestSchema,
  WorkflowManifestSchema,
]);
```

### DM-007: ProjectProfile Toolchain Extension (F013 Update)
```typescript
interface ProjectProfile {
  // ... existing fields (type, stack, layout) ...
  toolchain?: {
    primary?: string;   // e.g., "biome", "ruff", "eslint", "cargo"
    formatter?: string; // e.g., "prettier", "black"
    test?: string;      // e.g., "vitest", "pytest", "cargo-test"
  };
}
```

---

## 6. Technical Constraints

- **TC-001**: Air-Gapped — No external network calls for plugin loading.
- **TC-002**: Fail-Fast Config — Missing `manifest.yaml` → fail immediately.
- **TC-003**: TypeScript Only — No `.js` or `.jsx" in `src/`.
- **TC-010**: Strict Isolation Rule — `AgentBackend.dispatch()` MUST NOT mutate global filesystem state.
- **TC-012**: Language Filtering (R007) — `resolveEnforcementSkills` MUST silently skip builtins with mismatched `language` properties instead of throwing errors.
- **TC-013**: Grounding Injection Order (ADR-009) — Domain ontology MUST be injected before information hierarchy and UX posture.
- **TC-014**: Five Primitives Methodology — The `gwrk-ontology-construct` workflow MUST produce output structured around Classes, Properties, Relations, Individuals, and Axioms.
- **TC-015**: Toolchain detection (FR-015) MUST be entirely filesystem-based, reading config files and `package.json" without executing external commands or network requests. Zero context cost.

---

## 7. Testing Requirements

- **TR-001**: `src/plugins/manifest.test.ts` — Unit test manifest Zod schemas (including language/framework for enforcement). (FR-013)
- **TR-009**: `src/plugins/workflow-runtime.test.ts` — Unit test `WorkflowRuntime`. (FR-L25-001)
- **TR-011**: `src/commands/research.test.ts` — Unit test scaffold logic for R0XX numbering and brief generation. (FR-R006-001)
- **TR-012**: `src/engine/agent.test.ts` — Unit test `dispatchToAgent()` context injection logic for ontology and perspective files. (FR-ADR009-001)
- **TR-013**: `src/plugins/skill-runtime.test.ts` — Unit test `resolveEnforcementSkills()` correctly applying `ProjectProfile` language filtering. (FR-014)
- **TR-014**: `src/commands/define-ontology.test.ts` — Unit test for `gwrk define ontology` scaffolding logic. (FR-L25-009)
- **TR-015**: `src/plugins/builtins/workflows/gwrk-ontology-construct/prompt.test.ts` — Unit test (or prompt verification) for Five Primitives compliance. (FR-L25-012)
- **TR-016**: `src/engine/profile-detector.test.ts` — Unit test filesystem-based detection of Biome, Ruff, and standard toolchains. (FR-015)

---

## 8. Success Criteria

- **SC-001** to **SC-013**: Existing F014 functionality validated.
- **SC-014**: `gwrk define research "New Feature"" creates `docs/research/RXXX-new-feature/brief.md`.
- **SC-015**: A Python project running `gwrk ship` does not have `typescript-standards" injected into its prompt.
- **SC-016**: Projects with `.gwrk/ontology/domain.md` successfully inject the file contents into `dispatchToAgent" calls.
- **SC-017**: `gwrk define ontology --run` produces `domain.md`, `hierarchy.md`, and `ux-posture.md` grounded in project source material.
- **SC-018**: Projects with `biome.json` successfully report `toolchain.primary: "biome"` via `gwrk project info`.
- **SC-019**: Dispatched implementation agents execute `gwrk project info` and `gwrk project discover` on their first turn as mandated by the workflow preamble.

---

## 9. Verification Requirements

- **VR-017**: E2E: Run `gwrk define research test-initiative`, verify directory creation, then run `gwrk define research test-initiative --run` and verify `draft.md" generation.
- **VR-018**: Unit: `pnpm test` passes all TR-011 through TR-013.
- **VR-019**: E2E: Run `gwrk define ontology --run` in a test project and verify the creation and content of the three ontology/perspective documents.
- **VR-020**: E2E: Run `gwrk project info --format json` in a fixture project with `biome.json" and verify `.toolchain.primary == "biome"`.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-016 | FR-014 | FR-014 | US-016 | TR-013 |
| US-017 | FR-R006-001 | FR-R006-001 | US-017 | TR-011 |
| US-018 | FR-R006-002 | FR-R006-002 | US-018 | TR-009, TR-011 |
| US-019 | FR-ADR009-001 | FR-ADR009-001 | US-019 | TR-012 |
| US-020 | FR-L25-009 | FR-L25-009 | US-020 | TR-014 |
| US-021 | FR-L25-010 | FR-L25-010, FR-L25-012 | US-021 | TR-009, TR-015 |
| US-022 | FR-L25-011 | FR-L25-011 | US-022 | TR-015 |
| US-023 | FR-015 | FR-015 | US-023 | TR-016 |
| US-024 | FR-L25-013 | FR-L25-013 | US-024 | none — prompt verification |