#!/bin/bash
set -e

# T057-gate: Verify placeholder in gwrk-implement workflow
# Assertion #1: File exists
ls src/plugins/builtins/workflows/gwrk-implement/PROMPT.md > /dev/null

# Assertion #2: Placeholder exists
grep -q "{{enforcement}}" src/plugins/builtins/workflows/gwrk-implement/PROMPT.md

echo "✓ T057-gate passed"
