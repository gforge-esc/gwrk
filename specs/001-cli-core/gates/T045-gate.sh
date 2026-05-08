#!/bin/bash
set -euo pipefail
# Gate: T045 — Implement src/commands/define.ts (Add Examples)
# Asserts: Help text contains Examples section

gwrk define --help | grep -q "Examples:"

echo "PASS: T045 — Examples in define help"