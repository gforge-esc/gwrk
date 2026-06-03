# Research Initiative: R007 — Project Perspective & Enforcement Skills

> **Status:** Active — Feature A shipped, Feature B + ontology construction in progress
> **Consumer:** F014 Plugin System (enforcement skills, project overrides)
> **Related:** R006 (pluginable research) — same plugin resolution chain, different concern
> **Output:** `docs/research/R007-project-perspective/draft.md`
> **Origin:** Daily-driver audit session 2026-06-02, Section M.3

---

## Objective

Design how gwrk establishes **project perspective** — the code-smell conventions, linting standards, architecture grounding, and quality gates that define "how we build" for any given project. Today this works for gwrk (via `_isGwrk` flag and `gwrk-native` type guards) but has no mechanism for non-gwrk projects. This is the single most important use case for project overrides in F014.

---

## Context (Collected Thoughts)

### The gap today

gwrk's project understanding is split across two systems that don't connect:

1. **Profile detector** (`src/engine/profile-detector.ts`) — auto-detects stack from filesystem markers (`package.json`, `Cargo.toml`, `pyproject.toml`). Outputs `ProjectProfile` with `type`, `stack`, `layout`. This is **passive observation** — it tells you what language and build system you're looking at.

2. **Enforcement skills** (`tier: enforcement`) — `gwrk-conventions` and `typescript-standards` are injected into implement prompts via `{{enforcement}}`. These are **active rules** — they tell the agent how to write code. But they're gwrk-specific builtins with no project override mechanism.

3. **Prompt conditioner** (`src/engine/prompt-conditioner.ts`) — resolves `[type: gwrk-native]` / `[type: generic]` guards. Injects `<project_profile>` XML. But the only custom type is `gwrk-native` — every other project gets `generic` fallback content.

The result: an agent working on EnergyWork (Python + React + Go polyglot) gets a `ProjectProfile` that says `"python"` with no Django conventions, no Go idioms, no React patterns, no architecture grounding. The enforcement skills it receives are gwrk's TypeScript standards — wrong language, wrong project.

### What project perspective actually means

For a polyglot codebase like EnergyWork, an agent needs to know:

| Concern | Example | Where it lives today |
|---------|---------|---------------------|
| **Stack conventions** | "Django models use `TimeStampedModel` base, Go services use `chi` router" | Nowhere — agent discovers ad hoc |
| **Code-smell rules** | "No raw SQL in views, all queries go through managers" | Nowhere |
| **Architecture grounding** | "3 services: API (Django), Worker (Go), Frontend (React/Next)" | Maybe a README.md, not structured |
| **Quality gates** | "Python: black + ruff, Go: golangci-lint, JS: biome" | CI config (not agent-visible) |
| **Naming conventions** | "Django apps use snake_case, React components PascalCase" | Team knowledge, not codified |

All of these are **enforcement skills** scoped to the project. The F014 spec already defines the resolution order: project-local (`.gwrk/plugins/`) → global builtins. The gap is:

1. **No project-local skill authoring flow** — `gwrk init` doesn't scaffold enforcement skills
2. **No profile-to-enforcement routing** — the profile detector and enforcement resolver don't talk to each other. A Python project still gets `typescript-standards` because there's no filter
3. **No architecture grounding document** — `docs/grounding/architecture.md` works for gwrk because gwrk put it there. For other projects, agents need a way to discover or generate this

### Why this is project-agnostic gwrk

This isn't about gwrk knowing every framework — it's about gwrk providing a **scaffold for projects to declare their own standards**. The framework is:

```
.gwrk/
  plugins.yaml          ← project-level plugin overrides
  plugins/
    skills/
      django-standards/
        SKILL.md         ← "all models inherit TimeStampedModel..."
        manifest.yaml    ← tier: enforcement, scope: implementation
      go-service-patterns/
        SKILL.md         ← "chi router, structured logging..."
        manifest.yaml
      react-conventions/
        SKILL.md         ← "functional components, no class components..."
        manifest.yaml
```

gwrk doesn't need to ship Django or Go skills. It needs to ship **the mechanism** for projects to declare and enforce their own skills.

### The profile → enforcement routing problem

Today, enforcement skills are loaded unconditionally — every enforcement skill found in builtins + project-local gets injected into every implement prompt. This means:

- A Python project gets `typescript-standards` (wrong)
- A monorepo gets all skills for all languages (noisy)

The resolver needs a **matching step**: only inject enforcement skills whose declared `scope.language` or `scope.framework` matches the detected `ProjectProfile`. This is the connection point between the two systems.

### Connection to research plugins (R006)

R006 asks "what research methodology should we use?" — that's project-scoped too. Both enforcement skills and research plugins use the same resolution chain:

```
project-local (.gwrk/plugins/) → global (~/.gwrk/plugins/) → builtins
```

The key insight: **enforcement = "how we build"**, **research = "what we build"**. Both are project perspective. Both should be first-class plugin concerns in F014.

---

## Questions to Answer

### Q1: Project perspective authoring

How does a user create project-scoped enforcement skills?

| Approach | Pros | Cons |
|----------|------|------|
| `gwrk init` scaffolds `.gwrk/plugins/skills/` with stack-detected templates | Low friction, immediate value | Templates may not match team conventions |
| `gwrk plugin create <name> --tier enforcement` | Explicit, composable | Requires user to know the plugin system |
| Agent-generated from codebase analysis | Highest fidelity to actual conventions | Non-deterministic, may hallucinate standards |
| Import from community registry | Ecosystem effect | No registry exists yet |

### Q2: Profile → enforcement routing

How should the resolver filter enforcement skills by project profile?

```yaml
# manifest.yaml for a Django enforcement skill
type: skill
name: django-standards
tier: enforcement
scope:
  language: Python
  framework: Django
```

Should the `resolveEnforcementSkills()` function:
- (a) Only inject skills whose `scope.language` matches `profile.stack.language`?
- (b) Inject all project-local skills (user explicitly put them there) but filter builtins by profile?
- (c) Use a priority system where project-local always wins, builtins only apply if no project-local exist?

### Q3: Architecture grounding for non-gwrk projects

`docs/grounding/architecture.md` is gwrk's architecture grounding — injected into prompts so agents understand the codebase. For non-gwrk projects:

| Option | How it works |
|--------|-------------|
| Manual: user writes `.gwrk/grounding/architecture.md` | Full control, high effort |
| Agent-generated: `gwrk init --discover` scans codebase and produces a draft | Low effort, may be wrong |
| Hybrid: agent generates, user edits and commits | Best of both |
| None: enforcement skills are sufficient | Simpler, but loses big-picture context |

### Q4: Polyglot routing

In a monorepo with Python, Go, and TypeScript:
- Should enforcement skills be loaded per-file (Go standards only for `.go` files)?
- Or per-project (all three language skills loaded into every prompt)?
- Or per-workspace (each package/service gets its own profile)?

### Q5: Escape from gwrk-specific builtins

The current builtins (`gwrk-conventions`, `typescript-standards`) are gwrk-specific. For non-gwrk projects:
- Should they be loaded at all? (Currently yes — unconditionally)
- Should `gwrk-conventions` be split into generic (commit messages, task management) vs. gwrk-specific (flamingo branding, spec conventions)?
- Should `typescript-standards` only load when `profile.stack.language === "TypeScript"`?

**Resolved:** `typescript-standards` now has `language: TypeScript` in its manifest. `resolveEnforcementSkills()` filters by profile. Shipped in Feature A.

### Q6: Ontology construction as a define workflow

ADR-009 shipped ontology *injection* (agent.ts reads `.gwrk/ontology/domain.md` at dispatch) and *scaffolding* (`gwrk init` creates empty dirs). But constructing an ontology is missing.

The [ontology-construction-prompt.hbs](references/ontology-construction-prompt.hbs) is a 486-line structured methodology prompt — the same shape as R006's research methodology workflows. Constructing an ontology is structurally identical to running a research methodology:

| | Research (R006) | Ontology Construction |
|---|---|---|
| CLI | `gwrk define research R00X --methodology jtbd --run` | `gwrk define ontology --run` |
| Dispatch | `WorkflowRuntime.executeWorkflow('gwrk-research-jtbd', ...)` | `WorkflowRuntime.executeWorkflow('gwrk-ontology-construct', ...)` |
| Source material | Reference docs | Codebase, specs, architecture docs |
| Output | `draft.md` | `domain.md`, `hierarchy.md`, `ux-posture.md` |

This needs to be part of the next round of shipping.

---

## Input Documents

- `src/engine/profile-detector.ts` — Current auto-detection logic
- `src/engine/prompt-conditioner.ts` — Type guard resolution
- `src/plugins/skill-runtime.ts` — `resolveEnforcementSkills()` (line 149)
- `src/utils/agent.ts` — `{{enforcement}}` injection (line 432)
- `src/plugins/builtins/skills/gwrk-conventions/SKILL.md` — Current gwrk-specific conventions
- `src/plugins/builtins/skills/typescript-standards/SKILL.md` — Current TS standards
- `specs/014-plugin-system/spec.md` — US-016, FR-014 enforcement skills spec
- `docs/grounding/architecture.md` — gwrk's own architecture grounding (the pattern)

## Anti-Patterns

- Do NOT hardcode framework-specific conventions into gwrk core
- Do NOT assume every project is a TypeScript monorepo
- Do NOT break existing gwrk-native enforcement (it works — extend, don't regress)
- Do NOT conflate profile detection (passive observation) with enforcement (active rules)
- Do NOT make enforcement skills mandatory — projects should work with zero config

---

## Output Contract

1. ~~**`draft.md`** — Design document covering Q1-Q5 with recommendations~~ ✅ Done
2. ~~**Profile → enforcement routing spec** — Matching algorithm for skill filtering~~ ✅ Shipped (Feature A)
3. **Ontology construction workflow** — `gwrk define ontology` CLI command + `gwrk-ontology-construct` methodology plugin. Reuses R006's WorkflowRuntime dispatch. See Q6.
4. **Project init scaffold** — What `gwrk init` should generate for a new project
5. **Migration path** — How existing `gwrk-conventions` and `typescript-standards` evolve to support non-gwrk projects


# Notes from daily-driver-audit.md

### N. Ship Loop Hardening (FM-4/5/6)

> **Spec reference**: [ship-failure-diagnosis.md](specs/004-ship-loop/refs/ship-failure-diagnosis.md)
> **Code**: [ship-orchestrator.ts](src/engine/ship-orchestrator.ts)

#### FM-4: Stale dist Detection → ~~gwrk-specific~~ → R007

**Disposition**: Not a ship loop concern — this is a project-perspective problem. A TypeScript project needs `dist/` freshness checks; Python doesn't have `dist/`; Go builds differently. This belongs in the project-scoped pre-flight system designed in R007 (enforcement skills).

**Status**: Deferred to R007.