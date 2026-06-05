# Implementation Plan: 011 Harvest

**Branch**: `develop` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)

## Summary

Harvest (Feature 011) closes the loop on autonomous execution. Triggered by a GitHub webhook upon a PR merge, the Harvest engine rehomes and git-commits execution logs, finalizes the SQLite run record, calculates Point and Total Compression ratios, cleans up the feature branch, and posts a "🏆 Done, Done!" summary to Slack. This plan also encompasses the Fracture 2 remediation for phase completion tracking, as well as the new Post-Ship Issue Tracking module which associates GitHub issues with features and notifies Slack.

---

## Phases and File Structure

### Phase 1: Webhook Infrastructure & Orchestration

Implement the foundational GitHub webhook endpoint and the `harvestFeature` orchestrator. Includes idempotency and phase completion tracking.

**Files (2):**
- `src/server/github.ts` (Modify: Add `/webhook/github` endpoint, verify signature, filter PR events, track phase completion, and call `harvestFeature`)
- `src/engine/harvest.ts` (Modify: Update `harvestFeature` with idempotency guard against duplicate runs)

**Requirements Addressed:** FR-H01, FR-H09, FR-H10, US-H01, TC-H01, TC-H02, TC-H03, SC-H01, SC-H04

**Dependencies:** None

**Contract Mapping:**
- `contracts/webhook.md` → `POST /webhook/github` → `src/server/github.ts`
- `contracts/harvest.md` → `harvestFeature()` → `src/engine/harvest.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-004 | Command and Server Output Logging |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-H01 | Integration | `tests/server-github.test.ts` | Verify webhook ignores unmerged PRs and non-trunk targets |
| TR-H02 | Integration | `src/engine/harvest.test.ts` | Verify idempotency check skips execution if matching compression record exists |

#### Done When
- `pnpm vitest run tests/server-github.test.ts --grep "Webhook ignores unmerged PRs"` exits 0
- `pnpm vitest run src/engine/harvest.test.ts --grep "Idempotency check"` exits 0

---

### Phase 2: Finalization & Cleanup

Persist raw execution logs into git and finalize the database run records. Delete remote phase branches upon successful merge.

**Files (3):**
- `src/engine/harvest.ts` (Modify: Implement `finalizeLogs` and `cleanupBranch`)
- `src/db/runs.ts` (Modify: Implement `finishRun` to finalize SQLite record with merge commit sha and status)
- `src/cli.ts` (Modify: No CLI changes needed, keeping within 10 file limit)

**Requirements Addressed:** FR-H02, FR-H03, FR-H08, US-H02, US-H03, US-H06, SC-H02

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/harvest.md` → `finalizeLogs()` → `src/engine/harvest.ts`
- `contracts/harvest.md` → `cleanupBranch()` → `src/engine/harvest.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-002 | Execution ledger writes |
| ADR-003 | Two-tier state synchronization |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-H03 | Unit | `src/db/runs.test.ts` | Verify `finishRun()` updates `status` to merged and sets `finished_at` |
| TR-H04 | Integration | `src/engine/harvest.test.ts` | Verify logs are moved to specs dir and `index.json` is generated |
| TR-H05 | E2E | `tests/harvest-e2e.test.ts` | Verify branch deletion command is invoked |

#### Done When
- `pnpm vitest run src/db/runs.test.ts --grep "finishRun"` exits 0
- `pnpm vitest run src/engine/harvest.test.ts --grep "finalizeLogs"` exits 0
- `gwrk db runs 004-ship-loop --json | jq '.[0].status'` returns `"merged"` (Mocked check)

---

### Phase 3: Compression Calculation

Calculate the Point Compression and Total Compression ratios by comparing estimated SP values to the actual timestamps tracked via Git log parsing.

**Files (3):**
- `src/engine/compression.ts` (Modify: Fix test stubs and finalize `computeCompression` logic using `CommitCluster`)
- `src/db/compression.ts` (Modify: Expose method to insert a new compression record)
- `src/engine/harvest.ts` (Modify: Wire in `computeCompression` inside `harvestFeature`)

**Requirements Addressed:** FR-H04, FR-H05, FR-H06, US-H04, TC-H04, SC-H05

**Dependencies:** Phase 2

**Contract Mapping:**
- `contracts/compression-engine.md` → `computeCompression()` → `src/engine/compression.ts`
- `contracts/compression-engine.md` → `collectTimestamps()` → `src/engine/compression.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| specify-sharpen | Accuracy of metric collection rules |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-H06 | Unit | `src/engine/compression.test.ts` | Verify point compression formula (estimated hours / actual coding time) |
| TR-H07 | Unit | `src/engine/compression.test.ts` | Verify total compression formula (estimated days / delivery window) |

#### Done When
- `pnpm vitest run src/engine/compression.test.ts --grep "Point Compression"` exits 0
- `pnpm vitest run src/engine/compression.test.ts --grep "Total Compression"` exits 0
- `gwrk compression <mock-feature>` output includes valid ratios

---

### Phase 4: Done, Done! Notification

Ensure that the project's Slack channel is notified of the completed feature precisely once, including the calculated compression metrics.

**Files (2):**
- `src/engine/harvest.ts` (Modify: Wire `notifyDoneDone` to format and post the summary to the `003-slack` module API)
- `src/server/github.ts` (Modify: Ensure no slack notification is dispatched directly from the webhook to satisfy FR-H11)

**Requirements Addressed:** FR-H07, FR-H11, US-H05, SC-H03

**Dependencies:** Phase 3

**Contract Mapping:**
- `contracts/harvest.md` → `notifyDoneDone()` → `src/engine/harvest.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| signal-cut | Slack notification messaging clarity |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-H08 | E2E | `tests/harvest-e2e.test.ts` | Verify the slack webhook mock is called exactly once with compression metrics |

#### Done When
- `pnpm vitest run tests/harvest-e2e.test.ts --grep "Done Done notification sent exactly once"` exits 0

---

### Phase 5: Post-Ship Issue Tracking

Implement the capturing, DB logging, and Slack notification of any post-ship GitHub Issues matching the feature naming or label conventions.

**Files (4):**
- `src/server/github.ts` (Modify: Add support for GitHub `issues` events opened/closed/labeled and feature association logic)
- `src/db/migrations/008-issues.sql` (New: Table for post-ship issues)
- `src/db/issues.ts` (New: DB access layer for saving/updating issues)
- `src/engine/issues.ts` (New: Logic to format and trigger Slack notifications via `003-slack`)

**Requirements Addressed:** FR-H12, FR-H13, FR-H14, FR-H15, US-H07, TC-H05, SC-H06

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/webhook.md` → `POST /webhook/github` → `src/server/github.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-002 | Issue ledger updates |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-H09 | Integration | `tests/server-github.test.ts` | Verify `issues.opened` associates via `gwrk:002` label and inserts DB record |
| TR-H10 | Integration | `tests/server-github.test.ts` | Verify `issues.opened` resolves feature via title substring |
| TR-H11 | Unit | `src/db/issues.test.ts` | Verify DB issue status transitions from `open` to `closed` |

#### Done When
- `sqlite3 ~/.gwrk/gwrk.db "SELECT count(*) FROM issues;"` executes successfully
- `pnpm vitest run tests/server-github.test.ts --grep "Issue to feature association"` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `HarvestPayload` | `src/engine/harvest.ts` | `src/server/github.ts` |
| `IssueSchema` | `src/db/issues.ts` | `src/server/github.ts`, `src/engine/issues.ts` |
| `CompressionReport` | `src/engine/compression.ts` | `src/engine/harvest.ts`, `src/commands/compression.ts` |

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
| US-H01 | 1 | Planned |
| US-H02 | 2 | Planned |
| US-H03 | 2 | Planned |
| US-H04 | 3 | ✅ Done |
| US-H05 | 4 | ✅ Done |
| US-H06 | 2 | Planned |
| US-H07 | 5 | Planned |
| FR-H01 | 1 | Planned |
| FR-H02 | 2 | Planned |
| FR-H03 | 2 | Planned |
| FR-H04 | 3 | ✅ Done |
| FR-H05 | 3 | ✅ Done |
| FR-H06 | 3 | ✅ Done |
| FR-H07 | 4 | ✅ Done |
| FR-H08 | 2 | Planned |
| FR-H09 | 1 | Planned |
| FR-H10 | 1 | Planned |
| FR-H11 | 4 | ✅ Done |
| FR-H12 | 5 | Planned |
| FR-H13 | 5 | Planned |
| FR-H14 | 5 | Planned |
| FR-H15 | 5 | Planned |
| TC-H01 | 1 | Planned |
| TC-H02 | 1 | Planned |
| TC-H03 | 1 | Planned |
| TC-H04 | 3 | ✅ Done |
| TC-H05 | 5 | Planned |
| SC-H01 | 1 | Planned |
| SC-H02 | 2 | Planned |
| SC-H03 | 4 | ✅ Done |
| SC-H04 | 1 | Planned |
| SC-H05 | 3 | ✅ Done |
| SC-H06 | 5 | Planned |