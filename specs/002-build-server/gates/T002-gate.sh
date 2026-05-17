#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/docker.ts || { echo "FAIL: T002 — file not found: src/server/docker.ts" >&2; exit 1; }
grep -q 'export async function ensureDocker' src/server/docker.ts || { echo "FAIL: T002 — src/server/docker.ts missing 'ensureDocker'" >&2; exit 1; }
echo "PASS: T002 — Implement src/server/docker.ts"
