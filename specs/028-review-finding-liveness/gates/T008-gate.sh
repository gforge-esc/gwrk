#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T008 — Modify ADR-007-single-dispatch-path.md
# Generated from filesystem convention (deterministic vitest gate)

test -f docs/decisions/ADR-007-single-dispatch-path.md || { echo "FAIL: T008 — file not found: docs/decisions/ADR-007-single-dispatch-path.md" >&2; exit 1; }

pnpm vitest run docs/decisions/ADR-007-single-dispatch-path.md --reporter=verbose \
  || { echo "FAIL: T008 — vitest failed for docs/decisions/ADR-007-single-dispatch-path.md" >&2; exit 1; }

echo "PASS: T008 — Modify ADR-007-single-dispatch-path.md"
