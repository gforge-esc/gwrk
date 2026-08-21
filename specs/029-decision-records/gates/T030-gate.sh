#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T030 — Modify architecture.md
# Generated from filesystem convention (deterministic vitest gate)

test -f docs/grounding/architecture.md || { echo "FAIL: T030 — file not found: docs/grounding/architecture.md" >&2; exit 1; }

pnpm vitest run docs/grounding/architecture.md --reporter=verbose \
  || { echo "FAIL: T030 — vitest failed for docs/grounding/architecture.md" >&2; exit 1; }

echo "PASS: T030 — Modify architecture.md"
