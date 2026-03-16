# Feature Specification: 011 Harvest (Done, Done!)

**Feature Branch**: `feat/011-harvest`
**Created**: 2026-03-14
**Status**: Specified
**Input**: Post-merge lifecycle for shipped work. Harvest is triggered by GitHub webhook when a Ship Loop PR is merged. It rehomes logs, finalizes DB records, calculates compression ratios, and posts the "🏆 Done, Done!" notification to Slack.

> **Architectural anchors**: [architecture.md §6.3](file:///Users/gonzo/Code/gwrk/docs/architecture.md) (Harvest), [ADR-003](file:///Users/gonzo/Code/gwrk/docs/decisions/ADR-003-state-contract.md) (two-tier state), [004-ship-loop Loop-Closing Contract](file:///Users/gonzo/Code/gwrk/specs/004-ship-loop/spec.md) (handoff), [PRD §16](file:///Users/gonzo/Code/gwrk/docs/GWRK-PRD-PRFAQ.md) (Compression)

> **Boundary**: Ship Loop (004) ends at PR issued + Slack notification (steps 1-7). Harvest (011) begins at PR merge (step 8). See architecture.md §6.2-6.3.

---

## 1. Problem Statement

Ship Loop (004) produces a PR and git-tracked execution manifests. After the PR is merged, nothing happens automatically:
- Raw logs sit in `specs/<feature>/.gwrk/runs/` but aren't indexed
- SQLite run records are started (`startRun()`) but never finalized
- Compression ratios are never calculated
- There's no "done done" signal — no closure

Harvest closes the loop. It's the ceremony that turns "PR merged" into "Feature shipped."

---

## 2. User Scenarios & Testing

### US-H01 - Merge Triggers Harvest (Priority: P0)
As the build server, I want to receive a GitHub webhook on PR merge and automatically run the harvest pipeline for that feature.

**Implements**: FR-H01

**Acceptance Scenarios**:
1. **Given** a PR for `feat/004-ship-loop` is merged, **When** GitHub sends a `pull_request.closed` webhook with `merged: true`, **Then** the build server invokes the harvest pipeline for feature `004-ship-loop`.

### US-H02 - Log Finalization (Priority: P0)
As a Principal Engineer, I want all raw logs from the ship run indexed and available for learning.

**Implements**: FR-H02

**Acceptance Scenarios**:
1. **Given** a merged PR for phase-01 of `004-ship-loop`, **When** harvest runs, **Then**:
   - All raw logs in `specs/004-ship-loop/.gwrk/runs/` are git-committed (if not already)
   - A log index file `specs/004-ship-loop/.gwrk/runs/index.json` is created/updated with entries for each log file

### US-H03 - DB Record Finalization (Priority: P0)
As the execution ledger, I want the SQLite run record finalized with merge timestamp and final status.

**Implements**: FR-H03

**Acceptance Scenarios**:
1. **Given** a run record in `runs` table with `exit_code IS NULL`, **When** harvest runs for that feature/phase, **Then**:
   - `finishRun()` is called with merge timestamp, final exit code, and `status: 'merged'`
   - `gwrk db runs 004-ship-loop --json | jq '.[0].status'` returns `"merged"`

### US-H04 - Compression Calculation (Priority: P1)
As a Principal Engineer, I want to see how much faster agents shipped vs human estimates.

**Implements**: FR-H04, FR-H05, FR-H06

**Acceptance Scenarios**:
1. **Given** a merged feature with effort estimate in `plan.md` and Git timestamps, **When** harvest runs compression, **Then**:
   - Point compression = estimated hours ÷ active coding time (commit clustering, 30-min gap threshold)
   - Total compression = estimated days ÷ delivery window (first impl commit → merge)
   - Both values recorded in SQLite `compression` table
   - `gwrk compression 004-ship-loop` outputs the compression report

### US-H05 - Done, Done! Notification (Priority: P0)
As a Principal Engineer, I want a "🏆 Feature shipped" Slack notification with compression summary when harvest completes.

**Implements**: FR-H07

**Acceptance Scenarios**:
1. **Given** harvest completes successfully, **When** Slack notification is sent, **Then**:
   - Message contains feature name, phase, compression ratios, and duration
   - Message is posted to the project's Slack channel

### US-H06 - Branch Cleanup (Priority: P1)
As the build server, I want phase branches cleaned up after successful merge.

**Implements**: FR-H08

**Acceptance Scenarios**:
1. **Given** a merged PR from `phase/004-ship-loop-phase-01`, **When** harvest completes, **Then**:
   - The phase branch is deleted from remote

---

## 3. Functional Requirements

### Build Server Webhook Handler

- **FR-H01**: Build server MUST register a GitHub webhook endpoint for `pull_request` events. On `action: "closed"` with `merged: true`, extract feature name from branch naming convention (`feat/<feature>`) and invoke harvest pipeline. Webhook secret validated via `GITHUB_WEBHOOK_SECRET` env var (fail-fast if missing). (Implements: US-H01)

### Log Finalization

- **FR-H02**: Harvest MUST ensure all raw logs in `specs/<feature>/.gwrk/runs/` are git-committed. MUST create/update `specs/<feature>/.gwrk/runs/index.json` mapping each log file to its run metadata (runId, phase, agent, timestamp, size). Log sizes are 10-115KB (measured); all are git-tracked for learning. (Implements: US-H02)

### DB Finalization

- **FR-H03**: Harvest MUST call `finishRun()` on the SQLite execution ledger with: merge timestamp (from webhook payload), final status `'merged'`, PR number, and merge commit SHA. If no matching `startRun()` record exists, log warning and create a backfill record. (Implements: US-H03)

### Compression Engine

- **FR-H04**: Harvest MUST calculate **Point Compression**: estimated coding hours (from effort engine: SP × role rate × 1.25× overhead) ÷ actual active coding time (Git commit timestamps, 30-min gap threshold for session boundaries). (Implements: US-H04)

- **FR-H05**: Harvest MUST calculate **Total Compression**: estimated elapsed days (total hours ÷ 8 hours/day) ÷ actual delivery window (first impl commit → merge timestamp). Dormancy period (spec creation → first impl commit) tracked but NOT counted in compression. (Implements: US-H04)

- **FR-H06**: Harvest MUST record both compression values in SQLite `compression` table with feature, phase, timestamps, and ratios. (Implements: US-H04)

### Slack Done-Done

- **FR-H07**: Harvest MUST post a "🏆 Done, Done!" message to the project's Slack channel via 003-slack integration. Message includes: feature name, phase, point compression, total compression, active coding time, delivery window, dormancy (if any). (Implements: US-H05)

### Branch Cleanup

- **FR-H08**: Harvest MUST delete the merged phase branch from the remote via `git push origin --delete <branch>`. Deletion failure is logged but does not fail the harvest pipeline. (Implements: US-H06)

---

## 4. Dependencies

| Dependency | What It Provides | Feature |
|---|---|---|
| 002-build-server | Webhook endpoint, server lifecycle | Build server infrastructure |
| 003-slack | Slack notification API, channel resolution | Comms layer |
| 004-ship-loop | Execution manifests, raw logs, `startRun()` records | Ship Loop outputs |
| SQLite execution ledger | `runs` and `compression` tables | ADR-002 |
| Effort engine | SP × role rate estimates | engine/effort.ts |

---

## 5. Technical Constraints

- **TC-H01**: Webhook-triggered — Harvest MUST be initiated by GitHub webhook, not polling.
- **TC-H02**: Idempotent — Running harvest twice for the same merge MUST NOT create duplicate records.
- **TC-H03**: Fail-fast config — `GITHUB_WEBHOOK_SECRET` required; missing → `process.exit(1)`.
- **TC-H04**: Compression timestamps from Git only — no OS file dates (unreliable across environments).

---

## 6. Data Model

### Compression Record (`compression` table)

```json
{
  "feature": "004-ship-loop",
  "phase": "phase-01",
  "estimatedHours": 287.5,
  "actualCodingHours": 0.75,
  "estimatedDays": 36,
  "actualDeliveryDays": 0.73,
  "pointCompression": 383,
  "totalCompression": 49,
  "dormancyDays": 179,
  "firstImplCommit": "2026-03-31T15:42:00Z",
  "mergeTimestamp": "2026-04-01T09:15:00Z",
  "sessionCount": 1,
  "recordedAt": "2026-04-01T09:16:00Z"
}
```

---

## 7. Success Criteria

- **SC-H01**: PR merge triggers harvest automatically via webhook.
- **SC-H02**: All logs indexed, DB records finalized, compression calculated.
- **SC-H03**: Slack "🏆 Done, Done!" message posted with compression ratios.
- **SC-H04**: Harvest is idempotent — safe to re-run.
- **SC-H05**: `gwrk compression <feature>` shows calculated ratios after harvest.
