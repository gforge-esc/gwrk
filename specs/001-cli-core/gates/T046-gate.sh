#!/bin/bash
set -euo pipefail
# Gate: T046 — Implement src/commands/tasks.ts (Add Examples)
# Asserts: Help text contains Examples section

gwrk tasks --help | grep -q "Examples:"

echo "PASS: T046 — Examples in tasks help"