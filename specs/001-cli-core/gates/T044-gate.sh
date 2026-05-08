#!/bin/bash
set -euo pipefail
# Gate: T044 — Implement src/commands/ship.ts (Add Examples)
# Asserts: Help text contains Examples section

gwrk ship --help | grep -q "Examples:"

echo "PASS: T044 — Examples in ship help"