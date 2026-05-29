#!/bin/bash
# AUTHORED
set -euo pipefail

# T056: Create typescript-standards enforcement skill builtin
SKILL_DIR="src/plugins/builtins/skills/typescript-standards"

test -f "$SKILL_DIR/manifest.yaml" || { echo "FAIL: T056 — manifest.yaml missing" >&2; exit 1; }
test -f "$SKILL_DIR/SKILL.md" || { echo "FAIL: T056 — SKILL.md missing" >&2; exit 1; }

grep -q "tier: enforcement" "$SKILL_DIR/manifest.yaml" || { echo "FAIL: T056 — manifest missing tier: enforcement" >&2; exit 1; }
grep -q "scope: implementation" "$SKILL_DIR/manifest.yaml" || { echo "FAIL: T056 — manifest missing scope: implementation" >&2; exit 1; }

grep -qi "strict\|typing\|typescript" "$SKILL_DIR/SKILL.md" || { echo "FAIL: T056 — SKILL.md missing TypeScript content" >&2; exit 1; }

echo "PASS: T056 — typescript-standards builtin exists with enforcement tier"