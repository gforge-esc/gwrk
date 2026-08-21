#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T016 — Modify ADR-005-tdd-gate-architecture.md
# Generated from filesystem convention (deterministic vitest gate)

test -f docs/decisions/ADR-005-tdd-gate-architecture.md || { echo "FAIL: T016 — file not found: docs/decisions/ADR-005-tdd-gate-architecture.md" >&2; exit 1; }

pnpm vitest run docs/decisions/ADR-005-tdd-gate-architecture.md --reporter=verbose \
  || { echo "FAIL: T016 — vitest failed for docs/decisions/ADR-005-tdd-gate-architecture.md" >&2; exit 1; }

echo "PASS: T016 — Modify ADR-005-tdd-gate-architecture.md"
