# Code Review: 002 Build Server — Phase 01 (Audit & Prune)

**Date**: 2026-05-05
**Reviewer**: Gemini CLI (Audit Mode)
**Status**: READY FOR IMPLEMENTATION

## Summary
The codebase currently contains the obsolete server-side dispatch architecture (F005) which includes parallel task orchestration and worktree-based sandboxing managed by the server. This architecture is now architectural debt, as it was superseded by the sequential, in-place `ShipOrchestrator` (018) and the plugin-based dispatch system.

## Audit Findings

| File | Status | Action | Notes |
|---|---|---|---|
| `src/server/sandbox.ts` | **DEAD** | DELETE | Manages git worktrees. Not used by new ShipOrchestrator. |
| `src/server/dispatch-orchestrator.ts` | **DEAD** | DELETE | Parallel concurrency logic. Superseded by 018. |
| `src/server/context.ts` | **DEAD** | DELETE | Redundant. Plugin adapters handle context assembly now. |
| `src/server/git-manager.ts` | **DEAD** | DELETE | Server-side git lifecycle. Moved to CLI utilities. |
| `src/server/docker.ts` | **STALE** | MODIFY | Prune to health-check only. Docker sandboxes are gone. |
| `src/server/routes/dispatch.ts` | **STALE** | MODIFY | Remove API endpoints for server-side dispatch. |

## Dependencies & Risks
- **`gwrk ship --parallel`**: This flag depends on `DispatchOrchestrator`. It must be removed to avoid build errors.
- **Server Lifecycle**: `src/server/index.ts` must be refactored to remove the `DispatchQueue` and its related managers.
- **`src/server/dispatch.ts`**: This file (the `DispatchQueue`) should be added to the deletion list as it is no longer required.

## Verdict
The pruning plan is sound and correctly identifies the primary sources of architectural drift. The code is ready for pruning as soon as implementation begins.
