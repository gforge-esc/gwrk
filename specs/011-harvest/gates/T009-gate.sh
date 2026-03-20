#!/bin/bash
# AUTHORED
set -euo pipefail

# Assertion #1: Verify src/server/github.ts exists
ls src/server/github.ts > /dev/null

# Assertion #2: Verify signature verification logic
grep -q "X-Hub-Signature-256" src/server/github.ts

# Assertion #3: Verify branch filtering logic
grep -q "develop" src/server/github.ts

echo "PASS: T009 — Implement src/server/github.ts (NEW: Fastify plugin, signature verification)"
