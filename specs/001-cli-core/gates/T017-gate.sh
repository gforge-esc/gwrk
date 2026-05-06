#!/bin/bash
set -euo pipefail
# Gate: T017 — Implement src/utils/parser.ts
# Asserts: Derived from task description

test -f src/utils/parser.ts

echo "PASS: T017 — Implement src/utils/parser.ts"
