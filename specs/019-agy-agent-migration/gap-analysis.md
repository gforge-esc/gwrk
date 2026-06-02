# Gap Analysis: 019 agy-agent-migration

## Audit Summary
The feature is in an early "skeleton" state. While several files exist, they are largely non-functional placeholders ("Not implemented" errors). The core routing logic has some test coverage but lacks the actual prioritization of `agy` in the implementation.

## Detailed Findings

### 1. src/plugins/builtins/agents/agy/adapter.ts
- **Status**: `missing` / `wrong`
- **Gaps**:
    - [ ] `syncGovernance`: Not implemented. Needs to handle `AGENTS.md` with `<!-- gwrk:begin -->` markers (FR-003).
    - [ ] `dispatch`: Not implemented. Needs to map YOLO to `--dangerously-skip-permissions` and omit `--model` (FR-004).
    - [ ] `isAvailable`: Not implemented. Needs to check for `agy` binary in PATH (FR-001).
    - [ ] `parseResult`: Not implemented. Needs to normalize exit codes and output (FR-001).
    - [ ] **Types**: Currently using `any`. MUST import `AgentBackend` from `src/plugins/agent-backend.ts` and `TaskDispatch`, `TaskResult` from `src/utils/agent.ts`.

### 2. src/plugins/builtins/agents/agy/manifest.yaml
- **Status**: `greenfield`
- **Gaps**:
    - [ ] File is missing. Must define plugin metadata for the `agy` agent backend.

### 3. src/plugins/builtins/agents/index.ts
- **Status**: `missing`
- **Gaps**:
    - [ ] `AgyAdapter` is NOT registered in the `BUILTIN_AGENTS` record.

### 4. src/engine/router.ts
- **Status**: `wrong`
- **Gaps**:
    - [ ] `fallbackOrder` defaults to `["gemini", "claude"]`. Needs to be `["agy", "gemini", "claude"]` to prioritize `agy` (FR-002).

### 5. src/plugins/builtins/agents/agy/adapter.test.ts
- **Status**: `partial`
- **Gaps**:
    - [ ] Tests exist but catch "Not implemented" errors rather than asserting behavior. Needs real implementation-driven assertions.

### 6. src/engine/router.test.ts
- **Status**: `partial`
- **Gaps**:
    - [ ] Prioritization test exists but relies on a mock that doesn't reflect the current code's default fallback order.

## Task Decomposition Strategy (Halving Rule)
- Phase 1 will focus on the `AgyAdapter` implementation and its registration.
- Phase 2 will focus on the `Router` integration and default behavior updates.
- Each task will target a single verifiable outcome (e.g., `isAvailable` check, then `dispatch` mapping).
