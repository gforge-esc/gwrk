# Policy selection contracts

Domain policy carries `ProjectDesign` across workspace profiles and composes compatible rules without silent substitution. Initialization stays model-free while checks remain inactive until activation or assessment. Blocked: implementation depends on `043-unified-routing-prompt-delivery`.

## Profile design and workspace inheritance

| Item | Value |
|---|---|
| Domain files | `src/domain/types.ts` and `src/domain/profile-policy.ts` |
| Conditioning file | `src/domain/prompt-conditioner.ts` |
| Engine file | `src/engine/profile-detector.ts` |
| Phase | Phase 1 |

```typescript
import type { ProjectDesign } from "./architecture-context.js";

export interface WorkspaceProfileConfig {
  type?: string;
  stack?: {
    language?: string;
    framework?: string;
    buildSystem?: string;
  };
  layout?: string;
  toolchain?: ProjectProfile["toolchain"];
  design?: ProjectDesign;
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
  toolchain?: {
    primary?:
      | "biome"
      | "eslint"
      | "ruff"
      | "golangci-lint"
      | "clippy"
      | "cargo";
    formatter?: "prettier" | "biome" | "black" | "rustfmt" | "gofmt";
    test?:
      | "vitest"
      | "jest"
      | "pytest"
      | "cargo-test"
      | "go-test"
      | "node-test"
      | null;
    testCommand?: string;
    build?: string | null;
    testExtension?: string;
    sourceExtension?: string;
  };
  design?: ProjectDesign;
  _isGwrk?: boolean;
}

export interface ProfileOverrideInput {
  detected: ProjectProfile;
  projectDesign?: ProjectDesign;
  projectType?: string;
  projectStack?: ProjectProfile["stack"];
  projectLayout?: string;
  projectToolchain?: ProjectProfile["toolchain"];
  workspaceConfig?: WorkspaceProfileConfig;
}

export function mergeProfileOverrides(
  input: ProfileOverrideInput,
): ProjectProfile;

export function resolveWorkspacePolicyProfile(
  workspaceRelPath: string,
  detectedWorkspace: ProjectProfile,
  rootConfig?: {
    project?: {
      design?: ProjectDesign;
      toolchain?: ProjectProfile["toolchain"];
    };
    workspaces?: Readonly<Record<string, WorkspaceProfileConfig>>;
  },
): ProjectProfile;

export function detectProfile(projectRoot: string): Promise<ProjectProfile>;

export function resolveWorkspaceProfile(
  projectRoot: string,
  workspacePath: string,
): Promise<ProjectProfile>;

export function conditionPrompt(
  prompt: string,
  profile: ProjectProfile,
): string;
```

Both `mergeProfileOverrides` and `resolveWorkspacePolicyProfile` stay pure inside `src/domain/profile-policy.ts`. Without configured design metadata, `profile.design` stays `undefined` and profile behavior stays unchanged. When design metadata exists, `detectProfile` attaches `ProjectDesign` across every project type including `gwrk-native`. Inside a workspace folder without local config, `detectProfile` reads the nearest ancestor `.gwrkrc.json` in the worktree. It applies the matching `workspaces` entry and inherits `project.design`. Workspace resolution merges `resolveWorkspaceProfile` stack and toolchain overrides while preserving workspace or root `ProjectDesign`. Prompt conditioning in `conditionPrompt` emits `<design>` inside `<project_context>` only when `profile.design` is set.

## Manifest selectors and pure policy composition

| Item | Value |
|---|---|
| Manifest schema | `src/plugins/manifest.ts` |
| Guidance lookup | `src/domain/architecture-context.ts` |
| Policy module | `src/domain/policy-selection.ts` |
| Phase | Phase 2 |

```typescript
import type { ProjectDesign } from "./architecture-context.js";
import type { ProjectProfile } from "./types.js";

export type EnforcementScope =
  | "define"
  | "implementation"
  | "review"
  | "all";

export type DesignPrinciple = "functional-core" | "clean-code" | "tdd";

export type PolicySourceLayer =
  | "builtin"
  | "global"
  | "project-entry"
  | "project-local";

export interface EnforcementSkillSelectors {
  scope?: EnforcementScope;
  language?: string;
  framework?: string;
  architectures?: string[];
  principles?: DesignPrinciple[];
  projectScope?: "any" | "gwrk";
}

export interface PolicyCandidate {
  name: string;
  source: PolicySourceLayer;
  manifest: EnforcementSkillSelectors & {
    name: string;
    description: string;
    version: string;
  };
  content?: string;
}

export type PolicyGapKind =
  | "missing-language-binding"
  | "missing-framework-binding"
  | "incompatible-framework-policy"
  | "unbundled-architecture";

export interface PolicyGap {
  kind: PolicyGapKind;
  subject: string;
  message: string;
}

export interface CandidateEvaluation {
  included: boolean;
  reason:
    | "selected"
    | "project-local-override"
    | "legacy-global-unscoped"
    | "shadowed-by-override"
    | "scope-mismatch"
    | "project-scope-mismatch"
    | "language-mismatch"
    | "framework-mismatch"
    | "architecture-mismatch"
    | "principle-mismatch";
}

export interface EffectivePolicy {
  scope: EnforcementScope;
  design?: ProjectDesign;
  checksStatus: "inactive" | "configured";
  architectureRules: string[];
  languageGuidance?: string;
  frameworkGuidance?: string;
  selectedSkills: PolicyCandidate[];
  excludedSkills: Array<{
    name: string;
    source: PolicySourceLayer;
    reason: CandidateEvaluation["reason"];
  }>;
  gaps: PolicyGap[];
}

export interface ComposePolicyInput {
  profile?: ProjectProfile;
  scope?: EnforcementScope;
  candidates: readonly PolicyCandidate[];
  checksConfigured?: boolean;
}

export function lookupLanguageGuidance(language?: string): string | undefined;

export function lookupFrameworkGuidance(framework?: string): string | undefined;

export function evaluateEnforcementCandidate(
  candidate: PolicyCandidate,
  profile: ProjectProfile | undefined,
  scope: EnforcementScope,
): CandidateEvaluation;

export function composeEffectivePolicy(
  input: ComposePolicyInput,
): EffectivePolicy;
```

| Source layer | Precedence rank | Render position | Selection rule |
|---|---|---|---|
| `project-local` | 1 | 4 | Applies declared selectors. Legacy entries without selectors keep project-local scope. |
| `project-entry` | 2 | 3 | Filtered by manifest selectors |
| `global` | 3 | 2 | Unscoped legacy skills load globally while selector skills filter |
| `builtin` | 4 | 1 | Filtered by language and framework and `projectScope` |

Manifest parsing in `EnforcementSkillManifestSchema` adds optional `architectures` and `principles` and `projectScope` fields. It also adds `"define"` to `scope`. Legacy manifests without new fields still validate and default `scope` to `"all"`. Choose the highest-precedence compatible copy of each skill. An explicitly disabled copy suppresses lower copies. Report a mismatched override as an exclusion. Candidates with `projectScope: "gwrk"` require verified gwrk repository identity. A matching display name alone cannot establish scope. Candidates with `architectures` require `profile?.design?.architecture` to match one declared value. Candidates with `principles` require `profile?.design?.principles` to contain every declared principle. Missing or incompatible language or framework bindings record a `PolicyGap`. Selection never substitutes rules from another language or framework. Policy composition defaults `checksStatus` to `"inactive"` until the project explicitly configures checks. Assessment evidence describes the current checkout and does not activate checks.

## Runtime resolution and pack compatibility

| Item | Value |
|---|---|
| Runtime files | `src/plugins/skill-runtime.ts` and `src/commands/plugin.ts` |
| Built-in skills | `javascript-standards` and `gwrk-conventions` |
| Language baselines | `typescript` `javascript` `python` `go` `rust` |
| External packs | `nextjs` `react` `fastify` `express` `fastapi` `django` `gin` `chi` `axum` `clap` |

```typescript
import type {
  EffectivePolicy,
  EnforcementScope,
} from "../domain/policy-selection.js";
import type { ProjectProfile } from "../domain/types.js";

export interface ResolvePolicyOptions {
  scope?: EnforcementScope;
  profile?: ProjectProfile;
  globalDir?: string;
  checksConfigured?: boolean;
}

export function resolveEffectivePolicy(
  projectRoot: string,
  options?: ResolvePolicyOptions,
): Promise<EffectivePolicy>;

export function resolveEnforcementSkills(
  projectRoot: string,
  scope?: EnforcementScope,
  profile?: ProjectProfile,
): Promise<string>;

export function formatEffectivePolicyPrompt(
  policy: EffectivePolicy,
): string;
```

Built-in skill `javascript-standards` adds the fifth language baseline. Built-in skill `gwrk-conventions` sets `projectScope: gwrk` so repository rules stay out of external projects. Without an explicit `profile`, `resolveEffectivePolicy` runs `detectProfile(projectRoot)` first. Compatibility wrapper `resolveEnforcementSkills` delegates to `resolveEffectivePolicy` and preserves enforcement comment headers. Command `gwrk plugin list --project` calls `evaluateEnforcementCandidate` so CLI output matches runtime selection. Contract tests cover all five built-in language baselines and actual manifests for the ten published framework packs. Pin fixtures to a reviewed gwrk-plugins revision and record provenance. Report any pack that needs a follow-up change in gwrk-plugins. Tests and initialization run offline against checked-in fixtures or installed packs.

## Model-free initialization and prompt delivery

| Item | Value |
|---|---|
| Context files | `src/domain/architecture-context.ts` and `src/application/architecture/install-context.ts` |
| CLI file | `src/commands/init.ts` |
| Prompt route files | `src/plugins/workflow-runtime.ts` and `src/utils/agent.ts` |
| Phase | Phase 4 |

```typescript
import type { EffectivePolicy } from "./policy-selection.js";
import type { ProjectDesign } from "./architecture-context.js";

export interface ContextInput {
  projectName: string;
  design: ProjectDesign;
  language?: string;
  framework?: string;
  decisionsDir: string;
  effectivePolicy?: Pick<
    EffectivePolicy,
    | "checksStatus"
    | "architectureRules"
    | "languageGuidance"
    | "frameworkGuidance"
    | "gaps"
  >;
}

export function contextMarkdown(
  input: ContextInput,
  decisions: string[],
): string;
```

Context rendering in `contextMarkdown` keeps identical output and manifest hashes when `effectivePolicy.gaps` is empty. That output keeps unassessed conformance wording and inactive check status. Non-empty `effectivePolicy.gaps` renders explicit gap notes without certifying code or substituting another stack. Command `gwrk init` makes zero agent dispatches across fresh and repeat runs. Both `--context-only` and `--workspace` runs also make zero agent dispatches. Repeat runs preserve source files and human `Decided` ADRs. Repeat runs also preserve edited managed files and `workspaces` entries. Workflow execution in `WorkflowRuntime` forwards the resolved `ProjectProfile` into prompt conditioning and dispatch. Agent transport maps workflow types to policy scopes. Render selected skill rules once in the shared prompt. Keep the generated architecture target and ADR index as the sources for architecture rules and decision text. Use the effective policy section for the selection and any gaps.
