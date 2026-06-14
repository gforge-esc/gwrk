# R011: Obsidian Vault as Discovery Source — Technical Research Report

## 1. Extension Plugin Architecture

### ExtensionManifestSchema
The `ExtensionManifestSchema` extends the core `PluginBase` to support external tool integration. It is central to the "Domain Packs" and "Channel Adapters" vision (Layer 3).

```typescript
export const ExtensionManifestSchema = PluginBaseSchema.extend({
  type: z.literal("extension"),
  /** The capabilities this extension provides to the gwrk engine */
  provides: z.array(z.enum(["context", "metrics", "search", "notification"])),
  /** JSON Schema for validating per-project configuration in .gwrkrc.json */
  schema: z.record(z.any()).optional(),
  /** How to execute the extension's CLI or adapter script */
  execution: InvocationSchema.optional(),
});
```

### ContextProvider Interface
The `ContextProvider` is a functional contract used during agent dispatch.

```typescript
export interface ExtensionContextProvider {
  resolveContext(
    projectRoot: string, 
    workflow: string, 
    keywords: string[]
  ): Promise<string>;
}
```

Implementation logic in `src/plugins/extension-runtime.ts` (Proposed):
1. Discover active `extension` plugins via `PluginLoader`.
2. Filter those providing `context`.
3. For each, retrieve its configuration from the `.gwrkrc.json` `extensions` block.
4. If `execution` is defined, spawn the process with mapped arguments (e.g., `query={{keywords}}`).
5. Merge resulting context into a single grounding block.

## 2. Agent Dispatch Integration

Extensions follow the "Enforcement Skill" precedent. Context injection happens in `src/utils/agent.ts` within `dispatchToAgent()`.

**Injection Flow**:
- **Implicit**: Append to the grounding block (Grounding Documents) that precedes the main prompt.
- **Explicit**: Replace the `{{extensions}}` placeholder in the prompt if present.

**Keyword Extraction**:
To make search-based extensions effective, gwrk will use a heuristic to extract keywords from the task prompt to seed the extension search query.

## 3. Plugin Registry & Distribution

### Registry Model (Monorepo Catalog)
- **Repository**: `gforge-esc/gwrk-plugins`
- **Structure**:
  ```
  /
  ├── agents/
  ├── skills/
  ├── workflows/
  └── extensions/
      └── obsidian-vault/
          ├── manifest.yaml
          └── (scripts/binaries)
  ```
- **Provisioning**: Cloned to `~/.gwrk/registry/gwrk-plugins/` during workstation provisioning (`gwrk init`).

### `gwrk plugin` updates
- `install <name>`: Searches the registry monorepo if `<name>` is not a valid local path.
- `update`: Performs a `git pull` in the registry directory and re-installs active plugins.
- `search`: Greps the registry's `manifest.yaml` files for keywords.

## 4. Obsidian Adapter Design

The Obsidian integration is a thin wrapper around `obsidian-cli` (v1.12.7+).

**Manifest**:
```yaml
name: obsidian-vault
type: extension
provides: ["context"]
schema:
  type: object
  properties:
    vault: { type: string }
execution:
  command: obsidian-cli
  args: ["search:context", "query={{keywords}}", "format=json"]
```

**Configuration (.gwrkrc.json)**:
```json
{
  "extensions": {
    "obsidian-vault": {
      "vault": "EnergyWork"
    }
  }
}
```

## 5. Sequencing & Roadmap

### Phase 1: Core Extension Support (001-P10 / 014 Alignment)
- Implement `ExtensionManifestSchema` and update `AnyManifestSchema`.
- Update `PluginLoader` to support registry-based resolution.
- Add extension context injection logic to `src/utils/agent.ts`.

### Phase 2: Registry & Init (001-P10 Integration)
- Implement registry cloning during workstation setup.
- Add extension detection (e.g., checking for `obsidian-cli`) to the `init` wizard.

### Phase 3: Obsidian Adapter
- Construct the `obsidian-vault` extension plugin and publish to the `gwrk-plugins` registry.

## 6. Grounding Sources Check

- **Obsidian CLI**: `search:context` verified as the high-signal interaction point.
- **Enforcement Precedent**: `resolveEnforcementSkills()` in `skill-runtime.ts` provides the reference implementation for multi-plugin resolution.
- **Config**: `GwrkConfigSchema` in `src/utils/config.ts` must be extended with an `extensions` field.