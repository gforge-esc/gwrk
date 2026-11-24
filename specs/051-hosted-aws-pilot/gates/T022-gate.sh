#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T022 — Modify pnpm-lock.yaml
# Generated from filesystem convention (no test file found)

test -f pnpm-lock.yaml || { echo "FAIL: T022 — file not found: pnpm-lock.yaml" >&2; exit 1; }

echo "PASS: T022 — Modify pnpm-lock.yaml"
