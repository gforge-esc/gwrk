#!/bin/bash
# AUTHORED
set -euo pipefail

# Assertion #1: Verify src/db/compression.ts exists
ls src/db/compression.ts > /dev/null

# Assertion #2: Verify presence of compression record handling
grep -q "recordCompression" src/db/compression.ts

echo "PASS: T003 — Implement src/db/compression.ts (NEW)"
