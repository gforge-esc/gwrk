#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T004 — Modify ADR-006-plugin-agent-backends.md
# Generated from filesystem convention (deterministic vitest gate)

test -f docs/decisions/ADR-006-plugin-agent-backends.md || { echo "FAIL: T004 — file not found: docs/decisions/ADR-006-plugin-agent-backends.md" >&2; exit 1; }

pnpm vitest run docs/decisions/ADR-006-plugin-agent-backends.md --reporter=verbose \
  || { echo "FAIL: T004 — vitest failed for docs/decisions/ADR-006-plugin-agent-backends.md" >&2; exit 1; }

echo "PASS: T004 — Modify ADR-006-plugin-agent-backends.md"
