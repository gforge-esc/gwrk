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