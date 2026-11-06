# 031 — Unified AgentPort and Stdin-First CLI Backend Adapters

> **Status:** Defined · **Anchored to:** ADR-006, ADR-007, ADR-011

## 1. Problem
Three competing agent routers (`BackendSelector`, `selectBackend`, `pillarBackend`) and two registries (`src/server/agent-registry.ts` and `src/plugins/agent-registry.ts`) split routing decisions. `dispatchToAgent` calls `adapter.dispatch(task)` before populating `task.stdin`, forcing `AgyAdapter`, `ClaudeAdapter`, and `CodexAdapter` to pass prompts via CLI args and leaving raw `stream-json` in `TaskResult.stdout`.

## 2. Functional Requirements
- **FR-001:** `src/ports/agent-port.ts` MUST define `AgentPort`, `AgentTaskRequest`, `AgentDispatchSpec`, and `AgentTaskResult`.
- **FR-002:** `dispatchToAgent` MUST assemble the prompt, grounding bundle, enforcement skills, extension context, and `<command_safety>` block into `task.stdin` before calling `adapter.dispatch(task)`.
- **FR-003:** `AgyAdapter`, `ClaudeAdapter`, and `CodexAdapter` MUST deliver prompts over `stdin`, unwrap `stream-json` inside `parseResult`, and set `CodexAdapter.nativeWriter = true`.
- **FR-004:** `AgyAdapter` MUST NOT drop model flags outside `AGY_2_MODEL_PATTERN` and MUST NOT prepend `/${workflow}` when `task.prompt` is already an expanded workflow prompt.
- **FR-005:** `src/engine/router.ts` MUST unify `BackendSelector`, `ModelSelector`, and `selectBackend` on `AgentBackendRegistry`, and `src/server/agent-registry.ts` MUST be removed or re-exported from the canonical registry.
