# Contract: Plugin Registry

This contract defines the methods for scanning, loading, and resolving gwrk plugins.

## Service: `PluginLoader`

### `listPlugins(options?: ListOptions): Promise<PluginSummary[]>`

Scans `~/.gwrk/plugins/` and built-ins to return all available plugins.

- **Options**: `type`, `tier`, `category`, `includeDisabled` (boolean).
- **Returns**: Array of `{ name, type, tier, version, description, status: 'active'|'disabled' }`.

### `getPlugin<T extends PluginManifest>(name: string, options?: ResolveOptions): Promise<T>`

Resolves a single plugin by name, applying local project overrides and disables.

- **Options**: `projectRoot` (string, required for local resolution).
- **Resolution Order**:
  1. Check `.gwrk/plugins.yaml` for `disable` list. If present, throw `PluginDisabledError`.
  2. Check `.gwrk/plugins.yaml` for `override` path. If present, load from that path.
  3. Scan `~/.gwrk/plugins/<type>/<name>/`.
  4. Load from `src/plugins/builtins/`.
- **Returns**: Typed manifest object.
- **Errors**: `PluginNotFoundError`, `PluginDisabledError`, `ManifestValidationError`.

## Service: `PluginManager`

### `installPlugin(source: string, options?: InstallOptions): Promise<void>`

Installs a plugin from a local directory or git URL.

- **Source**: Local path or Git URL (e.g., `https://github.com/user/repo#main`).
- **Options**: `force` (overwrite existing), `type` (target directory).
- **Validation**: MUST validate `manifest.yaml` against schema before copying.
- **FS Operations**:
  - Clone/copy to `~/.gwrk/plugins/<type>/<name>/`.
  - Write `.gwrk-source.json` for git installs.
  - Run `npm install --ignore-scripts` if `package.json` exists.

### `removePlugin(name: string, options?: RemoveOptions): Promise<void>`

Removes a plugin from the global plugin directory.

- **Options**: `force` (skip dependency check).
- **Validation**: MUST check if other plugins `compose` this plugin.
- **FS Operations**: `rm -rf ~/.gwrk/plugins/<type>/<name>/`.
