#!/usr/bin/env bash
# Gate: T019 — Create sandbox Dockerfile
set -euo pipefail

# Assertion #1
test -f Dockerfile.sandbox || { echo "FAIL: Dockerfile.sandbox not found"; exit 1; }

# Verify base image
# Assertion #2
grep -q 'bookworm-slim\|debian' Dockerfile.sandbox || { echo "FAIL: bookworm-slim base not found"; exit 1; }

# Verify Node.js installation
# Assertion #3
grep -qi 'node\|nodejs' Dockerfile.sandbox || { echo "FAIL: Node.js installation not found"; exit 1; }

# Verify Git installation
# Assertion #4
grep -qi 'git' Dockerfile.sandbox || { echo "FAIL: Git installation not found"; exit 1; }

# Verify gh CLI installation
# Assertion #5
grep -qi 'gh\|github-cli' Dockerfile.sandbox || { echo "FAIL: gh CLI installation not found"; exit 1; }

# Verify WORKDIR
# Assertion #6
grep -q 'WORKDIR /workspace' Dockerfile.sandbox || { echo "FAIL: WORKDIR /workspace not set"; exit 1; }

echo "PASS: T019"
