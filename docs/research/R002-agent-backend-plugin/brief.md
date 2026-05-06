# Research Initiative: R002 — Agent Backend Plugin Design

> **Status:** Brief — Awaiting Approval
> **Consumer:** F014 spec expansion (Layer 1 FRs), architecture.md v5.0
> **Output:** `docs/research/R002-agent-backend-plugin/draft.md`

---

## Objective

Synthesize the existing research on `AgentBackend` plugins into a single, implementation-grade design document. The F014 spec currently covers Layer 2 (Skills) thoroughly but has zero FRs for Layer 1 (Agent Backends). This research fills that gap by answering the design questions that the spec must codify.

**Critical framing:**

1. **ADR-006 and F014 spec are the most mature thinking.** All other sources (cli-backend-research, plugin-strategy-audit, plugin-architecture-plan) are earlier explorations — useful for evidence but NOT authoritative where they conflict with ADR-006.
2. **R001 (Parallel Dispatch) v3 resolved key architectural questions** that directly impact this research: Codex Cloud is a separate feature (not F005), merge is always GitHub PR + Harvest, dispatch calls `gwrk ship` not shell scripts.
3. **Codex Cloud is NOT a CLI.** There is no `codex run --cloud` or `codex cloud exec`. Codex Cloud is a web/GitHub/Slack integration platform. The `AgentBackend` interface (ADR-006 §2.1) was designed around `spawn()` semantics. This research must address how the interface accommodates non-local dispatch.
4. **`.gwrk/agent-context.md` is the canonical governance source** per ADR-006 §2.2. The current `.agents/rules/workspace.md` and `GEMINI.md`/`CLAUDE.md`/`AGENTS.md` stubs are kludges of the current Antigravity-based workflow system. They are NOT the target architecture.

---

## Questions to Answer

### Q1: Agent Manifest Schema

What does an `AgentBackend` adapter's `manifest.yaml` look like, and how does it differ from a skill manifest?

**Must answer:**
- What fields are shared with skill manifests? (name, version, type, description)
- What fields are agent-specific? (`contextFileName`, `managedConfig`, `capacity`, invocation format, `exitCodeMap`)
- How does `dispatchMode` differentiate local CLI backends from non-local backends (e.g., Codex Cloud)?
- Does the manifest declare the CLI command template? Or is that hardcoded in the adapter's TypeScript?
- How is `preferredModel` per-task-type (implement, review, define, refactor) expressed?
- Sample manifests for: Claude, Codex (local), Codex (cloud), Gemini

### Q2: Adapter Lifecycle

What is the full lifecycle of an `AgentBackend` adapter from install to dispatch?

**Must answer:**
- Install: `gwrk plugin install ./agents/codex` — what validation beyond manifest schema?
- Register: how does the plugin loader discover and register agent adapters?
- `syncGovernance()`: when is it called? What does it write? How does `.gwrk/agent-context.md` → CLI-specific files work mechanically? (Source: ADR-006 §2.2)
- `dispatch()`: returns `{command, args, stdin, env, streamable}` — who actually `spawn()`s the process? (Source: ADR-006 §3)
- **Codex Cloud exception:** Codex Cloud is NOT a local spawn. It dispatches via GitHub issue creation (`@codex <prompt>`). How does this fit the `AgentBackend` interface? Does `dispatch()` need a `dispatchMode` discriminator? Or is Codex Cloud a separate interface entirely? (Source: codex-cloud-research-report.md, R001 v3 §Q2)
- `parseResult()`: maps raw stdout/stderr/exitCode to `TaskResult` — what's the full normalization table per backend?
- Teardown: is there cleanup? Context file removal on uninstall?

### Q3: Config Conflict Detection

ADR-006 §2.5 says plugins declare config keys they manage. How does `gwrk plugin check` work?

**Must answer:**
- What is the data structure for "config ownership"? (Source: ADR-006 §2.5 `managedConfig` in manifest)
- What happens when two adapters claim the same key?
- Is conflict detection install-time, dispatch-time, or both?
- What does `gwrk plugin check` output? (text/json per F013 contract)
- Error-as-navigation: what corrective action does the error suggest?

### Q4: Governance Sync Mechanics

How does `gwrk plugin sync-context` generate CLI-specific context files from `.gwrk/agent-context.md`?

**Must answer:**
- What is the canonical format of `.gwrk/agent-context.md`? (YAML frontmatter for machine-readable metadata + prose sections for governance rules)
- **Bootstrap:** Who creates `.gwrk/agent-context.md`? (Source: ADR-006 §2.2 says it's gwrk-managed. `gwrk init` must create it from template. Migration from existing `.agents/rules/workspace.md` kludge must be supported.)
- How does each adapter know which sections apply to it? (Per-adapter tagged sections: `### [claude]`, `### [gemini]`, etc.)
- Does `sync-context` overwrite the entire CLI context file, or merge within boundary markers?
- What about adapter-specific instructions? (e.g., Codex Cloud `AGENTS.md` needs richer content per codex-cloud-research-report.md §6)
- When is `sync-context` triggered? (Source: ADR-006 §2.2 — auto-called by `gwrk define plan` and `gwrk define tasks`)

### Q5: Migration Path from Current Facade

How does the current `dispatchToAgent()` → `spawn()` pattern migrate to `pluginRegistry.getAgentBackend().dispatch()`?

**Must answer:**
- What does `src/utils/agent.ts` do today? (Read the code.)
- What is the exact cut point? (Which lines become plugin calls?)
- Is there a compatibility shim during migration? (Old function wraps new plugin call?)
- Does F005 need to care about this migration, or does it only see `dispatchToAgent()` regardless?

### Q6: Workflow Execution Runtime (Layer 2.5)

If F014 moves `.agents/workflows/` to `~/.gwrk/plugins/workflows/`, how are they executed?

**Must answer:**
- What is `WorkflowRuntime` and how does it differ from `SkillRuntime`?
- How is a workflow invoked internally by commands like `gwrk define plan`?

### Q7: Filesystem Decoupling & LLM Isolation

How do we break the reliance on prompt-engineered instructions telling the LLM to write to the host filesystem directly?

**Must answer:**
- What is the structural payload a Workflow plugin must return (JSON Intents)?
- Which subsystem executes the filesystem mutation (e.g., `fs.writeFileSync(...)`)?

### Q8: Orchestration Subsystem Migration

How do we migrate existing bash dispatch loops (`scripts/dev/*`) to native orchestrators?

**Must answer:**
- What happens to `define-until-solid.sh` and `work-until-done.sh`?
- How do the CLI commands handle state-machine logic natively?

---

## Input Documents

The agent executing this research MUST read and synthesize these sources.

### Tier 1 — Authoritative (these are the most mature thinking; defer to these on conflicts)

1. [`docs/decisions/ADR-006-plugin-agent-backends.md`](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-006-plugin-agent-backends.md) — **canonical** interface definition, governance model, exit code normalization
2. [`specs/014-plugin-system/spec.md`](file:///Users/gonzo/Code/gwrk/specs/014-plugin-system/spec.md) — current spec (L2-only, staleness target for L1 expansion)
3. [`docs/architecture.md`](file:///Users/gonzo/Code/gwrk/docs/architecture.md) — §7 (Plugin Architecture), §8 (Config Contract), §14 (CLI Provisioning Matrix)

### Tier 2 — Research Context (critical findings that inform the design)

4. [`docs/research/R001-parallel-dispatch/draft.md`](file:///Users/gonzo/Code/gwrk/docs/research/R001-parallel-dispatch/draft.md) — **R001 v3** — resolved: Codex Cloud is separate feature, merge is always PR + Harvest, dispatch calls `gwrk ship`, resource gating is config-driven
5. [`docs/reference/codex-cloud-research-report.md`](file:///Users/gonzo/Code/gwrk/docs/reference/codex-cloud-research-report.md) — **Codex Cloud is NOT a CLI.** Environments, container lifecycle, GitHub/Slack integration, gwrk Tier 3 architecture
6. [`docs/reference/cli-backend-research-report.md`](file:///Users/gonzo/Code/gwrk/docs/reference/cli-backend-research-report.md) — deep-dive on Claude/Codex/Gemini invocation patterns, stdin delivery, exit codes

### Tier 3 — Supporting (useful for evidence, may be outdated)

7. [`docs/reference/plugin-strategy-audit.md`](file:///Users/gonzo/Code/gwrk/docs/reference/plugin-strategy-audit.md) — F004→F014 migration path, remediation matrix
8. [`docs/reference/plugin-architecture-plan.md`](file:///Users/gonzo/Code/gwrk/docs/reference/plugin-architecture-plan.md) — original three-phase plan (pre-ADR-006, check for drift)
9. [`docs/reference/skills-architecture.md`](file:///Users/gonzo/Code/gwrk/docs/reference/skills-architecture.md) — Layer 2 skill manifest design (contrast for Layer 1)

### Codebase (read actual implementation)

10. `src/utils/agent.ts` — current `dispatchToAgent()` facade
11. `src/utils/config.ts` — current `.gwrkrc.json` loader (agent config)
12. `GEMINI.md`, `CLAUDE.md`, `AGENTS.md` — current governance stubs (**kludge**, not the target architecture)
13. `.gwrkrc.json` — current agent config shape

---

## Output Contract

The research document MUST produce:

1. **Agent manifest schema** — complete YAML schema with sample manifests for Claude, Codex (local), Codex (cloud), Gemini. Codex Cloud manifest must use `dispatchMode: github-integration`, NOT `cli`/`invocation` fields.
2. **Contrast table** — agent manifest vs skill manifest (shared fields, divergent fields, why)
3. **Adapter lifecycle diagram** — install → register → syncGovernance → dispatch → parseResult → teardown. Must note that dispatch/parseResult phases differ for local-cli vs github-integration dispatch modes.
4. **Config conflict detection design** — data model, detection algorithm, `gwrk plugin check` output format
5. **Governance sync design** — `.gwrk/agent-context.md` is the source (per ADR-006 §2.2). Include: format spec, bootstrap mechanism (`gwrk init` template + migration from `.agents/rules/`), per-adapter generation rules, boundary marker strategy for CLI context files.
6. **Exit code normalization table** — complete mapping per backend (from cli-backend-research) → `TaskResult` fields
7. **Migration path** — current `agent.ts` → plugin-based dispatch, annotated with cut points
8. **`dispatchMode` discriminator design** — how local-cli and github-integration backends coexist under the `AgentBackend` interface. Interface evolution path (Phase 1: local-cli only for F014, Phase 2: `CloudAgentBackend` when Codex Cloud ships as separate feature).
9. **`WorkflowRuntime` Schema** — distinct from `SkillRuntime`. How Workflows define JSON-schema output contracts for File I/O.
10. **Filesystem Decoupling Plan** — how to migrate `define` commands and shell scripts off IDE-sandbox reliance into native TypeScript orchestrators catching JSON intents.
11. **F014 spec alignment notes** — explicit list of Layer 1 & 2.5 FRs that must be added, L2 FRs that must be updated.
12. **Architecture.md amendments** — specific text for §7, §8, §14 updates.

---

## Anti-Patterns

- ❌ Do NOT treat `.agents/rules/workspace.md` as the canonical governance source — it's a temporary kludge. `.gwrk/agent-context.md` is the target per ADR-006.
- ❌ Do NOT assume Codex Cloud is a CLI command — it's a web/GitHub/Slack integration. There is no `codex run --cloud`.
- ❌ Do NOT spec F014 in this document — this is research. The spec consumes this.
- ❌ Do NOT conflate L1 (Agent Backends) with L2 (Skills) or L3 (Extensions) — stay in lane
- ❌ Do NOT invent config or manifest fields without checking what ADR-006 and `cli-backend-research-report.md` already established
- ❌ Do NOT ignore the current `agent.ts` implementation — the migration path is a deliverable
- ❌ Do NOT reference `codex-lab.md` — it has been deleted and superseded by `codex-cloud-research-report.md`
