# Research Initiative: R010 — Polyglot Monorepo Support

> **Status:** Draft Complete — Awaiting Review
> **Consumer:** F014 Plugin System (workspace detection, enforcement routing, plugin scaffolding)
> **Related:** R007 (project perspective — Q4 Polyglot Routing was left unanswered)
> **Output:** `docs/research/R010-polyglot-monorepo/draft.md`
> **Origin:** EnergyWork daily-driver session 2026-06-09 — `gwrk init` failed to model a Python + Go + React monorepo

---

## Objective

Design how gwrk understands and operates on **polyglot monorepos** — projects where multiple languages, frameworks, and build systems coexist in the same repository. Today gwrk's profile detector picks a single language winner and the entire enforcement/prompt pipeline operates on a lie. R007 identified this as Q4 and deferred it. This research resolves Q4 and extends it into workspace-aware detection, per-workspace enforcement routing, and enforcement skill scaffolding.

The motivating use case is EnergyWork: a project with Python (Django API), Go (worker services), and TypeScript (React frontend). Running `gwrk init` detects `nodejs` and loses Python and Go entirely.

---

## Context (Collected Thoughts)

### What shipped in R007

R007 designed and shipped the **single-language enforcement routing** mechanism:
- `language` field on `EnforcementSkillManifest` (manifest.ts)
- `resolveEnforcementSkills()` filters builtins by `profile.stack.language`
- Project-local skills always load unconditionally
- `typescript-standards` tagged `language: TypeScript`

This works for single-language projects. For polyglot projects, R007 noted the problem (Q4) but deferred the design decision.

### What shipped in Phase 2 (feat/polyglot-monorepo-detection)

As a first-pass implementation to unblock EnergyWork:
- `profile-detector.ts` rewritten to scan ALL language markers (not first-match-wins)
- `type: "polyglot-monorepo"` with `stack.languages: string[]` when >1 language detected
- Go detection added (`go.mod` — was missing)
- `prompt-conditioner.ts` emits `<languages>` XML tag
- `skill-runtime.ts` matches enforcement skills against the languages array
- `config.ts` schema extended with `languages` array
- 5 new tests, all passing

This handles the "load all matching skills" case but is **coarse-grained**: a Go file edit still gets TypeScript and Python standards in the prompt. The prompt token waste and noise are acceptable for MVP but won't scale.

### The three unsolved problems

1. **Workspace decomposition** — Detecting workspace boundaries within a monorepo (where each "project" lives). Today the detector scans the root directory only. A workspace is a subtree with its own language identity.

2. **Task-to-workspace resolution** — When `gwrk ship` dispatches an agent to work on a task, which workspace does that task belong to? The enforcement skills loaded should match the workspace, not the whole repo.

3. **Enforcement skill authoring** — Creating project-local enforcement skills is entirely manual. `gwrk plugin create <name> --tier enforcement` was specced (FR-L1-009) but never built. For polyglot projects, the user needs to create N enforcement skills (one per language/framework) — high friction without scaffolding.

### Relationship to existing systems

| System | Current state | What polyglot needs |
|--------|--------------|---------------------|
| `profile-detector.ts` | Scans root-level markers only | Recursive workspace boundary detection |
| `prompt-conditioner.ts` | Emits single `<stack>` or `<languages>` | Per-workspace `<workspace>` elements |
| `skill-runtime.ts` | Filters by `stack.language` or `stack.languages[]` | Filter by workspace context from task/file path |
| `config.ts` | `stack.language` singular, `stack.languages` array | `workspaces[]` with per-workspace profiles |
| `init.ts` | Scaffolds `.gwrk/` dirs | Auto-detect workspaces, scaffold per-workspace enforcement skills |
| `gwrk plugin create` | Not implemented | Create enforcement skills from detected toolchain |
| `agent.ts` dispatch | Injects `<project_profile>` | Inject `<workspace_context>` scoped to task target |

---

## Questions to Answer

### Q1: Workspace boundary detection

How does the detector find workspace boundaries in a monorepo?

| Signal | Example | Reliability |
|--------|---------|-------------|
| Build system markers at depth | `services/worker/go.mod`, `api/pyproject.toml` | High — authoritative |
| pnpm/npm workspace patterns | `pnpm-workspace.yaml` → `packages/*` globs | High — explicit declaration |
| Directory naming conventions | `apps/`, `services/`, `packages/`, `libs/` | Medium — heuristic |
| Cargo workspace | `[workspace]` in root `Cargo.toml` with `members` | High — explicit |
| Python monorepo tools | `uv` workspaces, `poetry` groups | Medium — newer convention |

**Sub-questions:**
- How deep should the scanner recurse? (1 level? 2? configurable?)
- Should `gwrk init` discover workspaces interactively ("I found 3 workspaces — confirm?") or auto-commit?
- What happens when workspaces are nested (e.g., a Go service inside a Python monorepo)?

### Q2: Per-workspace enforcement routing

When an agent is working on a task, how does gwrk determine which workspace's enforcement skills to load?

| Approach | How it works | Tradeoffs |
|----------|-------------|-----------|
| File path matching | Task mentions `services/worker/*.go` → Go workspace | Requires file paths in tasks. Breaks for cross-workspace tasks. |
| Task metadata | Task declares `workspace: api` in tasks.json | Explicit but adds authoring burden. |
| Agent self-routing | Agent sees all workspaces in profile XML, picks relevant ones | Non-deterministic. Agent may pick wrong context. |
| Spec-level declaration | Spec declares `scope: api` | Natural for feature scoping. Requires spec schema extension. |
| Load all, annotate | Load all workspace skills, annotate each with workspace scope | Agent self-selects from context. Token-heavy but simple. |

### Q3: Workspace profile schema

What does a workspace profile look like in `.gwrkrc.json`?

```json
{
  "project": {
    "name": "EnergyWork",
    "type": "polyglot-monorepo",
    "workspaces": [
      {
        "root": "api",
        "name": "api",
        "stack": { "language": "Python", "framework": "Django", "buildSystem": "uv" },
        "toolchain": { "primary": "ruff", "test": "pytest" }
      },
      {
        "root": "services/worker",
        "name": "worker",
        "stack": { "language": "Go", "buildSystem": "go" },
        "toolchain": { "primary": "golangci-lint", "test": "go-test" }
      },
      {
        "root": "frontend",
        "name": "frontend",
        "stack": { "language": "TypeScript", "framework": "React", "buildSystem": "pnpm" },
        "toolchain": { "primary": "biome", "test": "vitest" }
      }
    ]
  }
}
```

**Sub-questions:**
- Should workspaces be auto-detected and written to config, or should the config be the source of truth?
- How does the `toolchain` model from R007 (Proposal 1) integrate here?
- Should each workspace have its own `.gwrk/` directory with local enforcement skills?

### Q4: Enforcement skill scaffolding (`gwrk plugin create`)

F014 spec FR-L1-009 specifies `gwrk plugin create` but it was never implemented. For polyglot projects, this is the highest-leverage single feature — it eliminates the manual authoring burden.

| Approach | Command | What it produces |
|----------|---------|-----------------|
| Scaffold from template | `gwrk plugin create python-conventions --tier enforcement` | `manifest.yaml` + empty `SKILL.md` with language/framework headers |
| Scaffold from detection | `gwrk plugin create --from-workspace api` | `manifest.yaml` pre-filled with detected stack + toolchain |
| Agent-generated | `gwrk define ontology --workspace api` | Full SKILL.md content generated from codebase analysis |

### Q5: Cross-workspace concerns

Some enforcement applies to ALL workspaces in a monorepo:
- Git commit format conventions
- PR hygiene standards
- Shared code ownership rules
- Monorepo-wide CI/CD patterns

How does this coexist with per-workspace skills?

| Option | Mechanism |
|--------|-----------|
| Global enforcement skill (no `language` field) | Already works — skills without `language` load for all |
| `scope: monorepo` in manifest | New scope value — always loads regardless of workspace |
| `.gwrk/plugins/skills/monorepo-conventions/` | Project-local, no language filter |

---

## Input Documents

- `src/engine/profile-detector.ts` — Current multi-language detection (Phase 2 shipped)
- `src/engine/prompt-conditioner.ts` — `ProjectProfile` interface with `languages[]`
- `src/plugins/skill-runtime.ts` — `resolveEnforcementSkills()` with array matching
- `src/plugins/manifest.ts` — `EnforcementSkillManifestSchema` with `language` field
- `src/utils/config.ts` — `GwrkConfigSchema` with `stack.languages`
- `src/commands/init.ts` — Init wizard (workspace discovery target)
- `docs/research/R007-project-perspective/draft.md` — R007 Q4 (polyglot routing) + toolchain model + style guide landscape
- `docs/research/R007-project-perspective/brief.md` — R007 context + anti-patterns
- `specs/014-plugin-system/spec.md` — FR-L1-009 (`gwrk plugin create`), US-016 (enforcement skills)

## Anti-Patterns

- Do NOT scan the entire file tree recursively — set a depth limit (2-3 levels max)
- Do NOT assume all workspaces have the same build system or framework version
- Do NOT break the existing single-language detection — it must remain the fast path
- Do NOT make workspace declaration mandatory — polyglot detection should work with zero config
- Do NOT hardcode workspace patterns (apps/, services/, packages/) — detect from build system markers
- Do NOT conflate workspace detection with enforcement skill authoring — they're separate concerns

---

## Output Contract

1. **`draft.md`** — Design document covering Q1-Q5 with recommendations, including:
   - Workspace boundary detection algorithm with depth limits
   - Per-workspace enforcement routing design
   - Config schema for `workspaces[]`
   - `gwrk plugin create --tier enforcement` CLI design
   - Cross-workspace enforcement pattern
2. **Workspace detection pseudocode** — Algorithm for scanning monorepo subtrees
3. **Config schema proposal** — JSON Schema for `workspaces` in `.gwrkrc.json`
4. **Migration path** — How existing Phase 2 `stack.languages` evolves to workspace-aware profiles
