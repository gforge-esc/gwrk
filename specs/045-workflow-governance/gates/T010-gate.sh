#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T010 — Modify architecture.md
# Generated from filesystem convention (no test file found)

test -f docs/grounding/architecture.md || { echo "FAIL: T010 — file not found: docs/grounding/architecture.md" >&2; exit 1; }

echo "PASS: T010 — Modify architecture.md"
