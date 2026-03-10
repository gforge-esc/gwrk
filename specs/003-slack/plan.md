# Implementation Plan: 003 Slack

**Branch**: `003-slack` | **Date**: 2026-03-10 | **Spec**: [spec.md](./spec.md)

## Summary
Implement full Slack integration using Bolt SDK and Socket Mode. This includes automated app provisioning, channel-per-project management, Block Kit status updates, slash command control, interactive review buttons, presence-aware notification throttling, and a real-time App Home Tab dashboard.

---

## Phases and File Structure

### Phase 1: Foundation & Setup
Implement `gwrk setup slack` to automate app creation/configuration and verify connectivity.

**Files (5):**
- `package.json` (Modify: Add `@slack/bolt` and `dotenv` dependency)
- `src/utils/slack.ts` (New: Slack client wrapper and Socket Mode initialization)
- `src/commands/setup-slack.ts` (New: Command implementation for setup and verification)
- `src/cli.ts` (Modify: Register `setup-slack` command)
- `src/db/migrations/002-slack.sql` (New: Database tables for notification queue and DUT threads)

**Requirements Addressed:** FR-001, FR-009, US-001, US-009, TC-002, TC-005, TC-006

**Dependencies:** None

**Test Strategy:**
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/commands/setup-slack.test.ts` | Verify app creation, token write, and connectivity check |
| TR-002 | Unit | `src/server/slack.test.ts` | Verify Bolt SDK initialization with Socket Mode |

### Phase 2: Server Integration
Integrate Bolt Socket Mode into the gwrk server and add the `server` CLI command.

**Files (3):**
- `src/server/index.ts` (Modify: Start Bolt app alongside Fastify)
- `src/server/slack.ts` (New: Bolt app instance and middleware)
- `src/commands/server.ts` (New: `gwrk server` command to start the daemon)
- `src/cli.ts` (Modify: Register `server` command)

**Requirements Addressed:** FR-001, TC-001, TC-005

**Dependencies:** Phase 1

### Phase 3: Project Channel Management
Automate Slack channel creation during project initialization.

**Files (3):**
- `src/utils/slack-channel.ts` (New: Logic for creating/reusing project channels)
- `src/commands/init.ts` (Modify: Call channel creation during `gwrk init`)
- `src/utils/config.ts` (Modify: Extend `GwrkConfigSchema` with Slack project state)

**Requirements Addressed:** FR-002, US-002, DM-002

**Dependencies:** Phase 1

### Phase 4: Block Kit Status Updates
Implement rich status notifications for pipeline events.

**Files (4):**
- `src/utils/slack-blocks.ts` (New: Block Kit builders for phase events, Pulse, and Done Done!)
- `src/commands/ship.ts` (Modify: Add Slack notification hooks for phase start/complete/fail)
- `src/commands/define.ts` (Modify: Add Slack notification hooks for spec/plan/tasks)
- `src/utils/slack-notify.ts` (New: Unified notification dispatcher)

**Requirements Addressed:** FR-003, US-003, TC-003

**Dependencies:** Phase 1

**Test Strategy:**
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit | `src/server/slack-messages.test.ts` | Verify Block Kit JSON structure for all event types |

### Phase 5: Slash Commands & Interactivity
Handle `/gwrk` commands and interactive button/reaction actions.

**Files (3):**
- `src/server/slack-handlers.ts` (New: Slash command handlers for status, dispatch, approve, etc.)
- `src/server/slack-actions.ts` (New: Interactive button and reaction (✅) handlers)
- `src/server/slack.ts` (Modify: Register handlers with Bolt app)

**Requirements Addressed:** FR-004, FR-005, US-004, US-005

**Dependencies:** Phase 2, Phase 4

**Test Strategy:**
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-003 | Unit | `src/server/slack-commands.test.ts` | Verify each slash command returns correct response |
| TR-004 | Unit | `src/server/slack-actions.test.ts` | Verify button taps and reactions trigger pipeline actions |

### Phase 6: Presence-Aware Throttling
Throttle notifications based on user Slack presence.

**Files (3):**
- `src/utils/slack-presence.ts` (New: Presence detection and notification queueing logic)
- `src/server/slack-presence.ts` (New: Presence event listeners and batch delivery)
- `src/db/runs.ts` (Modify: Add helpers for notification queue management)

**Requirements Addressed:** FR-007, US-007, DM-003

**Dependencies:** Phase 4, Phase 5

### Phase 7: App Home & DUT Conversations
Implement the dashboard and threaded AI conversations.

**Files (3):**
- `src/server/slack-home.ts` (New: Home Tab Block Kit builder and event handler)
- `src/server/slack-dut.ts` (New: `/dream` handler and threaded conversation logic)
- `src/db/runs.ts` (Modify: Add helpers for DUT thread persistence)

**Requirements Addressed:** FR-006, FR-008, US-006, US-008, DM-004

**Dependencies:** Phase 5, Phase 6

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| SlackProjectConfig | `src/utils/config.ts` | `src/commands/init.ts`, `src/utils/slack-channel.ts` |
| SlackEvent | `src/utils/slack-notify.ts` | `src/utils/slack-blocks.ts`, `src/utils/slack-presence.ts` |
| DutThread | `src/db/runs.ts` | `src/server/slack-dut.ts` |

---

## Mockup-to-Selector Mapping
_No mockups exist for this feature._

---

## Deferred Items
<!-- None — full coverage. -->

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| FR-001 (Setup) | 1, 2 | Planned |
| FR-002 (Channels) | 3 | Planned |
| FR-003 (Status) | 4 | Planned |
| FR-004 (Slash) | 5 | Planned |
| FR-005 (Actions) | 5 | Planned |
| FR-006 (DUT) | 7 | Planned |
| FR-007 (Presence) | 6 | Planned |
| FR-008 (Home Tab) | 7 | Planned |
| FR-009 (Verify) | 1 | Planned |
