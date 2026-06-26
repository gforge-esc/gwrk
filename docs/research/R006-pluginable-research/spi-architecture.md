# R006 Supplement — Stable Plugin Interface (SPI) Architecture

> **Status:** Draft — Awaiting Spec-Ready  
> **Date:** 2026-06-26  
> **Parent:** [R006 Brief](brief.md), [R006 Draft](draft.md)  
> **Origin:** Game-theory reasoning skills investigation → plugin architecture deep dive  
> **Consumer:** ADR-006 amendment, F014 Plugin System spec update, future reasoning/skills features

---

## Context

R006 established that research methodologies are workflow plugins dispatched through `WorkflowRuntime`. During an investigation into adding game-theoretic reasoning skills (incentive-compatibility, equilibrium-diagnosis, etc.) as pluggable capabilities, a deeper question emerged: **what is the stable boundary of gwrk as an OS?**

The [Windows/Linux API Analysis](references/Architectural%20Analysis_%20Core%20Differences%20Between%20Windows%20and%20Linux%20APIs.md) provided the architectural frame: both Linux and Windows NT succeed by drawing a clear stability line — Linux at the syscall ABI, Windows at the Win32 DLL layer. gwrk already has this structure. It just hasn't named it.

This supplement formalizes what exists as the **Stable Plugin Interface (SPI)** and establishes the design principles that govern its extension.

---

## The gwrk Stable Boundary

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

The SPI layer — `PluginLoader`, `WorkflowRuntime`, `resolveEnforcementSkills`, `resolveExtensionContext`, `detectProfile`, `conditionPrompt`, `dispatchToAgent` — is already the stable boundary. Every plugin type (agent, skill, workflow, extension, channel, review) interacts with gwrk exclusively through these interfaces.

---

## The SPI Architecture

```
gwrk SPI Architecture
│
├── ROUTING LAYER (CLI)                          ← Thin, stable, fixed
│   ├── Foxtrot Charlie: define, ship, test, gate, measure
│   └── Operations: init, tasks, plan, plugin, status, ...
│
├── STABLE PLUGIN INTERFACE (SPI)                ← The contract
│   ├── WorkflowRuntime                          ← Methodology dispatch
│   │   ├── gwrk-specify          (define spec)
│   │   ├── gwrk-implement        (ship implement)
│   │   ├── gwrk-review-code      (ship review)
│   │   ├── gwrk-research-*       (define research --methodology X)
│   │   ├── gwrk-reasoning-*      (define reasoning --modes X)
│   │   └── [project-local overrides via resolution chain]
│   │
│   ├── EnforcementSkillRuntime                  ← Behavioral injection
│   │   ├── scope: implementation | review | diagnostic | all
│   │   ├── language: TypeScript | Python | Rust | ...
│   │   ├── framework: React | Django | Express | ...
│   │   └── [project-local skills via resolution chain]
│   │
│   ├── ExtensionRuntime                         ← Context injection
│   │   └── ContextProvider interface (Obsidian, Jira, etc.)
│   │
│   ├── ProfileDetector                          ← Project identity
│   │   ├── Filesystem markers (auto-detect)
│   │   └── .gwrkrc.json overrides (explicit)
│   │
│   └── AgentRouter                              ← Backend dispatch
│       ├── Agent backends (agy, gemini, claude, codex)
│       └── Model selection (capability → model mapping)
│
└── CORE INTERNALS (PRIVATE)                     ← Can change freely
    ├── ShipOrchestrator (state machine)
    ├── PlanSolver (DAG resolution)
    ├── PromptAssembly (conditioning + enforcement + grounding + extension + safety)
    └── GateRunner (execution model)
```

### Key Architectural Principles

1. **The CLI is not the extension point.** The CLI is a stable routing layer. Plugin power comes from what's behind the routes, not from adding new routes. No dynamic command registration.

2. **WorkflowRuntime is the universal dispatch.** Research, reasoning, spec generation, implementation, review — they're all workflow dispatch. Different PROMPT.md files. Different grounding context. Same execution model.

3. **Enforcement skills are the universal modifier.** They're the primary mechanism for project-specific behavior. A Python project doesn't need new commands — it needs Python-aware enforcement skills that modify every existing command.

4. **The resolution chain is the override mechanism.** `Project-local > Global > Builtin`. This is how a project "mutates" gwrk — not by editing core code, but by placing a higher-priority plugin in the resolution chain.

---

## Design Principle: No Magic Values

> *"I hate debugging magic values of any kind in any setting."*

Every reasoning constraint the agent follows must be traceable to a **configured enforcement skill**, a **grounding document**, or a **workflow PROMPT.md** — never to opaque model training weights.

| Layer | Magic Values (Bad) | Explicit Configuration (Good) |
|-------|-------------------|-------------------------------|
| **Enforcement** | Hardcoded coding standards in PROMPT.md | `.gwrk/plugins/skills/conventions/SKILL.md` |
| **Grounding** | Domain terms embedded in workflow prompts | `.gwrk/ontology/domain.md` |
| **Reasoning** | Model decides how to analyze a problem | `gwrk define reasoning --modes X` dispatches explicit methodology |
| **Profile** | Hardcoded `if (language === "Python")` guards | `.gwrkrc.json` declares profile, enforcement skills auto-filter |
| **Agent** | Hardcoded model selection per command | `AgentRouter` selects based on capability mapping in agent manifest |

The SPI's stability contract includes this transparency guarantee: a principal architect can audit every behavioral influence on any gwrk command by inspecting the plugin resolution chain, the project profile, and the grounding documents.

---

## Resolved Decisions

| Decision | Resolution | Rationale |
|----------|-----------|-----------|
| Reasoning placement | `gwrk define reasoning` | Same dispatch pattern as research. Both are pre-definition cognitive work. Cross-cutting DIAGNOSE use is handled via `scope: diagnostic` enforcement skills. |
| SPI versioning | Independent of gwrk semver | SPI version tracks the plugin contract. gwrk version tracks the CLI/kernel. UX transparency is critical — principal architects, contributors, and users must see which SPI version a plugin targets. |
| `scope: "diagnostic"` | Confirmed | Small schema change to `manifest.ts`. Unlocks DIAGNOSE integration without touching the ship orchestrator. |
| Profile-driven enforcement | Confirmed | `.gwrkrc.json` declaring `stack.language: Python` should automatically filter enforcement skills to `language: Python`. |

---

## ADR Impact Assessment

### ADR-006: Plugin Agent Backends — **AMEND**

ADR-006 defines a "Three-Layer Plugin Architecture" (§7) that is now superseded by the SPI model:

**Current (ADR-006 §7):**
```
Layer 1: Agent Backend Plugins (ADR-006)
Layer 2: Skill Plugins (F014)
Layer 3: Extension Plugins (TBD)
```

**Proposed amendment:** Replace the three-layer model with the SPI architecture. The SPI formalizes:
- `AgentRouter` (was Layer 1)
- `WorkflowRuntime` + `EnforcementSkillRuntime` (was Layer 2, now split)
- `ExtensionRuntime` (was Layer 3, now implemented)
- `PluginLoader` + `ProfileDetector` + `PromptConditioner` (new — not covered in any layer)

ADR-006's `AgentBackend` interface (§2.1) remains valid. What changes is its position in the architecture — it's one of 7 SPI interfaces, not the top of a stack.

**Specific changes needed:**
- Replace §7 "Three-Layer Plugin Architecture" with the SPI diagram
- Add reference to SPI versioning contract
- Cross-reference enforcement skill `scope: diagnostic` as a new dispatch path
- Update "Layer 3: Not yet specified" — extensions are implemented (`extension-runtime.ts`)

### ADR-007: Single Dispatch Path — **STRENGTHEN**

ADR-007 established that all workflow dispatch flows through `WorkflowRuntime`. The SPI architecture **elevates this from a single decision to a core architectural principle**. ADR-007 should be amended to:
- Reference the SPI as the formal name for the stable boundary
- State that `WorkflowRuntime` is one of 7 named SPI interfaces
- Declare that the `.agents/` deprecation is permanent — the SPI is the successor

### ADR-009: Domain Ontology — **CROSS-REFERENCE**

ADR-009 established that projects declare knowledge layers (ontology, information hierarchy, UX posture) as project-owned documents. The SPI architecture positions this as part of the behavioral injection surface — grounding documents injected via `conditionPrompt()`. ADR-009 should:
- Reference the SPI as the mechanism that injects ontology content
- Confirm `.gwrk/ontology/` as the storage path (consistent with R006 draft recommendation)
- Cross-reference profile-driven enforcement (`.gwrkrc.json` → enforcement skill filtering)

### ADR-005: TDD Gate Architecture — **NO CHANGE**

Gates remain kernel-internal. The gate runner is part of CORE INTERNALS, not the SPI. No amendment needed.

### ADR-001, ADR-002, ADR-003, ADR-004, ADR-008 — **NO CHANGE**

These ADRs cover task tracking, SQLite ledger, state contracts, agent-native output, and command safety. None touch the SPI boundary. No amendments needed.

---

## What This Enables (Future Spec Inputs)

When shipping resumes, this research draft provides inputs for:

1. **F014 Plugin System spec update** — Add `scope: "diagnostic"` to enforcement skill schema, formalize SPI interfaces, add SPI version field to manifests.

2. **`gwrk define reasoning` subcommand** — New subcommand dispatching through WorkflowRuntime to `gwrk-reasoning-*` workflow plugins. Reasoning modes are installable methodology plugins, not hardcoded prompt fragments.

3. **DIAGNOSE integration** — Ship orchestrator's DIAGNOSE phase calls `resolveEnforcementSkills(cwd, "diagnostic", profile)` to inject reasoning-mode skills at iteration ≥ 2.

4. **Profile-driven enforcement filtering** — `detectProfile()` output used to auto-filter enforcement skills by `language`/`framework` without manual configuration.

5. **SPI documentation** — Formal documentation of the 7 stable interfaces as a versioned contract. This is governance work, not code work.

---

## References

| Document | Role |
|----------|------|
| [R006 Brief](brief.md) | Parent research initiative |
| [R006 Draft](draft.md) | Workflow plugins as the extension model |
| [Windows/Linux API Analysis](references/Architectural%20Analysis_%20Core%20Differences%20Between%20Windows%20and%20Linux%20APIs.md) | "Where is the stable boundary?" |
| [Reasoning Skills Reference](references/cowork-w-reasoning-skills.md) | Reasoning → draft pipeline proof |
| [ADR-006](../../decisions/ADR-006-plugin-agent-backends.md) | Three-layer model → SPI amendment |
| [ADR-007](../../decisions/ADR-007-single-dispatch-path.md) | WorkflowRuntime as single dispatch path |
| [ADR-009](../../decisions/ADR-009-domain-ontology-information-hierarchy-ux.md) | Ontology as project knowledge |
| [loader.ts](../../src/plugins/loader.ts) | 3-tier resolution chain |
| [manifest.ts](../../src/plugins/manifest.ts) | Plugin taxonomy + enforcement scope |
| [extension-runtime.ts](../../src/plugins/extension-runtime.ts) | ContextProvider interface |
| [skill-runtime.ts](../../src/plugins/skill-runtime.ts) | Enforcement skill resolution |
| [profile-detector.ts](../../src/engine/profile-detector.ts) | Auto-detection + override |
