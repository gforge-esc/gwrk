#!/bin/bash
set -euo pipefail
# Gate: T007 — Implement src/engine/spec-parser.test.ts
# Asserts: Derived from task description

test -f src/engine/spec-parser.test.ts

echo "PASS: T007 — Implement src/engine/spec-parser.test.ts"
