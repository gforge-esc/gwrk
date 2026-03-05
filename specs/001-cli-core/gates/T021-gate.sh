#!/bin/bash
set -euo pipefail
# Gate: T021 — Implement src/utils/parser.ts
# Asserts: Derived from task description

test -f src/utils/parser.ts
test -f specs/001-cli-core/plan.md

echo "PASS: T021 — Implement src/utils/parser.ts"
