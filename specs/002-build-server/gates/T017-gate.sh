#!/bin/bash
set -euo pipefail
# Gate: T017 — Implement src/server/git-manager.test.ts
# Asserts: Derived from task description

test -f src/server/git-manager.test.ts

echo "PASS: T017 — Implement src/server/git-manager.test.ts"
