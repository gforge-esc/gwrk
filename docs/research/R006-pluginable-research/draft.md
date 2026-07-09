# R006 Draft — Pluginable Research Workflow

> **Status:** Draft — Awaiting Review
> **Initiative:** [R006 brief](brief.md)
> **Consumer:** F014 Plugin System, `gwrk define research` CLI surface
> **Reference:** [Gonzo Feature Research Brief v2](references/gonzo-feature-research-brief-v2.md)

---

## Executive Summary

Research is gwrk's upstream feeder to definition. Today, `gwrk-research` is a single builtin workflow PROMPT.md that implements one methodology: "read the brief, read inputs, answer questions, produce a draft." This works for technical architecture investigations (R001–R005) but cannot support JTBD research, market landscape analysis, domain ontology construction, or building a business case — methodologies that have fundamentally different inputs, prompts, and outputs.

The recommendation is: **research plugins are workflow plugins** — not a new plugin type. The existing `WorkflowRuntime` already handles plugin resolution, PROMPT.md loading, enforcement injection, and JSON intent parsing. Research methodologies are dispatched as named workflows with methodology-specific prompts, grounding context, and output schemas. The brief template itself (the Gonzo Feature Research Brief v2) becomes a **grounding reference** installed alongside the workflow plugin, not embedded in the PROMPT.md.

Domain ontology construction (Pack C from the brief template) is elevated to a **first-class research workflow** — independent from feature research briefs but deeply connected. A project's domain ontology feeds into every research brief and every feature spec. This is the bridge between R006 (research) and R007 (project perspective).

---

## Q1: Plugin Geometry for Research

### Findings

The existing plugin system (F014) supports three plugin types relevant to research:

| Plugin Type | How it dispatches | Output mechanism | Multi-file? |
|---|---|---|---|
| **Workflow** (`gwrk-research`) | `WorkflowRuntime.executeWorkflow()` → agent dispatch | Agent writes files directly | ✅ Yes |
| **Skill** (`gwrk-conventions`) | Injected into prompt stdin | stdout only | ❌ No |
| **Compound skill** | Multi-pass in one LLM call | stdout only | ❌ No |

Research produces multi-file output: `draft.md`, possibly `artifacts/`, ontology fragments, journey maps. Only workflow plugins support this.

A new plugin type (`research-pack`) was considered but rejected: it would require new schema, new resolver, new test surface — all for a dispatch pattern that already exists in `WorkflowRuntime`.

### Recommendation: Workflow plugins

Research methodologies are **named workflow plugins**. Each methodology gets its own PROMPT.md with methodology-specific prompts, but shares the same brief → draft lifecycle.

```
~/.gwrk/plugins/workflows/
  gwrk-research/                ← Default: technical architecture research (current)
    PROMPT.md
    manifest.yaml
  gwrk-research-jtbd/           ← JTBD methodology
    PROMPT.md                   ← Uses forces map, switching behavior, job stories
    manifest.yaml
    references/
      jtbd-synthesis-prompt.md  ← Pack G1 from the Gonzo Brief
  gwrk-research-ontology/       ← Domain ontology construction
    PROMPT.md                   ← Uses Pack C primitives (classes, properties, relations, axioms)
    manifest.yaml
    references/
      ontology-extraction-prompt.md  ← Pack G4 from the Gonzo Brief
```

The manifest declares the research methodology type:

```yaml
# manifest.yaml for JTBD research
type: workflow
name: gwrk-research-jtbd
category: research                     # marks it as a research methodology
methodology: jtbd                      # human-readable methodology name
brief_template: gonzo-feature-research-brief-v2   # which brief template to validate against
output_contract:
  - draft.md                           # required output
  - artifacts/forces-map.md            # methodology-specific artifacts
```

---

## Q2: Research CLI Surface

### Findings

Three options were evaluated:

| Option | Command | Grammar fit | Semantic clarity |
|---|---|---|---|
| Under `define` | `gwrk define research <initiative>` | ✅ Research is pre-definition | ✅ Clear |
| New pillar | `gwrk discover <initiative>` | ⚠️ Adds top-level command | ✅ Maps to FC "Truth" pillar |
| Under `plugin` | `gwrk plugin run research <initiative>` | ❌ Generic | ❌ Loses meaning |

### Recommendation: `gwrk define research`

Research is pre-definition work — it feeds `gwrk define spec`. Keeping it under `define` preserves the CLI grammar's pillar structure (Discovery → Definition → Shipping → Delivery).

**The research command follows the same pattern as `gwrk define spec`** ([specify.ts L64-72](../../../src/commands/specify.ts#L64-L72)): the user provides a **name**, not a number. The number (`R008`, `R009`, ...) is auto-incremented by the same [`getNextFeatureNumber()`](../../../src/utils/scaffold-feature.ts#L136-L158) pattern that specs use — scanning `docs/research/` for the highest existing `R0XX-*` directory and incrementing.

```bash
# Create new research initiative (auto-numbered → R008-pluginable-research)
gwrk define research "Pluginable Research Workflow"

# Create with explicit methodology
gwrk define research "User Switching Behavior" --methodology jtbd

# Domain ontology construction (independent workflow)
gwrk define research "EnergyWork Domain Model" --methodology ontology

# Run existing initiative by ID or slug (like `gwrk define spec 014`)
gwrk define research R006
gwrk define research pluginable-research

# List available research methodologies
gwrk define research --list-methodologies
```

The `--methodology` flag resolves to a workflow plugin name: `gwrk-research-<methodology>`. If omitted, uses `gwrk-research` (the default technical architecture methodology).

### Scaffolding flow (new initiative)

Just like `gwrk define spec "Add OAuth2 integration"` creates `specs/047-add-oauth2-integration/`, the research command creates `docs/research/R008-<slug>/` with a templated `brief.md`:

```
gwrk define research "User Switching Behavior" --methodology jtbd
  │
  ├── getNextResearchNumber("docs/research/")  → R008
  ├── generateSlug("User Switching Behavior")  → user-switching-behavior
  ├── Create docs/research/R008-user-switching-behavior/
  │     ├── brief.md (seeded from methodology template — JTBD sections pre-populated)
  │     └── references/ (empty)
  ├── Register in plan DB (status: RESEARCHING)
  └── Print: "Created: R008-user-switching-behavior"
```

### Dispatch flow (existing initiative)

```
gwrk define research R008 --run
  │
  ├── Resolve initiative: docs/research/R008-user-switching-behavior/
  ├── Validate brief.md exists
  ├── Read brief frontmatter → methodology: jtbd
  ├── Resolve workflow: gwrk-research-jtbd
  ├── Load PROMPT.md from plugin
  ├── Inject brief.md path as context
  ├── Inject project domain ontology (if exists) as grounding
  ├── Dispatch via WorkflowRuntime
  └── Agent reads brief, executes methodology, writes draft.md
```

---

## Q3: Brief Schema Standardization

### Findings

The Gonzo Feature Research Brief v2 defines a structured format with:
- **Brief Control** (L82–93): metadata table with status, mode, owner, dates
- **Decision Options** (L111–117): Stop / Park / Probe / Prototype / Move to PRD
- **Optional Packs** (A–H): invoked by need, not by ritual

Current briefs (R001–R007) are freeform markdown. They share a loose convention (`## Objective`, `## Questions to Answer`, `## Output Contract`) but no enforced schema.

### Recommendation: Zod-validated YAML frontmatter + freeform body

Standardize the control metadata as YAML frontmatter. Keep the body freeform — the brief template provides structure but shouldn't be rigidly enforced.

```yaml
---
title: Pluginable Research Workflow
methodology: technical    # which workflow plugin to dispatch
created: 2026-06-02
updated: 2026-06-02
---
```

This enables:
- **Methodology routing**: `gwrk define research R006` reads `methodology` to pick the right workflow plugin

---

## Q4: Research Output as Spec Input

### Findings

Today: `gwrk define spec --refs docs/research/R006/draft.md` (manual path specification). This works and is explicit.

### Recommendation: `--refs` is the handoff

```bash
gwrk define spec 014 --refs docs/research/R006-pluginable-research/draft.md
```

The research → spec handoff is a human decision, not an automated one. The user knows which research feeds which spec. `--refs` is the mechanism. No auto-discovery needed — it would require forward-biasing the brief with a `consumer` field at creation time, which presumes knowledge we don't have.

---

## Q5: Domain Ontology as Independent Research Workflow

### Findings (from user direction)

Domain ontology construction is:
1. **Independent from feature research briefs** — an ontology models the project's domain, not a specific feature
2. **Connected to research and specs** — an ontology feeds into every research brief (Section 5: Domain Boundary) and every spec
3. **Optional but powerful** — not every project needs one, but projects that have one get dramatically better research briefs and specs
4. **Project-scoped** — the ontology belongs to the project, not to gwrk

The Gonzo Brief v2 already defines the ontology primitives in Pack C:
- **Classes** (C2): kinds of things, not instances
- **Properties** (C3): identifier, intrinsic, state, derived, extrinsic
- **Relations** (C4): typed edges with cardinality and direction
- **Axioms** (C5): rules stating what must always/never be true
- **Glossary** (C6): term disambiguation
- **Failure Scan** (C7): overloading, undergeneralizing, missing middle, etc.

### Recommendation: `gwrk-research-ontology` workflow + `.gwrk/ontology/` storage

Domain ontology construction is a first-class research workflow:

```bash
# Construct or update project domain ontology
gwrk define research --methodology ontology

# This reads:
#   .gwrk/ontology/domain.md (if exists — iterative refinement)
#   docs/research/*/draft.md (existing research as input)
#   Codebase analysis (extract domain concepts from code)
#
# This writes:
#   .gwrk/ontology/domain.md (the ontology document)
#   .gwrk/ontology/glossary.md (term disambiguation)
```

The ontology is stored in `.gwrk/ontology/` (project-local) and injected as grounding context into:
- Research workflows (when `domain_ontology` frontmatter is set, or auto-discovered from `.gwrk/ontology/`)
- Spec workflows (injected alongside enforcement skills)
- Implement workflows (injected as domain context so agents understand the project's vocabulary)

```
.gwrk/
  ontology/
    domain.md       ← Pack C output: classes, properties, relations, axioms
    glossary.md     ← Pack C6: term disambiguation
  plugins/
    skills/
      ...
  rules/
    ...
```

### Ontology ↔ Research Brief interaction

```mermaid
flowchart LR
    A["Project Domain Ontology\n.gwrk/ontology/domain.md"] -->|"grounding context"| B["Research Brief\nSection 5: Domain Boundary"]
    B -->|"refines/extends"| A
    A -->|"grounding context"| C["Feature Spec\nspec.md domain constraints"]
    C -->|"validates against"| A
```

The ontology is a living document — each research brief and spec cycle may extend or refine it. The `gwrk-research-ontology` workflow supports both initial construction and iterative refinement.

---

## Plugin Manifest Example: JTBD Research

```yaml
# ~/.gwrk/plugins/workflows/gwrk-research-jtbd/manifest.yaml
type: workflow
name: gwrk-research-jtbd
version: "1.0"
category: research
methodology: jtbd
description: >
  Jobs-to-Be-Done research methodology. Extracts progress under pressure,
  switching forces, hiring/firing criteria, and functional/social/emotional
  progress from interview notes and field observations.
brief_template: gonzo-feature-research-brief-v2
required_packs:
  - core         # Sections 0-7 (always)
  - pack_a       # Actor and Buying Committee Map
  - pack_g       # Agentic Research Prompts (G1: JTBD Interview Synthesis)
optional_packs:
  - pack_b       # UX Journey / Surface Map
  - pack_f       # GTM / Field Validation
output_contract:
  - draft.md
  - artifacts/forces-map.md
  - artifacts/job-stories.md
```

---

## CLI Integration Sketch

```typescript
// src/commands/define.ts — add 'research' subcommand

defineCommand
  .command("research <initiative>")
  .description("Run a research initiative")
  .option("--methodology <name>", "Research methodology (default: technical)")
  .option("--list-methodologies", "List available research workflows")
  .action(async (initiative, options) => {
    if (options.listMethodologies) {
      // Scan plugins for category: research workflows
      const loader = new PluginLoader();
      const plugins = await loader.listPlugins({ category: "research" });
      // Display table: name, methodology, description
      return;
    }

    const methodology = options.methodology || "technical";
    const workflowName = methodology === "technical"
      ? "gwrk-research"
      : `gwrk-research-${methodology}`;

    const briefDir = resolveResearchInitiative(initiative);  // R006 → docs/research/R006-*/
    const briefPath = path.join(briefDir, "brief.md");

    // Inject domain ontology if present
    const ontologyPath = path.join(process.cwd(), ".gwrk/ontology/domain.md");
    const ontologyContext = fs.existsSync(ontologyPath)
      ? fs.readFileSync(ontologyPath, "utf-8")
      : "";

    await dispatchToAgent({
      workflow: workflowName,
      workDir: process.cwd(),
      prompt: `Research initiative: ${briefDir}`,
      stdin: [
        ontologyContext ? `<domain_ontology>\n${ontologyContext}\n</domain_ontology>` : "",
        `<research_brief>\n${fs.readFileSync(briefPath, "utf-8")}\n</research_brief>`,
      ].filter(Boolean).join("\n\n"),
    });
  });
```

---

## Q6: The Stable Plugin Interface (SPI) — Architectural Model

### Context

Q1–Q5 established that research methodologies are workflow plugins dispatched through `WorkflowRuntime`. During a follow-on investigation into adding game-theoretic reasoning skills as pluggable capabilities, a deeper question emerged: **what is the stable boundary of gwrk as an OS?**

The [Windows/Linux API Analysis](references/Architectural%20Analysis_%20Core%20Differences%20Between%20Windows%20and%20Linux%20APIs.md) provided the frame: both Linux and Windows NT succeed by drawing a clear stability line — Linux at the syscall ABI, Windows at the Win32 DLL layer. gwrk already has this structure. It just hasn't named it.

### The gwrk Stable Boundary

```
┌─────────────────────────────────────────────────┐
│                 USER / CLI                       │  ← "Applications"
│  gwrk define research R006                      │
│  gwrk ship 014                                  │
│  gwrk define reasoning specs/017 --modes ...    │
└─────────────────────────────┬───────────────────┘
                              │
                    ══════════╪══════════════════════  ← THE STABLE BOUNDARY
                              │
┌─────────────────────────────┴───────────────────┐
│           STABLE PLUGIN INTERFACE (SPI)          │
│                                                  │
│  PluginLoader.resolvePlugin(name)               │  ← Plugin resolution chain
│  WorkflowRuntime.executeWorkflow(name, input)   │  ← Workflow dispatch
│  resolveEnforcementSkills(cwd, scope, profile)  │  ← Behavioral injection
│  resolveExtensionContext(cwd, keywords)         │  ← Context injection
│  detectProfile(projectRoot)                     │  ← Profile detection
│  conditionPrompt(template, profile)             │  ← Prompt conditioning
│  dispatchToAgent(config)                        │  ← Agent routing
└─────────────────────────────┬───────────────────┘
                              │
                    ══════════╪══════════════════════  ← PRIVATE / UNSTABLE
                              │
┌─────────────────────────────┴───────────────────┐
│              CORE INTERNALS (KERNEL)             │
│                                                  │
│  ShipOrchestrator state machine                 │  ← Can change freely
│  Plan DAG solver                                │  ← Can change freely  
│  Prompt assembly chain                          │  ← Can change freely
│  Gate runner execution model                    │  ← Can change freely
│  Agent backend protocol                         │  ← Can change freely
└─────────────────────────────────────────────────┘
```

### Architectural Principles

1. **The CLI is not the extension point.** The CLI is a stable routing layer. Plugin power comes from what's behind the routes (workflow resolution), not from adding new routes (no dynamic command registration).

2. **WorkflowRuntime is the universal dispatch.** Research, reasoning, spec generation, implementation, review — all workflow dispatch. Different PROMPT.md files, different grounding context, same execution model.

3. **Enforcement skills are the universal modifier.** A project doesn't need new commands — it needs project-aware enforcement skills that modify every existing command via `scope: all`.

4. **The resolution chain is the override mechanism.** `Project-local > Global > Builtin`. A project "mutates" gwrk by placing a higher-priority plugin in the resolution chain.

### Design Principle: No Magic Values

Every reasoning constraint the agent follows must be traceable to a **configured enforcement skill**, a **grounding document**, or a **workflow PROMPT.md** — never to opaque model training weights.

| Layer | Magic Values (Bad) | Explicit Configuration (Good) |
|-------|-------------------|-------------------------------|
| **Enforcement** | Hardcoded coding standards in PROMPT.md | `.gwrk/plugins/skills/conventions/SKILL.md` |
| **Grounding** | Domain terms embedded in workflow prompts | `.gwrk/ontology/domain.md` |
| **Reasoning** | Model decides how to analyze a problem | `gwrk define reasoning --modes X` dispatches explicit methodology |
| **Profile** | Hardcoded `if (language === "Python")` guards | `.gwrkrc.json` declares profile, enforcement skills auto-filter |
| **Agent** | Hardcoded model selection per command | `AgentRouter` selects based on capability mapping in agent manifest |

### How Reasoning Fits (Same Pattern as Research)

```bash
gwrk define reasoning specs/017 --modes equilibrium-diagnosis
#     │      │                          │
#     │      │                          └── Resolves to enforcement skills + reasoning prompt
#     │      └── Subcommand: dispatches to WorkflowRuntime
#     └── Pillar: Definition

gwrk define reasoning --list-modes          # Scans skills matching reasoning-*
```

Reasoning is a subcommand of `define` — same pattern as research. Both are pre-definition cognitive work. Both dispatch through `WorkflowRuntime`. Both use plugin resolution for methodology selection.

---

## Q7: ADR Impact Assessment

The SPI model affects three existing ADRs:

### ADR-006: Plugin Agent Backends — AMEND

ADR-006 §7 defines a "Three-Layer Plugin Architecture" that is superseded by the SPI model:

**Current:**
```
Layer 1: Agent Backend Plugins (ADR-006)
Layer 2: Skill Plugins (F014)
Layer 3: Extension Plugins (TBD)
```

**Proposed amendment:** Replace with the SPI architecture. The SPI formalizes `AgentRouter` (was Layer 1), `WorkflowRuntime` + `EnforcementSkillRuntime` (was Layer 2, now split), `ExtensionRuntime` (was Layer 3, now implemented), and `PluginLoader` + `ProfileDetector` + `PromptConditioner` (new — not covered in any layer).

ADR-006's `AgentBackend` interface (§2.1) remains valid — it's one of 7 SPI interfaces, not the top of a stack.

### ADR-007: Single Dispatch Path — STRENGTHEN

ADR-007 established that all workflow dispatch flows through `WorkflowRuntime`. The SPI architecture elevates this from a single decision to a core architectural principle. ADR-007 should reference the SPI as the formal name for the stable boundary.

### ADR-009: Domain Ontology — CROSS-REFERENCE

ADR-009 established that projects declare knowledge layers as project-owned documents. The SPI positions this as part of the behavioral injection surface — grounding documents injected via `conditionPrompt()`. ADR-009 should reference the SPI as the injection mechanism and confirm profile-driven enforcement (`.gwrkrc.json` → skill filtering).

### ADR-001, 002, 003, 004, 005, 008 — NO CHANGE

These cover task tracking, SQLite ledger, state contracts, agent-native output, TDD gates, and command safety. None touch the SPI boundary.

---

## Resolved Decisions

| Decision | Resolution | Rationale |
|----------|-----------|-----------|
| Ontology storage | `.gwrk/ontology/` | Confirmed. Project-local, injected as grounding. |
| Reasoning placement | `gwrk define reasoning` | Same dispatch pattern as research. Cross-cutting DIAGNOSE use via `scope: diagnostic` enforcement skills. |
| SPI versioning | Independent of gwrk semver | SPI version tracks the plugin contract. gwrk version tracks the CLI/kernel. UX transparency critical for principal architects, contributors, and users. |
| `scope: "diagnostic"` | Confirmed | Small schema change to `manifest.ts`. Unlocks DIAGNOSE integration. |
| Profile-driven enforcement | Confirmed | `.gwrkrc.json` `stack.language` auto-filters enforcement skills. |
| Community registry | Deferred | No registry infrastructure exists. |

---

## Spec Alignment Notes

- F014 spec needs amendment: add `category: research` to manifest schema
- F014 spec needs amendment: add `scope: "diagnostic"` to enforcement skill schema
- F014 plugin loader needs `listPlugins({ category })` filter
- `gwrk define` command needs `research` subcommand
- `gwrk define` command needs `reasoning` subcommand (same pattern)
- `WorkflowRuntime` needs ontology injection (similar to enforcement injection)
- SPI interfaces need formal documentation as a versioned contract
- ADR-006 §7 needs amendment (three-layer → SPI)
- ADR-007 needs strengthening (reference SPI)
- ADR-009 needs cross-reference (injection mechanism)

