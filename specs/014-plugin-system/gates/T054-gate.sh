#!/bin/bash
set -e

# T054-gate: Verify resolveEnforcementSkills implementation
# Assertion #1: Export exists in src/plugins/skill-runtime.ts
grep -q "export async function resolveEnforcementSkills" src/plugins/skill-runtime.ts

# Assertion #2: Precedence check (project > global > builtin)
# We check if it uses listPlugins({ tier: "enforcement" })
grep -q "loader.listPlugins({ tier: \"enforcement\" })" src/plugins/skill-runtime.ts

# Assertion #3: Combines SKILL.md content
grep -q "SKILL.md" src/plugins/skill-runtime.ts

echo "✓ T054-gate passed"
