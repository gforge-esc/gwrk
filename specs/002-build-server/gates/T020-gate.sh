#!/usr/bin/env bash
# Gate: T020 — Create Docker sandbox manager
# Contract: src/server/sandbox.ts must export createSandbox, destroySandbox, destroyAllSandboxes, listSandboxes
set -euo pipefail

FILE="src/server/sandbox.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'export.*function createSandbox\|export async function createSandbox' "$FILE" || { echo "FAIL: createSandbox not exported"; exit 1; }
# Assertion #3
grep -q 'export.*function destroySandbox\|export async function destroySandbox' "$FILE" || { echo "FAIL: destroySandbox not exported"; exit 1; }
# Assertion #4
grep -q 'export.*function destroyAllSandboxes\|export async function destroyAllSandboxes' "$FILE" || { echo "FAIL: destroyAllSandboxes not exported"; exit 1; }
# Assertion #5
grep -q 'export.*function listSandboxes\|export async function listSandboxes' "$FILE" || { echo "FAIL: listSandboxes not exported"; exit 1; }

# Verify Docker label convention
# Assertion #6
grep -q 'gwrk\.feature\|gwrk.feature' "$FILE" || { echo "FAIL: gwrk.feature label not referenced"; exit 1; }
# Assertion #7
grep -q 'gwrk\.phase\|gwrk.phase' "$FILE" || { echo "FAIL: gwrk.phase label not referenced"; exit 1; }

# Verify dockerode usage
# Assertion #8
grep -q 'dockerode\|Docker\|Dockerode' "$FILE" || { echo "FAIL: dockerode not imported"; exit 1; }

echo "PASS: T020"
