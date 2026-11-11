#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T009 — Modify biome.json
# Generated from filesystem convention (no test file found)

test -f biome.json || { echo "FAIL: T009 — file not found: biome.json" >&2; exit 1; }

echo "PASS: T009 — Modify biome.json"
