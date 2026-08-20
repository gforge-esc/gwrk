#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T015 — Modify ADR-004-agent-native-output.md
# Generated from filesystem convention (deterministic vitest gate)

test -f docs/decisions/ADR-004-agent-native-output.md || { echo "FAIL: T015 — file not found: docs/decisions/ADR-004-agent-native-output.md" >&2; exit 1; }

pnpm vitest run docs/decisions/ADR-004-agent-native-output.md --reporter=verbose \
  || { echo "FAIL: T015 — vitest failed for docs/decisions/ADR-004-agent-native-output.md" >&2; exit 1; }

echo "PASS: T015 — Modify ADR-004-agent-native-output.md"
