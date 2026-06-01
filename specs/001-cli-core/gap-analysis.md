# Gap Analysis: 001-cli-core Phase 13 (Project Awareness)

**Feature**: 001-cli-core
**Phase**: 13
**Date**: 2026-06-01

## 1. Context Audit

- **Spec**: `spec.md` R3 defines US-028 (Prompt Conditioning) and US-029 (Project Info).
- **Plan**: `plan.md` R3 outlines Phase 13 implementation.
- **Contracts**:
    - `agent.md`: Defines `dispatchAgent`, but doesn't mention prompt conditioning.
    - `config.md`: Defines `loadConfig`, which now returns a profile (from Phase 10).
- **Actual Code**:
    - `src/engine/prompt-conditioner.ts`: **STUB**. Throws "Not implemented".
    - `src/commands/project-info.ts`: **STUB**. Throws "Not implemented".
    - `src/engine/prompt-conditioner.test.ts`: **RED**. Exists but failing.
    - `src/commands/project-info.test.ts`: **RED**. Exists but failing.
    - `src/plugins/workflow-runtime.ts`: **MISSING** integration with prompt-conditioner.
    - `src/engine/ship-orchestrator.ts`: **MISSING** integration with prompt-conditioner.
    - `PROMPT.md` (15 files): **WRONG**. Contain ungated gwrk-native references.

## 2. Findings

| Item | Status | Finding |
|---|---|---|
| `prompt-conditioner.ts` | `greenfield` | Core logic for XML injection and guard resolution missing. |
| `project-info.ts` | `greenfield` | Logic to display resolved profile and support JSON output missing. |
| `workflow-runtime.ts` | `missing` | Workflow dispatch needs to call `conditionPrompt`. |
| `ship-orchestrator.ts` | `missing` | Review dispatch needs to call `conditionPrompt`. |
| `PROMPT.md` files | `wrong` | All PROMPT.md files assume gwrk-native project structure. |

## 3. Gap Details

### G-01: Prompt Conditioning Logic
The `conditionPrompt` function must:
1. Serialize the project profile into an XML block `<project_profile>...</project_profile>`.
2. Resolve `[type: gwrk-native]...[/type]` tags based on `profile.type === 'gwrk-native'`.
3. Be idempotent if called multiple times (though it should only be called once).

### G-02: Integration Points
Prompt conditioning must happen as late as possible before the prompt is sent to the agent.
- `WorkflowRuntime.executeWorkflow` is the central point for all `define` commands.
- `ShipOrchestrator` handles review dispatch which also needs conditioning.

### G-03: Project Info UX
`gwrk project info` should show:
- Project Type
- Tech Stack (Language, Framework, etc.)
- Layout (Source root, apps, packages)
- Conditioning Mode (Gwrk-native vs Generic)
- Source of truth for each field (Auto-detected vs Explicit)

### G-04: PROMPT.md Refactoring
Every workflow's `PROMPT.md` must be audited for gwrk-specific assumptions (e.g., `src/commands/`, `Commander.js`, `ADR-004`) and wrapped in `[type: gwrk-native]` guards.

## 4. Recommendations

1. Implement `prompt-conditioner.ts` first to make tests GREEN.
2. Integrate into `WorkflowRuntime` and verify with existing workflow tests.
3. Implement `project info` command.
4. Batch refactor `PROMPT.md` files by priority (Critical → Medium → Low).
