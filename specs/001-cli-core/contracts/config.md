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

**Critical**: No `.default()` calls. Every field is required. Missing field → `process.exit(1)`.
