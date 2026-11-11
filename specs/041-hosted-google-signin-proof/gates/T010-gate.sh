#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T010 — Create README.md
# Generated from filesystem convention (no test file found)

test -f README.md || { echo "FAIL: T010 — file not found: README.md" >&2; exit 1; }

echo "PASS: T010 — Create README.md"
