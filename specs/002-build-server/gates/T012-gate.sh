#!/usr/bin/env bash
# Gate: T012 — Setup Docker dependencies and ignore patterns
set -euo pipefail

# Assertion #1: dockerode in package.json
grep -q '"dockerode":' package.json || { echo "FAIL: dockerode dependency missing"; exit 1; }

# Assertion #2: @types/dockerode in package.json
grep -q '"@types/dockerode":' package.json || { echo "FAIL: @types/dockerode dependency missing"; exit 1; }

# Assertion #3: .dockerignore exists
test -f .dockerignore || { echo "FAIL: .dockerignore not found"; exit 1; }

# Assertion #4: .dockerignore contains node_modules
grep -q "node_modules" .dockerignore || { echo "FAIL: node_modules not in .dockerignore"; exit 1; }

# Assertion #5: .dockerignore contains .git
grep -q ".git" .dockerignore || { echo "FAIL: .git not in .dockerignore"; exit 1; }

echo "PASS: T012"
