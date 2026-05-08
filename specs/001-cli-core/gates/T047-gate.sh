#!/bin/bash
set -euo pipefail
# Gate: T047 — Implement src/commands/measure.ts (Add Examples)
# Asserts: Help text contains Examples section

gwrk measure --help | grep -q "Examples:"

echo "PASS: T047 — Examples in measure help"