---
type: specification
feature: 003-slack
last_modified: "2026-03-12T09:00:00Z"
revision: 2
---

# Feature Specification: 003 Slack

**Feature Branch**: `feat/003-slack`
**Created**: 2026-03-05
**Revised**: 2026-03-12 (v2 — gap fill, Slack-as-hub vision)
**Status**: Revised
**Input**: Slack as primary gwrk hub — socket mode, channel-per-project, slash commands, interactive review decisions, App Home Tab dashboard, build server notify bridge, `/gwrk ship` from Slack, multi-channel topology, presence-aware delivery

> **Revision Note (v2):** Original spec built the scaffolding (message builders, presence routing, handlers) but missed the integration contract between the ship loop and Slack. Core audit finding: `notifySlack()` and `MessageBuilder` are never called anywhere in the codebase. This revision adds the missing wiring (US-010 through US-013) and corrects broken assumptions in existing stories.

---

## 2. User Scenarios & Testing

### US-001 - Automated Slack App Provisioning (Priority: P0)
As a Principal Engineer, I want `gwrk setup slack` to guide me through making a Slack app, install it to my workspace, configure Socket Mode, write tokens to `~/.gwrk/.env`, and verify the connection — so that I never have to manually navigate Slack's API portal to configure a bot.

**Implements**: FR-001, FR-009

**Independent Test**: Run `gwrk setup slack --verify` with valid tokens in `~/.gwrk/.env`, verify exit 0.

**Acceptance Scenarios**:
1. **Given** valid Slack tokens in `~/.gwrk/.env`, **When** the user runs `gwrk setup slack --verify`, **Then**:
   - `gwrk setup slack --verify 2>&1 | grep -q 'Bot Token: OK'` exits 0
   - `gwrk setup slack --verify 2>&1 | grep -q 'Socket Mode: OK'` exits 0
   - Exit code is 0
2. **Given** `~/.gwrk/.env` already contains valid tokens, **When** the user runs `gwrk setup slack`, **Then**:
   - `gwrk setup slack 2>&1 | grep -q 'already configured'` exits 0
   - Exit code is 0 (idempotent)
3. **Given** an expired bot token, **When** running `gwrk setup slack --verify`, **Then**:
   - `gwrk setup slack --verify 2>&1 | grep -q 'Bot Token: FAIL'` exits 0
   - Exit code is 1

---

### US-002 - Channel-Per-Project (Priority: P0)
As a Principal Engineer, I want `gwrk init --slack <channel>` and `gwrk new` to provision a dedicated Slack channel for each project, so that each project has its own notification feed, separate from others.

**Implements**: FR-002

**Independent Test**: Run `gwrk init --slack my-project` in an existing project, verify channel exists in Slack and `channelId` is written to `.gwrkrc.json`.

**Acceptance Scenarios**:
1. **Given** Slack is configured and project name is `code-red`, **When** running `gwrk init --slack code-red`, **Then**:
   - `cat .gwrkrc.json | jq -e '.project.slack.channelId'` exits 0
   - `cat .gwrkrc.json | jq -r '.project.slack.channelName'` outputs `code-red`
2. **Given** channel `code-red` already exists, **When** running `gwrk init --slack code-red`, **Then**:
   - Command completes without error (idempotent — joins existing channel)
   - Exit code is 0
3. **Given** Slack not configured, **When** running `gwrk init --slack code-red`, **Then**:
   - `gwrk init --slack code-red 2>&1 | grep -q 'Slack not configured'` exits 0
   - Exit code is 1

---

### US-003 - Status Updates (Priority: P0)
As a Principal Engineer, I want gwrk to post structured status updates to the project channel for every pipeline lifecycle event — phase starts, completions, failures, CI results, review readiness — so that I can see pipeline progress from my phone without opening a laptop.

**Implements**: FR-003

**Independent Test**: Trigger `gwrk ship <feature> <phase>` with a Slack channel configured and the server running; verify Block Kit message appears in the project Slack channel.

**Acceptance Scenarios**:
1. **Given** server running, project channel configured, **When** `gwrk ship` starts a phase dispatch, **Then**:
   - A Block Kit `phaseStart` message appears in `#gwrk-ops` within 5 seconds
   - Message contains: phase name, agent backend, branch name
2. **Given** a phase completes successfully, **When** the ship loop finishes, **Then**:
   - A Block Kit `reviewReady` message appears in the channel with `[✅ Merge]`, `[🔄 Request Changes]`, `[🔍 View Review]` buttons
   - Message contains the actual PR URL and diff stat
3. **Given** a phase fails (gate or agent error), **When** failure is detected, **Then**:
   - A Block Kit `phaseFail` message appears with `[🔄 Retry]` and `[📋 View Logs]` buttons
   - Message contains truncated error excerpt

---

### US-004 - Slash Commands (Priority: P0)
As a Principal Engineer, I want to use `/gwrk` slash commands to query and control the pipeline from Slack, so that I can get real status and take real actions without touching a terminal.

**Implements**: FR-004

**Independent Test**: Type `/gwrk status` in Slack with server running and active features; verify Block Kit response contains RAGB status for at least one feature.

**Acceptance Scenarios**:
1. **Given** active features in SQLite `runs` table, **When** typing `/gwrk status`, **Then**:
   - Slack response contains features with phase, status, and RAGB color
   - Response arrives within 3 seconds
2. **Given** feature `002-build-server` exists, **When** typing `/gwrk dispatch 002-build-server 3`, **Then**:
   - `gwrk tasks list 002-build-server --compact | grep -q 'phase-03'` confirms phase exists
   - A dispatch confirmation message is posted to the channel
3. **Given** PR #N is open for a feature/phase, **When** typing `/gwrk approve 002-build-server phase-03`, **Then**:
   - `gh pr view <N> --json state -q .state | grep -q 'MERGED'` exits 0
   - Confirmation message: `PR #N merged ✅` posted to channel

---

### US-005 - Interactive Review Decisions (Priority: P0)
As a Principal Engineer, I want to approve or reject reviews by tapping buttons on Slack messages — or reacting with ✅ — so that I never need to open a laptop, terminal, or IDE to unblock the pipeline.

**Implements**: FR-005

**Independent Test**: Post a `reviewReady` message with buttons, tap `[✅ Merge]`, verify PR merged and confirmation posted.

**Acceptance Scenarios**:
1. **Given** a `reviewReady` message in channel with `[✅ Merge]` button, **When** the user taps `Merge`, **Then**:
   - `gh pr view <N> --json state -q .state | grep -q 'MERGED'` exits 0
   - Confirmation posted: `PR #N merged ✅`
2. **Given** a `reviewReady` message, **When** the user reacts with ✅, **Then**:
   - Same merge flow as tapping the button
3. **Given** a `phaseFail` message with `[🔄 Retry]`, **When** user taps Retry, **Then**:
   - New dispatch enqueued for the same feature/phase
   - Confirmation posted: `Retrying <feature> phase-<N>...`

---

### US-006 - Presence-Aware Notification Throttling (Priority: P1)
As a Principal Engineer, I want gwrk to throttle notifications based on my Slack presence — verbose when active, batched when away — so I don't wake up to 47 phase update messages at 2am.

**Implements**: FR-007

**Independent Test**: Set presence to away, trigger 3 phase events, change presence to active, verify single batched summary message received.

**Acceptance Scenarios**:
1. **Given** user is `active` in Slack, **When** a phase completes, **Then**:
   - Individual status message posted immediately (within 5 seconds)
2. **Given** user is `away` and 3 phase events occur, **When** presence changes to `active`, **Then**:
   - Single batched summary message posted containing all 3 events
   - No individual messages were posted during `away` period

---

### US-007 - App Home Tab Dashboard (Priority: P1)
As a Principal Engineer, I want the gwrk Slack App Home Tab to show a live ops dashboard — active agents, dispatch queue, system resources, feature phase progress with RAGB — so I have a single glass pane for pipeline state when I open Slack.

**Implements**: FR-008

**Independent Test**: Open gwrk app Home Tab in Slack with server running; verify all 5 sections render with live data.

**Acceptance Scenarios**:
1. **Given** server running with active dispatches, **When** user opens gwrk App Home Tab, **Then**:
   - Block Kit renders 5 sections: Active Agents, Dispatch Queue, System Resources, Feature Progress, Pulse Summary
   - Feature Progress shows RAGB status per feature
2. **Given** a phase status changes, **When** user re-opens or refreshes Home Tab, **Then**:
   - Updated state is reflected (triggered by `app_home_opened`)

---

### US-008 - Slack Setup Verification (Priority: P0)
As a Principal Engineer, I want `gwrk setup slack --verify` to test the full Slack pipeline and tell me exactly what's working and what's broken, so that I know integration health before relying on it.

**Implements**: FR-001, FR-009

**Independent Test**: Run `gwrk setup slack --verify`, verify structured output for each check.

**Acceptance Scenarios**:
1. **Given** valid Slack tokens, **When** running `gwrk setup slack --verify`, **Then**:
   - Output contains: `Bot Token: OK`, `App Token: OK`, `Socket Mode: OK`, `Test Message: OK`
   - `gwrk setup slack --verify` exits 0
2. **Given** invalid bot token, **When** running `gwrk setup slack --verify`, **Then**:
   - `gwrk setup slack --verify 2>&1 | grep -q 'Bot Token: FAIL'` exits 0
   - Exit code is 1

---

### US-009 - Setup Verification (Priority: P0)
_Covered by US-008. Combined for simplicity._

---

### US-010 - Ship Loop → Slack Notify Bridge (Priority: P0) ⭐ **NEW**
As a Principal Engineer, I want the `gwrk ship` loop to automatically post lifecycle events (phase start, complete, fail, CI result, review ready) to the project Slack channel via the build server, so that Slack actually receives pipeline events without me doing anything.

**Implements**: FR-010

**Independent Test**: Run `gwrk ship <feature> <phase>` with server running and channel configured; verify Slack messages appear without any manual action.

**Acceptance Scenarios**:
1. **Given** server running, channel in `.gwrkrc.json`, **When** `agent-run.sh` starts phase execution, **Then**:
   - `curl -s http://localhost:18790/api/notify -d '{"type":"phase_start",...}'` exits 0
   - Block Kit `phaseStart` message appears in Slack channel within 5 seconds
2. **Given** phase completes, **When** `agent-run.sh` exits 0, **Then**:
   - `POST /api/notify` with type `review_ready` triggers Block Kit message with PR URL and gate results
3. **Given** server is not running, **When** ship loop attempts notify, **Then**:
   - Notify call fails silently (non-fatal) — logged to ship log but ship continues
   - `grep -q 'notify skipped' .gwrk/logs/*.log` exits 0

---

### US-011 - PR Lookup for Slash Command Approval (Priority: P0) ⭐ **NEW**
As a Principal Engineer, I want `/gwrk approve <feature> <phase>` to look up the actual open PR number from the SQLite `runs` table and merge it with `gh pr merge`, so that tapping Approve from Slack reliably merges the right PR.

**Implements**: FR-011

**Independent Test**: After `gwrk ship` creates PR for a feature/phase, run `/gwrk approve <feature> <phase>` in Slack; verify correct PR is merged.

**Acceptance Scenarios**:
1. **Given** PR #42 open for `002-build-server phase-03`, **When** `/gwrk approve 002-build-server phase-03` is typed, **Then**:
   - `gh pr view 42 --json state -q .state | grep -q 'MERGED'` exits 0
   - Confirmation: `PR #42 merged ✅`
2. **Given** no open PR for the feature/phase, **When** `/gwrk approve` is typed, **Then**:
   - Ephemeral response: `No open PR found for 002-build-server phase-03`
   - No error thrown

---

### US-012 - `/gwrk ship` from Slack (Priority: P1) ⭐ **NEW**
As a Principal Engineer, I want to type `/gwrk ship <feature> <phase>` in Slack and have it dispatch the full ship loop as a background job, posting progress back to the channel, so that I can start a feature build from my phone without touching a terminal.

**Implements**: FR-012

**Independent Test**: Type `/gwrk ship 002-build-server 3` in Slack; verify acknowledgment posted and ship loop starts.

**Acceptance Scenarios**:
1. **Given** server running and feature exists, **When** typing `/gwrk ship 002-build-server 3`, **Then**:
   - Ephemeral acknowledgment immediately: `🚀 Dispatching 002-build-server phase-3...`
   - Within 10 seconds, `phaseStart` Block Kit message appears in channel
2. **Given** invalid feature name, **When** typing `/gwrk ship bad-feature 1`, **Then**:
   - Ephemeral error: `Feature bad-feature not found`
   - Exit 0 (Slack requires non-error responses to slash commands)

---

### US-013 - Multi-Channel Topology (Priority: P1) ⭐ **NEW**
As a Principal Engineer, I want a `gwrk-ops` master channel for cross-project summaries and a per-project channel (e.g., `#code-red`) for per-project events, so that my Slack has a logical hierarchy matching my project portfolio.

**Implements**: FR-013

**Independent Test**: Configure `gwrk-ops` as master channel and `code-red` as project channel; verify ship events route to `#code-red` and daily Pulse summary routes to `#gwrk-ops`.

**Acceptance Scenarios**:
1. **Given** `gwrkrc.json` has `slack.masterChannelId` and `slack.channelId`, **When** a phase event fires, **Then**:
   - Phase event posts to project channel (`#code-red`)
   - Master channel (`#gwrk-ops`) does NOT receive individual phase events
2. **Given** Pulse summary generated, **When** daily summary fires, **Then**:
   - `#gwrk-ops` receives cross-project Pulse summary
   - Individual project channels receive only their own activity

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

The Slack app requires these OAuth scopes:

| Scope | Purpose |
|---|---|
| `channels:manage` | Create project channels |
| `channels:read` | List channels (for idempotent provisioning) |
| `channels:join` | Join existing channels |
| `chat:write` | Post status updates |
| `commands` | Register `/gwrk` slash command |
| `reactions:read` | Detect ✅ approval reactions |
| `users:read` | Presence detection for notification throttling |
| `app_mentions:read` | DUT @mention triggers (future) |

---

## 4. Functional Requirements

- **FR-001**: System MUST provide `gwrk setup slack` that writes tokens to `~/.gwrk/.env` and verifies the connection. Idempotent. (Implements: US-001, US-008)
- **FR-002**: System MUST provision a Slack channel (create or join) via `gwrk init --slack <channel>` for existing projects and `gwrk new` for new projects. Store `channelId` + `channelName` in `.gwrkrc.json`. (Implements: US-002)
- **FR-003**: System MUST post Block Kit-formatted status messages to the project channel for: phase start, phase completion, phase failure, CI result, review readiness (with interactive buttons + PR URL), Pulse daily summary, and Done Done! celebration. (Implements: US-003)
- **FR-004**: System MUST register and handle these slash commands with real data from SQLite and the running server: `/gwrk status [feature]`, `/gwrk dispatch <feature> <phase>`, `/gwrk approve <feature> <phase>`, `/gwrk reject <feature> <phase> <reason>`, `/gwrk pause <feature>`, `/gwrk pulse`, `/gwrk effort <feature>`, `/gwrk logs <feature> <phase>`, `/gwrk ship <feature> <phase>`. (Implements: US-004, US-012)
- **FR-005**: System MUST render interactive buttons on review messages (`Merge`, `Request Changes`, `View Full Review`) and handle button taps and ✅ reactions as real pipeline actions (PR merge via `gh pr merge #N`, re-dispatch, log view). (Implements: US-005)
- **FR-006**: DEFERRED to 009-agent-dut.
- **FR-007**: System MUST observe Slack user presence and throttle notifications: active → immediate, away → batch and deliver summary on return to active. (Implements: US-006)
- **FR-008**: System MUST render an App Home Tab dashboard with: Active Agents, Dispatch Queue, System Resources, Feature Progress (with RAGB per feature), Pulse summary. Refreshes on `app_home_opened`. (Implements: US-007)
- **FR-009**: System MUST provide `gwrk setup slack --verify` that tests token validity, Socket Mode connection, and sends a test message reporting `Bot Token: OK/FAIL`, `App Token: OK/FAIL`, `Socket Mode: OK/FAIL`, `Test Message: OK/FAIL`. (Implements: US-008)
- **FR-010**: System MUST provide a `POST /api/notify` HTTP endpoint on the build server that accepts a lifecycle event payload and posts the corresponding Block Kit message to the project Slack channel. The ship loop scripts MUST call this endpoint at: phase start, phase complete (with PR URL), phase fail (with error), CI result, review ready. Failure to reach the endpoint MUST be non-fatal (logged, ship continues). (Implements: US-010)
- **FR-011**: System MUST implement PR lookup for approval actions: query SQLite `runs` table for the most recent open PR number for a given `featureId + phaseId`, then call `gh pr merge --merge --delete-branch <N>`. Approve button and `/gwrk approve` slash command MUST use this lookup. (Implements: US-011)
- **FR-012**: System MUST handle `/gwrk ship <feature> <phase>` by spawning `gwrk ship` as a background subprocess, acknowledging immediately to Slack, and posting phaseStart + subsequent lifecycle events to the channel. (Implements: US-012)
- **FR-013**: System MUST support a two-tier channel topology: `masterChannelId` in `.gwrkrc.json` for cross-project events (Pulse summary, Done Done!), and `channelId` for per-project events (phase lifecycle, review messages). Both configurable via `gwrk init`. (Implements: US-013)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Tokens missing from `~/.gwrk/.env` | `Slack credentials not found. Run gwrk setup slack` | 1 |
| Socket Mode connection fails | `Socket Mode connection failed` | 1 |
| Already configured (idempotent) | `Slack already configured` | 0 |

#### FR-002 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Slack not configured | `Slack not configured. Run gwrk setup slack first` | 1 |
| Channel creation fails (permissions) | `Failed to create channel: <api-error>` | 1 |
| App token used instead of bot token | `missing_scope` → use bot token directly via fetch | 1 |

#### FR-003 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No channel configured for project | `No Slack channel configured — skipping notification` | 0 (warn, non-fatal) |
| Message post fails | `Failed to post Slack notification: <api-error>` | 0 (warn, non-fatal) |
| Server not running (from ship script) | `notify skipped: server not reachable` | 0 (non-fatal) |

#### FR-004 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Unknown slash command | `Unknown command: <cmd>` | 0 (ephemeral reply) |
| Feature not found | `Feature <feature> not found` | 0 (ephemeral reply) |
| Server not running when command received | `Build server offline — command unavailable` | 0 (ephemeral reply) |

#### FR-005 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Button action with invalid payload | `Invalid action payload` | 0 (ephemeral reply) |
| PR not found for approval | `No open PR found for <feature> <phase>` | 0 (ephemeral reply) |
| `gh pr merge` fails | `Failed to merge PR: <error>` | 0 (ephemeral reply) |
| PR already merged | `PR already merged` | 0 (ephemeral reply) |

#### FR-007 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Presence API unavailable | `Warning: presence detection unavailable — immediate delivery fallback` | 0 (non-fatal) |
| Batch queue overflow (>100 events) | `Warning: notification batch truncated to 100 events` | 0 (non-fatal) |

#### FR-008 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Server not reachable | App Home renders with `Server: Offline` section | 0 |
| No projects configured | App Home renders with `No projects configured` | 0 |

#### FR-009 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Invalid bot token | `Bot Token: FAIL` | 1 |
| Invalid app token | `App Token: FAIL` | 1 |
| Test message failed | `Test Message: FAIL` | 1 |

#### FR-010 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Server not running | `notify skipped: ECONNREFUSED` | 0 (non-fatal, ship continues) |
| Unknown event type | `Unknown notify event type: <type>` | 1 |
| Missing required fields in payload | `Notify payload invalid: <field> required` | 1 |

#### FR-011 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No PR in `runs` for feature/phase | `No open PR found for <feature> <phase>` | 0 (ephemeral) |
| `gh` CLI not found | `gh CLI not found — cannot merge PR` | 0 (ephemeral) |

#### FR-012 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Feature not found | `Feature <feature> not found` | 0 (ephemeral) |
| Phase out of range | `Phase <N> not found for <feature>` | 0 (ephemeral) |

#### FR-013 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| `masterChannelId` not configured | Route all events to `channelId` (graceful fallback) | 0 |

---

## 5. Data Model Requirements

### DM-001: Slack Configuration (`~/.gwrk/.env`)

```bash
SLACK_BOT_TOKEN=xoxb-...     # Bot User OAuth Token (used for all REST API calls)
SLACK_APP_TOKEN=xapp-...     # App-Level Token (Socket Mode WebSocket only)
```

> **NOTE**: Bot token MUST be used for REST API calls (chat.postMessage, conversations.create etc). App token is ONLY for Socket Mode WebSocket connection. Mixing them causes `missing_scope` errors.

### DM-002: Project Slack State (`.gwrkrc.json`)

```typescript
interface SlackProjectConfig {
  channelId: string;          // Per-project Slack channel ID
  channelName: string;        // e.g. "code-red"
  masterChannelId?: string;   // Cross-project hub (e.g. gwrk-ops)
  masterChannelName?: string; // e.g. "gwrk-ops"
}
```

### DM-003: Notification Queue (in-memory, presence-aware)

```typescript
interface BatchedNotification {
  projectId: string;
  events: SlackEvent[];
  batchedSince: string;  // ISO 8601 of first queued event
}

interface SlackEvent {
  type: 'phase_start' | 'phase_complete' | 'phase_fail' | 'ci_result' | 'review_ready' | 'done_done';
  feature: string;
  phase?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}
```

### DM-004: Notify Bridge Payload (HTTP body for `POST /api/notify`)

```typescript
interface NotifyPayload {
  type: SlackEvent['type'];
  feature: string;
  phase?: string;
  prUrl?: string;       // For review_ready — linked from `runs` table
  prNumber?: number;    // For approval lookup
  gateResults?: string; // Summary of gate pass/fail for review_ready
  error?: string;       // For phase_fail
  branch?: string;
  backend?: string;
}
```

### DM-005: PR Tracking (SQLite `runs` table extension)
The existing `runs` table needs a `pr_number` column populated by the ship loop when a PR is created:
```sql
ALTER TABLE runs ADD COLUMN pr_number INTEGER;
ALTER TABLE runs ADD COLUMN pr_url TEXT;
```

### DM-006: DUT Thread State — DEFERRED to 009-agent-dut.

---

## 6. Technical Constraints

- **TC-001**: Air-Gapped by Default — Socket Mode uses outbound WebSocket only. No inbound HTTP. No ngrok. No public URL.
- **TC-002**: Fail-Fast Config — Zod validation of all Slack tokens. Missing `SLACK_BOT_TOKEN` or `SLACK_APP_TOKEN` → `process.exit(1)`.
- **TC-003**: No CDN — All Block Kit JSON generated locally. No runtime fetches. No external assets in messages.
- **TC-004**: Single-User — One workspace, one PE. No multi-tenant auth.
- **TC-005**: Bolt SDK — Use `@slack/bolt` for Socket Mode WebSocket. REST API calls use raw `fetch` with bot token directly (NOT `app.client` — see DM-001 note).
- **TC-006**: Token Storage — Tokens in `~/.gwrk/.env`. Never committed. Fail if missing.
- **TC-007**: TypeScript only — No `.js` in `src/`. ESM modules, ES2022 target.
- **TC-008**: Non-Fatal Notify — `POST /api/notify` failures in ship scripts MUST NOT abort the ship loop. Log and continue.
- **TC-009**: PR Lookup Required — Interactive approve actions MUST resolve actual PR number from SQLite before calling `gh pr merge`. Hardcoded or assumed PR numbers are forbidden.

---

## 7. Testing Requirements

- **TR-001**: `src/commands/setup-slack.test.ts` — Mock Slack API: verify token write, verify command, idempotency. Vitest. (FR-001, FR-009)
- **TR-002**: `src/server/slack.test.ts` — Mock Bolt App: verify Socket Mode init, lifecycle start/stop, graceful shutdown. Vitest. (FR-001)
- **TR-003**: `src/server/slack-commands.test.ts` — Mock each slash command: `/gwrk status` format, `/gwrk approve` PR lookup, `/gwrk ship` dispatch acknowledgment. Vitest. (FR-004, FR-011, FR-012)
- **TR-004**: `src/server/slack-actions.test.ts` — Mock interactive button handler: verify Merge calls `gh pr merge #N` (with mocked PR lookup), Request Changes re-dispatches, ✅ reaction triggers same flow. Vitest. (FR-005, FR-011)
- **TR-005**: `src/server/slack-messages.test.ts` — Unit test all Block Kit builders: JSON structure for phaseStart, phaseComplete, phaseFail, ciResult, reviewReady (verify PR URL present), pulseSummary, doneDone, batchedSummary. Vitest. (FR-003)
- **TR-006**: `src/server/slack-presence.test.ts` — Mock user presence changes: verify immediate delivery when active, batched summary when away→active, overflow truncation at 100 events. Vitest. (FR-007)
- **TR-007**: `src/server/slack-home.test.ts` — Mock daemon state: verify all 5 Block Kit sections, RAGB per feature, Server: Offline fallback. Vitest. (FR-008)
- **TR-008**: DEFERRED to 009-agent-dut.
- **TR-009**: `src/server/slack-channel.test.ts` — Mock Slack API via fetch: verify `conversations.create` called with project name, re-use on duplicate (`name_taken`), config update in `.gwrkrc.json`. Vitest. (FR-002)
- **TR-010**: `src/server/slack-integration.test.ts` — Mock Bolt app: send simulated slash command, verify response format. Vitest. (FR-004)
- **TR-011**: `src/server/routes/notify.test.ts` — Unit test `POST /api/notify` endpoint: valid payload → correct `notifySlack()` call, invalid payload → 400, server missing channel → 200 with warn. Vitest. (FR-010)
- **TR-012**: `src/server/slack-actions.test.ts` — PR lookup test: mock SQLite `runs.pr_number`, verify approval resolves correct PR number, verify "no PR found" ephemeral when `runs` has no entry. Vitest. (FR-011)

---

## 8. Success Criteria

- **SC-001**: `gwrk setup slack` completes with zero manual Slack API portal clicks (tokens still require manual copy from portal — that's a Slack OAuth limitation).
- **SC-002**: Phase lifecycle events (start, complete, fail) appear in Slack within 5 seconds of the event in the ship loop, with no manual action required.
- **SC-003**: All 9 slash commands return responses within 3 seconds with real, non-hardcoded data.
- **SC-004**: Tapping `[✅ Merge]` or reacting with ✅ merges the correct PR (by number, from SQLite) and posts confirmation.
- **SC-005**: DEFERRED to 009-agent-dut.
- **SC-006**: Away → Active presence transition delivers a single batched summary of all queued events.
- **SC-007**: App Home Tab renders live dashboard with RAGB per feature; `Server: Offline` rendered gracefully when daemon is down.
- **SC-008**: `/gwrk ship <feature> <phase>` from Slack starts a real ship loop and posts progress to the channel.
- **SC-009**: Cross-project summaries (Pulse, Done Done!) route to `#gwrk-ops`; per-project events route to project channels.

---

## 9. Verification Requirements

- **VR-001**: E2E: run `gwrk setup slack --verify`, verify tokens written and all four checks pass.
- **VR-002**: E2E: run `gwrk init --slack code-red`, verify `channelId` in `.gwrkrc.json` and channel visible in workspace.
- **VR-003**: Negative: run any Slack command without `gwrk setup slack` → exit 1 with `Slack not configured`.
- **VR-004**: E2E: `gwrk ship` a phase → verify Block Kit phaseStart and reviewReady messages appear in Slack with real data (no hardcoded values).
- **VR-005**: E2E: `/gwrk status` → verify Block Kit response shows real feature state from SQLite.
- **VR-006**: E2E: `/gwrk approve <feature> <phase>` → verify correct PR merged (PR number from SQLite `runs`).
- **VR-007**: Resiliency: run `gwrk ship` with server stopped → verify ship completes, logs `notify skipped`, no crash.
- **VR-008**: E2E: `/gwrk ship <feature> <phase>` in Slack → verify phaseStart posted within 10 seconds.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-009 | FR-001 | US-001, US-008 | TR-001, TR-002 |
| US-002 | FR-002 | FR-002 | US-002 | TR-009 |
| US-003 | FR-003, FR-010 | FR-003 | US-003 | TR-005 |
| US-004 | FR-004, FR-011 | FR-004 | US-004 | TR-003, TR-010 |
| US-005 | FR-005, FR-011 | FR-005 | US-005 | TR-004, TR-012 |
| US-006 | FR-007 | FR-007 | US-006 | TR-006 |
| US-007 | FR-008 | FR-008 | US-007 | TR-007 |
| US-008 | FR-001, FR-009 | FR-009 | US-008 | TR-001 |
| US-010 | FR-010 | FR-010 | US-010 | TR-011 |
| US-011 | FR-011 | FR-011 | US-011 | TR-012 |
| US-012 | FR-012 | FR-012 | US-012 | TR-003 |
| US-013 | FR-013 | FR-013 | US-013 | TR-005, TR-011 |
| — | FR-006 | FR-006 | DEFERRED → 009 | DEFERRED → 009 |
