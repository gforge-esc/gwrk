# Implementation Plan: 003 Slack + App Home Tab

**Branch**: `feat/003-slack` | **Date**: 2026-03-10 | **Spec**: [spec.md](./spec.md)

## Summary

Implement Slack integration via Bolt SDK and Socket Mode. Six phases: (1) setup command + token provisioning, (2) server integration + channel management, (3) Block Kit status updates, (4) slash commands + interactive review buttons, (5) presence-aware notification throttling, (6) App Home Tab dashboard. DUT conversational AI (former FR-006) is deferred to 009-agent-dut.

---

## Phases and File Structure

### Phase 1: Setup & Provisioning

Automated Slack app creation, token management, and connectivity verification. Foundation for all subsequent phases.

**Files (5):**
- `package.json` (Modify: Add `@slack/bolt` dependency)
- `src/commands/setup-slack.ts` (New: `gwrk setup slack [--verify]` command)
- `src/utils/slack-client.ts` (New: Slack client wrapper, token loader from `~/.gwrk/.env`)
- `src/cli.ts` (Modify: Register `setup slack` subcommand)
- `src/utils/config.ts` (Modify: Add Zod schema for Slack tokens, fail-fast validation)

**Requirements Addressed:** FR-001, FR-009, US-001, US-008, TC-001, TC-002, TC-005, TC-006, TC-007, DM-001

**Dependencies:** None (first phase)

**Contract Mapping:**
- `contracts/slack-setup.md` → `setupSlack()` → `src/commands/setup-slack.ts`
- `contracts/slack-setup.md` → `SlackSetupResult` → `src/utils/slack-client.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md (env vars) | SLACK_BOT_TOKEN, SLACK_APP_TOKEN in `~/.gwrk/.env` — fail-fast |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/commands/setup-slack.test.ts` | Mock Slack API: verify app creation, token write, idempotency |
| TR-002 | Unit | `src/server/slack.test.ts` | Mock Bolt App init: Socket Mode config, event registration |

#### Done When
- `pnpm vitest run src/commands/setup-slack.test.ts` exits 0
- `pnpm vitest run src/server/slack.test.ts` exits 0
- `pnpm build` exits 0
- `node dist/cli.js setup slack --help` shows `--verify` flag

---

### Phase 2: Server Integration & Channel Management

Wire Bolt SDK into the Fastify build server lifecycle. Implement channel-per-project provisioning during `gwrk init`/`gwrk new`.

**Files (5):**
- `src/server/slack.ts` (New: Bolt App instance, start/stop with Fastify lifecycle)
- `src/server/index.ts` (Modify: Start Bolt on `server:ready`, stop on `server:shutdown`)
- `src/server/slack-channel.ts` (New: `conversations.create`/reuse logic)
- `src/commands/init.ts` (Modify: Call channel creation when Slack is configured)
- `src/utils/config.ts` (Modify: Extend `.gwrkrc.json` schema with `channelId`, `channelName`)

**Requirements Addressed:** FR-002, US-002, TC-001, TC-004, DM-002

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/bolt-events.md` → `BoltLifecycle.start/stop` → `src/server/slack.ts`
- `contracts/bolt-events.md` → `BoltAppConfig` → `src/server/slack.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md (config) | `.gwrkrc.json` Slack project config extension |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-009 | Unit | `src/server/slack-channel.test.ts` | Mock `conversations.create`, verify re-use on duplicate |
| TR-002 | Unit | `src/server/slack.test.ts` | Verify lifecycle hooks, graceful shutdown |

#### Done When
- `pnpm vitest run src/server/slack-channel.test.ts` exits 0
- `pnpm vitest run src/server/slack.test.ts` exits 0
- `pnpm build` exits 0

---

### Phase 3: Block Kit Status Updates

Rich status notifications for pipeline events: phase start, complete, fail, CI results, review readiness, Pulse summary, Done Done! celebration.

**Files (4):**
- `src/server/slack-messages.ts` (New: Block Kit message builders for 7 event types)
- `src/server/slack-notify.ts` (New: Unified notification dispatcher, channel resolution)
- `src/commands/ship.ts` (Modify: Add Slack notification hooks for phase lifecycle events)
- `src/server/dispatch.ts` (Modify: Emit events consumed by slack-notify)

**Requirements Addressed:** FR-003, US-003, TC-003

**Dependencies:** Phase 2

**Contract Mapping:**
- `contracts/block-kit-messages.md` → `MessageBuilder.*` → `src/server/slack-messages.ts`
- `contracts/block-kit-messages.md` → `SlackMessage` → `src/server/slack-notify.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md (no CDN) | All Block Kit JSON generated locally, no external assets |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit | `src/server/slack-messages.test.ts` | Verify Block Kit JSON structure for all 7 event types |

#### Done When
- `pnpm vitest run src/server/slack-messages.test.ts` exits 0
- `pnpm build` exits 0

---

### Phase 4: Slash Commands & Interactive Review

Handle `/gwrk` slash commands (8 commands) and interactive button/reaction actions for review flow.

**Files (4):**
- `src/server/slack-commands.ts` (New: 8 slash command handlers)
- `src/server/slack-actions.ts` (New: Interactive button handler, ✅ reaction-to-approve)
- `src/server/slack.ts` (Modify: Register command/action handlers with Bolt)
- `src/server/routes/health.ts` (Modify: Add Slack connection status to health endpoint)

**Requirements Addressed:** FR-004, FR-005, US-004, US-005

**Dependencies:** Phase 2, Phase 3

**Contract Mapping:**
- `contracts/slash-commands.md` → `SlashCommandHandler` → `src/server/slack-commands.ts`
- `contracts/slash-commands.md` → `CommandContext` → `src/server/slack-commands.ts`
- `contracts/block-kit-messages.md` → `ReviewAction` → `src/server/slack-actions.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md (env vars) | `gh` CLI required for merge actions |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-003 | Unit | `src/server/slack-commands.test.ts` | Verify each slash command response format |
| TR-004 | Unit | `src/server/slack-actions.test.ts` | Verify Merge triggers `gh pr merge`, reaction handler |
| TR-010 | Integration | `src/server/slack-integration.test.ts` | Mock Bolt app, send slash command, verify response |

#### Done When
- `pnpm vitest run src/server/slack-commands.test.ts` exits 0
- `pnpm vitest run src/server/slack-actions.test.ts` exits 0
- `pnpm vitest run src/server/slack-integration.test.ts` exits 0
- `pnpm build` exits 0

---

### Phase 5: Presence-Aware Notification Throttling

Detect user Slack presence (active/away) and throttle notifications accordingly: immediate when active, batched summary when status changes to active.

**Files (3):**
- `src/server/slack-presence.ts` (New: Presence poller, notification queue, batch delivery)
- `src/server/slack-notify.ts` (Modify: Route through presence gate before posting)
- `src/server/slack-messages.ts` (Modify: Add `batchedSummary()` message builder)

**Requirements Addressed:** FR-007, US-006, DM-003

**Dependencies:** Phase 3, Phase 4

**Contract Mapping:**
- `contracts/block-kit-messages.md` → `MessageBuilder.batchedSummary` → `src/server/slack-messages.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md (no magic values) | Presence poll interval from config, not hardcoded |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-006 | Unit | `src/server/slack-presence.test.ts` | Mock presence changes, verify immediate vs batched delivery |

#### Done When
- `pnpm vitest run src/server/slack-presence.test.ts` exits 0
- `pnpm build` exits 0

---

### Phase 6: App Home Tab

Real-time ops dashboard rendered as Slack App Home Tab via Block Kit. Sections: Active Agents, Dispatch Queue, System Resources, Feature Progress, Pulse summary. Auto-refreshes on `app_home_opened`.

**Files (3):**
- `src/server/slack-home.ts` (New: App Home Tab Block Kit builder, `app_home_opened` handler)
- `src/server/slack.ts` (Modify: Register `app_home_opened` event handler)
- `src/server/routes/status.ts` (Modify: Export status data for Home Tab consumption)

**Requirements Addressed:** FR-008, US-007

**Dependencies:** Phase 4 (needs slash commands registered, status data)

**Contract Mapping:**
- `contracts/bolt-events.md` → `handleAppHomeOpened` → `src/server/slack-home.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md (no CDN) | All Block Kit JSON generated locally |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-007 | Unit | `src/server/slack-home.test.ts` | Mock daemon state, verify Block Kit sections for all 5 dashboard areas |

#### Done When
- `pnpm vitest run src/server/slack-home.test.ts` exits 0
- `pnpm build` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `SlackSetupResult` | `src/utils/slack-client.ts` | `src/commands/setup-slack.ts` |
| `SlackProjectConfig` | `src/utils/config.ts` | `src/commands/init.ts`, `src/server/slack-channel.ts` |
| `SlackMessage` | `src/server/slack-notify.ts` | `src/server/slack-messages.ts` |
| `SlackEvent` | `src/server/slack-notify.ts` | `src/server/slack-presence.ts` |
| `SlashCommandHandler` | `src/server/slack-commands.ts` | `src/server/slack.ts` |
| `ReviewAction` | `src/server/slack-actions.ts` | `src/server/slack.ts` |
| `BatchedNotification` | `src/server/slack-presence.ts` | `src/server/slack-notify.ts` |

---

## Mockup-to-Selector Mapping
_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| FR-006 | `/dream` DUT Conversations | Conversational AI requires LLM integration, thread state, spec generation — distinct from core Slack infra | 009-agent-dut |
| TR-008 | DUT Thread Test | Deferred with FR-006 | 009-agent-dut |
| DM-004 | DUT Thread State (SQLite) | Deferred with FR-006 | 009-agent-dut |
| SC-005 | DUT spec generation | Deferred with FR-006 | 009-agent-dut |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 (Setup) | 1 | Planned |
| US-002 (Channels) | 2 | Planned |
| US-003 (Status) | 3 | Planned |
| US-004 (Slash Cmds) | 4 | Planned |
| US-005 (Review Buttons) | 4 | Planned |
| US-006 (Presence) | 5 | Planned |
| US-007 (Home Tab) | 6 | Planned |
| US-008 (Verify) | 1 | Planned |
| FR-001 (Setup Slack) | 1 | Planned |
| FR-002 (Channels) | 2 | Planned |
| FR-003 (Status Updates) | 3 | Planned |
| FR-004 (Slash Commands) | 4 | Planned |
| FR-005 (Interactive Reviews) | 4 | Planned |
| FR-006 (DUT) | — | Deferred → 009 |
| FR-007 (Presence) | 5 | Planned |
| FR-008 (Home Tab) | 6 | Planned |
| FR-009 (Verify) | 1 | Planned |
| TR-001 (Setup Test) | 1 | Planned |
| TR-002 (Bolt Init) | 1, 2 | Planned |
| TR-003 (Slash Cmds) | 4 | Planned |
| TR-004 (Actions) | 4 | Planned |
| TR-005 (Messages) | 3 | Planned |
| TR-006 (Presence) | 5 | Planned |
| TR-007 (Home Tab) | 6 | Planned |
| TR-008 (DUT) | — | Deferred → 009 |
| TR-009 (Channels) | 2 | Planned |
| TR-010 (Integration) | 4 | Planned |
| DM-001 (Slack Config) | 1 | Planned |
| DM-002 (Project State) | 2 | Planned |
| DM-003 (Notification Queue) | 5 | Planned |
| DM-004 (DUT Threads) | — | Deferred → 009 |
| TC-001 (Air-Gapped) | 1, 2 | Planned |
| TC-002 (Fail-Fast) | 1 | Planned |
| TC-003 (No CDN) | 3 | Planned |
| TC-004 (Single-User) | 2 | Planned |
| TC-005 (Bolt SDK) | 1 | Planned |
| TC-006 (Token Storage) | 1 | Planned |
| TC-007 (TypeScript Only) | All | Planned |
| SC-001 (Zero Clicks) | 1 | Planned |
| SC-002 (5s Updates) | 3 | Planned |
| SC-003 (3s Commands) | 4 | Planned |
| SC-004 (Merge Flow) | 4 | Planned |
| SC-005 (DUT) | — | Deferred → 009 |
| SC-006 (Batched) | 5 | Planned |
| SC-007 (Home Tab) | 6 | Planned |
| VR-001 (Setup E2E) | 1 | Planned |
| VR-002 (Channel E2E) | 2 | Planned |
| VR-003 (Negative) | 1 | Planned |
| VR-004 (Review E2E) | 4 | Planned |
| VR-005 (Slash E2E) | 4 | Planned |
| VR-006 (Determinism) | 3 | Planned |
