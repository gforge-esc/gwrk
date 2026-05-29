#!/bin/bash
# AUTHORED
set -euo pipefail

# T057: Add tier: enforcement to SkillManifestSchema
pnpm vitest run src/plugins/enforcement.p9.red.test.ts -t "TR-P9-003" --reporter=verbose 2>&1 | grep -q "pass" || {
  echo "FAIL: T057 — TR-P9-003 enforcement tier schema test not passing" >&2
  exit 1
}

echo "PASS: T057 — SkillManifestSchema accepts tier: enforcement"