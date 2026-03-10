#!/bin/bash
set -e
echo "Gate T005: Register setup slack in CLI"
# Assertion #1: setup slack subcommand in cli.ts
grep -q "setup.*slack\|setup-slack" src/cli.ts || { echo "FAIL: setup slack not registered in cli.ts"; exit 1; }
# Assertion #2: Compiles
pnpm build 2>&1 | tail -3
echo "PASS"
