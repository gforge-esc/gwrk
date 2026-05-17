# Contract: Slack Events

**Feature**: 002-build-server

## `handleEvent(event: ShipEvent)`

**Consumed by**: ShipOrchestrator emitting events to the daemon.

**Input Types**:
```typescript
type ShipEvent = 
  | { type: "ship:complete", feature: string, phase: number, prNumber: number }
  | { type: "ship:failed", feature: string, phase: number, reason: string }
  | { type: "ship:blocked", feature: string, phase: number, attempts: number };
```

**Actions**:
Converts to Block Kit messages with exactly one CTA button (`[✅ Merge]`, `[🔄 Retry]`, `[📋 Escalate]`).
