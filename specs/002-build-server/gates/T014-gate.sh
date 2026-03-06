#!/usr/bin/env bash
# Gate: T014 — Implement Docker sandbox manager
set -euo pipefail

# Assertion #1: src/server/sandbox.ts exists
test -f src/server/sandbox.ts || { echo "FAIL: src/server/sandbox.ts not found"; exit 1; }

# Assertion #2: createSandbox exported
grep -q "export.*createSandbox" src/server/sandbox.ts || { echo "FAIL: createSandbox not exported"; exit 1; }

# Assertion #3: destroySandbox exported
grep -q "export.*destroySandbox" src/server/sandbox.ts || { echo "FAIL: destroySandbox not exported"; exit 1; }

# Assertion #4: destroyAllSandboxes exported
grep -q "export.*destroyAllSandboxes" src/server/sandbox.ts || { echo "FAIL: destroyAllSandboxes not exported"; exit 1; }

# Assertion #5: listSandboxes exported
grep -q "export.*listSandboxes" src/server/sandbox.ts || { echo "FAIL: listSandboxes not exported"; exit 1; }

# Assertion #6: uses dockerode
grep -q "import.*Docker.*from 'dockerode'" src/server/sandbox.ts || { echo "FAIL: dockerode import missing"; exit 1; }

# Assertion #7: applies gwrk labels
grep -q "gwrk.feature" src/server/sandbox.ts && grep -q "gwrk.phase" src/server/sandbox.ts || { echo "FAIL: gwrk labels not applied to containers"; exit 1; }

echo "PASS: T014"
