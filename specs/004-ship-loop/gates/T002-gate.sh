#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002 — Implement src/utils/manifest.ts

FILE="src/utils/manifest.ts"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: digest: z.array(z.string()) exists in ExecutionManifestSchema
grep -q "digest: z.array(z.string())" "$FILE"

# Assertion 3: TC-002 Fail-Fast Config — no .default() on digest
if grep -q "digest: z.array(z.string()).default(\[\])" "$FILE"; then
  echo "FAIL: T002 — digest property has a default value (violates TC-002)"
  exit 1
fi

# Assertion 4: assembleDigest function exists and is exported
grep -q "export function assembleDigest" "$FILE"
grep -q "fs.readFileSync(eventsFilePath, \"utf-8\")" "$FILE"

echo "PASS: T002 — src/utils/manifest.ts implementation verified"
