#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
grep -q 'digest' src/utils/manifest.ts || { echo "FAIL: digest not in manifest.ts"; exit 1; }
grep -qE 'assembleDigest|assemble_digest' src/utils/manifest.ts || { echo "FAIL: assembleDigest not in manifest.ts"; exit 1; }
echo "PASS: T002 — digest assembly in manifest.ts"
