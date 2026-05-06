# Implementation Plan: 003 Slack (v3 — Daily Driver)

**Branch**: `feat/003-slack` | **Date**: 2026-05-05 | **Spec**: [spec.md](./spec.md)

## Summary

Slack is the **primary control surface** for gwrk. The principal engineer should be able to drive most pipeline operations from their phone. The existing scaffolding (Bolt app, Socket Mode, channels, message builders, presence routing) is in place but disconnected — messages build but nobody sends them, buttons render but actions are stubs.

This plan connects the wiring. Every phase below delivers one end-to-end interaction that works from Slack.

**Design Principle — Foxtrot Charlie Bless Model:**
Every Slack message must answer two questions:
1. **What pillar is this?** (Discovery / Definition / Shipping / Delivery)
2. **What do I bless?** (The ONE action that advances the progression)

If there's nothing to bless, the message should not exist.

---

## Dependency

This plan depends on 002-build-server Phase 2 (ship-bridge.ts event bridge). The event bridge is what converts ShipOrchestrator events into Slack notifications. Without it, the ship loop can't talk to Slack through the server.

**Execution order**: 002 Phase 1 → 002 Phase 2 → 003 Phase 1 → interleave from there.

---

## Phases and File Structure

### Phase 1: Bless the Ship — Merge from Slack

The single most valuable interaction: ship completes → Slack message → tap ✅ Merge → PR merged → pipeline advances. This closes the loop between `gwrk ship` and the PE's phone.

**Prerequisite**: 002 Phase 2 (ship-bridge.ts) must be complete so ship events reach Slack.

**Files (3):**
- `src/server/slack-actions.ts` (MODIFY: Wire `merge_pr` handler to real `gh pr merge` via `execSync`. Currently a stub that posts confirmation without merging.)
- `src/server/slack-actions.ts` (MODIFY: Wire `retry_phase` handler to spawn `gwrk ship <feature> <phase>` as background process.)
- `src/server/slack-messages.ts` (MODIFY: Ensure `reviewReady` message includes PR number in button value payload for lookup.)

**Foxtrot Charlie Contract:**
| Event | Pillar | Message | Primary CTA |
|-------|--------|---------|-------------|
| `ship:complete` | P3 Shipping | "🚢 Shipped: {feature} phase {N} — PR #{M}" | `[✅ Merge]` |
| `ship:failed` | P3 Shipping | "⚠️ Ship Failed: {feature} — {reason}" | `[🔄 Retry]` |

**Requirements Addressed:** FR-005, FR-011, US-005, US-011

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-003-001 | Unit | `slack-actions.ts` | `merge_pr` handler calls `execSync('gh pr merge #N')` |
| TR-003-002 | Unit | `slack-actions.ts` | `merge_pr` posts confirmation "PR #{N} merged ✅" |
| TR-003-003 | Unit | `slack-actions.ts` | `retry_phase` spawns `gwrk ship` subprocess |
| TR-003-004 | Unit | `slack-actions.ts` | ✅ reaction triggers same merge flow |

#### Done When
- Tap ✅ Merge in Slack → PR actually merged via `gh`
- Tap 🔄 Retry → ship re-dispatched
- React with ✅ emoji → same as tapping Merge
- Every button tap posts confirmation or error (no silent failures)

---

### Phase 2: Status from Slack — `/gwrk status`

Wire `/gwrk status` to the plan DAG (018). This is the principal engineer's "what's going on?" from their phone.

**Files (2):**
- `src/server/slack-commands.ts` (MODIFY: Wire `status` handler to call `PlanStore.getStatus()` and format as Block Kit. Current handler queries dispatch queue which is mostly empty.)
- `src/server/slack-home.ts` (MODIFY: Home tab shows plan DAG status, pending blessings queue, active ships. Replace the current data-dump sections with actionable information.)

**Foxtrot Charlie Contract:**
- `/gwrk status` → Plan DAG summary: features by status (SHIPPED/IN_PROGRESS/READY/BLOCKED), active ships, pending PRs
- Home tab → Same info + pending blessings (specs/plans awaiting approval)

**Requirements Addressed:** FR-004, FR-008, US-004, US-007

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-003-005 | Unit | `slack-commands.ts` | `status` handler returns plan DAG Block Kit |
| TR-003-006 | Unit | `slack-home.ts` | Home tab includes plan status section |

#### Done When
- `/gwrk status` → Block Kit response with plan DAG summary
- Home tab shows: features by status, active ships, pending blessings
- Response arrives within 3 seconds

---

### Phase 3: Ship from Slack — `/gwrk ship`

Dispatch a ship run from Slack. This is the "start work from my phone" interaction.

**Files (2):**
- `src/server/slack-commands.ts` (MODIFY: Wire `ship` handler to spawn `gwrk ship <feature> <phase>` as background subprocess, acknowledge immediately)
- `src/server/slack-commands.ts` (MODIFY: Wire `approve` handler to call `gh pr merge` with PR lookup from execution ledger)

**Foxtrot Charlie Contract:**
- `/gwrk ship 006 1` → "🚀 Dispatching 006-pulse phase 1..." → ship runs in background
- `/gwrk approve 002 3` → "PR #31 merged ✅"

**Requirements Addressed:** FR-004, FR-012, US-004, US-012

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-003-007 | Unit | `slack-commands.ts` | `ship` handler spawns subprocess |
| TR-003-008 | Unit | `slack-commands.ts` | `ship` handler acknowledges immediately |
| TR-003-009 | Unit | `slack-commands.ts` | `approve` handler calls `gh pr merge` |

#### Done When
- `/gwrk ship 006 1` → acknowledgment → ship starts → progress posted
- `/gwrk approve 002 3` → PR merged → confirmation

---

### Phase 4: Bless the Definition — Spec/Plan Approval

When `gwrk define spec` or `gwrk define plan` completes, notify Slack so the PE can approve without opening a laptop.

**Prerequisite**: 002 Phase 4 (define event bridge) must be complete.

**Files (2):**
- `src/server/slack-actions.ts` (MODIFY: Add `approve_spec` and `approve_plan` handlers that update plan DAG status)
- `src/server/slack-messages.ts` (MODIFY: Add `specReady` and `planReady` message builders with Approve/Revise buttons)

**Foxtrot Charlie Contract:**
| Event | Pillar | Message | Primary CTA |
|-------|--------|---------|-------------|
| `define:spec:ready` | P2 Definition | "📐 Spec Ready: {feature}" | `[✅ Approve]` |
| `define:plan:ready` | P2 Definition | "📐 Plan Ready: {feature} — {N} phases" | `[✅ Approve]` |

**Requirements Addressed:** US-003 (extended to Definition pillar)

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-003-010 | Unit | `slack-actions.ts` | `approve_spec` updates plan DAG |
| TR-003-011 | Unit | `slack-messages.ts` | `specReady` Block Kit has Approve button |

#### Done When
- Spec completes → Slack: "📐 Spec Ready" with `[✅ Approve]`
- Tap Approve → plan DAG updated
- Same for plan approval

---

### Phase 5: Message Hygiene — Kill the Noise

Remove messages that don't have a bless action. Tighten the interaction contract.

**Files (2):**
- `src/server/slack-messages.ts` (MODIFY: Remove `phaseStart` builder — user started it, they know)
- `src/server/slack-messages.ts` (MODIFY: Remove `phaseComplete` standalone — fold into `reviewReady`)
- `src/server/slack-presence.ts` (MODIFY: Replace raw `batchedSummary` with actionable pending-blessings summary)

**Killed messages:**
- ❌ `phaseStart` — PE started it, they know
- ❌ `phaseComplete` without PR — redundant with `reviewReady`
- ❌ `ciResult` standalone — fold into ship:complete or ship:failed
- ❌ `batchedSummary` raw event list — replace with pending-blessings on return

**Requirements Addressed:** Foxtrot Charlie interaction contract enforcement

#### Done When
- Ship start → no Slack message
- Ship complete → exactly one message with one CTA
- Return from away → pending blessings summary, not raw event dump

---

## Build Plan Integration

After spec approval, generate tasks and ship:

```bash
gwrk plan next              # 003 should appear as ready
gwrk ship 003 1             # Ship Phase 1
# Slack: "🚢 Shipped: 003-slack phase 1 — PR #N"
# Tap ✅ Merge (from Slack!)
gwrk ship 003 2             # Ship Phase 2
# ...
```

The goal is that by Phase 3, you're shipping from Slack itself.

---

## Success Criteria

1. **Merge from phone**: Tap ✅ → PR merged → confirmed in 5 seconds
2. **Ship from phone**: `/gwrk ship` → ship runs → progress posted
3. **Status from phone**: `/gwrk status` → plan DAG summary
4. **Zero noise**: Only messages with bless actions. No FYI spam.
5. **Bless model**: Every message maps to one Foxtrot Charlie pillar with one primary CTA
