# Implementation Plan: 003 Slack

**Branch**: `feat/003-slack` | **Date**: 2026-05-13 | **Spec**: [spec.md](./spec.md)

## Summary

This plan hardens the Slack integration by implementing the missing v3 requirements: the full Definition pillar in Slack (slash command, spec/plan approval loops), a conversational agent surface for @gwrk mentions, and hardening of the webhook-first notification bridge for cloud-native dispatches.

---

## Phases and File Structure

### Phase 1: Slack Definition Pillar (P0)

Enable the PE to define features entirely from Slack. This involves adding the `/gwrk define` command, interactive approval buttons for specs and plans, and the corresponding backend logic in the `DefineOrchestrator`.

**Files (4):**
- `src/server/slack-commands.ts` (MODIFY: Add `define` subcommand handler)
- `src/server/slack-messages.ts` (MODIFY: Add `specReady` and `planReady` Block Kit builders)
- `src/server/slack-actions.ts` (MODIFY: Add `approve_spec`, `approve_plan`, `revise_spec` handlers)
- `src/server/routes/notify.ts` (MODIFY: Handle `define_spec_ready` and `define_plan_ready` event types)

**Requirements Addressed:** US-014, FR-015, FR-016, FR-005

**Dependencies:** F002 (Build Server), F018 (Build Plan Orchestrator)

**Contract Mapping:**
- `specs/003-slack/contracts/slash-commands.md` → `/gwrk define` → `src/server/slack-commands.ts`
- `specs/003-slack/contracts/block-kit-messages.md` → `specReady`, `planReady` → `src/server/slack-messages.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-004 | Output signal protocol for background jobs |
| specify-sharpen | Applied during background spec generation |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-013 | Unit | `src/server/slack-commands.test.ts` | `/gwrk define 001` spawns background process and acknowledges |
| TR-014 | Unit | `src/server/slack-messages.test.ts` | `specReady` and `planReady` blocks contain correct buttons and feature IDs |
| TR-015 | Unit | `src/server/slack-actions.test.ts` | `approve_spec` triggers plan generation; `approve_plan` updates PlanStore to DEFINED |

#### Done When
- `/gwrk define 003` from Slack returns immediate acknowledgment and eventually posts a spec approval message.
- Tapping `Approve` on a spec message triggers plan generation and posts a plan approval message.

---

### Phase 2: Conversational Agent Surface (P1)

Surface the agent's reasoning and project knowledge directly in Slack threads. This allows for ad-hoc project interrogation and architectural thinking from mobile.

**Files (3):**
- `src/server/slack-agent.ts` (NEW: Handle app mentions and threaded context)
- `src/server/slack.ts` (MODIFY: Register `app_mention` and `message.channels` handlers)
- `src/utils/agent-context.ts` (NEW: Utility to build project context for the agent from local files and SQLite)

**Requirements Addressed:** US-015, FR-006, FR-017

**Dependencies:** F014 (Plugin System - Skills)

**Contract Mapping:**
- `specs/003-slack/contracts/bolt-events.md` → `app_mention` → `src/server/slack-agent.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| decision-forge | Invoked via mentions for architectural queries |
| architecture-stress-test | Invoked via mentions for plan/spec reviews |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-016 | Integration | `src/server/slack-agent.test.ts` | Mentioning @gwrk in thread returns contextual response using project metadata |
| TR-017 | Integration | `src/server/slack-agent.test.ts` | Agent maintains context across 3+ messages in the same thread |

#### Done When
- `@gwrk what is the status of 003?` in Slack returns a coherent summary of the Slack feature.
- `@gwrk help me think through the plugin system` triggers a thinking mode response.

---

### Phase 3: Webhook Hardening & Topology (P1)

Harden the notification path for Cloud environments (Codex Cloud) and enforce the two-tier channel topology (ops vs. project).

**Files (3):**
- `src/utils/slack-webhook.ts` (NEW: Extracted webhook logic for use in ship loop without Fastify)
- `src/server/slack-notify.ts` (MODIFY: Refine routing logic to respect `opsChannelId`)
- `src/commands/ship.ts` (MODIFY: Ensure ship loop uses `SLACK_WEBHOOK_URL` directly if set)

**Requirements Addressed:** US-010, US-013, FR-013, FR-014

**Dependencies:** F004 (Ship Loop)

**Contract Mapping:**
- `specs/003-slack/contracts/notify.md` → `notifySlack` → `src/server/slack-notify.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| workspace.md | Environment variable security (WEBHOOK_URL) |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-011 | Integration | `src/server/routes/notify.test.ts` | Webhook fallback works when build server is unreachable |
| TR-005 | Unit | `src/server/slack-messages.test.ts` | `doneDone` and `pulse` route to `opsChannelId` |

#### Done When
- Running `SLACK_WEBHOOK_URL=... gwrk ship 003 1` posts to Slack even if the build server is offline.
- Pulse summary appears in `#gwrk-ops` while phase updates appear in `#gwrk-dev`.

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| SlackMessage | `src/server/slack-messages.ts` | notify.ts, slack-notify.ts, slack-agent.ts |
| NotifyPayload | `src/server/types.ts` | notify.ts, slack-notify.ts |
| SlackProjectConfig | `src/utils/config.ts` | init.ts, setup-slack.ts, slack-notify.ts |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| US-009 | Setup Verification | Combined with US-008. | US-008 |
| DM-006 | DUT Thread State | Deferred to 009-agent-dut. | F009 |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-014 (Define from Slack) | 1 | ✅ Done |
| FR-015 (define slash command) | 1 | ✅ Done |
| FR-016 (define event bridge) | 1 | ✅ Done |
| US-015 (Conversational Agent) | 2 | ✅ Done |
| FR-006 (Mentions) | 2 | ✅ Done |
| FR-017 (Skills in Slack) | 2 | ✅ Done |
| US-010 (Ship loop notify bridge) | 3 | ✅ Done |
| FR-014 (Webhook-first) | 3 | ✅ Done |
| US-013 (Multi-channel topology) | 3 | ✅ Done |
| FR-013 (opsChannelId) | 3 | ✅ Done |
| DM-004 (Notify Payload) | 1, 3 | ✅ Done |
| TR-013 (Define slash test) | 1 | ✅ Done |
| TR-014 (Define message test) | 1 | ✅ Done |
| TR-015 (Define action test) | 1 | ✅ Done |
| TR-016 (Agent mention test) | 2 | ✅ Done |
| TR-017 (Thread context test) | 2 | ✅ Done |
| SC-010 (Define from Slack SC) | 1 | ✅ Done |
| SC-011 (Approve spec/plan SC) | 1 | ✅ Done |
| SC-012 (Conversational SC) | 2 | ✅ Done |
| VR-009 (E2E Define) | 1 | ✅ Done |
| VR-010 (E2E Approve spec) | 1 | ✅ Done |
