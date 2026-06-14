---
type: contract
feature: 001-cli-core
last_modified: "2026-06-14T10:00:00Z"
---

# Contract: Plugin Management

**Feature**: 001-cli-core
**Scope**: Plugin registry searching, installation, and updates.

---

## `searchPlugins(query: string): Promise<PluginManifest[]>`

**Source**: `src/engine/registry.ts`
**Consumed by**: `src/commands/plugin.ts`

Searches the local plugin registry at `~/.gwrk/registry/` for plugins matching the query. Returns an array of manifests.

```typescript
function searchPlugins(query: string): Promise<PluginManifest[]>
```

| Parameter | Type | Description |
|---|---|---|
| `query` | `string` | Search query (matches name, description, keywords) |

**Returns**: `Promise<PluginManifest[]>`

---

## `installPlugin(idOrUrl: string): Promise<void>`

**Source**: `src/engine/registry.ts`
**Consumed by**: `src/commands/plugin.ts`

Resolves a plugin ID from the registry or a direct git URL. Clones/copies the plugin to `~/.gwrk/plugins/`. Validates `manifest.yaml`.

```typescript
function installPlugin(idOrUrl: string): Promise<void>
```

| Parameter | Type | Description |
|---|---|---|
| `idOrUrl` | `string` | Plugin ID (e.g., "narrative") or git URL |

**Error states**:
| Condition | stderr | Exit code |
|---|---|---|
| Plugin already installed | `Plugin <id> already installed. Run 'gwrk plugin update' to update.` | 1 |
| Manifest validation fails | `Invalid plugin manifest: <error>` | 1 |
| Clone fails | `Failed to clone plugin from <url>` | 1 |

---

## `updatePlugin(id?: string): Promise<void>`

**Source**: `src/engine/registry.ts`
**Consumed by**: `src/commands/plugin.ts`

Updates one or all installed plugins via `git pull`.

```typescript
function updatePlugin(id?: string): Promise<void>
```

| Parameter | Type | Description |
|---|---|---|
| `id` | `string` (optional) | Specific plugin ID to update. If omitted, updates all. |
