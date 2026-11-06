# 031 — Implementation Plan

## Phases

### Phase 1 — Canonical AgentPort, Stdin Pipeline, and Unified Router (8 SP)
- `src/ports/agent-port.ts` (NEW: Define canonical `AgentPort` contract)
- `src/utils/agent.ts` (MODIFY: Assemble `task.stdin` prior to `adapter.dispatch` and unwrap via `adapter.parseResult`)
- `src/plugins/builtins/agents/agy/adapter.ts` (MODIFY: Stdin prompt delivery, remove `AGY_2_MODEL_PATTERN` drop, unwrap `stream-json`)
- `src/plugins/builtins/agents/claude/adapter.ts` (MODIFY: Stdin prompt delivery, remove positional `featureDir`, unwrap `stream-json`)
- `src/plugins/builtins/agents/codex/adapter.ts` (MODIFY: Set `nativeWriter = true` and deliver prompt via `stdin`)
- `src/engine/router.ts` (MODIFY: Unify routing and model selection)

#### Done When
```bash
pnpm vitest run src/plugins/builtins/agents/ src/engine/router.test.ts src/utils/agent.test.ts
```
