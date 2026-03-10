---
type: contract
feature: 004-ship-loop
last_modified: "2026-03-09T22:00:00Z"
---

# Contract: Implement Action

**Feature**: 004-ship-loop
**Scope**: Single-phase task execution with pre-flight/post-flight gate enforcement

---

## `implementAction(feature, phase, opts): Promise<void>`

**Source**: `src/commands/implement.ts`
**Consumed by**: `scripts/dev/work-until-done.sh` (IMPLEMENT stage, via `agent-run.sh implement`)

Executes all tasks in a single phase sequentially: load tasks → pre-flight gate → agent dispatch → post-flight gate → mark complete.

```typescript
async function implementAction(
  feature: string,
  phase: string,
  opts: { dryRun?: boolean; agent?: string }
): Promise<void>
```

### Behavior Per Task
1. Load task from `tasks.json`
2. Run pre-flight gate (`gates/T0xx-gate.sh`)
   - Exit 0 → skip task (already satisfied)
   - Exit != 0 → proceed to implementation
3. Dispatch agent via `agent-run.sh implement <feature> <phase> <taskId>`
4. Run post-flight gate
   - Exit 0 → mark task complete in `tasks.json`
   - Exit != 0 → throw error

### Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| tasks.json not found | `Task state file not found` | 1 |
| Phase not found | `Phase phase-NN not found` | 1 |
| Post-flight gate fails | `gate failed after implementation` | 1 |
