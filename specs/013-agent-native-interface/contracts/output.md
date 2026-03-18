# Contract: Output — `CommandOutput`

**Source**: `src/utils/output.ts`
**Spec**: FR-002, TC-006

## Factory

```typescript
export function createOutput(format?: string): CommandOutput;
```

## Interface

```typescript
export interface CommandOutput {
  write(data: string | object): void;  // stdout
  info(msg: string): void;             // stderr
}
```

## Behavior by Format

### text mode (default, no format flag)

| Method | Target | Behavior |
|---|---|---|
| `write(string)` | stdout | `process.stdout.write(data)` |
| `write(object)` | stdout | `process.stdout.write(String(data))` |
| `info(msg)` | stderr | `process.stderr.write(msg + '\n')` |

### `json` mode

| Method | Target | Behavior |
|---|---|---|
| `write(object)` | stdout | `process.stdout.write(JSON.stringify(data, null, 2) + '\n')` |
| `write(string)` | stdout | `process.stdout.write(JSON.stringify(data) + '\n')` |
| `info(msg)` | stderr | `process.stderr.write(msg + '\n')` (unchanged) |

## Invariants

- `write()` ALWAYS goes to stdout
- `info()` ALWAYS goes to stderr
- `--format json` and `--agent` are independent flags (TC-006)
- `--format json` does NOT imply `--agent`
- `--agent` does NOT imply `--format json`

## Error States

| Condition | Behavior |
|---|---|
| Invalid format value (`--format xml`) | Exit 2: `Unknown format: xml. Supported: json` |
| `--format json` on non-queryable command | No error — command runs normally |
