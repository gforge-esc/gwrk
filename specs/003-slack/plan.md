# Implementation Plan: 003 Slack + App Home Tab (v2)

**Branch**: `feat/003-slack` | **Date**: 2026-03-12 | **Spec**: [spec.md](./spec.md)

## Summary

Implement Slack as the primary gwrk operations hub. Phases 1–6 built the scaffolding (Bolt app, slash command handlers, Block Kit builders, presence routing, App Home Tab). **Phases 7–9 wire everything together**: ship loop → Slack notify bridge, real PR lookup for approvals, `/gwrk ship` from Slack, and multi-channel topology.

> **v2 Changes**: Added Phases 7, 8, 9 to address audit findings. Core gap: `notifySlack()` and `MessageBuilder` are never called — the ship loop and Slack have no bridge. Also: interactive approval uses hardcoded PR logic (no SQLite lookup), `/gwrk ship` from Slack is unimplemented, and multi-channel routing doesn't exist.

---

## Phases and File Structure

### Phase 1: Setup & Provisioning ✅

Automated Slack app token management and connectivity verification.

**Files (5):** `package.json`, `src/commands/setup-slack.ts`, `src/utils/slack-client.ts`, `src/cli.ts`, `src/utils/config.ts`

**Requirements Addressed:** FR-001, FR-009, US-001, US-008, TC-001, TC-002, TC-005, TC-006, TC-007, DM-001

**Dependencies:** None

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md (env vars) | SLACK_BOT_TOKEN, SLACK_APP_TOKEN in `~/.gwrk/.env` — fail-fast |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/commands/setup-slack.test.ts` | Mock Slack API: token write, verify, idempotency |
| TR-002 | Unit | `src/server/slack.test.ts` | Mock Bolt App init: Socket Mode config |

#### Done When
- `pnpm vitest run src/commands/setup-slack.test.ts` exits 0
- `node dist/cli.js setup slack --help` shows `--verify` flag
- `pnpm build` exits 0

---

### Phase 2: Server Integration & Channel Management ✅

Wire Bolt SDK into Fastify lifecycle. Channel-per-project provisioning.

**Files (5):** `src/server/slack.ts`, `src/server/index.ts`, `src/server/slack-channel.ts`, `src/commands/init.ts`, `src/utils/config.ts`

**Requirements Addressed:** FR-002, US-002, TC-001, TC-004, DM-002

**Dependencies:** Phase 1

> **Bug Fix Applied**: `slack-channel.ts` now uses raw `fetch` with bot token directly (not `app.client`) to avoid Bolt's Socket Mode token routing bug that caused `missing_scope` errors on `conversations.create`.

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md (config) | `.gwrkrc.json` Slack project config extension |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-009 | Unit | `src/server/slack-channel.test.ts` | Mock fetch: verify `conversations.create` called, re-use on `name_taken` |
| TR-002 | Unit | `src/server/slack.test.ts` | Lifecycle hooks, graceful shutdown |

#### Done When
- `pnpm vitest run src/server/slack-channel.test.ts` exits 0
- `gwrk init --slack gwrk-ops` provisions channel and writes to `.gwrkrc.json`
- `pnpm build` exits 0

---

### Phase 3: Block Kit Status Updates ✅ (builders exist — wiring in Phase 7)

Rich status notifications for all pipeline events. **Note**: builders are implemented but not yet called. Phase 7 adds the wiring.

**Files (4):** `src/server/slack-messages.ts`, `src/server/slack-notify.ts`, `src/commands/ship.ts`, `src/server/dispatch.ts`

**Requirements Addressed:** FR-003, US-003, TC-003

**Dependencies:** Phase 2

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md (no CDN) | All Block Kit JSON generated locally |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit | `src/server/slack-messages.test.ts` | Verify Block Kit JSON structure for all 8 event types including `prUrl` in `reviewReady` |

#### Done When
- `pnpm vitest run src/server/slack-messages.test.ts` exits 0
- `pnpm build` exits 0

---

### Phase 4: Slash Commands & Interactive Review ✅ (handlers exist — fixups in Phase 8)

Handle `/gwrk` slash commands (9 commands) and interactive button/reaction actions.

**Files (4):** `src/server/slack-commands.ts`, `src/server/slack-actions.ts`, `src/server/slack.ts`, `src/server/routes/health.ts`

**Requirements Addressed:** FR-004, FR-005, US-004, US-005

**Dependencies:** Phase 2, Phase 3

> **Known gaps fixed in Phase 8**: PR number lookup (currently no SQLite query), `/gwrk ship` handler, `/gwrk approve` real merge flow.

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md (env vars) | `gh` CLI required for merge actions |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-003 | Unit | `src/server/slack-commands.test.ts` | Each command response format, approve PR lookup |
| TR-004 | Unit | `src/server/slack-actions.test.ts` | Merge triggers `gh pr merge #N`, reaction handler |
| TR-010 | Integration | `src/server/slack-integration.test.ts` | Mock Bolt app, slash command round-trip |

#### Done When
- `pnpm vitest run src/server/slack-commands.test.ts` exits 0
- `pnpm vitest run src/server/slack-actions.test.ts` exits 0
- `pnpm build` exits 0

---

### Phase 5: Presence-Aware Notification Throttling ✅

Detect user presence, throttle notifications: immediate when active, batched summary on return from away.

**Files (3):** `src/server/slack-presence.ts`, `src/server/slack-notify.ts` (route through presence), `src/server/slack-messages.ts` (batchedSummary)

**Requirements Addressed:** FR-007, US-006, DM-003

**Dependencies:** Phase 3, Phase 4

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md (no magic values) | Presence poll interval from config |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-006 | Unit | `src/server/slack-presence.test.ts` | Mock presence changes, verify immediate vs batched, overflow at 100 |

#### Done When
- `pnpm vitest run src/server/slack-presence.test.ts` exits 0
- `pnpm build` exits 0

---

### Phase 6: App Home Tab ✅

Real-time ops dashboard in Slack App Home Tab. 5 sections: Active Agents, Dispatch Queue, System Resources, Feature Progress (RAGB), Pulse Summary.

**Files (3):** `src/server/slack-home.ts`, `src/server/slack.ts` (register handler), `src/server/routes/status.ts`

**Requirements Addressed:** FR-008, US-007

**Dependencies:** Phase 4

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md (no CDN) | All Block Kit JSON generated locally |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-007 | Unit | `src/server/slack-home.test.ts` | Mock daemon state, verify 5 sections, RAGB per feature, Server: Offline fallback |

#### Done When
- `pnpm vitest run src/server/slack-home.test.ts` exits 0
- Opening App Home Tab in Slack renders at least 5 sections
- `pnpm build` exits 0

---

### Phase 7: Ship Loop → Slack Notify Bridge ⭐ **NEW**

The critical missing wire. Add `POST /api/notify` endpoint to the build server. Wire `agent-run.sh` and `wud.sh` to call it at every lifecycle event. This is what makes Slack actually receive pipeline events.

**Files (6):**
- `src/server/routes/notify.ts` (New: POST /api/notify endpoint)
- `src/server/index.ts` (Modify: register `/api/notify` route)
- `scripts/dev/agent-run.sh` (Modify: add `gwrk_notify` calls at phase_start, phase_complete, phase_fail, ci_result, review_ready)
- `src/commands/ship.ts` (Modify: hook notify calls into ship lifecycle — for TypeScript callers)
- `src/db/migrations/003_pr_tracking.sql` (New: `pr_number`, `pr_url` columns on `runs` table)
- `src/server/routes/notify.test.ts` (New: TR-011)

**Requirements Addressed:** FR-010, US-010, DM-004, DM-005, TC-008, SC-002

**Dependencies:** Phase 3 (block kit builders must exist)

**Contract Mapping:**
- `POST /api/notify` accepts `NotifyPayload` (DM-004): `{type, feature, phase?, prUrl?, prNumber?, gateResults?, error?, branch?, backend?}`
- On success: calls `notifySlack(MessageBuilder[type](payload))`
- On failure to reach server from shell: non-fatal, `echo "notify skipped: $err" >> $LOG`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md (fail fast) | Only the notify call is non-fatal; payload validation is fail-fast |
| workspace.md (no magic values) | Server URL from `.gwrkrc.json`, not hardcoded |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-011 | Unit | `src/server/routes/notify.test.ts` | Valid payload → `notifySlack()` called; invalid payload → 400; no channel → 200 + warn |

#### Done When
- `curl -s -X POST http://localhost:18790/api/notify -H 'Content-Type: application/json' -d '{"type":"phase_start","feature":"test","phase":"phase-01","branch":"feat/test","backend":"gemini"}' | jq -e '.ok == true'` exits 0
- `pnpm vitest run src/server/routes/notify.test.ts` exits 0
- `grep -q 'notifySlack' src/server/routes/notify.ts` exits 0
- `gwrk ship` test run → Block Kit message appears in `#gwrk-ops` within 5s
- `pnpm build` exits 0

---

### Phase 8: PR Lookup, Approve Flow & `/gwrk ship` from Slack ⭐ **NEW**

Fix the broken approval flow and add `/gwrk ship` from Slack. Two closely related gaps: (1) interactive approvals don't look up real PR numbers, (2) you can't start a ship from Slack.

**Files (6):**
- `src/server/slack-commands.ts` (Modify: add `/gwrk ship` handler; fix `/gwrk approve` PR lookup)
- `src/server/slack-actions.ts` (Modify: fix `merge_pr` action to query SQLite `runs` for `pr_number` before calling `gh pr merge`)
- `src/db/runs.ts` (Modify: add `getPrForPhase(featureId, phaseId): {prNumber, prUrl} | null`)
- `src/server/slack.ts` (Modify: pass `db` into `CommandContext` for PR lookup)
- `src/server/slack-commands.ts` (Modify: `/gwrk approve` uses `getPrForPhase`)
- `src/server/slack-actions.test.ts` (Modify: add PR lookup tests → TR-012)

**Requirements Addressed:** FR-004, FR-005, FR-011, FR-012, US-004, US-005, US-011, US-012, TC-009, SC-003, SC-004, SC-008

**Dependencies:** Phase 4, Phase 7 (ships from Slack need notify bridge to post progress)

**Contract Mapping:**
- `getPrForPhase(featureId, phaseId)` → queries `runs` WHERE `feature_id = ? AND phase_id = ? AND pr_number IS NOT NULL ORDER BY created_at DESC LIMIT 1`
- `/gwrk ship` handler → `child_process.spawn('gwrk', ['ship', feature, phase], {detached: true})` → ack immediately → progress via notify bridge

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md (no magic values) | PR numbers MUST come from SQLite, never hardcoded |
| TC-009 | PR lookup required before any merge action |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-012 | Unit | `src/server/slack-actions.test.ts` | Mock `runs` DB: verify merge uses `pr_number` from DB; verify ephemeral "no PR" when not found |
| TR-003 | Unit (update) | `src/server/slack-commands.test.ts` | `/gwrk ship` ack; `/gwrk approve` PR lookup |

#### Done When
- `/gwrk approve test-feature phase-01` with mocked PR #5 in `runs` → `gh pr merge 5` called
- `/gwrk approve test-feature phase-01` with no PR in `runs` → ephemeral `No open PR found...`
- `/gwrk ship 002-build-server 3` from Slack → phaseStart appears in channel within 10s
- `pnpm vitest run src/server/slack-actions.test.ts` exits 0
- `pnpm vitest run src/server/slack-commands.test.ts` exits 0
- `pnpm build` exits 0

---

### Phase 9: Multi-Channel Topology & Status Fixes ⭐ **NEW**

Implement the two-tier channel model (`gwrk-ops` master + per-project channels) and fix `/gwrk status` to read from SQLite rather than in-memory queue.

**Files (5):**
- `src/utils/config.ts` (Modify: add `opsChannelId`, `opsChannelName` to `SlackProjectConfig` Zod schema)
- `src/server/slack-notify.ts` (Modify: route events — per-project events to `channelId`, cross-project events to `opsChannelId`)
- `src/commands/init.ts` (Modify: `gwrk init --slack-ops <channel>` for ops channel provisioning)
- `src/server/slack-commands.ts` (Modify: `/gwrk status` queries SQLite `tasks` + `runs` tables, NOT in-memory queue)
- `src/server/routes/notify.ts` (Modify: accept `opsOnly: boolean` flag to route to ops channel)

**Requirements Addressed:** FR-013, FR-004, US-013, US-004, SC-009, DM-002

**Dependencies:** Phase 7 (notify routing must exist first)

**Contract Mapping:**
- `notifySlack(msg, event, {ops: true})` → routes to `opsChannelId` if set, falls back to `channelId`
- Cross-project events: `done_done`, `pulse_summary` → ALWAYS go to ops channel
- Per-project events: `phase_start`, `phase_complete`, `phase_fail`, `ci_result`, `review_ready` → go to project channel

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md (no magic values) | Master channel from config, not hardcoded |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 (update) | Unit | `src/server/slack-messages.test.ts` | Verify `doneDone` and `pulseSummary` tagged as master-routed |
| TR-011 (update) | Unit | `src/server/routes/notify.test.ts` | `opsOnly: true` routes to opsChannelId |

#### Done When
- `cat .gwrkrc.json | jq -e '.project.slack.opsChannelId'` exits 0 after `gwrk init --slack-ops gwrk-ops`
- Phase lifecycle event posts to `#code-red`, NOT `#gwrk-ops`
- Done Done! posts to `#gwrk-ops`, NOT `#code-red`
- `/gwrk status` response reads from SQLite (verify with DB containing completed tasks but empty in-memory queue)
- `pnpm build` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `SlackSetupResult` | `src/utils/slack-client.ts` | `src/commands/setup-slack.ts` |
| `SlackProjectConfig` | `src/utils/config.ts` | `src/commands/init.ts`, `src/server/slack-channel.ts`, `src/server/slack-notify.ts` |
| `SlackMessage` | `src/server/slack-messages.ts` | `src/server/slack-notify.ts` |
| `SlackEvent` | `src/server/slack-notify.ts` | `src/server/slack-presence.ts` |
| `NotifyPayload` | `src/server/routes/notify.ts` | `scripts/dev/agent-run.sh` (JSON body), `src/commands/ship.ts` |
| `SlashCommandHandler` | `src/server/slack-commands.ts` | `src/server/slack.ts` |
| `ReviewAction` | `src/server/slack-actions.ts` | `src/server/slack.ts` |
| `BatchedNotification` | `src/server/slack-presence.ts` | `src/server/slack-notify.ts` |
| `CommandContext` | `src/server/slack-commands.ts` | `src/server/slack.ts` (+ db reference for Phase 8) |

---

## Data Model Changes

### Migration: `003_pr_tracking.sql` (Phase 7)
```sql
ALTER TABLE runs ADD COLUMN pr_number INTEGER;
ALTER TABLE runs ADD COLUMN pr_url TEXT;
```

### Config Extension: `SlackProjectConfig` (Phase 9)
```typescript
interface SlackProjectConfig {
  channelId: string;
  channelName: string;
  opsChannelId?: string;   // NEW — Phase 9
  opsChannelName?: string; // NEW — Phase 9
}
```

---

## Mockup-to-Selector Mapping
_No mockups for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| FR-006 | DUT Conversational AI | LLM integration, thread state, spec generation | 009-agent-dut |
| TR-008 | DUT Thread Test | Deferred with FR-006 | 009-agent-dut |
| DM-006 | DUT Thread State (SQLite) | Deferred with FR-006 | 009-agent-dut |
| SC-005 | DUT spec generation | Deferred with FR-006 | 009-agent-dut |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 (Setup) | 1 | ✅ Implemented |
| US-002 (Channels) | 2 | ✅ Implemented |
| US-003 (Status Updates) | 3+7 | 3 built, **7 wires it** |
| US-004 (Slash Commands) | 4+8+9 | 4 built, **8 fixes approve+ship, 9 fixes status** |
| US-005 (Review Buttons) | 4+8 | 4 built, **8 fixes PR lookup** |
| US-006 (Presence) | 5 | ✅ Implemented |
| US-007 (Home Tab) | 6 | ✅ Implemented |
| US-008 (Verify) | 1 | ✅ Implemented |
| US-010 (Notify Bridge) | 7 | **Phase 7 — new** |
| US-011 (PR Lookup) | 8 | **Phase 8 — new** |
| US-012 (/gwrk ship from Slack) | 8 | **Phase 8 — new** |
| US-013 (Multi-Channel) | 9 | **Phase 9 — new** |
| FR-001 | 1 | ✅ |
| FR-002 | 2 | ✅ |
| FR-003 | 3+7 | Builders ✅, wiring Phase 7 |
| FR-004 | 4+8+9 | Handlers ✅, fixups Phase 8+9 |
| FR-005 | 4+8 | Handlers ✅, PR lookup Phase 8 |
| FR-006 | — | Deferred → 009 |
| FR-007 | 5 | ✅ |
| FR-008 | 6 | ✅ |
| FR-009 | 1 | ✅ |
| FR-010 | 7 | Phase 7 — new |
| FR-011 | 8 | Phase 8 — new |
| FR-012 | 8 | Phase 8 — new |
| FR-013 | 9 | Phase 9 — new |
| TR-001 | 1 | ✅ |
| TR-002 | 1, 2 | ✅ |
| TR-003 | 4+8 | Phase 8 adds ship+approve tests |
| TR-004 | 4+8 | Phase 8 adds PR lookup tests |
| TR-005 | 3+9 | Phase 9 adds master-routing assertion |
| TR-006 | 5 | ✅ |
| TR-007 | 6 | ✅ |
| TR-008 | — | Deferred → 009 |
| TR-009 | 2 | ✅ |
| TR-010 | 4 | ✅ |
| TR-011 | 7+9 | Phase 7 new, Phase 9 updates |
| TR-012 | 8 | Phase 8 — new |
| DM-001 | 1 | ✅ |
| DM-002 | 2+9 | 2 base, 9 extends |
| DM-003 | 5 | ✅ |
| DM-004 | 7 | Phase 7 — new |
| DM-005 | 7 | Phase 7 — new |
| DM-006 | — | Deferred → 009 |
| TC-001 | 1, 2 | ✅ |
| TC-002 | 1 | ✅ |
| TC-003 | 3 | ✅ |
| TC-004 | 2 | ✅ |
| TC-005 | 1, 2 | ✅ (fetch for REST, Bolt for WS) |
| TC-006 | 1 | ✅ |
| TC-007 | All | ✅ |
| TC-008 | 7 | Phase 7 — new |
| TC-009 | 8 | Phase 8 — new |
| SC-001 | 1 | ✅ |
| SC-002 | 7 | Phase 7 — wiring |
| SC-003 | 8+9 | Phase 8+9 — fixups |
| SC-004 | 8 | Phase 8 — PR lookup |
| SC-005 | — | Deferred → 009 |
| SC-006 | 5 | ✅ |
| SC-007 | 6 | ✅ |
| SC-008 | 8 | Phase 8 — new |
| SC-009 | 9 | Phase 9 — new |
| VR-001 | 1 | ✅ |
| VR-002 | 2 | ✅ |
| VR-003 | 1 | ✅ |
| VR-004 | 7 | Phase 7 — end-to-end with real messages |
| VR-005 | 9 | Phase 9 — real SQLite status |
| VR-006 | 8 | Phase 8 — real PR merge |
| VR-007 | 7 | Phase 7 — resiliency test |
| VR-008 | 8 | Phase 8 — /gwrk ship from Slack |
