#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/git-manager.ts || { echo "FAIL: T005 — file not found: src/server/git-manager.ts" >&2; exit 1; }
grep -q 'export class GitManager' src/server/git-manager.ts || { echo "FAIL: T005 — src/server/git-manager.ts missing 'GitManager'" >&2; exit 1; }
echo "PASS: T005 — Implement src/server/git-manager.ts"
