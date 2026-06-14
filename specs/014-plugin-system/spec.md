---
type: specification
feature: 014-plugin-system
last_modified: "2026-06-13T12:00:00Z"
revision: 6
---

# Feature Specification: 014 Plugin System

**Feature Branch**: `feat/014-plugin-system`
**Created**: 2026-03-15
**Status**: Draft
**Input**: OpenClaw research, skills architecture analysis, manifest stress test, R006 (Pluginable Research), R007 (Project Perspective), ADR-009 (Domain Ontology), R011 (Obsidian Vault Integration)
**Reference**: [skills-architecture.md](file:///Users/gonzo/Code/gwrk/docs/reference/skills-architecture.md), [plugin-architecture-plan.md](file:///Users/gonzo/Code/gwrk/docs/reference/plugin-architecture-plan.md)

> **Positioning:** This is the plugin infrastructure spec. F008 (Agent Router), F012 (Knowledge Work), F016 (Domain Packs), and F017 (Channel Abstraction) depend on the manifest schema, plugin loader, and skill runtime established here. Research workflows (R006) and Domain Grounding (ADR-009) execute on top of this layer. Extension Plugins (Layer 3) enable integration with external knowledge sources like Obsidian vaults.

---

## 1. Problem Statement

gwrk has plugin-shaped seams — skills, workflows, agent backends, Slack — but no plugin contract. Skills are markdown files pasted into agent context windows. Workflows are slash-command triggered documents. Agent backends are hardcoded dispatch logic. This blocks:

1. **Independent development** — skills can't declare version, dependencies, or agent compatibility
2. **Shareability** — no install/publish mechanism for friends or collaborators
3. **Composability** — skills can't be invoked as CLI commands, piped, or composed
4. **Knowledge work expansion** — no way to add domain-specific packs without editing core
5. **Research flexibility** — methodologies like JTBD or Ontology modeling require distinct prompts and workflows, not a single hardcoded script.
6. **Project-specific constraints** — non-gwrk projects currently receive gwrk-specific linting and rules because enforcement routing lacks language/framework awareness.
7. **External Context Isolation** — gwrk is currently limited to files within the repository. There is no standard way to inject context from external knowledge bases (e.g., Obsidian vaults, Jira, Slack archives) into the agent's reasoning loop.

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
| Extension Plugins | Layer 3 dynamic adapters (Obsidian, metrics, search) | R011 |

---

## 1.1. F014-R: WorkflowRuntime Rework Addendum (Layer 2.5)

The F014-R rework internalizes workflows into the gwrk product, ending the reliance on personal `.agents/` directories and hardcoded shell scripts. This introduces **Layer 2.5: WorkflowRuntime**, a strict execution engine that decouples LLM reasoning from filesystem mutation.

### Architectural Layer Model (Updated)
- **Layer 1: Agent Backend Plugins** (Claude, Codex, Gemini, Antigravity adapters) - *SHIPPED*
- **Layer 2: Skill Plugins** (Atomic reasoning, compound compositions, Enforcement standards) - *SHIPPED*
- **Layer 2.5: WorkflowRuntime** (JSON intent execution, built-in workflows, research methodologies, grounding injection) - **F014-R**
- **Layer 3: Extension Plugins** (Domain Packs, Channel Adapters, Context Providers) - **F014-E**

---

## 1.2. F014-E: Extension Plugins Rework (Layer 3)

Layer 3 Extension Plugins provide gwrk with the ability to "plug in" to external data sources and services. This enables features like deep integration with Obsidian vaults, custom metrics collection, and specialized search capabilities.

### Core Components of F014-E:
1. **ExtensionManifestSchema**: Supports a `provides` array identifying the capabilities offered by the plugin (`context`, `metrics`, `search`, `notification`).
2. **ContextProvider Interface**: A standardized contract for plugins to provide relevant context strings based on keywords or project state.
3. **ExtensionRuntime**: Discovers and resolves active extensions, managing the lifecycle and query execution for context providers.
4. **Context Injection**: Automated injection of extension-provided data into `dispatchToAgent()` calls, following the `resolveEnforcementSkills()` precedent.
5. **Per-Project Configuration**: Extensions are enabled and configured via an `extensions` block in `.gwrkrc.json`.
6. **Obsidian Vault Adapter**: A reference implementation that allows gwrk to pull in relevant notes and design documents from a local Obsidian vault.

---

## 2. User Scenarios & Testing

### US-001 to US-024
*(Existing scenarios US-001 through US-024 from Revision 5 remain active and authoritative. See previous revision for full text.)*

### US-025 - Register a Context Provider Extension (Priority: P0)
As a Principal Engineer, I want to install an extension plugin that provides `context`, so that I can extend the agent's knowledge with data from my personal knowledge base.
**Implements**: FR-L3-001, FR-L3-002
**Acceptance Scenarios**:
1. **Given** an extension directory with `manifest.yaml` declaring `provides: [context]`, **When** `gwrk plugin install ./obsidian-adapter` is run, **Then**:
   - `gwrk plugin list --format json | jq -e '.[] | select(.type == "extension" and .name == "obsidian")' > /dev/null` exits 0

### US-026 - Configure Extension per Project (Priority: P0)
As a Principal Engineer, I want to enable and configure an extension in my `.gwrkrc.json`, so that I can specify which external sources are relevant to this specific project.
**Implements**: FR-L3-005
**Acceptance Scenarios**:
1. **Given** an installed extension `obsidian`, **When** `.gwrkrc.json` contains `extensions: { obsidian: { vaultPath: "/path/to/vault" } }`, **Then**:
   - `gwrk project info --format json | jq -e '.extensions.obsidian.vaultPath == "/path/to/vault"' > /dev/null` exits 0

### US-027 - Dynamic Context Injection from Obsidian (Priority: P0)
As a Principal Engineer, I want the agent to automatically receive relevant notes from my Obsidian vault when I run `gwrk ship`, so that it has access to my design thoughts and historical decisions.
**Implements**: FR-L3-003, FR-L3-004, FR-L3-006
**Acceptance Scenarios**:
1. **Given** obsidian extension enabled and vault containing a note about "Parallel Dispatch", **When** `gwrk ship` is run for a task related to dispatch, **Then**:
   - `gwrk ship --dry-run | grep "<external_context>" | grep "Parallel Dispatch"` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

Extension Plugins execute locally. Permissions for external data sources (e.g., file system access for Obsidian) are granted to the gwrk process. Extensions requiring remote API access MUST handle their own credential management via environment variables, following gwrk security standards (no secrets in code).

---

## 4. Functional Requirements

### Plugin Infrastructure (Existing)
*(FR-001 through FR-015 remain active. See previous revision.)*

### Extension Plugins (Layer 3)

- **FR-L3-001**: System MUST provide an `ExtensionManifestSchema` that supports a `provides` array. Allowed values: `context`, `metrics`, `search`, `notification`. (Implements: US-025)
- **FR-L3-002**: System MUST define a `ContextProvider` interface with a `resolveContext(params: { keywords: string[], root: string, config: any })` method. (Implements: US-025)
- **FR-L3-003**: System MUST provide an `ExtensionRuntime` that manages the discovery and invocation of extension adapters. (Implements: US-027)
- **FR-L3-004**: `ExtensionRuntime` MUST provide `resolveExtensionContext()` which aggregates context from all active `context` providers. (Implements: US-027)
- **FR-L3-005**: System MUST support an `extensions` block in `.gwrkrc.json` for per-project enabling and configuration of extensions. (Implements: US-026)
- **FR-L3-006**: `dispatchToAgent()` MUST call `resolveExtensionContext()` and inject the result into the `<external_context>` block of the agent prompt. (Implements: US-027)
- **FR-L3-007**: System MUST ship a built-in `obsidian-vault` extension as a reference implementation. (Implements: US-027)

### Workflow Runtime (Layer 2.5)
*(FR-L25-001 through FR-L25-013 remain active. See previous revision.)*

---

## 5. Data Model Requirements

### DM-006: Plugin Base Schema (Unified Update)

```typescript
const ExtensionManifestSchema = PluginBaseSchema.extend({
  type: z.literal('extension'),
  provides: z.array(z.enum(['context', 'metrics', 'search', 'notification'])),
  adapter: z.string(), // Path to the adapter entry point
});

const AnyManifestSchema = z.discriminatedUnion('type', [
  AgentManifestSchema,
  SkillManifestSchema,
  EnforcementSkillManifestSchema,
  WorkflowManifestSchema,
  ExtensionManifestSchema,
]);
```

### DM-008: ContextProvider Contract
```typescript
interface ContextResult {
  source: string;
  content: string;
  relevance: number; // 0-1
}

interface ContextProvider {
  resolveContext(params: {
    keywords: string[];
    projectRoot: string;
    config: Record<string, any>;
  }): Promise<ContextResult[]>;
}
```

---

## 6. Technical Constraints

*(TC-001 through TC-015 remain active. See previous revision.)*

- **TC-016**: Extension Isolation — Extension adapters MUST be loaded in a way that prevents them from crashing the main gwrk process (e.g., via try-catch blocks in the runtime).
- **TC-017**: Context Truncation — `resolveExtensionContext()` MUST enforce a strict token/character limit on aggregated context to prevent prompt bloat.
- **TC-018**: Silent Fail — If an extension fails or its configuration is missing, gwrk MUST proceed without that extension's context rather than exiting with an error (unless it's a critical system extension).

---

## 7. Testing Requirements

*(TR-001 through TR-016 remain active. See previous revision.)*

- **TR-017**: `src/plugins/extension-runtime.test.ts` — Unit test for extension discovery, configuration loading, and `resolveExtensionContext()` aggregation. (FR-L3-003, FR-L3-004)
- **TR-018**: `src/utils/agent.test.ts` — Verify `dispatchToAgent()` correctly calls `resolveExtensionContext()` and injects results into the prompt. (FR-L3-006)
- **TR-019**: `src/plugins/builtins/extensions/obsidian-vault/adapter.test.ts` — Unit test for the Obsidian vault adapter's ability to search and read notes. (FR-L3-007)

---

## 8. Success Criteria

- **SC-020**: `gwrk ship` successfully pulls in relevant notes from a configured Obsidian vault and presents them to the agent.
- **SC-021**: Extensions can be enabled/disabled per project via `.gwrkrc.json` without affecting other projects.
- **SC-022**: Token usage remains within bounds even when multiple extensions provide context.

---

## 9. Verification Requirements

- **VR-021**: E2E: Configure the `obsidian-vault` extension in a test project, run `gwrk ship`, and verify (via `--dry-run` or log inspection) that Obsidian context is present in the prompt.
- **VR-022**: Unit: `pnpm test` passes all TR-017 through TR-019.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-025 | FR-L3-001, FR-L3-002 | FR-L3-001, FR-L3-002 | US-025 | TR-017 |
| US-026 | FR-L3-005 | FR-L3-005 | US-026 | TR-017 |
| US-027 | FR-L3-003, FR-L3-004, FR-L3-006, FR-L3-007 | FR-L3-003, FR-L3-004, FR-L3-006, FR-L3-007 | US-027 | TR-017, TR-018, TR-019 |
