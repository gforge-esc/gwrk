#!/bin/bash
# AUTHORED
set -euo pipefail

# T055: Create gwrk-conventions enforcement skill builtin
SKILL_DIR="src/plugins/builtins/skills/gwrk-conventions"

test -f "$SKILL_DIR/manifest.yaml" || { echo "FAIL: T055 — manifest.yaml missing" >&2; exit 1; }
test -f "$SKILL_DIR/SKILL.md" || { echo "FAIL: T055 — SKILL.md missing" >&2; exit 1; }

grep -q "tier: enforcement" "$SKILL_DIR/manifest.yaml" || { echo "FAIL: T055 — manifest missing tier: enforcement" >&2; exit 1; }
grep -q "scope: implementation" "$SKILL_DIR/manifest.yaml" || { echo "FAIL: T055 — manifest missing scope: implementation" >&2; exit 1; }

grep -q "open" "$SKILL_DIR/SKILL.md" || { echo "FAIL: T055 — SKILL.md missing 'open' status" >&2; exit 1; }
grep -q "in_progress" "$SKILL_DIR/SKILL.md" || { echo "FAIL: T055 — SKILL.md missing 'in_progress' status" >&2; exit 1; }
grep -q "completed" "$SKILL_DIR/SKILL.md" || { echo "FAIL: T055 — SKILL.md missing 'completed' status" >&2; exit 1; }
grep -q "cancelled" "$SKILL_DIR/SKILL.md" || { echo "FAIL: T055 — SKILL.md missing 'cancelled' status" >&2; exit 1; }

echo "PASS: T055 — gwrk-conventions builtin exists with enforcement tier and status enum"