#!/usr/bin/env bash
# Gate: T013 — Create gwrk-sandbox Dockerfile
set -euo pipefail

# Assertion #1: Dockerfile.sandbox exists
test -f Dockerfile.sandbox || { echo "FAIL: Dockerfile.sandbox not found"; exit 1; }

# Assertion #2: bookworm-slim base
grep -q "bookworm-slim" Dockerfile.sandbox || { echo "FAIL: Dockerfile.sandbox base image not bookworm-slim"; exit 1; }

# Assertion #3: Node.js LTS installed
grep -q "node" Dockerfile.sandbox || { echo "FAIL: node installation missing in Dockerfile.sandbox"; exit 1; }

# Assertion #4: git installed
grep -q "git" Dockerfile.sandbox || { echo "FAIL: git installation missing in Dockerfile.sandbox"; exit 1; }

# Assertion #5: gh CLI installed
grep -q "gh" Dockerfile.sandbox || { echo "FAIL: gh CLI installation missing in Dockerfile.sandbox"; exit 1; }

# Assertion #6: WORKDIR set to /workspace
grep -q "WORKDIR /workspace" Dockerfile.sandbox || { echo "FAIL: WORKDIR not set to /workspace"; exit 1; }

echo "PASS: T013"
