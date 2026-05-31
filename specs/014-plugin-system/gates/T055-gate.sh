#!/bin/bash
set -e

# T055-gate: Verify EnforcementSkillManifestSchema in src/plugins/manifest.ts
# Assertion #1: EnforcementSkillManifestSchema exists
grep -q "export const EnforcementSkillManifestSchema" src/plugins/manifest.ts

# Assertion #2: tier: enforcement is validated
grep -q "tier: z.literal(\"enforcement\")" src/plugins/manifest.ts

# Assertion #3: scope field exists
grep -q "scope: z.enum(\[\"implementation\", \"review\", \"all\"\])" src/plugins/manifest.ts

echo "✓ T055-gate passed"
