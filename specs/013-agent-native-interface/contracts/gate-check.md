# Contract: Gate Check — `gwrk gate-check`

**Source**: `src/commands/gate-check.ts`
**Spec**: FR-006, DM-002

## Command Signature

```
gwrk gate-check <task_id> [-f, --feature <dir>] [--format json]
```

## Method

```typescript
export async function runGateCheck(taskId: string, featureDir: string): Promise<GateCheckResult>;
```

## Schema (DM-002)

```typescript
interface GateCheckResult {
  taskId: string;           // e.g., "T001"
  feature: string;          // e.g., "000-tdd-infrastructure"
  gatePath: string;         // Relative path to gate script
  result: 'PASS' | 'FAIL';
  exitCode: number;         // Gate script exit code
  stdout: string;           // Captured stdout
  stderr: string;           // Captured stderr
  durationMs: number;       // Execution time
}
```

## Gate Script Resolution

```
specs/<feature>/gates/<taskId>-gate.sh
```

Example: `gwrk gate-check T001 -f specs/000-tdd-infrastructure`
→ resolves to `specs/000-tdd-infrastructure/gates/T001-gate.sh`

## Feature Inference (when `-f` is omitted)

1. Look for `specs/**/gates/<taskId>-gate.sh` (glob)
2. If exactly 1 match → use that feature
3. If 0 matches → error with navigation
4. If >1 matches → error: `Task ID ambiguous across features: [list]. Use -f to specify.`

## Behavior

| Condition | result | exitCode | Command Exit |
|---|---|---|---|
| Gate script exits 0 | `PASS` | 0 | 0 |
| Gate script exits non-0 | `FAIL` | script exit code | 1 |
| Gate script not found | N/A | N/A | 1 |

## Error States

| Condition | stderr Contains | Exit Code |
|---|---|---|
| Gate script not found | `Gate script not found: <path>. Run 'gwrk project gates' to list available gates.` | 1 |
| Feature not specified and not inferrable | `Feature required. Run 'gwrk project specs' to list features.` | 2 |
| Ambiguous task ID | `Task ID ambiguous across features: [list]. Use -f to specify.` | 2 |
