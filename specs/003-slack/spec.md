---
type: specification
feature: 003-slack
last_modified: "2026-03-10T08:20:00Z"
---

# Feature Specification: 003 Slack

**Feature Branch**: `003-slack`
**Created**: 2026-03-05
**Revised**: 2026-03-10
**Status**: Settled
**Input**: Slack integration via Socket Mode + Bolt SDK — channel-per-project model, slash commands, interactive review messages, threaded DUT conversations, App Home Tab dashboard, presence-aware notifications, automated provisioning

---

## 2. User Scenarios & Testing

### US-001 - Automated Slack App Provisioning (Priority: P0)
As a Principal Engineer, I want `gwrk setup slack` to create a Slack app, install it to my workspace, configure Socket Mode, write tokens to `.env`, and verify the connection — so that I never have to manually configure a Slack bot.

**Implements**: FR-001

**Independent Test**: Run `gwrk setup slack` with valid Slack credentials, verify app is created and a test message is sent to `#gwrk`.

**Acceptance Scenarios**:
1. **Given** valid Slack admin credentials and `gh auth status` succeeds, **When** the user runs `gwrk setup slack`, **Then**:
   - The Slack app is created with Socket Mode enabled
   - Bot/app tokens are written to `~/.gwrk/.env`
   - `gwrk setup slack --verify` exits 0 with `Slack connection: OK`
2. **Given** `gwrk setup slack` has already been run, **When** the user runs `gwrk setup slack` again, **Then**:
   - `gwrk setup slack 2>&1 | grep -q 'already configured'` exits 0 (idempotent)

### US-002 - Channel-Per-Project (Priority: P0)
As a Principal Engineer, I want `gwrk init` (and `gwrk new`) to automatically create a Slack channel `#<project-name>` when Slack is configured, so that each project has its own notification channel.

**Implements**: FR-002

**Independent Test**: Run `gwrk init` in a project with Slack configured, verify channel is created.

**Acceptance Scenarios**:
1. **Given** Slack is configured and project name is `code-red`, **When** running `gwrk init`, **Then**:
   - A Slack channel `#code-red` exists (or is reused if it already exists)
   - `gwrk init --json | jq -e '.slack.channel == "#code-red"'` exits 0

### US-003 - Status Updates (Priority: P0)
As a Principal Engineer, I want gwrk to post structured status updates to the project channel — phase starts, completions, failures, Pulse summaries — so that I can see pipeline progress from my phone.

**Implements**: FR-003

**Independent Test**: Trigger a phase dispatch, verify a Block Kit message appears in the project channel.

**Acceptance Scenarios**:
1. **Given** a project channel `#code-red` exists and an agent starts Phase 01, **When** the dispatch begins, **Then**:
   - A Block Kit message is posted to `#code-red` containing: phase name, agent backend, branch name, task count
2. **Given** a phase completes with all tests passing, **When** the review is ready, **Then**:
   - A Block Kit message is posted with interactive buttons: `[✅ Merge]`, `[🔄 Request Changes]`, `[🔍 View Full Review]`

### US-004 - Slash Commands (Priority: P0)
As a Principal Engineer, I want to use slash commands (`/gwrk status`, `/gwrk dispatch`, `/gwrk approve`, `/gwrk reject`, `/gwrk pause`, `/gwrk pulse`, `/gwrk effort`, `/gwrk logs`) to control the pipeline from Slack.

**Implements**: FR-004

**Independent Test**: Type `/gwrk status` in the project channel and verify a response is returned.

**Acceptance Scenarios**:
1. **Given** active features across repos, **When** the user types `/gwrk status`, **Then**:
   - A Block Kit response shows all active features, their phases, and RAGB status
2. **Given** a feature `001-cli-core` exists, **When** the user types `/gwrk dispatch 001-cli-core`, **Then**:
   - The dispatch queue picks up the feature and posts a confirmation message
3. **Given** a phase is ready for review, **When** the user types `/gwrk approve 001-cli-core phase-01`, **Then**:
   - The PR is merged and a confirmation is posted to the channel

### US-005 - Interactive Review Buttons (Priority: P0)
As a Principal Engineer, I want to approve or reject reviews by tapping interactive buttons on Slack messages — or by reacting with ✅ — so that I never need to open a laptop to unblock the pipeline.

**Implements**: FR-005

**Independent Test**: Post a review message with interactive buttons, tap Merge, verify the PR is merged.

**Acceptance Scenarios**:
1. **Given** a review message with `[✅ Merge]` button, **When** the user taps `Merge`, **Then**:
   - The PR is merged via `gh pr merge`
   - A confirmation message is posted: `PR #14 merged ✅`
2. **Given** a review message, **When** the user reacts with ✅, **Then**:
   - The reaction triggers the same merge flow as the `Merge` button

> **Deferred to 009-agent-dut**: US-006 (Threaded DUT Conversations), FR-006, TR-008, DM-004 moved to [009-agent-dut](file:///Users/gonzo/Code/gwrk/specs/009-agent-dut/spec.md). DUT depends on a fully functioning 003-slack.

### US-006 - Presence-Aware Notifications (Priority: P1)
As a Principal Engineer, I want gwrk to throttle notifications based on my Slack presence — verbose when Active, batched summaries when Away — so I don't wake up to 47 phase updates at 2am.

**Implements**: FR-007

**Independent Test**: Set Slack status to Away, trigger multiple phase events, verify a single batched summary is posted when status returns to Active.

**Acceptance Scenarios**:
1. **Given** user Slack status is `active`, **When** a phase completes, **Then**:
   - An individual status message is posted immediately
2. **Given** user Slack status is `away` and 3 phases complete, **When** user status changes to `active`, **Then**:
   - A single batched summary is posted with all 3 phase results

### US-008 - App Home Tab Dashboard (Priority: P1)
As a Principal Engineer, I want the gwrk Slack app's Home Tab to show a real-time dashboard — active agents, dispatch queue, system resources, feature phase progress, gate status — rendered in Block Kit.

**Implements**: FR-008

**Independent Test**: Open the gwrk app Home Tab in Slack, verify dashboard sections are rendered.

**Acceptance Scenarios**:
1. **Given** the gwrk daemon is running with active dispatches, **When** the user opens the gwrk app Home Tab, **Then**:
   - Block Kit sections are rendered for: Active Agents, Dispatch Queue, System Resources, Feature Progress
2. **Given** a phase status changes, **When** the user refreshes the Home Tab (or it auto-updates), **Then**:
   - The Home Tab reflects the updated state

### US-009 - Slack Setup Verification (Priority: P0)
As a Principal Engineer, I want `gwrk setup slack --verify` to test the full Slack pipeline — send a test message, verify Socket Mode connection, check token validity — so I know the integration works before relying on it.

**Implements**: FR-009

**Independent Test**: Run `gwrk setup slack --verify` and verify it reports pass/fail for each check.

**Acceptance Scenarios**:
1. **Given** valid Slack tokens in `~/.gwrk/.env`, **When** running `gwrk setup slack --verify`, **Then**:
   - `gwrk setup slack --verify` exits 0
   - Output contains: `Socket Mode: OK`, `Bot Token: OK`, `App Token: OK`, `Test Message: OK`
2. **Given** an expired or invalid bot token, **When** running `gwrk setup slack --verify`, **Then**:
   - `gwrk setup slack --verify 2>&1 | grep -q 'Bot Token: FAIL'` exits 0
   - Exit code is 1

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

The Slack app requires these OAuth scopes:

| Scope | Purpose |
|---|---|
| `channels:manage` | Create project channels |
| `channels:read` | List channels |
| `chat:write` | Post status updates |
| `commands` | Register slash commands |
| `reactions:read` | Detect ✅ approval reactions |
| `users:read` | Presence detection for notification throttling |
| `app_mentions:read` | DUT @mention triggers |

---

## 4. Functional Requirements

- **FR-001**: System MUST provide a `gwrk setup slack` command that creates a Slack app (Socket Mode, Bolt SDK), installs it to the workspace, writes tokens to `~/.gwrk/.env`, and verifies the connection. Idempotent — re-running detects existing configuration. (Implements: US-001, US-009)
- **FR-002**: System MUST create a Slack channel `#<project-name>` during `gwrk init` / `gwrk new` when Slack is configured. Re-use existing channel if it already exists. (Implements: US-002)
- **FR-003**: System MUST post Block Kit-formatted status messages to the project channel for: phase start, phase completion, phase failure, CI results, review readiness, Pulse daily summary, and Done Done! celebration (🏆). (Implements: US-003)
- **FR-004**: System MUST register and handle these slash commands: `/gwrk status [feature]`, `/gwrk dispatch <feature>`, `/gwrk approve <feature> <phase>`, `/gwrk reject <feature> <phase> <reason>`, `/gwrk pause <feature>`, `/gwrk pulse [repo]`, `/gwrk effort <feature>`, `/gwrk logs <feature> <phase>`. (Implements: US-004)
- **FR-005**: System MUST render interactive buttons on review messages (`Merge`, `Request Changes`, `View Full Review`) and handle button taps as pipeline actions. System MUST also support ✅ reaction-to-approve as an alternative to the Merge button. (Implements: US-005)
- **FR-006**: DEFERRED to 009-agent-dut. See deferral note in §2.
- **FR-007**: System MUST observe Slack user presence and throttle notifications: Active → immediate individual messages, Away → batch and deliver a single summary when presence changes to Active. (Implements: US-007)
- **FR-008**: System MUST render a Block Kit App Home Tab with sections: Active Agents, Dispatch Queue, System Resources (CPU/mem/disk), Feature Progress (per-project phase status + RAGB), and Pulse summary. MUST update on `app_home_opened` event. (Implements: US-008)
- **FR-009**: System MUST provide `gwrk setup slack --verify` that tests Socket Mode connection, token validity, and sends a test message to `#gwrk`. (Implements: US-009)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Slack admin credentials missing | `Slack credentials not found. Provide SLACK_BOT_TOKEN and SLACK_APP_TOKEN` | 1 |
| Socket Mode connection fails | `Socket Mode connection failed` | 1 |
| App already installed (idempotent) | `Slack already configured` | 0 |

#### FR-002 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Slack not configured | `Slack not configured. Run gwrk setup slack first` | 1 |
| Channel creation fails (permissions) | `Failed to create channel: <api-error>` | 1 |

#### FR-004 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Unknown slash command | `Unknown command: <command>` | 0 (Slack responds ephemerally) |
| Feature not found | `Feature <feature> not found` | 0 (Slack responds ephemerally) |

#### FR-009 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Invalid bot token | `Bot Token: FAIL` | 1 |
| Invalid app token | `App Token: FAIL` | 1 |
| Test message failed | `Test Message: FAIL` | 1 |

#### FR-003 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Slack not configured | `Slack not configured. Run gwrk setup slack first` | 1 |
| Channel not found for project | `No Slack channel configured for project <name>` | 1 |
| Message post fails (API error) | `Failed to post status update: <api-error>` | 1 |
| Build server not reachable (status query) | `Build server not reachable — status update skipped` | 0 (non-fatal, logged) |

#### FR-005 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Button action with invalid payload | `Invalid action payload` | 0 (Slack responds ephemerally) |
| `gh pr merge` fails | `Failed to merge PR: <error>` | 0 (Slack responds ephemerally with error) |
| Reaction on non-review message | (ignored silently) | 0 |
| PR already merged | `PR already merged` | 0 (Slack responds ephemerally) |

#### FR-006 Error States
DEFERRED to 009-agent-dut.

#### FR-007 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Presence API unavailable | `Warning: presence detection unavailable — falling back to immediate delivery` | 0 (non-fatal) |
| Batch queue overflow (>100 events) | `Warning: notification batch truncated to 100 events` | 0 (non-fatal) |

#### FR-008 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Build server not reachable | App Home Tab renders with `Server: Offline` status section | 0 |
| No projects configured | App Home Tab renders with `No projects configured` message | 0 |
| `views.publish` API fails | `Warning: failed to update App Home Tab: <api-error>` | 0 (non-fatal, logged) |

---

## 5. Data Model Requirements

### DM-001: Slack Configuration (`~/.gwrk/.env`)

```bash
SLACK_BOT_TOKEN=xoxb-...     # Bot User OAuth Token
SLACK_APP_TOKEN=xapp-...     # App-Level Token (Socket Mode)
SLACK_SIGNING_SECRET=...     # Request signing secret
```

### DM-002: Project Slack State (`.gwrkrc.json` extension)

```typescript
interface SlackProjectConfig {
  channelId: string;          // Slack channel ID for this project
  channelName: string;        // e.g. "#code-red"
}
```

### DM-003: Notification Queue (in-memory)

```typescript
interface BatchedNotification {
  projectId: string;
  events: SlackEvent[];       // Queued while user is away
  batchedSince: string;       // ISO 8601 of first queued event
}

interface SlackEvent {
  type: 'phase_start' | 'phase_complete' | 'phase_fail' | 'ci_result' | 'review_ready' | 'done_done';
  feature: string;
  phase?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}
```

### DM-004: DUT Thread State (SQLite)
DEFERRED to 009-agent-dut.

---

## 6. Technical Constraints

- **TC-001**: Air-Gapped by Default — Socket Mode uses outbound WebSocket only. No inbound HTTP required. No public URL. No ngrok.
- **TC-002**: Fail-Fast Config — Zod validation of all Slack tokens. Missing `SLACK_BOT_TOKEN` or `SLACK_APP_TOKEN` → `process.exit(1)`.
- **TC-003**: No CDN — All Block Kit JSON generated locally. No runtime fetches. No external assets.
- **TC-004**: Single-User — The Slack app serves one workspace, one user (the PE). No multi-tenant auth.
- **TC-005**: Bolt SDK — Use `@slack/bolt` (official Slack SDK) with Socket Mode. No raw WebSocket.
- **TC-006**: Token Storage — Tokens stored in `~/.gwrk/.env`, NOT in the project repo. Never committed.
- **TC-007**: TypeScript only — No `.js` in `src/`. ES2022 module syntax.

---

## 7. Testing Requirements

- **TR-001**: `src/commands/setup-slack.test.ts` — Mock Slack API: verify app creation, token write, idempotency, connection test. Vitest. (FR-001, FR-009)
- **TR-002**: `src/server/slack.test.ts` — Mock Bolt SDK `App` initialization: verify Socket Mode config, event registration, graceful shutdown. Vitest. (FR-001)
- **TR-003**: `src/server/slack-commands.test.ts` — Mock each slash command handler: `/gwrk status` response format, `/gwrk approve` merge trigger, `/gwrk dispatch` queue insertion. Vitest. (FR-004)
- **TR-004**: `src/server/slack-actions.test.ts` — Mock interactive button handler: verify Merge triggers `gh pr merge`, Request Changes re-dispatches, reaction handler triggers merge. Vitest. (FR-005)
- **TR-005**: `src/server/slack-messages.test.ts` — Unit test Block Kit message builders: verify JSON structure for phase start, phase complete, phase fail, review ready, Pulse summary, Done Done! Vitest. (FR-003)
- **TR-006**: `src/server/slack-presence.test.ts` — Unit test presence watcher: mock user presence changes, verify immediate vs batched delivery, verify batch summary format. Vitest. (FR-007)
- **TR-007**: `src/server/slack-home.test.ts` — Unit test App Home Tab builder: mock daemon state, verify Block Kit sections for active agents, queue, resources, feature progress. Vitest. (FR-008)
- **TR-008**: DEFERRED to 009-agent-dut. (FR-006)
- **TR-009**: `src/server/slack-channel.test.ts` — Mock channel creation: verify `conversations.create` called with project name, re-use on duplicate, config update. Vitest. (FR-002)
- **TR-010**: Integration test — Start a mock Bolt app, send a simulated slash command, verify response. Vitest. (FR-004, FR-001)

---

## 8. Success Criteria

- **SC-001**: `gwrk setup slack` completes with zero manual Slack portal clicks (fully automated).
- **SC-002**: Status updates appear in project channel with Block Kit formatting within 5 seconds of a pipeline event.
- **SC-003**: All 8 slash commands return responses via Slack within 3 seconds.
- **SC-004**: Tapping `[✅ Merge]` or reacting with ✅ merges the PR and posts confirmation.
- **SC-005**: DEFERRED to 009-agent-dut.
- **SC-006**: Away → Active presence transition delivers a single batched summary of all queued events.
- **SC-007**: App Home Tab renders a live dashboard with active agents, queue, resources, and feature progress.

---

## 9. Verification Requirements

- **VR-001**: E2E test: run `gwrk setup slack`, verify tokens are written and `--verify` passes.
- **VR-002**: E2E test: run `gwrk init` with Slack configured, verify channel `#<project>` is created.
- **VR-003**: Negative test: run any Slack command without `gwrk setup slack` → exit 1 with `Slack not configured`.
- **VR-004**: E2E test: simulate a phase completion → verify review message with buttons posted to channel.
- **VR-005**: E2E test: run `/gwrk status` → verify Block Kit response.
- **VR-006**: Determinism test: same pipeline state → same Block Kit messages (no randomness).

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001 | FR-001 | US-001, US-009 | TR-001, TR-002 |
| US-002 | FR-002 | FR-002 | US-002 | TR-009 |
| US-003 | FR-003 | FR-003 | US-003 | TR-005 |
| US-004 | FR-004 | FR-004 | US-004 | TR-003, TR-010 |
| US-005 | FR-005 | FR-005 | US-005 | TR-004 |
| US-006 | FR-006 | FR-006 | DEFERRED → 009 | DEFERRED → 009 |
| US-007 | FR-007 | FR-007 | US-007 | TR-006 |
| US-008 | FR-008 | FR-008 | US-008 | TR-007 |
| US-009 | FR-001, FR-009 | FR-009 | US-009 | TR-001 |
