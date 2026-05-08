#!/bin/bash
set -euo pipefail
# Gate: T048 — Implement src/commands/db.ts (Add Examples)
# Asserts: Help text contains Examples section

gwrk db --help | grep -q "Examples:"

echo "PASS: T048 — Examples in db help"