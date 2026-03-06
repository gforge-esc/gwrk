---
type: contract
feature: 002-build-server
last_modified: "2026-03-05T11:12:20Z"
---

# Contract: Context Compiler

**Feature**: 002-build-server
**Scope**: Compile agent context payload for sandbox injection

---

## `compileContext(featureDir: string, phaseId: string): Promise<string>`

**Source**: `src/server/context.ts`
**Consumed by**: `src/server/sandbox.ts`

Reads governance rules, persona, spec, plan, and tasks for the given feature and compiles them into a single Markdown document suitable for agent consumption.

```typescript
async function compileContext(featureDir: string, phaseId: string): Promise<string>
```

| Parameter | Type | Description |
|---|---|---|
| `featureDir` | `string` | Absolute path to `specs/<feature>/` |
| `phaseId` | `string` | e.g. `"phase-01"` |

**Returns**: Compiled Markdown string with sections:

```markdown
# Phase Context: <feature> / <phase>

## Governance Rules
<contents of .agent/rules/*.md>

## Feature Specification
<contents of spec.md>

## Implementation Plan
<contents of plan.md>

## Current Tasks
<JSON from .gwrk/tasks.json, filtered to this phase>

## Gate Scripts
<contents of gate scripts for this phase's tasks>
```

**Error states**:
| Condition | Throws |
|---|---|
| `spec.md` not found | `ContextError('spec.md not found in <featureDir>')` |
| `.agent/rules/` missing | `ContextError('.agent/rules/ directory not found')` |

---

## `writeContextToSandbox(containerId: string, context: string): Promise<void>`

**Source**: `src/server/context.ts`
**Consumed by**: `src/server/sandbox.ts`

Writes the compiled context string to `/workspace/.gwrk/phase-context.md` inside the Docker container via `docker exec`.

```typescript
async function writeContextToSandbox(containerId: string, context: string): Promise<void>
```
