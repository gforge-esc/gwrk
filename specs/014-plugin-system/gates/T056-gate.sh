#!/bin/bash
set -e

# T056-gate: Verify resolveEnforcementSkills call in src/utils/agent.ts
# Assertion #1: Import exists
grep -q "import { resolveEnforcementSkills } from \"../plugins/skill-runtime.js\"" src/utils/agent.ts

# Assertion #2: Call exists in dispatchToAgent
grep -q "await resolveEnforcementSkills(" src/utils/agent.ts

# Assertion #3: Injection into dispatch.stdin
grep -q "dispatch.stdin.replace(\"{{enforcement}}\", enforcement)" src/utils/agent.ts

echo "✓ T056-gate passed"
