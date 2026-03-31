# Implementation Plan: 014 Plugin System (F014-R Rework)

**Branch**: `develop` | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)

## Summary

Implement a three-layer plugin architecture (Agent Backends, Skills, Workflows) that enables gwrk to be extended via CLI-native, pipe-composable plugins. This plan delivers the manifest-driven registry, the skill reasoning runtime, the Layer 1 AgentBackend adapters (ADR-006), and the Layer 2.5 WorkflowRuntime (JSON Intent Engine) required for shareability and bash eradication.

---

## Phases and File Structure

### Phase 1: Foundation (Plugin Loader & Registry)

Establish the core infrastructure for scanning, validating, and resolving plugins. This phase implements the Zod-validated `manifest.yaml` contract and the global-to-local resolution logic.

**Files (7):**
- `src/plugins/manifest.ts` (NEW: Zod schemas for Skill, Agent, and Workflow manifests)
- `src/plugins/loader.ts` (NEW: Plugin scanner, registry, and resolution engine)
- `src/commands/plugin.ts` (NEW: `gwrk plugin list/install/remove/disable/enable` handlers)
- `src/utils/config.ts` (MODIFY: Add support for reading `~/.gwrk/plugins/` paths)
- `src/plugins/manifest.test.ts` (NEW: Unit tests for manifest validation)
- `src/plugins/loader.test.ts` (NEW: Unit tests for resolution order)
- `src/commands/plugin.test.ts` (NEW: Integration tests for plugin CLI)

**Requirements Addressed:** FR-001, FR-002, FR-003, FR-004, FR-005, FR-013, US-001, US-002, US-003, US-004, TC-001, TC-002, TC-004, TC-005, TC-009

**Dependencies:** None

**Contract Mapping:**
- `contracts/plugin-registry.md` → `getPlugin(name)` → `src/plugins/loader.ts`
- `contracts/plugin-registry.md` → `listPlugins(options)` → `src/plugins/loader.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-004 | Plugin commands MUST emit `[exit:N | Xs]` signals |
| decision-forge | Applied to plugin resolution priority (Global vs Local) |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/plugins/manifest.ts` | Validates Atomic/Compound/Agent/Workflow manifests |
| TR-002 | Unit | `src/plugins/loader.ts` | Global -> Local Override -> Local Disable resolution order |
| TR-003 | Integration | `src/commands/plugin.ts` | `install` validates then copies; `remove` warns on dependencies |

#### Done When
- `pnpm vitest run src/plugins/loader.test.ts` exits 0

---

### Phase 2: Skill Runtime (Layer 2)

Implement the execution engine for Layer 2 plugins (Skills). This includes assembling multi-pass prompts for compound skills and invoking agents with the full F013 contract.

**Files (5):**
- `src/plugins/skill-runtime.ts` (NEW: Atomic/Compound assembly and execution logic)
- `src/commands/skill.ts` (NEW: `gwrk skill <name>` command handler)
- `src/utils/agent-layer.ts` (MODIFY: Support ANSI stripping and binary guards for skill output)
- `src/plugins/skill-runtime.test.ts` (NEW: Unit tests for prompt assembly)
- `src/commands/skill.test.ts` (NEW: Integration tests for skill piping)

**Requirements Addressed:** FR-006, FR-007, FR-008, FR-009, FR-010, US-005, US-006, US-007, US-008, TC-007, TC-008

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/skill-runtime.md` → `executeSkill(name, input)` → `src/plugins/skill-runtime.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-004 | Skill output MUST be ANSI-stripped in --agent mode |
| skills-architecture.md | Two-tier hierarchy enforcement |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-004 | Unit | `src/plugins/skill-runtime.ts` | Compound skills assemble all passes into a single prompt |
| TR-008 | Integration | `src/commands/skill.ts` | `gwrk skill A | gwrk skill B` preserves signals on stderr |

#### Done When
- `echo "test" | gwrk skill narrative` (mocked) exits 0 with signal on stderr

---

### Phase 3: Agent Backend Adapters (Layer 1 - ADR-006)

Implement the normalized `AgentBackend` interface. This replaces hardcoded CLI dispatch with a plugin-driven adapter model.

**Files (7):**
- `src/plugins/builtins/agents/index.ts` (NEW: Static registry of built-in adapters)
- `src/plugins/builtins/agents/claude/adapter.ts`, `gemini/adapter.ts`, `codex/adapter.ts` (NEW: Adapters)
- `src/utils/agent.ts` (MODIFY: Replace spawn logic with `AgentBackend.dispatch()`)
- `src/commands/sync-context.ts` (NEW: `gwrk plugin sync-context` handler)
- `src/db/migrations/003-agent-context.sql` (NEW: Track sync state in SQLite)
- `src/plugins/agent-adapter.test.ts` (NEW: Verify exit normalization)

**Requirements Addressed:** FR-L1-001 to FR-L1-013, TC-010, ADR-006

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/agent-backend.md` → `dispatch(task)` → `src/plugins/builtins/agents/*`
- `contracts/agent-backend.md` → `syncGovernance(root, gov)` → `src/plugins/builtins/agents/*`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-006 | Stdin context delivery is REQUIRED |
| ADR-006 | Exit code normalization: Gemini 53 -> gwrk 1 |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| FR-L1-003 | Unit | `parseResult()` | Normalizes proprietary exit codes to gwrk standard |
| FR-L1-004 | Integration | `syncGovernance()` | Updates context files from agent-context.md |

#### Done When
- `gwrk plugin sync-context` generates context files with boundary markers

---

### Phase 4: WorkflowRuntime (Layer 2.5 - F014-R)

Implement the `WorkflowRuntime` engine and the `IntentEngine` for native filesystem mutation. This is the core of the F014-R rework.

**Files (6):**
- `src/plugins/workflow-runtime.ts` (NEW: Resolve and execute workflows via agents)
- `src/engine/intent-engine.ts` (NEW: Native FS mutation: `WRITE_FILE`, `CREATE_DIR`, `RUN_COMMAND`)
- `src/plugins/builtins/workflows/` (NEW: 10 core workflows as built-in plugins)
- `src/plugins/workflow-runtime.test.ts` (NEW: Verify JSON intent parsing and validation)
- `src/engine/intent-engine.test.ts` (NEW: Verify FS path containment and execution)

**Requirements Addressed:** FR-L25-001, FR-L25-002, FR-L25-006, FR-L25-007, US-011, US-012, US-015, TC-011

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/workflow-runtime.md` → `executeWorkflow(name, input)` → `src/plugins/workflow-runtime.ts`
- `contracts/workflow-runtime.md` → `executeIntents(intents, root)` → `src/engine/intent-engine.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| cascade-sync | LLMs MUST NOT directly mutate the filesystem |
| decision-forge | Path containment enforcement for `IntentEngine` |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-009 | Unit | `WorkflowRuntime` | Catches invalid JSON intents and exits 1 |
| TR-011 | Integration | `IntentEngine` | Blocks file writes outside the project root |

#### Done When
- `gwrk-specify` workflow executes in memory and returns valid `WRITE_FILE` intents

---

### Phase 5: DefineOrchestrator & CLI Rewiring

Implement the `DefineOrchestrator` state machine and rewire existing commands to use the `WorkflowRuntime`. This eradicates the dependency on `define-until-solid.sh`.

**Files (5):**
- `src/engine/define-orchestrator.ts` (NEW: TS state machine for spec->plan->tasks loop)
- `src/commands/specify.ts`, `plan.ts`, `tasks-generate.ts` (MODIFY: Rewire to `WorkflowRuntime`)
- `src/engine/define-orchestrator.test.ts` (NEW: Verify state transitions)
- `src/commands/specify.test.ts`, `plan.test.ts` (MODIFY: E2E verification)

**Requirements Addressed:** FR-L25-003, FR-L25-004, US-011, US-013

**Dependencies:** Phase 4

**Contract Mapping:**
- `contracts/workflow-runtime.md` → `runLoop(specPath)` → `src/engine/define-orchestrator.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| architecture-stress-test | Applied to state machine transitions |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-010 | Unit | `DefineOrchestrator` | Transitions through SPEC, PLAN, TASKS sequentially |
| TR-012 | E2E | `gwrk specify` | Successfully creates a spec file via WorkflowRuntime |

#### Done When
- `gwrk specify my-feature` works in a directory without an `.agents/` folder

---

### Phase 6: Provisioning & Migration

Overhaul `gwrk init` to provision the global home and provide migration/seeding tools.

**Files (6):**
- `src/commands/init.ts` (MODIFY: Provision `~/.gwrk/plugins/` with built-ins)
- `src/plugins/migrate.ts` (NEW: `.agents/` to `~/.gwrk/plugins/` migration)
- `src/plugins/seed.ts` (NEW: Taxonomy to atomic skills seeding)
- `src/commands/init.test.ts`, `src/plugins/migrate.test.ts`, `src/plugins/seed.test.ts`

**Requirements Addressed:** FR-011, FR-012, FR-L25-005, US-009, US-010, US-014, TC-006

**Dependencies:** Phase 2, Phase 4, Phase 5

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| TC-006 | Original `.agents/` files MUST NOT be deleted during migration |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit | `migrate()` | Generates valid `manifest.yaml` from frontmatter |
| TR-006 | Unit | `seed()` | Categories (reasoning, evaluative, etc.) are preserved |

#### Done When
- `gwrk init` populates `~/.gwrk/plugins/workflows/` with 10 core workflows

---

### Phase 7: Routing & Intelligence (ex-F008)

Implement the routing engine that selects the optimal backend based on task type, quota, and historical success.

**Files (5):**
- `src/engine/router.ts` (NEW: `selectBackend()` logic with fallback chains)
- `src/engine/quota.ts` (NEW: Quota probing per adapter)
- `src/db/migrations/004-routing-history.sql` (NEW: `routing_decisions` table)
- `src/engine/router.test.ts` (NEW: Verify fallback chains and historical learning)
- `src/commands/status.ts` (MODIFY: Include backend availability in status)

**Requirements Addressed:** FR-014 (Phase 4), FR-L1-005, TC-009

**Dependencies:** Phase 3

**Contract Mapping:**
- `contracts/router.md` → `selectBackend(task)` → `src/engine/router.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| decision-forge | Applied to fallback ordering and quota prioritization |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| FR-P4-001 | Unit | `selectBackend()` | Respects `fallbackOrder` from `.gwrkrc.json` |
| FR-P4-002 | Unit | `quotaProbe()` | Detects 429/rate-limit and applies backoff |

#### Done When
- `gwrk status` correctly identifies unavailable backends via quota probing

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `AnyManifest` | `src/plugins/manifest.ts` | Loader, Registry, CLI |
| `JsonIntent` | `src/plugins/manifest.ts` | WorkflowRuntime, IntentEngine |
| `TaskDispatch` | `src/utils/agent.ts` | AgentBackend, Router |
| `TaskResult` | `src/utils/agent.ts` | AgentBackend, Ship Loop |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| FR-L1-007 | github-integration dispatchMode | Codex Cloud integration is a separate high-effort feature (F005 Tier 3) | Wave 5 |
| Layer 3 | Extension Plugins | Requires F012 (Knowledge Work) and F017 (Channel Abstraction) specs | Wave 7 |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 1 | Planned |
| US-002 | 1 | Planned |
| US-003 | 1 | Planned |
| US-004 | 1 | Planned |
| US-005 | 2 | Planned |
| US-006 | 2 | Planned |
| US-007 | 2 | Planned |
| US-008 | 2 | Planned |
| US-009 | 6 | Planned |
| US-010 | 6 | Planned |
| US-011 | 4, 5 | Planned |
| US-012 | 4 | Planned |
| US-013 | 5 | Planned |
| US-014 | 6 | Planned |
| US-015 | 4 | Planned |
| FR-001 | 1 | Planned |
| FR-002 | 1 | Planned |
| FR-003 | 1 | Planned |
| FR-004 | 1 | Planned |
| FR-005 | 1 | Planned |
| FR-006 | 2, 3 | Planned |
| FR-007 | 2 | Planned |
| FR-008 | 2 | Planned |
| FR-009 | 2 | Planned |
| FR-010 | 2 | Planned |
| FR-011 | 6 | Planned |
| FR-012 | 6 | Planned |
| FR-013 | 1 | Planned |
| FR-L1-001 | 3 | Planned |
| FR-L1-002 | 3 | Planned |
| FR-L1-003 | 3 | Planned |
| FR-L1-004 | 3 | Planned |
| FR-L1-005 | 3, 7 | Planned |
| FR-L1-006 | 3 | Planned |
| FR-L1-007 | Deferred | Deferred |
| FR-L1-008 | 6 | Planned |
| FR-L1-009 | 3 | Planned |
| FR-L1-010 | 3 | Planned |
| FR-L1-011 | 1 | Planned |
| FR-L1-012 | 1 | Planned |
| FR-L1-013 | 1 | Planned |
| FR-L25-001 | 4 | Planned |
| FR-L25-002 | 4 | Planned |
| FR-L25-003 | 5 | Planned |
| FR-L25-004 | 5 | Planned |
| FR-L25-005 | 6 | Planned |
| FR-L25-006 | 4 | Planned |
| FR-L25-007 | 4 | Planned |
| DM-001 to DM-007 | 1 | Planned |
| TC-001 to TC-011 | All | Planned |
| TR-001 to TR-012 | All | Planned |
| VR-011 to VR-016 | All | Planned |
