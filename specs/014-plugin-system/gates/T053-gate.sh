#!/bin/bash
set -e

# T053-gate: Verify typescript-standards manifest.yaml
# Assertion #1: File exists
ls src/plugins/builtins/skills/typescript-standards/manifest.yaml > /dev/null

# Assertion #2: tier is enforcement
grep -q "tier: enforcement" src/plugins/builtins/skills/typescript-standards/manifest.yaml

# Assertion #3: scope is implementation
grep -q "scope: implementation" src/plugins/builtins/skills/typescript-standards/manifest.yaml

echo "✓ T053-gate passed"
