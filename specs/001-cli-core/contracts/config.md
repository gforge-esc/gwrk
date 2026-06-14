---
type: contract
feature: 001-cli-core
last_modified: "2026-02-27T00:04:35Z"
---

# Contract: Configuration

**Feature**: 001-cli-core
**Scope**: .gwrkrc.json loading and validation

---

## `loadConfig(projectRoot: string): GwrkConfig`

**Source**: `src/utils/config.ts`
**Consumed by**: `src/cli.ts` (at startup, before any command runs)

Loads `.gwrkrc.json` from the project root, validates against `GwrkConfigSchema` (Zod). Crashes on failure — no graceful degradation.

```typescript
function loadConfig(projectRoot: string): GwrkConfig
```

| Parameter | Type | Description |
|---|---|---|
| `projectRoot` | `string` | Absolute path to project root |

**Returns**: `GwrkConfig` (Zod-validated)

**Error states**:
| Condition | stderr | Exit code |
|---|---|---|
| `.gwrkrc.json` missing | `Configuration file .gwrkrc.json not found` | 1 |
| Schema validation fails | `Configuration error: <zod_error>` | 1 |
| JSON parse fails | `Configuration error: invalid JSON` | 1 |

---

## `GwrkConfigSchema` (Zod)

**Source**: `src/utils/config.ts`
**Consumed by**: `loadConfig()`

See [data-model.md](./data-model.md) DM-003 for full schema definition.

**Critical (R3 Update)**: 
- `project.type`, `project.stack`, `project.layout`, `project.architecture`, and `project.conventions` are **optional** and auto-detected at runtime if missing.
- Existing `.gwrkrc.json` files WITHOUT these fields MUST continue to parse without error.
- Explicit configuration in `.gwrkrc.json` always overrides auto-detected values.
- `agents.define` and `agents.implement` default to `"gemini"` if missing.
