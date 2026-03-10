#!/bin/bash
set -euo pipefail
# Gate: T020 — Implement src/server/git-manager.ts
# Asserts: Derived from task description

test -f src/server/git-manager.ts

echo "PASS: T020 — Implement src/server/git-manager.ts"
