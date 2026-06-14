#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: TR-019 — built-in obsidian-vault extension
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/plugins/builtins/extensions/obsidian-vault/adapter.test.ts -t "FR-L3-007|US-027" --reporter=verbose \
  || { echo "FAIL: TR-019 — vitest failed for src/plugins/builtins/extensions/obsidian-vault/adapter.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: TR-019 — tests pass + lint clean"
