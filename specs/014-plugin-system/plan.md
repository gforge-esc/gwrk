# Implementation Plan: 014 Plugin System (F014-R Rework)

**Branch**: `develop` | **Date**: 2026-06-03 | **Spec**: [spec.md](./spec.md)

## Summary

Implement a three-layer plugin architecture (Agent Backends, Skills, Workflows) that enables gwrk to be extended via CLI-native, pipe-composable plugins. This plan delivers the manifest-driven registry, the skill reasoning runtime, the Layer 1 AgentBackend adapters (ADR-006), and the Layer 2.5 WorkflowRuntime (JSON Intent Engine). It also adds R007 project perspective (toolchain detection, profile-aware routing) and ADR-009 ontology construction.

---

## Phases and File Structure

### Phase 1: Foundation (Plugin Loader & Registry) ✅ SHIPPED

Establish the core infrastructure for scanning, validating, and resolving plugins.

**Requirements Addressed:** FR-001, FR-002, FR-003, FR-004, FR-005, FR-013, US-001, US-002, US-003, US-004

---

### Phase 2: Skill Runtime (Layer 2) ✅ SHIPPED

Implement the execution engine for Layer 2 plugins (Skills).

**Requirements Addressed:** FR-006, FR-007, FR-008, FR-009, FR-010, US-005, US-006, US-007, US-008

---

### Phase 3: Agent Backend Adapters (Layer 1 - ADR-006) ✅ SHIPPED

Implement the normalized `AgentBackend` interface.

**Requirements Addressed:** FR-L1-001 to FR-L1-013, ADR-006

---

### Phase 4: Antigravity (agy) Adapter ✅ SHIPPED

Add the Antigravity CLI (`agy`) as a fourth built-in agent backend.

**Requirements Addressed:** FR-L1-001, FR-L1-002, FR-L1-003, FR-L1-004, FR-L1-010

---

### Phase 5: WorkflowRuntime (Layer 2.5 - F014-R) ✅ SHIPPED

Implement the `WorkflowRuntime` engine and the `IntentEngine` for native filesystem mutation.

**Requirements Addressed:** FR-L25-001, FR-L25-002, FR-L25-006, FR-L25-007, US-011, US-012, US-015

---

### Phase 6: DefineOrchestrator & CLI Rewiring ✅ SHIPPED

Implement the `DefineOrchestrator` state machine and rewire existing commands.

**Requirements Addressed:** FR-L25-003, FR-L25-004, US-011, US-013

---

### Phase 7: Provisioning & Migration ✅ SHIPPED

Overhaul `gwrk init` and provide migration/seeding tools.

**Requirements Addressed:** FR-011, FR-012, FR-L25-005, US-009, US-010, US-014

---

### Phase 8: Routing & Intelligence (ex-F008) ✅ SHIPPED

Implement the routing engine and historical learning.

**Requirements Addressed:** FR-L1-005

---

### Phase 8A: Review Plugin Layer ✅ SHIPPED

ReviewPlugin, review-code-cli, review-uat-cli.

**Requirements Addressed:** F014 Layer 3 (partial)

---

### Phase 9: Enforcement Skills (FR-014 / US-016) ✅ SHIPPED

Ship builtin enforcement skills.

**Requirements Addressed:** FR-014, US-016

---

### Phase 10: .agents/ Migration to Builtins (ADR-007) ✅ SHIPPED

Migrate all content into the builtin plugin architecture.

**Requirements Addressed:** FR-L25-003, US-011, ADR-007

---

### Phase 11: Research CLI (R006) ✅ SHIPPED

`gwrk define research <initiative>` scaffolding.

**Requirements Addressed:** FR-R006-001, US-017

---

### Phase 12: Methodology Dispatch (R006) ✅ SHIPPED

`--run` flag for `gwrk define research`.

**Requirements Addressed:** FR-R006-002, US-018

---

### Phase 13: Grounding Injection (ADR-009) ✅ SHIPPED

Dynamic injection of project knowledge documents.

**Requirements Addressed:** FR-L25-008, FR-ADR009-001, US-019

---

### Phase 14: .agents/ Deletion & Verification (ADR-007) ✅ SHIPPED

Delete the `.agents/` directory.

**Requirements Addressed:** ADR-007, US-011

---

### Phase 15: Profile-Aware Enforcement Routing (R007) ✅ SHIPPED

Record the implementation of language-aware enforcement skill resolution.

**Files (2):**
- `src/plugins/manifest.ts` (MODIFY: Add `language` field to `EnforcementSkillManifestSchema`)
- `src/plugins/skill-runtime.ts` (MODIFY: Filter built-in enforcement skills by `profile.stack.language`)

**Requirements Addressed:** FR-014, US-016

**Dependencies:** Phase 9

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| R007 | Only filter BUILTIN enforcement skills; project-local always loads |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-013 | Unit | `src/plugins/skill-runtime.ts` | Skips mismatched language builtins |

#### Done When
- `pnpm vitest run src/plugins/skill-runtime.test.ts` exits 0

---

### Phase 16: Toolchain Detection (R007)

Implement filesystem-based detection of project toolchains (primary, formatter, test) to refine enforcement routing and agent awareness.

**Files (3):**
- `src/engine/profile-detector.ts` (MODIFY: Detect Biome, Ruff, ESLint, Prettier, vitest, pytest signals)
- `src/engine/prompt-conditioner.ts` (MODIFY: Extend `ProjectProfile` interface with `toolchain`)
- `src/commands/project.ts` (MODIFY: Report `toolchain` in `gwrk project info --format json`)

**Requirements Addressed:** FR-015, US-023, DM-007

**Dependencies:** Phase 15

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| R007 | Detection MUST be zero-cost (filesystem-only, no process spawning) |
| TC-015 | No network calls or user prompts during detection |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-016 | Unit | `src/engine/profile-detector.ts` | Correctly identifies Biome/Ruff/ESLint signals |

#### Done When
- `gwrk project info --format json | jq '.toolchain.primary'` returns "biome" for a project with `biome.json`

---

### Phase 17: Context Gathering Mandate (R007)

Update the implement workflow to ensure agents read project profile and toolchain state before beginning work.

**Files (1):**
- `src/plugins/builtins/workflows/gwrk-implement/PROMPT.md` (MODIFY: Add `gwrk project info` and `gwrk project discover` to Step 1 preamble)

**Requirements Addressed:** FR-L25-013, US-024

**Dependencies:** Phase 16

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-004 | Use agent-native signals in the preamble |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| US-024 | Prompt Verification | `gwrk-implement/PROMPT.md` | Contains `gwrk project info` call |

#### Done When
- `cat src/plugins/builtins/workflows/gwrk-implement/PROMPT.md | grep "gwrk project info"` exits 0

---

### Phase 18: Ontology Construction Workflow (ADR-009)

Implement automated domain ontology generation using the Five Primitives methodology.

**Files (5):**
- `src/commands/define-ontology.ts` (NEW: `gwrk define ontology [--run]` handler)
- `src/engine/ontology-scaffold.ts` (NEW: Logic for directory and empty artifact creation)
- `src/engine/source-scanner.ts` (NEW: Scan specs and codebase for grounding material)
- `src/plugins/builtins/workflows/gwrk-ontology-construct/manifest.yaml` (NEW)
- `src/plugins/builtins/workflows/gwrk-ontology-construct/PROMPT.md` (NEW: Five Primitives methodology)

**Requirements Addressed:** FR-L25-009, FR-L25-010, FR-L25-011, FR-L25-012, US-020, US-021, US-022

**Dependencies:** Phase 13, Phase 17

**Contract Mapping:**
- `contracts/ontology.md` → `scaffold(root)` → `src/engine/ontology-scaffold.ts`
- `contracts/ontology.md` → `construct(root)` → `src/commands/define-ontology.ts`
- `contracts/ontology.md` → `scan(root)` → `src/engine/source-scanner.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-009 | Output MUST follow Classes, Properties, Relations, Individuals, Axioms |
| TC-014 | Enforce Five Primitives structure |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-014 | Unit | `src/engine/ontology-scaffold.ts` | Creates .gwrk/ontology and .gwrk/perspective |
| TR-015 | Unit | `src/engine/source-scanner.ts` | Discovers architecture.md and specs/ |

#### Done When
- `gwrk define ontology --run` produces a grounded `domain.md` file

---

### Phase 9: Enforcement Skills (FR-014 / US-016)

Ship builtin enforcement skills that teach implementing agents gwrk's operational vocabulary and coding standards. Enforcement skills are auto-loaded by SkillRuntime at dispatch time and injected into agent context for all write workflows (implement, review-code, review-uat).

**Design Decisions (ADR-006 §2.2, ADR-007 §2.2):**
- **Loading**: SkillRuntime auto-injection at dispatch time (ADR-006 Dual-Layer Context — enforcement sits at Layer 1/2 boundary)
- **Resolution**: `tier: enforcement` follows workflow resolution order (builtins → global → project-local), not global-only. This is a semantic exception to TC-004 per US-016 AC 3.
- **Naming**: Two separate builtins — `gwrk-conventions` (platform vocabulary) + `typescript-standards` (language/toolchain)

**Files (8):**
- `src/plugins/builtins/skills/gwrk-conventions/SKILL.md` (NEW: valid task statuses, tasks.json Zod schema, commit identity rules, `.agents/` is legacy, file naming)
- `src/plugins/builtins/skills/gwrk-conventions/manifest.yaml` (NEW: `type: skill`, `tier: enforcement`, `scope: implementation`)
- `src/plugins/builtins/skills/typescript-standards/SKILL.md` (NEW: strict typing, no `any`, lint compliance, no `.js`/`.jsx` in `src/`, ESM conventions)
- `src/plugins/builtins/skills/typescript-standards/manifest.yaml` (NEW: `type: skill`, `tier: enforcement`, `scope: implementation`)
- `src/plugins/skill-runtime.ts` (MODIFY: add `resolveEnforcementSkills(projectRoot)` — scans builtins, global, and project-local for `tier: enforcement` manifests, returns SKILL.md content)
- `src/plugins/manifest.ts` (MODIFY: add `tier: enforcement` to `SkillManifestSchema`, add `scope` field)
- `src/utils/agent.ts` (MODIFY: call `resolveEnforcementSkills()` during dispatch context assembly, inject into `<code_quality>` section)
- `src/plugins/builtins/workflows/gwrk-implement/PROMPT.md` (MODIFY: replace inline `<code_quality>` placeholder with `{{enforcement}}` marker — resolved by SkillRuntime)

**Requirements Addressed:** FR-014, US-016, FR-013 (enforcement tier), FR-010 (help listing)

**Dependencies:** Phase 1 (manifest schema), Phase 2 (skill runtime), Phase 8A (review dispatch)

**Contract Mapping:**
- `contracts/skill-runtime.md` → `resolveEnforcementSkills(root)` → `src/plugins/skill-runtime.ts`
- `contracts/plugin-registry.md` → `tier: enforcement` manifest → `src/plugins/manifest.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-005 | Gates MUST verify enforcement skill content is injected into dispatch prompts |
| ADR-006 §2.2 | Enforcement skills are Layer 1 (Durable Governance) content — project-level, not per-task |
| ADR-007 §2.2 | Resolution follows builtins → global → project-local hierarchy |
| compile-gate | Always |

#### Test Strategy
| ID | Type | Subject | Assertion |
|---|---|---|---|
| TR-P9-001 | Unit | `skill-runtime.ts` | `resolveEnforcementSkills()` returns builtin SKILL.md content |
| TR-P9-002 | Unit | `skill-runtime.ts` | Project-local `.gwrk/plugins/skills/typescript-standards/` overrides builtin |
| TR-P9-003 | Unit | `manifest.ts` | `tier: enforcement` validates in SkillManifestSchema; `scope: implementation` accepted |
| TR-P9-004 | Integration | `gwrk plugin list` | Shows enforcement skills with `tier: enforcement` grouping |
| TR-P9-005 | Integration | Dispatch context | `dispatchToAgent()` stdin includes enforcement skill content in `<code_quality>` section |
| TR-P9-006 | Unit | `gwrk-conventions` SKILL.md | Contains valid task status enum: `open \| in_progress \| completed \| cancelled` |

#### Done When
- `gwrk plugin list --type skills | grep typescript-standards` exits 0 with `tier: enforcement`
- `gwrk plugin list --type skills | grep gwrk-conventions` exits 0 with `tier: enforcement`
- Implementing agent's dispatch prompt includes enforcement skill content (verified by TR-P9-005)
- Local `.gwrk/plugins/skills/typescript-standards/` overrides builtin (verified by TR-P9-002)
- `pnpm build` passes
- `pnpm test` passes

---

> Eliminate gwrk's runtime dependency on the `.agents/` directory by migrating all content into the builtin plugin architecture. After this phase, `.agents/` is inert — nothing reads from it at runtime.

**Requirements Addressed:** FR-L25-003 (core workflows independent of `.agents/`), TC-011 (zero-dependency workflows), US-011 (execute workflows without `.agents/`), ADR-007

**Dependencies:** Phase 8 (review dispatch already migrated)

#### Files

**Rules migration:**
- `src/plugins/builtins/rules/operating-model.md` (NEW: copy from `.agents/rules/operating-model.md`)
- `src/plugins/builtins/rules/workspace.md` (NEW: copy from `.agents/rules/workspace.md`)
- `src/commands/init.ts` (MODIFY: seed `.gwrk/rules/` from `builtins/rules/` during `gwrk init`)

**Missing builtin workflows (5):**
- `src/plugins/builtins/workflows/gwrk-analyze/manifest.yaml` (NEW)
- `src/plugins/builtins/workflows/gwrk-analyze/PROMPT.md` (NEW: from `.agents/workflows/gwrk-analyze.md`)
- `src/plugins/builtins/workflows/gwrk-cascade-sync/manifest.yaml` (NEW)
- `src/plugins/builtins/workflows/gwrk-cascade-sync/PROMPT.md` (NEW: from `.agents/workflows/gwrk-cascade-sync.md`)
- `src/plugins/builtins/workflows/gwrk-checklist/manifest.yaml` (NEW)
- `src/plugins/builtins/workflows/gwrk-checklist/PROMPT.md` (NEW: from `.agents/workflows/gwrk-checklist.md`)
- `src/plugins/builtins/workflows/gwrk-constitution/manifest.yaml` (NEW)
- `src/plugins/builtins/workflows/gwrk-constitution/PROMPT.md` (NEW: from `.agents/workflows/gwrk-constitution.md`)
- `src/plugins/builtins/workflows/gwrk-effort/manifest.yaml` (NEW)
- `src/plugins/builtins/workflows/gwrk-effort/PROMPT.md` (NEW: from `.agents/workflows/gwrk-effort.md`)

**Personas:**
- `src/plugins/builtins/personas/principal-engineer.md` (NEW: from `.agents/prompts/personas/`)
- `src/plugins/builtins/personas/product-manager.md` (NEW: from `.agents/prompts/personas/`)
- `src/plugins/builtins/personas/senior-dev.md` (NEW: from `.agents/prompts/personas/`)

**Templates:**
- `.specify/templates/verification-gate.md` (NEW: from `.agents/templates/verification-gate.md`)
- `.specify/templates/monorepo-context.md` (NEW: from `.agents/templates/monorepo-context.md`)
- `.specify/templates/e2e-patterns.md` (NEW: from `.agents/templates/e2e-patterns.md`)

**Reference updates:**
- `src/plugins/skill-runtime.ts` (MODIFY: remove `.agents/skills/` symbolic log path at L125)
- `src/server/slack-agent.ts` (MODIFY: remove `.agents/workflows/` string check at L26)
- `AGENTS.md` (MODIFY: `.agents/rules/` → `.gwrk/rules/`)

**Dead code removal:**
- `.agents/scripts/parser/parser-scaffold.sh` — not referenced in src/. Delete.
- `.agents/scripts/parser/parser-validate.sh` — not referenced in src/. Delete.
- `.agents/workflows/plan.md` — superseded by `gwrk-plan`. Delete.
- `.agents/workflows/specify.md` — superseded by `gwrk-specify`. Delete.

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| governance-audit | Verify all 15 gwrk-* workflows resolve from builtins without .agents/ |
| compile-gate | Always |

#### Test Strategy
| ID | Type | Subject | Assertion |
|---|---|---|---|
| TR-P10-001 | Unit | `init.ts` rules seeding | `gwrk init` creates `.gwrk/rules/operating-model.md` and `workspace.md` |
| TR-P10-002 | Integration | Builtin workflow resolution | All 15 `gwrk-*` workflows resolve via `PluginLoader` from builtins dir |
| TR-P10-003 | Unit | `skill-runtime.ts` | No `.agents/` path in log strings |
| TR-P10-004 | Unit | `slack-agent.ts` | No `.agents/workflows/` string check |

#### Done When
- `gwrk init` creates `.gwrk/rules/` with `operating-model.md` and `workspace.md`
- All 15 `gwrk-*` workflows resolve from `builtins/workflows/` (verified by TR-P10-002)
- No runtime source file contains a hardcoded `.agents/` filesystem path
- `pnpm build` passes
- `pnpm test` passes

---

### Phase 11: .agents/ Deletion & Verification (ADR-007)

> Delete the `.agents/` directory from the repository and verify gwrk functions without it. This is the final cleanup — all content has been migrated in Phase 10.

**Requirements Addressed:** US-011 AC L303 ("No `.agents/` directory is created in the project root by default"), TC-011, ADR-007

**Dependencies:** Phase 10

#### Files
- `.agents/` (DELETE: entire directory tree — 39 files)
- `src/plugins/migrate.ts` (MODIFY: add deprecation warning if `.agents/` detected — advise `gwrk init`)
- `src/engine/drift-detector.ts` (MODIFY: remove `.agents/` artifact check at L24-52 — directory no longer exists)

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| governance-audit | Post-deletion full verification |
| compile-gate | Always |

#### Test Strategy
| ID | Type | Subject | Assertion |
|---|---|---|---|
| TR-P11-001 | Integration | Full workflow resolution | `gwrk define spec --help` resolves, no `.agents/` fallback |
| TR-P11-002 | Integration | Review dispatch | `gwrk ship` review stage sends full PROMPT.md, not skeleton |
| TR-P11-003 | Unit | `migrate.ts` | Warns when `.agents/` exists in target project |
| TR-P11-004 | Unit | `drift-detector.ts` | No `.agents/` references in drift checks |

#### Done When
- `.agents/` directory does not exist in the repository
- `git ls-files .agents/` returns empty
- `grep -rn '\.agents/' src/ --include='*.ts'` returns zero results (excluding `config.agents` property access)
- `pnpm build` passes
- `pnpm test` passes
- `gwrk define spec --help` resolves workflow from builtins

---

### Phase 19: Extension Schema and Runtime (Layer 3)

Implement the discovery and resolution engine for Layer 3 Extension Plugins, including the updated manifest schemas.

**Files (4):**
- `src/plugins/manifest.ts` (MODIFY: Add `ExtensionManifestSchema` and update discriminated union)
- `src/plugins/extension-runtime.ts` (NEW: Extension discovery and `resolveExtensionContext()` logic)
- `src/plugins/context-provider.ts` (NEW: `ContextProvider` interface)
- `src/utils/config.ts` (MODIFY: Support `extensions` block in `.gwrkrc.json`)

**Requirements Addressed:** FR-L3-001, FR-L3-002, FR-L3-003, FR-L3-004, FR-L3-005, US-025, US-026

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/extension-runtime.md` → `resolveExtensionContext()` → `src/plugins/extension-runtime.ts`
- `contracts/extension-runtime.md` → `ContextProvider` → `src/plugins/context-provider.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-004 | Use agent-native signals |
| TC-016 | Extension Isolation (try-catch around provider calls) |
| TC-018 | Silent Fail for missing extensions |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-017 | Unit | `src/plugins/extension-runtime.ts` | Discovers extensions, loads config, and aggregates context safely |

#### Done When
- `pnpm vitest run src/plugins/extension-runtime.test.ts` exits 0

---

### Phase 20: Built-in Obsidian Vault Extension

Implement the reference `obsidian-vault` extension plugin to provide context from a local Obsidian vault.

**Files (2):**
- `src/plugins/builtins/extensions/obsidian-vault/manifest.yaml` (NEW: `provides: [context]`)
- `src/plugins/builtins/extensions/obsidian-vault/adapter.ts` (NEW: Implements `ContextProvider` interface)

**Requirements Addressed:** FR-L3-007, US-027

**Dependencies:** Phase 19

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| TC-016 | Adapter must not crash process |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-019 | Unit | `src/plugins/builtins/extensions/obsidian-vault/adapter.ts` | Returns context items matching keywords |

#### Done When
- `pnpm vitest run src/plugins/builtins/extensions/obsidian-vault/adapter.test.ts` exits 0

---

### Phase 21: Context Injection in Dispatch

Automate the injection of extension-provided data into `dispatchToAgent()` calls to enrich agent prompts.

**Files (1):**
- `src/utils/agent.ts` (MODIFY: Call `resolveExtensionContext()` and inject into `<external_context>` block)

**Requirements Addressed:** FR-L3-006, US-027

**Dependencies:** Phase 19

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| TC-017 | Context Truncation (enforce token/character limits) |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-018 | Unit | `src/utils/agent.ts` | Injects output of `resolveExtensionContext` into prompt |

#### Done When
- `pnpm vitest run src/utils/agent.test.ts` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `AnyManifest` | `src/plugins/manifest.ts` | Loader, Registry, CLI |
| `JsonIntent` | `src/plugins/manifest.ts` | WorkflowRuntime, IntentEngine |
| `TaskDispatch` | `src/utils/agent.ts` | AgentBackend, Router |
| `TaskResult` | `src/utils/agent.ts` | AgentBackend, Ship Loop |
| `ProjectProfile` | `src/engine/prompt-conditioner.ts` | ProfileDetector, SkillRuntime |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| FR-L1-007 | github-integration dispatchMode | Codex Cloud integration is a separate high-effort feature (F005 Tier 3) | Wave 5 |
| Layer 3 | Extension Plugins (remaining) | Review plugins (Phase 8) are the first L3 use case. Domain Packs and Channel Adapters require F012 and F017 | Wave 7 |
| `.agents/skills/` | Skill migration via `gwrk plugin migrate` | Skills already dual-exist in `~/.gwrk/plugins/skills/` (seeded by init). `.agents/skills/` retained for IDE compatibility per TC-006 | Phase 11 deletes `.agents/` wholesale |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 1 | ✅ Done |
| US-002 | 1 | ✅ Done |
| US-003 | 1 | ✅ Done |
| US-004 | 1 | ✅ Done |
| US-005 | 2 | ✅ Done |
| US-006 | 2 | ✅ Done |
| US-007 | 2 | ✅ Done |
| US-008 | 2 | ✅ Done |
| US-009 | 7 | ✅ Done |
| US-010 | 7 | ✅ Done |
| US-011 | 5, 6, 10, 14 | ✅ Done |
| US-012 | 5 | ✅ Done |
| US-013 | 6 | ✅ Done |
| US-014 | 7 | ✅ Done |
| US-015 | 5 | ✅ Done |
| US-016 | 9, 15 | ✅ Done |
| US-017 | 11 | ✅ Done |
| US-018 | 12 | ✅ Done |
| US-019 | 13 | ✅ Done |
| US-020 | 18 | PLANNED |
| US-021 | 18 | PLANNED |
| US-022 | 18 | PLANNED |
| US-023 | 16 | PLANNED |
| US-024 | 17 | PLANNED |
| FR-001 | 1 | ✅ Done |
| FR-002 | 1 | ✅ Done |
| FR-003 | 1 | ✅ Done |
| FR-004 | 1 | ✅ Done |
| FR-005 | 1 | ✅ Done |
| FR-006 | 2, 3 | ✅ Done |
| FR-007 | 2 | ✅ Done |
| FR-008 | 2 | ✅ Done |
| FR-009 | 2 | ✅ Done |
| FR-010 | 2 | ✅ Done |
| FR-011 | 7 | ✅ Done |
| FR-012 | 7 | ✅ Done |
| FR-013 | 1, 9 | ✅ Done |
| FR-014 | 9, 15 | ✅ Done |
| FR-015 | 16 | PLANNED |
| FR-L1-001 | 3, 4 | ✅ Done |
| FR-L1-002 | 3, 4 | ✅ Done |
| FR-L1-003 | 3, 4 | ✅ Done |
| FR-L1-004 | 3, 4 | ✅ Done |
| FR-L1-005 | 3, 8 | ✅ Done |
| FR-L1-006 | 3 | ✅ Done |
| FR-L1-007 | Deferred | ✅ Done |
| FR-L1-008 | 7 | ✅ Done |
| FR-L1-009 | 3 | ✅ Done |
| FR-L1-010 | 3, 4 | ✅ Done |
| FR-L1-011 | 1 | ✅ Done |
| FR-L1-012 | 1 | ✅ Done |
| FR-L1-013 | 1 | ✅ Done |
| FR-L25-001 | 5 | ✅ Done |
| FR-L25-002 | 5 | ✅ Done |
| FR-L25-003 | 6, 10 | ✅ Done |
| FR-L25-004 | 6 | ✅ Done |
| FR-L25-005 | 7 | ✅ Done |
| FR-L25-006 | 5 | ✅ Done |
| FR-L25-007 | 5 | ✅ Done |
| FR-L25-008 | 13 | ✅ Done |
| FR-L25-009 | 18 | PLANNED |
| FR-L25-010 | 18 | PLANNED |
| FR-L25-011 | 18 | PLANNED |
| FR-L25-012 | 18 | PLANNED |
| FR-L25-013 | 17 | PLANNED |
| FR-R006-001 | 11 | ✅ Done |
| FR-R006-002 | 12 | ✅ Done |
| FR-ADR009-001 | 13 | ✅ Done |
| DM-001 to DM-007 | 1, 16 | ✅ Done |
| TC-006 | 10, 14 | ✅ Done |
| TC-011 | 10, 14 | ✅ Done |
| TC-013 | 13 | ✅ Done |
| TC-014 | 18 | PLANNED |
| TC-015 | 16 | PLANNED |
| TR-001 to TR-012 | All | ✅ Done |
| TR-P10-001 to TR-P10-004 | 10 | ✅ Done |
| TR-P11-001 to TR-P11-004 | 14 | ✅ Done |
| TR-P9-001 to TR-P9-006 | 9 | ✅ Done |
| TR-P12-001 | 12 | ✅ Done |
| TR-013 | 15 | ✅ Done |
| TR-014 | 18 | PLANNED |
| TR-015 | 18 | PLANNED |
| TR-016 | 16 | PLANNED |
| VR-011 to VR-016 | All | ✅ Done |
| VR-017 | 11 | ✅ Done |
| VR-018 | 11, 12 | ✅ Done |
| VR-019 | 18 | PLANNED |
| VR-020 | 16 | PLANNED |
| US-025 | 19 | PLANNED |
| US-026 | 19 | PLANNED |
| US-027 | 20, 21 | PLANNED |
| FR-L3-001 | 19 | PLANNED |
| FR-L3-002 | 19 | PLANNED |
| FR-L3-003 | 19 | PLANNED |
| FR-L3-004 | 19 | PLANNED |
| FR-L3-005 | 19 | PLANNED |
| FR-L3-006 | 21 | PLANNED |
| FR-L3-007 | 20 | PLANNED |
| DM-006 | 19 | PLANNED |
| DM-008 | 19 | PLANNED |
| TC-016 | 19, 20, 21 | PLANNED |
| TC-017 | 21 | PLANNED |
| TC-018 | 19, 21 | PLANNED |
| TR-017 | 19 | PLANNED |
| TR-018 | 21 | PLANNED |
| TR-019 | 20 | PLANNED |
| VR-021 | 21 | PLANNED |
| VR-022 | 19, 20, 21 | PLANNED |
