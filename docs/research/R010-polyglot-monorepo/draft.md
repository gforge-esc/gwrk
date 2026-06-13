# R010 Draft — Polyglot Monorepo Support

> **Status:** Draft — Awaiting Review
> **Initiative:** [R010 brief](brief.md)
> **Consumer:** F014 Plugin System, F001 CLI Core
> **Related:** [R007 draft](../R007-project-perspective/draft.md) — project perspective + toolchain model (shipped)
> **Depends on:** R007 Feature A (language filtering — shipped), Phase 2 (multi-language detection — shipped)

---

## Executive Summary

Polyglot monorepo support extends gwrk from "one project = one language" to "one project = multiple workspaces, each with its own language, framework, and quality posture." This draft proposes workspace-aware profile detection, per-workspace enforcement routing, config schema extensions, and the `gwrk plugin create` scaffolding command.

The core principle: **workspace detection is passive observation; enforcement is active rules.** The detector finds workspaces. The user (or an agent) authors enforcement skills. gwrk routes the right skills to the right workspace at dispatch time.

---

## What Already Exists (Grounded)

### Multi-Language Detection — Phase 2 (Shipped)

**Code**: [profile-detector.ts](../../src/engine/profile-detector.ts) — scans all root-level language markers (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`). When >1 marker found: `type: "polyglot-monorepo"`, `stack.languages: string[]`.

**Limitation**: Only scans the root directory. A monorepo where `api/pyproject.toml` and `services/worker/go.mod` live in subdirectories (with no root-level markers) would detect as `unknown`.

### Enforcement Routing — R007 Feature A (Shipped)

**Code**: [skill-runtime.ts L190-203](../../src/plugins/skill-runtime.ts#L190-L203) — filters enforcement skills by `manifest.language` against `profile.stack.language` (single) or `profile.stack.languages` (array). Project-local skills always load unconditionally.

**Limitation**: No workspace context. All matching skills load for every task, regardless of which workspace the task targets.

### Config Schema — Phase 2 (Shipped)

**Code**: [config.ts L25-26](../../src/utils/config.ts#L25-L26) — `stack.languages: z.array(z.string()).optional()`.

**Limitation**: Flat array. No per-workspace stack information.

### Plugin Create — F014 (Specced, Not Implemented)

**Spec**: [F014 spec.md FR-L1-009](../../specs/014-plugin-system/spec.md) — `gwrk plugin create <name>`. The spec mentions it but provides no detail on enforcement skill creation.

**Code**: Zero. Not in `plugin.ts`.

---

## Q1: Workspace Boundary Detection — Recommendation

### Algorithm: Marker-Anchored Depth-Limited Scan

The detector should scan subdirectories to a configurable depth (default: 2) for language markers that define workspace boundaries. A workspace is a directory subtree that has its own build system marker.

```
EnergyWork/
├── package.json          ← root marker (TypeScript)
├── pyproject.toml        ← root marker (Python)  ← NOT a workspace (root)
├── api/                  ← workspace: Python/Django
│   └── pyproject.toml    ← workspace marker
├── services/
│   └── worker/           ← workspace: Go
│       └── go.mod        ← workspace marker (depth 2)
├── frontend/             ← workspace: TypeScript/React
│   └── package.json      ← workspace marker
└── shared/               ← workspace: Python (library)
    └── pyproject.toml    ← workspace marker
```

**Detection rules:**

1. **Root markers** establish the project's top-level languages (existing Phase 2 behavior)
2. **Subdirectory markers** at depth 1-2 establish workspace boundaries
3. A subdirectory marker **overrides** the root marker for that subtree — `api/pyproject.toml` means the `api/` workspace is Python, regardless of what's at root
4. **pnpm/npm workspaces** are detected from `pnpm-workspace.yaml` globs → each matched directory is a workspace
5. **Cargo workspaces** are detected from `Cargo.toml` `[workspace]` → `members` globs
6. **uv workspaces** are detected from `pyproject.toml` `[tool.uv.workspace]` → `members` globs

**Depth limit**: 2 by default. Configurable via `.gwrkrc.json` (`detection.maxDepth`). Deeper than 2 is almost always noise.

### Proposed Interface

```typescript
export interface WorkspaceProfile {
  /** Relative path from project root (e.g. "api", "services/worker") */
  root: string;
  /** Human-readable name (derived from directory name or config override) */
  name: string;
  /** Language/framework profile for this workspace */
  stack: {
    language: string;
    framework?: string;
    buildSystem?: string;
  };
  /** Quality posture (from R007 toolchain model) */
  toolchain?: {
    primary?: string;    // "biome" | "ruff" | "cargo" | "golangci-lint" | "eslint"
    formatter?: string;  // Only when not converged
    test?: string;       // "vitest" | "pytest" | "cargo-test" | "go-test"
  };
}

export interface ProjectProfile {
  type: string;
  stack?: {
    language?: string;
    languages?: string[];
    framework?: string;
    buildSystem?: string;
  };
  layout?: string;
  _isGwrk?: boolean;
  /** Workspace decomposition for polyglot monorepos */
  workspaces?: WorkspaceProfile[];
}
```

### Detection Pseudocode

```
function detectWorkspaces(projectRoot, maxDepth = 2):
  workspaces = []
  
  // 1. Check for explicit workspace declarations
  if exists(pnpm-workspace.yaml):
    globs = parse pnpm-workspace.yaml packages
    for each glob match:
      ws = detectSingleWorkspace(matched_dir)
      if ws: workspaces.push(ws)
    return workspaces
  
  if exists(Cargo.toml) and has [workspace]:
    members = parse Cargo.toml workspace.members
    for each member glob match:
      ws = detectSingleWorkspace(matched_dir)
      if ws: workspaces.push(ws)
    return workspaces
  
  // 2. Heuristic: scan subdirectories for language markers
  for each dir at depth 1..maxDepth:
    if dir has build system marker (go.mod, pyproject.toml, Cargo.toml, package.json):
      ws = detectSingleWorkspace(dir)
      if ws: workspaces.push(ws)
  
  return workspaces

function detectSingleWorkspace(dir):
  // Reuse existing language detection logic on a single directory
  profile = detectProfile(dir)  // existing function
  return {
    root: relative(projectRoot, dir),
    name: basename(dir),
    stack: profile.stack,
  }
```

### Init Experience

`gwrk init` should:
1. Run root detection (existing)
2. If polyglot detected, run workspace scan
3. Present discovered workspaces for confirmation:
   ```
   Step 1: Project Profile Detection
   Detected: polyglot-monorepo (3 workspaces)
     api/              Python (Django, uv)
     services/worker/  Go
     frontend/         TypeScript (React, pnpm)
   Confirm workspaces? (Y/n)
   ```
4. Write `workspaces` to `.gwrkrc.json`

---

## Q2: Per-Workspace Enforcement Routing — Recommendation

### Approach: Spec-Scoped + Fallback to All

The cleanest routing is through the spec/task system. When a spec declares `scope`, the ship orchestrator knows which workspace the task targets.

**Routing priority:**
1. If task has `workspace` metadata → load only that workspace's enforcement skills
2. If spec has `scope` → resolve workspace from scope
3. If neither → load all workspace enforcement skills (current behavior, backwards compatible)

### How workspace context reaches the agent

The `dispatchToAgent()` function in [agent.ts](../../src/utils/agent.ts) already injects `<project_profile>` XML. Extend it:

```xml
<project_profile type="polyglot-monorepo">
  <workspace name="api" root="api">
    <stack language="Python" framework="Django" buildSystem="uv" />
    <toolchain primary="ruff" test="pytest" />
  </workspace>
  <workspace name="worker" root="services/worker">
    <stack language="Go" buildSystem="go" />
    <toolchain primary="golangci-lint" test="go-test" />
  </workspace>
  <workspace name="frontend" root="frontend">
    <stack language="TypeScript" framework="React" buildSystem="pnpm" />
    <toolchain primary="biome" test="vitest" />
  </workspace>
  <active_workspace name="api" />
</project_profile>
```

The `<active_workspace>` element is set when the routing system resolves a workspace for the current task. When not resolvable, it's omitted and the agent sees all workspaces.

### Impact on `resolveEnforcementSkills()`

```typescript
export async function resolveEnforcementSkills(
  projectRoot: string,
  scope: "implementation" | "review" | "all" = "all",
  profile?: ProjectProfile,
  workspace?: WorkspaceProfile,  // NEW: optional workspace context
): Promise<string> {
  // ...existing code...
  
  // When workspace is provided, filter by workspace language instead of project languages
  const filterLanguage = workspace?.stack.language 
    ?? profile?.stack?.language;
  
  if (filterLanguage && manifest.language) {
    const manifestLang = manifest.language.toLowerCase();
    if (manifestLang !== filterLanguage.toLowerCase()) {
      continue;
    }
  }
}
```

---

## Q3: Workspace Profile Schema — Recommendation

### Config Schema Addition

```typescript
// In config.ts — extend GwrkConfigSchema
workspaces: z.array(z.object({
  root: z.string(),
  name: z.string().optional(),  // defaults to basename of root
  stack: z.object({
    language: z.string(),
    framework: z.string().optional(),
    buildSystem: z.string().optional(),
  }),
  toolchain: z.object({
    primary: z.string().optional(),
    formatter: z.string().optional(),
    test: z.string().optional(),
  }).optional(),
})).optional(),
```

### Source of Truth: Config is Authoritative, Detection is Advisory

- `gwrk init` **discovers** workspaces and **proposes** them
- User confirms or edits during interactive init
- `.gwrkrc.json` is the source of truth after init
- Re-running `gwrk init` in an existing project can refresh workspace detection and merge new discoveries

### Per-Workspace Enforcement Skills

Each workspace can have its own enforcement skills in project-local plugins:

```
.gwrk/plugins/skills/
  python-api-standards/
    manifest.yaml         # language: Python, workspace: api
    SKILL.md              # Django conventions, ruff rules, pytest patterns
  go-service-standards/
    manifest.yaml         # language: Go, workspace: worker
    SKILL.md              # chi router, structured logging, golangci-lint
  react-frontend-standards/
    manifest.yaml         # language: TypeScript, workspace: frontend
    SKILL.md              # React conventions, biome rules, vitest patterns
```

**Manifest extension** (optional):

```yaml
type: skill
name: python-api-standards
tier: enforcement
scope: implementation
language: Python
workspace: api    # NEW: optional workspace scope
```

When a skill has `workspace`, it only loads for tasks targeting that workspace. This is finer-grained than language-only filtering and prevents Django conventions from loading for a Python CLI tool in a different workspace.

---

## Q4: Enforcement Skill Scaffolding — Recommendation

### `gwrk plugin create` Implementation

**Minimal viable command:**

```bash
gwrk plugin create django-standards --tier enforcement --language Python
```

**Produces:**

```
.gwrk/plugins/skills/django-standards/
  manifest.yaml
  SKILL.md
```

`manifest.yaml`:
```yaml
type: skill
name: django-standards
version: 1.0.0
description: Python/Django coding standards
tier: enforcement
scope: implementation
language: Python
```

`SKILL.md`:
```markdown
# Django Standards

## Coding Conventions
<!-- Define your Django coding conventions here -->

## Quality Gates
<!-- Define linting, formatting, and test requirements -->

## Architecture Patterns
<!-- Define architectural patterns and constraints -->
```

### Workspace-Aware Scaffolding

```bash
gwrk plugin create --from-workspace api
```

This reads the workspace profile from `.gwrkrc.json`, pre-fills the manifest with detected language/framework/toolchain, and generates a SKILL.md skeleton with relevant section headers.

### Agent-Generated Content (Future)

```bash
gwrk define ontology --workspace api
```

This runs the ontology construction workflow (R007 Q6) scoped to a specific workspace, scanning `api/` for source material and producing a full SKILL.md with project-specific conventions discovered from the codebase.

---

## Q5: Cross-Workspace Concerns — Recommendation

### Pattern: Global Enforcement Skills (No Language, No Workspace)

Skills without `language` or `workspace` fields load for all tasks. This is the existing behavior and the right pattern for monorepo-wide concerns:

```yaml
# .gwrk/plugins/skills/monorepo-standards/manifest.yaml
type: skill
name: monorepo-standards
version: 1.0.0
description: Cross-workspace conventions for EnergyWork
tier: enforcement
scope: all
# No language field — loads for everything
# No workspace field — loads for everything
```

The SKILL.md for global skills would cover:
- Git commit message format
- PR description template
- Branch naming conventions
- Cross-workspace API contracts
- Shared CI/CD patterns
- Documentation standards

### Resolution Order (Complete)

```
1. Cross-workspace enforcement skills (no language, no workspace) → always load
2. Language-matched enforcement skills (language matches workspace) → load for matching workspaces
3. Workspace-scoped enforcement skills (workspace matches task target) → load for specific workspace
4. Project-local skills → always load (user chose these)
5. Builtins → filter by language
```

---

## Migration Path

### Phase 2 → Phase 3 (Non-Breaking)

All Phase 2 changes are forwards-compatible:

| Phase 2 (current) | Phase 3 (proposed) | Migration |
|---|---|---|
| `stack.languages: string[]` | `workspaces: WorkspaceProfile[]` | Languages array becomes derived from workspace profiles. Kept for backwards compat. |
| `type: "polyglot-monorepo"` | Same | No change |
| `resolveEnforcementSkills(profile)` | `resolveEnforcementSkills(profile, workspace)` | New optional parameter. Existing callers unchanged. |
| Root-level detection only | Root + depth scan | Additive — root detection preserved |

### Implementation Sequence

| Step | What | LOC Est. | Depends On |
|---|---|---|---|
| 1 | `WorkspaceProfile` type + `detectWorkspaces()` | ~100 | Nothing |
| 2 | `gwrk init` workspace discovery UI | ~80 | Step 1 |
| 3 | Config schema `workspaces[]` | ~30 | Step 1 |
| 4 | `prompt-conditioner` workspace XML | ~50 | Step 1 |
| 5 | `resolveEnforcementSkills()` workspace param | ~30 | Step 1 |
| 6 | `gwrk plugin create --tier enforcement` | ~120 | Nothing (independent) |
| 7 | `manifest.yaml` workspace field | ~20 | Step 5 |
| 8 | Agent dispatch workspace resolution | ~50 | Steps 4, 5 |

**Total estimate**: ~480 LOC across 8 steps. Steps 1-5 are the core workspace detection pipeline. Step 6 is independent and can ship separately.

---

## Summary: What's Grounded vs. What's New

| Item | Status | Source |
|---|---|---|
| Multi-language detection (root-level) | **Shipped** | Phase 2, profile-detector.ts |
| `stack.languages` array | **Shipped** | Phase 2, prompt-conditioner.ts |
| Enforcement routing (multi-language) | **Shipped** | Phase 2, skill-runtime.ts |
| Go detection | **Shipped** | Phase 2, profile-detector.ts |
| Workspace boundary detection | **Proposed** | This draft, Q1 |
| Per-workspace enforcement routing | **Proposed** | This draft, Q2 |
| Config `workspaces[]` schema | **Proposed** | This draft, Q3 |
| `gwrk plugin create --tier enforcement` | **Proposed** | This draft, Q4 + F014 FR-L1-009 |
| `manifest.yaml` workspace field | **Proposed** | This draft, Q3 |
| Cross-workspace enforcement pattern | **Proposed** | This draft, Q5 |
| Agent-generated enforcement skills | **Future** | R007 Q6 (ontology construction) |
| R007 toolchain model integration | **Research complete** | R007 draft, Proposal 1 |

---

## Open Items

| Item | Status | Decision Needed |
|---|---|---|
| Workspace scan depth limit | Proposed: 2 | Is 2 sufficient? Should it be configurable? |
| Workspace detection: explicit vs. heuristic | Proposed: prefer explicit (pnpm-workspace.yaml), fallback to heuristic | Any monorepo tools not covered? |
| Task-to-workspace resolution | Proposed: spec-scoped + fallback | Does the spec schema need a `scope` field? |
| `gwrk plugin create` — independent feature or part of this? | Proposed: ship independently (Step 6) | Should it be a separate spec (F021)? |
| Toolchain detection per-workspace | R007 research complete, not implemented | Ship with workspace detection or defer? |
| Nested workspaces | Not addressed | Does any real project need this? |
