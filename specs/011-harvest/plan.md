# Implementation Plan: 011 Harvest (Done, Done!)

**Branch**: `feat/011-harvest` | **Date**: 2026-03-19 | **Spec**: [spec.md](./spec.md)

## Summary

Implement the post-merge lifecycle for gwrk. This feature closes the loop by automatically triggering on GitHub PR merges to rehome execution logs, finalize SQLite run records, calculate point and total compression ratios, and post the "🏆 Done, Done!" notification to Slack.

---

## Phases and File Structure

### Phase 1: Persistence & Schema (F011-P1)

Establish the data model for harvest and compression tracking.

**Files (4):**
- `src/db/migrations/005-compression.sql` (VERIFY: Schema already merged during F014)
- `src/db/runs.ts` (MODIFY: Update `RunRecord` type and `finishRun()` to support harvest data)
- `src/db/compression.ts` (NEW: DB access for the `compression` table)
- `src/engine/types.ts` (MODIFY: Ensure all harvest and compression types are present)

**Requirements Addressed:** FR-H03, FR-H06, US-H03

**Dependencies:** None

**Contract Mapping:**
- `specs/011-harvest/contracts/db.md` → `finishRun` → `src/db/runs.ts`
- `specs/011-harvest/contracts/db.md` → `recordCompression` → `src/db/compression.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-002 SQLite Ledger | Schema design compliance |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-H03 | Unit | `src/db/runs.test.ts` | `finishRun` updates status, PR, and merge commit |
| TR-H06 | Unit | `src/db/compression.test.ts` | `recordCompression` correctly inserts record |

#### Done When
- `pnpm vitest run src/db/` exits 0

### Phase 2: Log Management & Finalization (F011-P2)

Implement logic to move raw logs to their permanent home and maintain the log index.

**Files (2):**
- `src/engine/harvest.ts` (NEW: Implement `finalizeLogs()`, `updateLogIndex()`, and git commit logic)
- `src/utils/git.ts` (MODIFY: Add `commitFiles()` helper if missing)

**Requirements Addressed:** FR-H02, US-H02

**Dependencies:** F011-P1

**Contract Mapping:**
- `specs/011-harvest/contracts/harvest.md` → `finalizeLogs` → `src/engine/harvest.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-003 State Contract | Two-tier state management |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-H02 | Integration | `src/engine/harvest.test.ts` | Logs are moved, index.json updated, and git commit attempted |

#### Done When
- `pnpm vitest run src/engine/harvest.test.ts` exits 0

### Phase 3: Webhook Handler & Branch Parsing (F011-P3)

Implement the GitHub webhook endpoint on the build server.

**Files (3):**
- `src/server/github.ts` (NEW: Fastify plugin for GitHub webhooks with signature verification)
- `src/server/index.ts` (MODIFY: Register the github webhook plugin)
- `src/utils/config.ts` (MODIFY: Add `GITHUB_WEBHOOK_SECRET` to Zod schema)

**Requirements Addressed:** FR-H01, FR-H09, US-H01, TC-H01, TC-H03

**Dependencies:** F011-P1

**Contract Mapping:**
- `specs/011-harvest/contracts/webhook.md` → `POST /webhook/github` → `src/server/github.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-004 Agent-Native | Command classification |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-H01 | Integration | `tests/server-github.test.ts` | Valid PR merge webhook triggers harvest; sandbox PRs ignored |

#### Done When
- `pnpm vitest run tests/server-github.test.ts` exits 0

### Phase 4: Harvest Orchestration & Compression (F011-P4)

Connect the webhook to the harvest engine and calculate compression ratios.

**Files (1):**
- `src/engine/harvest.ts` (MODIFY: Implement `harvestFeature()` orchestrator)

**Requirements Addressed:** FR-H04, FR-H05, FR-H06, US-H04, TC-H04

**Dependencies:** F011-P2, F011-P3

**Contract Mapping:**
- `specs/011-harvest/contracts/harvest.md` → `harvestFeature` → `src/engine/harvest.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-003 State Contract | Two-tier state synchronization |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-H04 | Integration | `src/engine/harvest.test.ts` | Point and Total compression calculated correctly from git timestamps |

#### Done When
- `pnpm vitest run src/engine/harvest.test.ts` exits 0

### Phase 5: Notification, Cleanup & CLI (F011-P5)

Post notifications, clean up branches, and provide a CLI interface.

**Files (2):**
- `src/commands/harvest.ts` (NEW: `gwrk harvest` CLI command)
- `src/cli.ts` (MODIFY: Register `harvest` command)

**Requirements Addressed:** FR-H07, FR-H08, US-H05, US-H06, SC-H03, SC-H05

**Dependencies:** F011-P4

**Contract Mapping:**
- `specs/011-harvest/contracts/harvest.md` → `notifyDoneDone` → `src/engine/harvest.ts`
- `specs/011-harvest/contracts/harvest.md` → `cleanupBranch` → `src/engine/harvest.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-004 Agent-Native | Operational signal [exit:N \| Xs] |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-H07 | E2E | `tests/harvest-e2e.test.ts` | Full harvest loop: webhook → logs → db → compression → slack → cleanup |

#### Done When
- `gwrk harvest --help` exits 0
- `pnpm vitest run tests/harvest-e2e.test.ts` exits 0

### Phase 6: Remediation — Idempotency, Dedup, Test Coverage (F011-P6)

Address gaps identified in forensic audit (2026-04-14). This phase makes harvest production-safe and clears test debt.

**Files (3):**
- `src/engine/harvest.ts` (MODIFY: Add idempotency guard at top of `harvestFeature()` via compression table lookup)
- `src/server/github.ts` (MODIFY: Remove duplicate Slack notification after `harvestFeature()` — harvest already calls `notifyDoneDone()` internally)
- `src/engine/harvest.test.ts` (MODIFY: Implement the 3 `it.todo()` test stubs for compression, Slack, and branch cleanup)

**Requirements Addressed:** FR-H10, FR-H11, FR-H04, FR-H05, FR-H07, FR-H08, TC-H02, SC-H04

**Dependencies:** F011-P4, F011-P5

**Contract Mapping:**
- `specs/011-harvest/contracts/harvest.md` → `harvestFeature` idempotency guard → `src/engine/harvest.ts`
- `specs/011-harvest/contracts/webhook.md` → notification dedup → `src/server/github.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| TDD mandate | Tests MUST be implemented, not todo |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-H10 | Unit | `src/engine/harvest.test.ts` | `harvestFeature` skips processing when compression record already exists |
| TR-H04 | Unit | `src/engine/harvest.test.ts` | `harvestFeature` calculates correct point and total compression from mocked git actuals |
| TR-H07 | Unit | `src/engine/harvest.test.ts` | `notifyDoneDone` calls Slack with feature name and compression values |
| TR-H08 | Unit | `src/engine/harvest.test.ts` | `cleanupBranch` calls `deleteRemoteBranch` and handles failure gracefully |
| TR-H11 | Integration | `tests/server-github.test.ts` | Webhook handler does NOT call `notifySlack` directly (harvest handles it) |

#### Done When
- `pnpm vitest run src/engine/harvest.test.ts` exits 0 with zero `it.todo()` stubs
- `pnpm vitest run tests/server-github.test.ts` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| HarvestRecord | `src/engine/types.ts` | `src/engine/harvest.ts`, `src/db/runs.ts` |
| CompressionReport | `src/engine/types.ts` | `src/engine/compression.ts`, `src/db/compression.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| F015 integration | Event Bus notification | F015 is not yet implemented | Wave 5 |
| E2E harvest loop | Full webhook→harvest→Slack E2E | Requires live server infra | Post-ship |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-H01 | Phase 3 | Planned |
| US-H02 | Phase 2 | Planned |
| US-H03 | Phase 1 | Planned |
| US-H04 | Phase 4 | Planned |
| US-H05 | Phase 5 | Planned |
| US-H06 | Phase 5 | Planned |
| FR-H01 | Phase 3 | Planned |
| FR-H02 | Phase 2 | Planned |
| FR-H03 | Phase 1 | Planned |
| FR-H04 | Phase 4 | Planned |
| FR-H05 | Phase 4 | Planned |
| FR-H06 | Phase 1, 4 | Planned |
| FR-H07 | Phase 5, 6 | Done |
| FR-H08 | Phase 5, 6 | Done |
| FR-H09 | Phase 3 | Planned |
| FR-H10 | Phase 6 | Done |
| FR-H11 | Phase 6 | Done |
| TC-H01 | Phase 3 | Planned |
| TC-H02 | Phase 3, 4, 6 | Done |
| TC-H03 | Phase 3 | Planned |
| TC-H04 | Phase 4 | Planned |
| SC-H01 | Phase 3 | Planned |
| SC-H02 | Phase 1-4 | Planned |
| SC-H03 | Phase 5 | Planned |
| SC-H04 | Phase 4, 6 | Done |
| SC-H05 | Phase 5 | Planned |
