# Implementation Plan: 019 agy-agent-migration

**Branch**: `develop` | **Date**: 2026-06-01 | **Spec**: [spec.md](./spec.md)

## Summary

This feature migrates agent dispatch to the Antigravity (`agy`) CLI backend. It implements an `AgyAdapter` as a built-in plugin, ensuring gwrk can use `agy` as its primary agent backend. This includes mapping gwrk's YOLO mode to `agy`'s `--dangerously-skip-permissions`, omitting the `--model` flag (as `agy` handles it via configuration or its own defaults), and implementing governance synchronization via `AGENTS.md`. The router is updated to prioritize `agy` over the legacy `gemini` CLI.

---

## Phases and File Structure

### Phase 1: AgyAdapter Foundation

Implement the `AgyAdapter` and its manifest to integrate with the `agy` CLI binary. This phase establishes the core communication layer between gwrk and Antigravity.

**Files (4):**
- `src/plugins/builtins/agents/agy/adapter.ts` (NEW: Implements AgyAdapter with command mapping and governance sync)
- `src/plugins/builtins/agents/agy/manifest.yaml` (NEW: Plugin manifest for agy agent backend)
- `src/plugins/builtins/agents/index.ts` (MODIFY: Register AgyAdapter in BUILTIN_AGENTS)
- `src/plugins/builtins/agents/agy/adapter.test.ts` (NEW: Unit tests for AgyAdapter)

**Requirements Addressed**: FR-001, FR-003, FR-004, US-001, US-002, TC-001, TC-002, TC-003

**Dependencies**: None

**Contract Mapping:**
- `specs/014-plugin-system/contracts/agent-backend.md` → `AgentBackend` → `src/plugins/builtins/agents/agy/adapter.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-006: Plugin Agent Backends | Defines the Adapter interface and dispatch contract |
| ADR-004: Agent-Native Output | Signal protocol and exit code normalization |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/plugins/builtins/agents/agy/adapter.test.ts` | Verify command generation maps YOLO flag to `--dangerously-skip-permissions` and omits `--model`. |

#### Done When
- `pnpm vitest run src/plugins/builtins/agents/agy/adapter.test.ts` exits 0

### Phase 2: Router Integration

Update the engine's router to prioritize `agy` over `gemini` in the default fallback chain and ensure it is the default backend for autonomous implementation tasks.

**Files (2):**
- `src/engine/router.ts` (MODIFY: Update fallbackOrder and default backend logic)
- `src/engine/router.test.ts` (MODIFY: Verify agy prioritization)

**Requirements Addressed**: FR-002, US-001, SC-001, VR-001

**Dependencies**: Phase 1

**Contract Mapping:**
- `specs/014-plugin-system/contracts/router.md` → `selectBackend` → `src/engine/router.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-006: Plugin Agent Backends | Routing and backend selection rules |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-002 | Unit | `src/engine/router.test.ts` | Verify the router's fallback chain prioritizes `agy` over `gemini`. |

#### Done When
- `pnpm vitest run src/engine/router.test.ts` exits 0
- `gwrk gate-check VR-001` (via mock dispatch observation) exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| AgentBackend | `src/plugins/agent-backend.ts` | `src/plugins/builtins/agents/agy/adapter.ts`, `src/engine/router.ts` |
| TaskDispatch | `src/utils/agent.ts` | `src/plugins/builtins/agents/agy/adapter.ts` |
| TaskResult | `src/utils/agent.ts` | `src/plugins/builtins/agents/agy/adapter.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

- None — full coverage.

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 1, 2 | PLANNED |
| US-002 | 1 | PLANNED |
| FR-001 | 1 | PLANNED |
| FR-002 | 2 | PLANNED |
| FR-003 | 1 | PLANNED |
| FR-004 | 1 | PLANNED |
| TR-001 | 1 | PLANNED |
| TR-002 | 2 | PLANNED |
| SC-001 | 2 | PLANNED |
| VR-001 | 2 | PLANNED |
| TC-001 | 1 | PLANNED |
| TC-002 | 1 | PLANNED |
| TC-003 | 1 | PLANNED |
