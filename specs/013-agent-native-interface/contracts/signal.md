# Contract: Signal — `withSignal()`

**Source**: `src/utils/signal.ts`
**Spec**: FR-001, TC-005, TC-007

## Method

```typescript
export async function withSignal(name: string, fn: () => Promise<void>): Promise<void>;
```

## Behavior

| Input | Output | Side Effect |
|---|---|---|
| `fn` resolves | `[exit:0 \| <duration>]` on stderr | Sets `process.exitCode = 0` |
| `fn` throws `Error(msg)` | `[exit:1 \| <duration>] <name>: <msg>` on stderr | Sets `process.exitCode = 1` |
| `fn` throws non-Error | `[exit:1 \| <duration>] <name>: Unknown error` on stderr | Sets `process.exitCode = 1` |

## Duration Formatting

| Condition | Format | Example |
|---|---|---|
| `< 1000ms` | `Nms` | `42ms` |
| `≥ 1000ms` | `N.Ns` | `3.2s` |

## Invariants

- Signal is ALWAYS the last line written to stderr (TC-005)
- Signal NEVER appears on stdout (TC-007)
- Duration is measured via `performance.now()` (wall clock, not CPU)
- No unhandled rejections escape — `withSignal()` catches everything
- `withSignal()` does NOT call `process.exit()` — it sets `process.exitCode` and returns. Commander.js handles actual exit. This makes the function unit-testable.

## Testability

`withSignal()` is designed to be testable:
- It writes to `process.stderr` (interceptable via spy)
- It sets `process.exitCode` (readable in test assertions)
- It does NOT call `process.exit()` (no process death in test runner)

Test pattern:
```typescript
const stderrSpy = vi.spyOn(process.stderr, 'write');
await withSignal('test', async () => { throw new Error('boom'); });
expect(process.exitCode).toBe(1);
expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[exit:1'));
```

## Error States

| Condition | stderr Contains | Exit Code |
|---|---|---|
| `fn` throws | `[exit:1 \| Xs] <name>: <error.message>` | 1 |
| `fn` succeeds | `[exit:0 \| Xs]` | 0 |
