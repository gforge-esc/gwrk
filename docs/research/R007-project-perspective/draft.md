# R007 Draft — Project Perspective & Enforcement Skills

> **Status:** Draft — Awaiting Review
> **Initiative:** [R007 brief](brief.md)
> **Consumer:** F014 Plugin System
> **Related:** [R006 draft](../R006-pluginable-research/draft.md) — shared plugin resolution chain

---

## Executive Summary

Project perspective is how gwrk understands "how we build" for any given project. Today this only works for gwrk itself. R007 proposes extending F014's existing enforcement skill infrastructure to support non-gwrk projects.

This draft separates what **already exists** (cited to spec/code) from what **is proposed** (new design requiring spec amendment). The user's direction adds domain ontology as a concern — this is explicitly **new architecture** with no existing spec or code basis.

---

## What Exists Today (Grounded)

### Enforcement Skills — FR-014, US-016 (Implemented)

**Spec**: [F014 spec.md FR-014](../../specs/014-plugin-system/spec.md#L367):

> System MUST ship builtin enforcement skills in `src/plugins/builtins/skills/`. Enforcement skills (`tier: enforcement`) define coding standards, quality constraints, and project conventions that are automatically loaded by write workflows. Enforcement skills follow the same resolution order as workflows: project-local `.gwrk/plugins/skills/` overrides global `~/.gwrk/plugins/skills/` overrides builtins.

**Code**: [skill-runtime.ts L154-199](../../src/plugins/skill-runtime.ts#L154-L199) — `resolveEnforcementSkills(projectRoot, scope)` loads all enforcement skills. Resolution order: project-local → global → builtins. Precedence: project-local overrides builtins of the same name.

**Manifest schema**: [manifest.ts L119](../../src/plugins/manifest.ts#L119) — Enforcement skills have `scope: "implementation" | "review" | "all"`. No `language` or `framework` fields exist.

### Project-Local Override — US-016 AC3 (Spec'd)

**Spec**: [F014 spec.md US-016 AC3](../../specs/014-plugin-system/spec.md#L333-L334):

> Given a project needs custom standards, When a user installs a project-local skill at `.gwrk/plugins/skills/typescript-standards/`, Then the local override takes precedence over the builtin.

**Code**: `PluginLoader` in [loader.ts](../../src/plugins/loader.ts) scans project-local, then global, then builtins. Already works.

### Profile Detection (Implemented, Not Connected)

**Code**: [profile-detector.ts](../../src/engine/profile-detector.ts) — auto-detects `ProjectProfile` with `type`, `stack.language`, `stack.framework`, `stack.buildSystem`, `layout`. Output used by prompt conditioner for `[type:]` guards.

**Gap**: Profile detection and enforcement skill resolution don't talk to each other. `resolveEnforcementSkills()` takes no profile parameter and loads all enforcement skills unconditionally.

### Prompt Conditioner (Implemented, gwrk-Only)

**Code**: [prompt-conditioner.ts](../../src/engine/prompt-conditioner.ts) — resolves `[type: gwrk-native]` / `[type: generic]` guards, injects `<project_profile>` XML. The only custom type is `gwrk-native`. Every other project gets `generic` fallback.

---

## What R007 Proposes (New Design — Requires Spec Amendment)

### Proposal 1: Profile → Enforcement Routing

**Problem**: A Python project currently receives `typescript-standards` because `resolveEnforcementSkills()` doesn't filter by profile. [skill-runtime.ts L159](../../src/plugins/skill-runtime.ts#L159) calls `loader.listPlugins({ tier: "enforcement" })` — no language filter.

**Proposed change**: Add `scope.language` and `scope.framework` to the enforcement manifest schema.

```yaml
# New manifest fields (requires manifest.ts amendment)
type: skill
name: django-conventions
tier: enforcement
scope: implementation
# --- NEW FIELDS ---
language: Python
framework: Django
```

**Routing algorithm**:

```
1. Load all enforcement skills (existing listPlugins call)
2. If project has local enforcement skills → inject all (user chose these)
3. If falling back to builtins → filter by profile.stack.language match
4. Skills with no language field → always match (backwards compatible)
```

**Impact**: Requires amending FR-014 and the `EnforcementSkillManifestSchema` in [manifest.ts](../../src/plugins/manifest.ts). Backwards compatible — existing manifests without `language` continue to load for all projects.

### Proposal 2: Domain Ontology, Information Hierarchy, and UX Posture

**Decided in [ADR-009](../../docs/decisions/ADR-009-domain-ontology-information-hierarchy-ux.md).**

Three project knowledge layers, all optional, file-based, injected at dispatch:
- `.gwrk/ontology/domain.md` — what things mean (classes, properties, relations, axioms, glossary)
- `.gwrk/perspective/hierarchy.md` — what matters first (L0 Decision → L4 Recovery)
- `.gwrk/perspective/ux-posture.md` — how actors experience the system (entry → closure)

Grounded in the [Gonzo Feature Research Brief v2](../R006-pluginable-research/references/gonzo-feature-research-brief-v2.md) (Sections 4-5, Pack C) and the [ontology-construction-prompt](references/ontology-construction-prompt.hbs).

---

## Q2: Profile → Enforcement Routing (Detailed)

### Current code

```typescript
// skill-runtime.ts L154-159 — no profile awareness
export async function resolveEnforcementSkills(
  projectRoot: string,
  scope: "implementation" | "review" | "all" = "all",
): Promise<string> {
  const loader = new PluginLoader({ projectDir: projectRoot });
  const allPlugins = await loader.listPlugins({ tier: "enforcement" });
```

### Proposed change

```typescript
// Add profile parameter — optional, backwards compatible
export async function resolveEnforcementSkills(
  projectRoot: string,
  scope: "implementation" | "review" | "all" = "all",
  profile?: ProjectProfile,  // NEW
): Promise<string> {
```

Then in the loop at [L170-196](../../src/plugins/skill-runtime.ts#L170-L196), add filtering:

```typescript
// After loading the manifest:
const manifest = loaded.manifest as EnforcementSkillManifest;

// NEW: Profile-based filtering (only for builtins — project-local always loads)
if (profile && summary.source === "builtin" && manifest.language) {
  if (manifest.language.toLowerCase() !== profile.stack?.language?.toLowerCase()) {
    continue;
  }
}
```

### Builtin split

| Builtin | Current behavior | Proposed |
|---|---|---|
| `gwrk-conventions` | Loads for all projects | Add `language: null` (all projects) — split gwrk-specific rules to `_isGwrk` guard |
| `typescript-standards` | Loads for all projects | Add `language: TypeScript` — only loads for TS projects |
| NEW: `generic-conventions` | N/A | Generic commit format, PR hygiene. `language: null`. |

---

## Q5: Escape from gwrk-Specific Builtins

**Current builtins** (`gwrk-conventions`, `typescript-standards`) are gwrk-specific. For non-gwrk projects this is wrong — Python projects get TypeScript standards.

**Proposed split** (backwards compatible):

1. Extract generic rules from `gwrk-conventions` into `generic-conventions` (commit messages, task management — project-agnostic)
2. Keep `gwrk-conventions` for gwrk-specific rules (flamingo branding, spec conventions). Gate with `_isGwrk` check or `language: gwrk-native`.
3. Add `language: TypeScript` to `typescript-standards` manifest so it only loads for TS projects (requires Proposal 1).

---

## Init Scaffolding

**What exists**: `gwrk init` creates `specs/`, `.gwrk/rules/`, `.gitattributes`. See [init.ts L231-285](../../src/commands/init.ts#L231-L285).

**Proposed addition** (minimal — just directories):

```diff
  const dirs = ["specs", ".gwrk/rules"];
+ // Only if we proceed with ontology/grounding proposals:
+ // ".gwrk/ontology"
+ // ".gwrk/grounding"
```

**Not proposed**: scaffolding enforcement skill templates. Users create those via `gwrk plugin create` (already exists per FR-L1-009) or manually.

---

## Summary: What's Grounded vs. What's New

| Item | Status | Spec/Code basis |
|---|---|---|
| Enforcement skills | **Implemented** | FR-014, US-016, skill-runtime.ts |
| Project-local override | **Implemented** | US-016 AC3, PluginLoader |
| Profile detection | **Implemented** | profile-detector.ts |
| `scope.language` filtering | **Proposed** | No spec basis. Requires FR-014 amendment. |
| Domain ontology | **Proposed** | No spec/ADR basis. User direction. New concept. |
| Architecture grounding | **Proposed** | No spec basis. gwrk uses it informally. |
| Builtin split (generic/gwrk/ts) | **Proposed** | Backwards compatible. No spec change needed. |

---

## Open Items

| Item | Decision needed |
|---|---|
| Ontology: enforcement skill vs. new injection path vs. just-a-file? | Determines implementation complexity |
| `scope.language` filtering: amend FR-014 or defer? | Blocks non-gwrk project support |
| Architecture grounding: worth the new concept or premature? | May be deferred indefinitely |
