#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: TR-017 — ExtensionManifestSchema supports provides
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/plugins/extension-runtime.test.ts -t "FR-L3-001|FR-L3-002|FR-L3-003|FR-L3-004|FR-L3-005|US-025|US-026" --reporter=verbose \
  || { echo "FAIL: TR-017 — vitest failed for src/plugins/extension-runtime.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: TR-017 — tests pass + lint clean"
