#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/loader.ts
grep -q 'getPlugin' src/plugins/loader.ts
grep -q 'listPlugins' src/plugins/loader.ts
grep -q 'scanPlugins' src/plugins/loader.ts

echo "PASS: T002 — Implement src/plugins/loader.ts"
