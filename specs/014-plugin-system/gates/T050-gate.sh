#!/bin/bash
set -e

# T050-gate: Verify gwrk-conventions SKILL.md
# Assertion #1: File exists
ls src/plugins/builtins/skills/gwrk-conventions/SKILL.md > /dev/null

# Assertion #2: Contains valid task statuses
grep -q "open" src/plugins/builtins/skills/gwrk-conventions/SKILL.md
grep -q "in_progress" src/plugins/builtins/skills/gwrk-conventions/SKILL.md
grep -q "completed" src/plugins/builtins/skills/gwrk-conventions/SKILL.md
grep -q "cancelled" src/plugins/builtins/skills/gwrk-conventions/SKILL.md

# Assertion #3: Mentions .agents/ is legacy
grep -q ".agents/" src/plugins/builtins/skills/gwrk-conventions/SKILL.md
grep -q "legacy" src/plugins/builtins/skills/gwrk-conventions/SKILL.md

echo "✓ T050-gate passed"
