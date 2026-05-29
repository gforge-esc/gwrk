#!/bin/bash
# AUTHORED
set -euo pipefail

# T058: Implement resolveEnforcementSkills() in skill-runtime.ts
grep -q "resolveEnforcementSkills" src/plugins/skill-runtime.ts || {
  echo "FAIL: T058 — resolveEnforcementSkills not found in skill-runtime.ts" >&2
  exit 1
}

grep -q "export.*resolveEnforcementSkills" src/plugins/skill-runtime.ts || {
  echo "FAIL: T058 — resolveEnforcementSkills not exported" >&2
  exit 1
}

pnpm vitest run src/plugins/enforcement.p9.red.test.ts -t "TR-P9-001" --reporter=verbose 2>&1 | grep -q "pass" || {
  echo "FAIL: T058 — TR-P9-001 resolveEnforcementSkills test not passing" >&2
  exit 1
}

echo "PASS: T058 — resolveEnforcementSkills() implemented and tested"
