#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T013 — Modify ADR-002-sqlite-execution-ledger.md
# Generated from filesystem convention (deterministic vitest gate)

test -f docs/decisions/ADR-002-sqlite-execution-ledger.md || { echo "FAIL: T013 — file not found: docs/decisions/ADR-002-sqlite-execution-ledger.md" >&2; exit 1; }

pnpm vitest run docs/decisions/ADR-002-sqlite-execution-ledger.md --reporter=verbose \
  || { echo "FAIL: T013 — vitest failed for docs/decisions/ADR-002-sqlite-execution-ledger.md" >&2; exit 1; }

echo "PASS: T013 — Modify ADR-002-sqlite-execution-ledger.md"
