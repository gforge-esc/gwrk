#!/bin/bash
set -e

# T052-gate: Verify typescript-standards SKILL.md
# Assertion #1: File exists
ls src/plugins/builtins/skills/typescript-standards/SKILL.md > /dev/null

# Assertion #2: Mentions strict typing / no any
grep -i -q "any" src/plugins/builtins/skills/typescript-standards/SKILL.md

# Assertion #3: Mentions no .js/.jsx in src/
grep -q ".js" src/plugins/builtins/skills/typescript-standards/SKILL.md
grep -q "src/" src/plugins/builtins/skills/typescript-standards/SKILL.md

echo "✓ T052-gate passed"
