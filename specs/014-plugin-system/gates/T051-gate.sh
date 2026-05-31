#!/bin/bash
set -e

# T051-gate: Verify gwrk-conventions manifest.yaml
# Assertion #1: File exists
ls src/plugins/builtins/skills/gwrk-conventions/manifest.yaml > /dev/null

# Assertion #2: tier is enforcement
grep -q "tier: enforcement" src/plugins/builtins/skills/gwrk-conventions/manifest.yaml

# Assertion #3: type is skill
grep -q "type: skill" src/plugins/builtins/skills/gwrk-conventions/manifest.yaml

# Assertion #4: scope is implementation
grep -q "scope: implementation" src/plugins/builtins/skills/gwrk-conventions/manifest.yaml

echo "✓ T051-gate passed"
