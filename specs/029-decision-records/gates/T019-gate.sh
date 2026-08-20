#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T019 — Modify ADR-008-command-safety-posture.md
# Generated from filesystem convention (deterministic vitest gate)

test -f docs/decisions/ADR-008-command-safety-posture.md || { echo "FAIL: T019 — file not found: docs/decisions/ADR-008-command-safety-posture.md" >&2; exit 1; }

pnpm vitest run docs/decisions/ADR-008-command-safety-posture.md --reporter=verbose \
  || { echo "FAIL: T019 — vitest failed for docs/decisions/ADR-008-command-safety-posture.md" >&2; exit 1; }

echo "PASS: T019 — Modify ADR-008-command-safety-posture.md"
