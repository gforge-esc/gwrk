#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T014 — Modify ADR-003-state-contract.md
# Generated from filesystem convention (deterministic vitest gate)

test -f docs/decisions/ADR-003-state-contract.md || { echo "FAIL: T014 — file not found: docs/decisions/ADR-003-state-contract.md" >&2; exit 1; }

pnpm vitest run docs/decisions/ADR-003-state-contract.md --reporter=verbose \
  || { echo "FAIL: T014 — vitest failed for docs/decisions/ADR-003-state-contract.md" >&2; exit 1; }

echo "PASS: T014 — Modify ADR-003-state-contract.md"
