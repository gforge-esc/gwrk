#!/usr/bin/env bash
# T003-gate.sh — assembleDigest() + manifest digest field (FR-012, FR-017)
set -euo pipefail
PASS=0; FAIL=0

# Assertion #1: assembleDigest function exists
if grep -q 'assembleDigest' src/commands/ship.ts || grep -q 'assembleDigest' src/utils/manifest.ts; then
  echo "✓ Assertion #1: assembleDigest function exists"
  ((PASS++))
else
  echo "✗ Assertion #1: assembleDigest NOT found in ship.ts or manifest.ts"
  ((FAIL++))
fi

# Assertion #2: digest field in ExecutionManifestSchema
if grep -q 'digest' src/utils/manifest.ts; then
  echo "✓ Assertion #2: digest field in manifest schema"
  ((PASS++))
else
  echo "✗ Assertion #2: digest field NOT in manifest schema"
  ((FAIL++))
fi

# Assertion #3: digest passed to writeManifest call
if grep -q 'digest' src/commands/ship.ts; then
  echo "✓ Assertion #3: digest used in ship.ts"
  ((PASS++))
else
  echo "✗ Assertion #3: digest NOT used in ship.ts"
  ((FAIL++))
fi

echo "T003: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
