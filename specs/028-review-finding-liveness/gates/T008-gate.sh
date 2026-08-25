#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T008 — Modify ADR-007-single-dispatch-path.md
# Asserts the authored Done-When from plan.md Phase 05 (FR-011, W4).
# Hand-repaired: the generated form pointed `vitest run` at the ADR itself, a
# markdown path matching no test include — it could never exit 0.

ADR=docs/decisions/ADR-007-single-dispatch-path.md
TR011=src/engine/ship-orchestrator.review-finding-liveness.test.ts

test -f "$ADR" || { echo "FAIL: T008 — file not found: $ADR" >&2; exit 1; }

npm run build \
  || { echo "FAIL: T008 — npm run build failed" >&2; exit 1; }

npx vitest run "$TR011" \
  || { echo "FAIL: T008 — vitest failed for $TR011" >&2; exit 1; }

grep -q '028 correction' "$ADR" \
  || { echo "FAIL: T008 — '028 correction' block missing from $ADR" >&2; exit 1; }

grep -q 'code-review-verdict-defect.md' "$ADR" \
  || { echo "FAIL: T008 — citation of code-review-verdict-defect.md missing from $ADR" >&2; exit 1; }

grep -q 'one-way' "$ADR" \
  || { echo "FAIL: T008 — one-way gate authority rule missing from $ADR" >&2; exit 1; }

grep -q '026 correction' "$ADR" \
  || { echo "FAIL: T008 — '026 correction' block missing from $ADR (placement anchor)" >&2; exit 1; }

grep -q 'ADR-007 carries the 028 one-way correction' "$TR011" \
  || { echo "FAIL: T008 — TR-011 case missing from $TR011" >&2; exit 1; }

echo "PASS: T008 — Modify ADR-007-single-dispatch-path.md"
