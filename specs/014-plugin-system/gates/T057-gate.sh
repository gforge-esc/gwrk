#!/bin/bash
# AUTHORED
set -euo pipefail

# T057: Add tier: enforcement to SkillManifestSchema
OUTPUT=$(pnpm vitest run src/plugins/enforcement.p9.red.test.ts -t "TR-P9-003" --reporter=verbose 2>&1) || true

if echo "$OUTPUT" | grep -q "passed"; then
  echo "PASS: T057 — SkillManifestSchema accepts tier: enforcement"
  exit 0
else
  echo "FAIL: T057 — TR-P9-003 enforcement tier schema test not passing" >&2
  echo "$OUTPUT" | tail -10 >&2
  exit 1
fi