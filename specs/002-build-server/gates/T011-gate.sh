#!/usr/bin/env bash
# Gate: T011 — Implement Context Compiler and sandbox injector
set -euo pipefail

# Assertion #1: src/server/context.ts exists
test -f src/server/context.ts || { echo "FAIL: src/server/context.ts not found"; exit 1; }

# Assertion #2: compileContext exported
grep -q "export.*compileContext" src/server/context.ts || { echo "FAIL: compileContext not exported"; exit 1; }

# Assertion #3: writeContextToSandbox exported
grep -q "export.*writeContextToSandbox" src/server/context.ts || { echo "FAIL: writeContextToSandbox not exported"; exit 1; }

# Assertion #4: compileContext includes rules/spec/plan/tasks
grep -q "rules" src/server/context.ts && grep -q "spec.md" src/server/context.ts && grep -q "plan.md" src/server/context.ts && grep -q "tasks.json" src/server/context.ts || { echo "FAIL: context compilation logic incomplete"; exit 1; }

# Assertion #5: uses docker exec to write context
grep -q "docker exec" src/server/context.ts || { echo "FAIL: writeContextToSandbox does not use docker exec"; exit 1; }

echo "PASS: T011"
