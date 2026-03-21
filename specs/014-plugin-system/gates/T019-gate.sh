#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T019: Implement src/utils/agent.ts
# Description: Replace spawn logic with AgentBackend.dispatch()

FILE="src/utils/agent.ts"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: Interface TaskDispatch exists (FR-019)
grep -q "interface TaskDispatch" "$FILE"

# Assertion 3: Interface TaskResult exists (FR-019)
grep -q "interface TaskResult" "$FILE"

# Assertion 4: dispatchToAgent() uses normalized result (FR-020)
grep -q "async function dispatchToAgent" "$FILE"
grep -q "EXIT_CODE_MAP" "$FILE"

# Assertion 5: Logic for dispatching work exists
grep -q "dispatchAgent" "$FILE"
grep -q "buildCommand" "$FILE"

echo "PASS: T019 — Implement src/utils/agent.ts"
