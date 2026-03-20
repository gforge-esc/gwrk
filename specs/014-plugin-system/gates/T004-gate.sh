#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/utils/config.ts
# Checking for plugin path support
grep -q 'plugins' src/utils/config.ts

echo "PASS: T004 — Implement src/utils/config.ts"
