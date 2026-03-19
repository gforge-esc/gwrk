# Implementation Plan: 014 Plugin System

**Branch**: `develop` | **Date**: 2026-03-19 | **Spec**: [spec.md](./spec.md)

## Summary

Implement a three-layer plugin architecture (Agent Backends, Skills, Extensions) that enables gwrk to be extended via CLI-native, pipe-composable plugins. This plan delivers the manifest-driven registry, the skill reasoning runtime, the normalized AgentBackend interface (ADR-006), and the routing intelligence (ex-F008) required for multi-agent orchestration.

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
- `src/plugins/loader.test.ts` (NEW: Unit tests for plugin resolution order)
- `src/commands/plugin.test.ts` (NEW: Integration tests for plugin CLI)

**Requirements Addressed:** FR-001, FR-002, FR-003, FR-004, FR-005, FR-013, TC-001, TC-002, TC-004, TC-005, TC-009

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
| TR-001 | Unit | `src/plugins/manifest.ts` | Validates Atomic/Compound/Agent manifests, rejects unknown types |
| TR-002 | Unit | `src/plugins/loader.ts` | Global -> Local Override -> Local Disable resolution order |
| TR-003 | Integration | `src/commands/plugin.ts` | `install` validates then copies; `remove` warns on dependencies |

#### Done When
- `pnpm vitest run src/plugins/loader.test.ts` exits 0

---

### Phase 2: Skill Runtime

Implement the execution engine for Layer 2 plugins (Skills). This includes assembling multi-pass prompts for compound skills and invoking agents with the full F013 contract.

**Files (5):**
- `src/plugins/skill-runtime.ts` (NEW: Atomic/Compound assembly and execution logic)
- `src/commands/skill.ts` (NEW: `gwrk skill <name>` command handler)
- `src/utils/agent-layer.ts` (MODIFY: Support ANSI stripping and binary guards for skill output)
- `src/plugins/skill-runtime.test.ts` (NEW: Unit tests for prompt assembly and mock invocation)
- `src/commands/skill.test.ts` (NEW: Integration tests for skill piping)

**Requirements Addressed:** FR-006, FR-007, FR-008, FR-009, FR-010, TC-007, TC-008

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

### Phase 3: Agent Backend Adapters (Layer 1)

Implement the normalized `AgentBackend` interface as per ADR-006. This replaces hardcoded CLI dispatch with a plugin-driven adapter model.

**Files (8):**
- `src/plugins/builtins/agents/index.ts` (NEW: Static registry of built-in adapters)
- `src/plugins/builtins/agents/claude/adapter.ts` (NEW: Claude Code adapter)
- `src/plugins/builtins/agents/gemini/adapter.ts` (NEW: Gemini CLI adapter)
- `src/plugins/builtins/agents/codex/adapter.ts` (NEW: Codex CLI adapter)
- `src/utils/agent.ts` (MODIFY: Replace spawn logic with `AgentBackend.dispatch()`)
- `src/commands/sync-context.ts` (NEW: `gwrk plugin sync-context` handler)
- `src/db/migrations/003-agent-context.sql` (NEW: Track sync state in SQLite)
- `src/plugins/agent-adapter.test.ts` (NEW: Verify stdin delivery and exit normalization)

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
| FR-L1-004 | Integration | `syncGovernance()` | Updates GEMINI.md/CLAUDE.md from agent-context.md |

#### Done When
- `gwrk plugin sync-context` generates context files with boundary markers

---

### Phase 4: Routing & Intelligence

Implement the routing engine that selects the optimal backend based on task type, quota, and historical success. Absorbs the retired F008 feature.

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

### Phase 5: Migration & Seeding

Provide tools for migrating legacy skills and seeding the atomic skill library from the reasoning modes taxonomy.

**Files (4):**
- `src/plugins/migrate.ts` (NEW: `.agents/skills/` migration logic)
- `src/plugins/seed.ts` (NEW: `reasoning-modes.md` parsing and plugin generation)
- `src/plugins/migrate.test.ts` (NEW: Verify manifest generation from frontmatter)
- `src/plugins/seed.test.ts` (NEW: Verify ~40 atomic skills generated)

**Requirements Addressed:** FR-011, FR-012, TC-006

**Dependencies:** Phase 2

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| TC-006 | Original `.agents/` files MUST NOT be deleted |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit | `migrate()` | Generates valid `manifest.yaml` from SKILL.md frontmatter |
| TR-006 | Unit | `seed()` | Categories (reasoning, evaluative, etc.) are preserved |

#### Done When
- `gwrk plugin seed --dry-run` lists 30+ atomic skills

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `AnyManifest` | `src/plugins/manifest.ts` | Loader, Registry, CLI |
| `TaskDispatch` | `src/utils/agent.ts` | AgentBackend, Router |
| `TaskResult` | `src/utils/agent.ts` | AgentBackend, Ship Loop |
| `PluginRegistry` | `src/plugins/loader.ts` | CLI, Engine, Server |

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
|--------|-------------|--------|
| US-001 | 1 | Planned |
| US-002 | 1 | Planned |
| US-003 | 1 | Planned |
| US-004 | 1 | Planned |
| US-005 | 2 | Planned |
| US-006 | 2 | Planned |
| US-007 | 2 | Planned |
| US-008 | 2 | Planned |
| US-009 | 5 | Planned |
| US-010 | 5 | Planned |
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
| FR-011 | 5 | Planned |
| FR-012 | 5 | Planned |
| FR-013 | 1 | Planned |
| FR-L1-001 | 3 | Planned |
| FR-L1-002 | 3 | Planned |
| FR-L1-003 | 3 | Planned |
| FR-L1-004 | 3 | Planned |
| FR-L1-005 | 3, 4 | Planned |
| FR-L1-006 | 3 | Planned |
| FR-L1-007 | Deferred | Planned |
| FR-L1-008 | 3 | Planned |
| FR-L1-009 | 3 | Planned |
| FR-L1-010 | 3 | Planned |
| FR-L1-011 | 1 | Planned |
| FR-L1-012 | 1 | Planned |
| FR-L1-013 | 1 | Planned |
| FR-L25-001 | 1 | Planned |
| FR-L25-002 | 2 | Planned |
| FR-L25-003 | 2 | Planned |
| DM-001 to DM-007 | 1 | Planned |
| TC-001 to TC-010 | 1, 2, 3 | Planned |
| TR-001 to TR-008 | 1, 2, 3 | Planned |
| VR-001 to VR-010 | All | Planned |
