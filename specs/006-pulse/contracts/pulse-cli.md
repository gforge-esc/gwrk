# Contract: Pulse CLI Commands

**Feature**: 006-pulse
**Scope**: Commander.js command registration and terminal rendering

---

## `registerPulseCommands(program: Command): void`

**Source**: `src/commands/pulse.ts`
**Consumed by**: `src/cli.ts`

Registers the `pulse` command group with Commander.js:
- `gwrk pulse` — generates a multi-repo PulseReport from config
- `gwrk pulse scan [path]` — scans a single repo at the given path

Both commands support `--json` flag for structured output.

```typescript
function registerPulseCommands(program: Command): void
```

### Subcommand: `gwrk pulse`

| Option | Type | Default | Description |
|---|---|---|---|
| `--json` | boolean | `false` | Output full PulseReport as JSON to stdout |

**Behavior**:
1. Loads config via `loadConfig()`
2. Validates `config.pulse.repos` exists and is non-empty
3. Calls `generatePulseReport(config)`
4. If `--json`: outputs JSON to stdout
5. Else: renders formatted terminal table

### Subcommand: `gwrk pulse scan <path>`

| Argument | Type | Required | Description |
|---|---|---|---|
| `path` | `string` | Yes | Absolute or relative path to git repository |

| Option | Type | Default | Description |
|---|---|---|---|
| `--json` | boolean | `false` | Output PulseSnapshot as JSON to stdout |
| `--branch` | string | auto-detect | Override default branch detection |

**Behavior**:
1. Resolves `path` to absolute
2. Validates path exists and is a git repository
3. Calls `scanRepository(repoPath)`
4. If `--json`: outputs JSON to stdout
5. Else: renders formatted terminal table

---

## `renderPulseTable(report: PulseReport): string`

**Source**: `src/commands/pulse.ts`
**Consumed by**: `registerPulseCommands()` (internal)

Renders a PulseReport as a formatted terminal table matching the PRD §14 example output format. Uses Unicode box-drawing characters.

```typescript
function renderPulseTable(report: PulseReport): string
```

**Returns**: Formatted string for terminal output.

---

## `renderSnapshotTable(snapshot: PulseSnapshot): string`

**Source**: `src/commands/pulse.ts`
**Consumed by**: `registerPulseCommands()` (internal)

Renders a single PulseSnapshot as a formatted terminal table for `gwrk pulse scan` output.

```typescript
function renderSnapshotTable(snapshot: PulseSnapshot): string
```

**Returns**: Formatted string for terminal output.
