# Contract: Ship Pre-flight — `gwrk ship` test-file guard

**Source**: `src/commands/ship.ts`
**Spec**: FR-008, US-008

## Behavior

Before dispatching any agent work, `gwrk ship <feature> <phase>` checks that test files exist for the phase's deliverable files.

### Resolution

1. Read `tasks.json` for the specified phase
2. Extract deliverable file paths from task titles/descriptions
3. For each deliverable `.ts` file in `src/`, check for a matching `.test.ts`:
   - `src/utils/signal.ts` → `src/utils/signal.test.ts`
   - `src/commands/ship.ts` → `src/commands/ship.test.ts`
4. If zero matching `.test.ts` files found → BLOCKED

### Pre-flight Result

| Condition | Exit Code | stderr |
|---|---|---|
| ≥1 `.test.ts` file found for phase deliverables | Continue | — |
| 0 `.test.ts` files found | 1 | `[BLOCKED] No test files found for <phase>` |

### Invariants

- Pre-flight runs BEFORE any agent dispatch — no work starts without tests
- Active immediately — not gated by a flag, config, or toggle
- Only checks `src/` deliverables — `specs/`, `docs/`, `.agents/` files are exempt
- Does NOT run the tests — only checks file existence. Gate scripts run tests.

### Exit Code Contract (ADR-004 §2.2)

| Code | Meaning |
|---|---|
| 0 | Pre-flight passed, ship proceeds |
| 1 | Expected failure: no test files found (BLOCKED) |
