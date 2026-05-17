# Implementation Plan: 008 Agent Router

**Branch**: `008-agent-router` | **Date**: 2026-03-10 | **Spec**: [spec.md](./spec.md)

## Summary

Implements the intelligence layer of the shipping triad (004→005→008). The router operates on **two dimensions**: (1) provider selection based on quota remaining, (2) model selection within a provider based on task classification. It implements a two-level fallback chain — model failover within a provider before provider failover. Pure selection — no execution. Integrates with 005-parallel-dispatch via the `BackendSelector` interface and with 004-ship-loop via `ShipRequest.backend`.

---

## Phases and File Structure

### Phase 1: Agent Registry & Zod Validation

Registry loader that reads `.gwrkrc.json`, validates the `agents.registry` schema (including `quotaProbe` config), and exports typed backend configs.

**Files (4):**
- `src/server/agent-registry.ts` (NEW: Zod schema with model `tier`/`modelFlag`, `docs?`/`discoveryMethod?`, `loadRegistry()`, `AgentBackendConfig` type, `ProviderDocs` type, `ModelEntry` type)
- `src/server/agent-registry.test.ts` (NEW: TR-003 — valid/invalid registry, model tier validation, fail-fast)
- `src/utils/config.ts` (MODIFY: Add `agents.registry` to project config schema)
- `src/server/task-classifier.ts` (NEW: `TaskClassification` enum, `classifyTask()` function — `implement` → `thinking`, `test` → `fast`, `review` → `thinking`, `define` → `high-context`, `remediation` → `thinking`)
- `package.json` (MODIFY: No new deps — Zod already available)

**Requirements Addressed:** FR-005, FR-011, US-004, US-010, TC-003

**Dependencies:** None (foundation phase)

**Contract Mapping:**
- `contracts/backend-selector.md` → `AgentBackendConfig` → `src/server/agent-registry.ts`
- `contracts/backend-selector.md` → `loadRegistry()` → `src/server/agent-registry.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| Fail-Fast Config | Zod with no `.default()`. Missing registry → `process.exit(1)` |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-003 | Unit | `src/server/agent-registry.test.ts` | Valid registry loads with model tiers; invalid registry throws; missing registry exits |
| TR-010 | Unit | `src/server/task-classifier.test.ts` | `implement` → `thinking`, `test` → `fast`, `define` → `high-context` |

#### Done When
- `pnpm vitest run src/server/agent-registry.test.ts` exits 0
- `grep -q "loadRegistry" src/server/agent-registry.ts` exits 0
- `grep -q "agents.*registry" src/utils/config.ts` exits 0

---

### Phase 2: Quota Prober & Cache

Implements the `QuotaProber` that checks remaining quota per backend. Supports interactive-scrape (tmux-based), optimistic assumption, and cached readings with configurable TTL.

**Files (4):**
- `src/server/quota-prober.ts` (NEW: `probeQuota()`, cache logic, tmux scraping, timeout handling, per-model cooldown tracking)
- `src/server/quota-prober.test.ts` (NEW: TR-005 timeout, TR-007 cache TTL)
- `scripts/dev/quota-probe.sh` (NEW: Shell helper for tmux-based interactive scrape)
- `.runs/quota-cache.json` (RUNTIME: Gitignored cache file, DM-003)

**Requirements Addressed:** FR-002, FR-007, FR-010 (partial — model cooldown tracking), US-003, US-006, US-009 (partial), TC-002, TC-005, TC-006

**Dependencies:** Phase 1 (registry provides probe config)

**Contract Mapping:**
- `contracts/quota-prober.md` → `probeQuota(backend)` → `src/server/quota-prober.ts`
- `contracts/quota-prober.md` → `QuotaReading` → `src/server/quota-prober.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| Air-Gapped | No external API calls. Local CLI probes only |
| Probe Resilience (TC-005) | 5s timeout max. Failure → optimistic |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit | `src/server/quota-prober.test.ts` | Mock 10s probe → assert returns within 6s with `timeout-assumed-available` |
| TR-007 | Unit | `src/server/quota-prober.test.ts` | Probe → cache hit → TTL expire → re-probe |

#### Done When
- `pnpm vitest run src/server/quota-prober.test.ts` exits 0
- `grep -q "probeQuota" src/server/quota-prober.ts` exits 0
- `grep -q "timeout-assumed-available" src/server/quota-prober.ts` exits 0

---

### Phase 3: Backend Selector (Core Logic)

The core `selectBackend()` function. Reads quota from prober, checks availability, applies SQLite tiebreaker, implements two-level fallback chain (model failover within provider, then provider failover). Includes `ModelSelector` for task-aware model selection. Pure selection — no side effects except routing_decisions INSERT.

**Files (6):**
- `src/server/backend-selector.ts` (NEW: `BackendSelector`, `selectBackend()`, two-level fallback chain)
- `src/server/model-selector.ts` (NEW: `ModelSelector`, `selectModel()` — picks from `models[]` by task tier, handles model cooldowns)
- `src/server/model-selector.test.ts` (NEW: TR-008 model selection by tier, TR-010 command template injection)
- `src/server/backend-selector.test.ts` (NEW: TR-001 quota selection, TR-002 provider fallback, TR-004 tiebreaker, TR-009 model failover)
- `src/db/migrations/003-routing-decisions.sql` (NEW: DM-002 CREATE TABLE with `task_classification`, `model_failover_used`)
- `src/server/routing-decisions.ts` (NEW: `recordDecision()`, TR-006)

**Requirements Addressed:** FR-001, FR-003, FR-004, FR-006, FR-009, FR-010, US-001, US-002, US-005, US-008, US-009, TC-001, TC-004

**Dependencies:** Phase 1 (registry), Phase 2 (prober)

**Contract Mapping:**
- `contracts/backend-selector.md` → `selectBackend(context)` → `src/server/backend-selector.ts`
- `contracts/backend-selector.md` → `BackendSelection` → `src/server/backend-selector.ts`
- `contracts/backend-selector.md` → `recordDecision()` → `src/server/routing-decisions.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| Determinism (TC-001) | Same inputs → same selection. No random tiebreaking |
| Pure Selection (TC-004) | Returns object, no agent execution |
| SQLite (WAL mode) | `routing_decisions` table |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/server/backend-selector.test.ts` | 3 backends, different quota → highest selected |
| TR-002 | Unit | `src/server/backend-selector.test.ts` | Primary 0% → fallback selected, max 3 attempts |
| TR-004 | Unit | `src/server/backend-selector.test.ts` | Equal quota → higher success rate wins |
| TR-006 | Unit | `src/server/routing-decisions.test.ts` | Selection recorded with quota_percent, probe_status, selected_model, task_classification, model_failover_used |
| TR-008 | Unit | `src/server/model-selector.test.ts` | `implement` → thinking model, `test` → fast model |
| TR-009 | Unit | `src/server/backend-selector.test.ts` | Flash in cooldown (429) → Pro selected before provider failover |
| TR-010 | Unit | `src/server/model-selector.test.ts` | `{{model}}` template → rendered command with modelFlag |

#### Done When
- `pnpm vitest run src/server/backend-selector.test.ts src/server/routing-decisions.test.ts` exits 0
- `grep -q "selectBackend" src/server/backend-selector.ts` exits 0
- `grep -q "routing_decisions" src/db/migrations/003-routing-decisions.sql` exits 0
- `grep -q "fallback" src/server/backend-selector.ts` exits 0

---

### Phase 4: Integration & Wiring

Wire the `BackendSelector` into the ship pipeline so 004 and 005 can consume it. Export the public interface for 005-parallel-dispatch.

**Files (4):**
- `src/server/index.ts` (MODIFY: Export `BackendSelector` instance)
- `src/commands/ship.ts` (MODIFY: Call `selectBackend()` if no `--agent` override)
- `src/server/routing-decisions.test.ts` (NEW: TR-006 integration)
- `src/server/backend-selector.integration.test.ts` (NEW: End-to-end — registry→probe→select→record)

**Requirements Addressed:** FR-008, US-007, SC-001, SC-002, SC-003

**Dependencies:** Phase 1, 2, 3

**Contract Mapping:**
- `contracts/backend-selector.md` → `BackendSelector` (exported interface) → `src/server/index.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-006 | Integration | `src/server/routing-decisions.test.ts` | Full flow: select → record → query |

#### Done When
- `pnpm vitest run src/server/backend-selector.integration.test.ts` exits 0
- `grep -q "BackendSelector\|selectBackend\|backend-selector" src/commands/ship.ts` exits 0
- `pnpm build` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `AgentBackendConfig` | `src/server/agent-registry.ts` | `quota-prober.ts`, `backend-selector.ts`, `model-selector.ts` |
| `ProviderDocs` | `src/server/agent-registry.ts` | _(informational — not consumed at runtime, available for tooling)_ |
| `ModelEntry` | `src/server/agent-registry.ts` | `model-selector.ts`, `backend-selector.ts` |
| `QuotaReading` | `src/server/quota-prober.ts` | `backend-selector.ts` |
| `TaskContext` | `src/server/backend-selector.ts` | 005 `dispatch-orchestrator.ts` |
| `TaskClassification` | `src/server/task-classifier.ts` | `model-selector.ts`, `backend-selector.ts` |
| `BackendSelection` | `src/server/backend-selector.ts` | 005 `dispatch-orchestrator.ts`, 004 `ship.ts` |
| `ShipRequest.backend` | 004 `src/commands/ship.ts` | Populated by 008 `selectBackend()` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

None — full coverage.

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | P3 | Planned |
| US-002 | P3 | Planned |
| US-003 | P2 | Planned |
| US-004 | P1 | Planned |
| US-005 | P3 | Planned |
| US-006 | P2 | Planned |
| US-007 | P4 | Planned |
| US-008 | P3 | Planned |
| US-009 | P3 | Planned |
| US-010 | P1 | Planned |
| FR-001 | P3 | Planned |
| FR-002 | P2 | Planned |
| FR-003 | P3 | Planned |
| FR-004 | P3 | Planned |
| FR-005 | P1 | Planned |
| FR-006 | P3 | Planned |
| FR-007 | P2 | Planned |
| FR-008 | P3, P4 | Planned |
| FR-009 | P3 | Planned |
| FR-010 | P2, P3 | Planned |
| FR-011 | P1, P3 | Planned |
| TR-001 | P3 | Planned |
| TR-002 | P3 | Planned |
| TR-003 | P1 | Planned |
| TR-004 | P3 | Planned |
| TR-005 | P2 | Planned |
| TR-006 | P3, P4 | Planned |
| TR-007 | P2 | Planned |
| TR-008 | P3 | Planned |
| TR-009 | P3 | Planned |
| TR-010 | P1 | Planned |
| TC-001 | P3 | Planned |
| TC-002 | P2 | Planned |
| TC-003 | P1 | Planned |
| TC-004 | P3 | Planned |
| TC-005 | P2 | Planned |
| TC-006 | P2 | Planned |
| DM-001 | P1 | Planned |
| DM-002 | P3 | Planned |
| DM-003 | P2 | Planned |
| SC-001 | P4 | Planned |
| SC-002 | P4 | Planned |
| SC-003 | P4 | Planned |
| SC-004 | P3 | Planned |
| VR-001 | P4 | Planned |
| VR-002 | P4 | Planned |
| VR-003 | P4 | Planned |
