# 038 Implementation Plan

Phase 1 adds SQLite migration 012 and run telemetry persistence. It also wires harvest hydration and compression cost metrics. Blocked: none.

## Phase 1

Points: 3

- `T001` Add migration `012_run_telemetry.sql` and update `src/db/runs.ts` for telemetry columns.
- `T002` Wire usage and device fields in `src/commands/ship.ts` and `src/engine/harvest.ts`.
- `T003` Add telemetry cost per SP to `src/engine/compression.ts` and `src/db/telemetry.test.ts`.
- Done-When: `pnpm test:ci src/db/telemetry.test.ts` exits 0.
