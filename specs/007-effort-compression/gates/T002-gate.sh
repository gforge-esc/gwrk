#!/bin/bash
set -euo pipefail
# Gate: T002 — Implement src/engine/spec-parser.ts
# Asserts: Derived from task description

test -f src/engine/spec-parser.ts
test -f specs/007-effort-compression/spec.md

echo "PASS: T002 — Implement src/engine/spec-parser.ts"
