#!/bin/bash
set -euo pipefail
# Gate: T003 — Implement src/utils/config.ts
# Asserts: Derived from task description

test -f src/utils/config.ts

echo "PASS: T003 — Implement src/utils/config.ts"
