#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002 — SQLite Execution Ledger

# ── FILES: Check for core DB files ──
test -f src/db/index.ts
test -f src/db/migrations/001-initial.sql
test -f src/db/runs.ts
test -f src/commands/db.ts
test -f src/commands/runs.ts
test -f src/commands/stats.ts

# ── BEHAVIORAL: DB and Command tests must pass ──
pnpm vitest run src/db/db.test.ts src/commands/runs.test.ts src/commands/stats.test.ts \
  || { echo "FAIL: T002 — vitest failed for DB/runs/stats tests" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/db/ src/commands/db.ts src/commands/runs.ts src/commands/stats.ts --no-errors-on-unmatched \
  || { echo "FAIL: T002 — lint errors in DB or command files" >&2; exit 1; }

echo "PASS: T002 — SQLite Execution Ledger verified"
