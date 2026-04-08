#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/seed.ts \
  || { echo "FAIL: T035 — file not found: src/plugins/seed.ts" >&2; exit 1; }
grep -q 'export async function seedSkills' src/plugins/seed.ts \
  || { echo "FAIL: T035 — src/plugins/seed.ts missing 'export async function seedSkills'" >&2; exit 1; }

echo "PASS: T035 — Implement src/plugins/seed.ts"
