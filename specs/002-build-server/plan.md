# Implementation Plan: 002 Build Server (v3 — Daily Driver)

**Branch**: `feat/002-build-server` | **Date**: 2026-05-05 | **Spec**: [spec.md](./spec.md)

## Summary

The build server is the **always-on backbone** that lets the principal engineer drive gwrk from Slack instead of a terminal. With 018 (build plan orchestrator) shipped, the DAG knows what's ready. With 004 (ship loop) hardened, the orchestrator can execute. What's missing is the **bridge**: server → Slack → principal engineer → bless → advance.

**Target experience**: Open Slack on your phone. See "🚢 Shipped: 003-slack phase 2 — PR #31." Tap ✅ Merge. Move on. See "📐 Plan Ready: 006-pulse." Tap ✅ Approve. The pipeline advances. Close Slack. Done.

Most of the server infrastructure exists (lifecycle, PID, status, monitoring, Slack connection). What's broken is the **event bridge** between the orchestrator and Slack, and the **bless actions** that make Slack interactions actually advance the pipeline.

---

## Phases and File Structure

### Phase 1: Audit & Prune Dead Code

Remove Docker sandbox abstractions and dispatch queue code that was never used. The ship loop runs agents locally via `child_process`. These files add complexity, confuse agents during implementation, and test nothing real.

**Files (6):**
- `src/server/sandbox.ts` (DELETE: Docker container lifecycle — never used)
- `src/server/docker.ts` (MODIFY: Keep `ensureDocker()` health check only, remove sandbox operations)
- `src/server/context.ts` (DELETE: Context compilation — ship-orchestrator owns this)
- `src/server/dispatch-orchestrator.ts` (DELETE: Server-side dispatch queue — ship-orchestrator owns this)
- `src/server/git-manager.ts` (DELETE: Server-side git lifecycle — ship-orchestrator owns this)
- `src/server/routes/dispatch.ts` (MODIFY: Remove sandbox dispatch endpoints, keep run-tracking POST)

**Requirements Addressed:** Removes technical debt, clears path for Phase 2

**Dependencies:** None

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| compile-gate | Always |
| No breaking changes to `gwrk server start/stop/status` | Must verify |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-002-001 | E2E | `gwrk server start` + `gwrk server stop` | Still works after pruning |
| TR-002-002 | E2E | `gwrk status --json` | Status shape unchanged |
| TR-002-003 | Build | `pnpm build` | No dead import errors |

#### Done When
- `pnpm build` passes with no dead imports
- `gwrk server start` / `gwrk server stop` work unchanged
- `gwrk status` returns same JSON shape
- All deleted files have zero live importers

---

### Phase 2: Ship Orchestrator → Server Event Bridge

Wire the ShipOrchestrator's EventEmitter to the server's Slack notification system. Currently `ship.ts` (the CLI command handler) calls `notifySlack()` directly, bypassing the orchestrator. The orchestrator should own the events; the server should listen and route to Slack.

**Files (4):**
- `src/engine/ship-orchestrator.ts` (MODIFY: Emit typed events for every stage transition: `ship:start`, `ship:stage`, `ship:complete`, `ship:failed`, `ship:blocked`)
- `src/server/ship-bridge.ts` (NEW: Listens for orchestrator events, converts to `MessageBuilder` calls, dispatches via `notifySlack()`)
- `src/commands/ship.ts` (MODIFY: Remove direct `notifySlack` calls — the bridge handles it. Wire orchestrator events to bridge when server is running.)
- `src/server/index.ts` (MODIFY: Initialize ship-bridge listener on server start)

**Requirements Addressed:** FR-005, FR-006, US-003

**Dependencies:** Phase 1

**Contract Mapping:**
- ShipOrchestrator emits → `ship-bridge.ts` listens → `MessageBuilder` builds → `notifySlack()` sends
- If server is NOT running, ship still works (CLI output only, no Slack)

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| compile-gate | Always |
| Foxtrot Charlie interaction contract | Every message must have exactly one primary CTA |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-002-004 | Unit | `src/server/ship-bridge.ts` | Event → correct MessageBuilder call |
| TR-002-005 | Unit | `src/server/ship-bridge.ts` | `ship:complete` → `reviewReady` with Merge button |
| TR-002-006 | Unit | `src/server/ship-bridge.ts` | `ship:failed` → `phaseFail` with Retry button |
| TR-002-007 | Integration | `src/commands/ship.ts` | Ship without server running = no Slack calls, no crash |

#### Done When
- `gwrk ship 018 5` with server running sends exactly one Slack message (ship:complete → reviewReady)
- Ship without server running works identically to today (CLI output only)
- No `notifySlack` calls remain in `ship.ts` — all moved to bridge

---

### Phase 3: Bless Actions — Slack → Pipeline

Make button taps and emoji reactions in Slack actually advance the pipeline. The `slack-actions.ts` handlers exist but several are stubs. Wire them to real operations using `gh` CLI and the plan DAG.

**Files (4):**
- `src/server/slack-actions.ts` (MODIFY: Wire `merge_pr` to `gh pr merge`, `retry_phase` to re-dispatch, `request_changes` to add PR comment)
- `src/server/slack-commands.ts` (MODIFY: Wire `/gwrk status` to `gwrk plan status` DAG output, `/gwrk ship` to trigger dispatch)
- `src/server/slack-home.ts` (MODIFY: Home tab shows: plan DAG status, pending blessings, active ships — not raw data dump)
- `src/engine/plan-store.ts` (MODIFY: Add `advanceFeature()` — after merge, update plan DAG status for the feature/phase)

**Requirements Addressed:** FR-007, US-004, US-005

**Dependencies:** Phase 2

**Foxtrot Charlie Bless Map:**
| Action | Button/Command | Pipeline Effect |
|---|---|---|
| Merge PR | `[✅ Merge]` or ✅ reaction | `gh pr merge`, update plan DAG, post confirmation |
| Retry Ship | `[🔄 Retry]` | Re-dispatch `gwrk ship <feature> <phase>` |
| Request Changes | `[✏️ Request Changes]` | Add PR review comment, post note to channel |
| Approve Spec | `[✅ Approve Spec]` | Mark spec reviewed, advance to plan generation |
| Approve Plan | `[✅ Approve Plan]` | Mark plan reviewed, enable shipping |
| View Logs | `[📋 View Logs]` | Post log file tail to ephemeral message |
| Status | `/gwrk status` | Plan DAG summary from `gwrk plan status` |
| Ship from Slack | `/gwrk ship <feature> <phase>` | Trigger ship dispatch from phone |

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| compile-gate | Always |
| No silent failures | Every button tap must post confirmation or error |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-002-008 | Unit | `src/server/slack-actions.ts` | `merge_pr` calls `execSync('gh pr merge')` |
| TR-002-009 | Unit | `src/server/slack-actions.ts` | `retry_phase` triggers dispatch |
| TR-002-010 | Unit | `src/server/slack-home.ts` | Home tab includes plan DAG status section |
| TR-002-011 | Unit | `src/server/slack-commands.ts` | `/gwrk status` returns plan DAG output |

#### Done When
- Tap ✅ Merge in Slack → PR merged, plan DAG updated, confirmation posted
- Tap 🔄 Retry → ship re-dispatched, confirmation posted
- `/gwrk status` → plan DAG summary (same output as `gwrk plan status`)
- `/gwrk ship 006 1` → ship dispatched from Slack
- Home tab shows: features by status, pending blessings, active ships

---

### Phase 4: Define Event Bridge

Extend the event bridge to cover the Definition pillar. When `gwrk define spec` or `gwrk define plan` completes, the server should notify Slack so the PE can approve from their phone.

**Files (3):**
- `src/commands/define.ts` (MODIFY: Emit `define:spec:ready` and `define:plan:ready` events after successful agent dispatch)
- `src/server/ship-bridge.ts` (MODIFY: Also handle define events — build spec/plan-ready messages with Approve/Revise buttons)
- `src/server/slack-actions.ts` (MODIFY: Add `approve_spec` and `approve_plan` action handlers)

**Requirements Addressed:** US-003 (extend to Definition pillar)

**Dependencies:** Phase 3

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-002-012 | Unit | `src/server/ship-bridge.ts` | `define:spec:ready` → spec-ready message with Approve button |
| TR-002-013 | Unit | `src/server/slack-actions.ts` | `approve_spec` advances plan state |

#### Done When
- `gwrk define spec 006` → Slack: "📐 Spec Ready: 006-pulse" with `[✅ Approve]`
- Tap Approve → spec marked reviewed in plan DAG
- `gwrk define plan 006` → Slack: "📐 Plan Ready" with `[✅ Approve]`

---

### Phase 5: Resilience & Polish

Harden sleep/wake, network detection, and the execution ledger. These exist but need testing and edge-case fixes.

**Files (3):**
- `src/server/lifecycle.ts` (MODIFY: Verify heartbeat drift detection works with Slack reconnection)
- `src/server/network.ts` (MODIFY: Verify network state polling emits correct events)
- `src/server/slack.ts` (MODIFY: Add Slack reconnection on wake — currently drops connection after sleep)

**Requirements Addressed:** FR-008, FR-009, FR-010, US-005, US-006

**Dependencies:** Phase 4

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-002-014 | Unit | `src/server/lifecycle.ts` | Heartbeat drift → lifecycle `sleeping` |
| TR-002-015 | Unit | `src/server/network.ts` | Interface change → correct event |
| TR-002-016 | Integration | Sleep/wake | Slack reconnects after wake |

#### Done When
- Close laptop lid, open it → `gwrk status` shows `ready` within 30s
- Slack bot reconnects and responds to `/gwrk status` after wake
- Network loss → `gwrk status` shows `offline` → network restore → `online`

---

## Build Plan Integration

This plan uses 018's DAG for tracking. After spec approval:

```bash
# Generate tasks from this plan
gwrk define plan-to-tasks 002

# Check what's ready
gwrk plan next

# Ship phase by phase
gwrk ship 002 1
gwrk ship 002 2
# ... etc
```

The ship orchestrator (018) handles the implement→review→PR→CI loop for each phase. The build server (this feature) handles the Slack bridge so the PE can bless each phase from their phone.

---

## Success Criteria

1. **Phone-first**: PE can approve specs, merge PRs, retry failures, and check status from Slack without opening a laptop
2. **Silent when idle**: No Slack noise when nothing needs attention
3. **One CTA per message**: Every notification has exactly one primary action that advances the pipeline
4. **Resilient**: Server survives sleep/wake, network loss, and Slack disconnection
5. **Ledger complete**: Every agent dispatch recorded with queryable history
