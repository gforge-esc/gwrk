#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002 — Modify ADR-001-task-tracking.md
# Generated from filesystem convention (deterministic vitest gate)

test -f docs/decisions/ADR-001-task-tracking.md || { echo "FAIL: T002 — file not found: docs/decisions/ADR-001-task-tracking.md" >&2; exit 1; }

pnpm vitest run docs/decisions/ADR-001-task-tracking.md --reporter=verbose \
  || { echo "FAIL: T002 — vitest failed for docs/decisions/ADR-001-task-tracking.md" >&2; exit 1; }

echo "PASS: T002 — Modify ADR-001-task-tracking.md"
