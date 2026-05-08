#!/bin/bash
set -euo pipefail
# Gate: T049 — Implement src/commands/test.ts (Add Examples)
# Asserts: Help text contains Examples section

# Note: test command might be registered under define or top-level depending on Phase 11 specifics
gwrk test --help | grep -q "Examples:" || gwrk define test --help | grep -q "Examples:"

echo "PASS: T049 — Examples in test help"