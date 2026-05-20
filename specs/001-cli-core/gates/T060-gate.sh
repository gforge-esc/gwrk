#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/plugins/workflow-runtime.ts" || { echo "FAIL: T060 — file not found: src/plugins/workflow-runtime.ts" >&2; exit 1; }
grep -q "extractJsonFromOutput" "src/plugins/workflow-runtime.ts" || { echo "FAIL: T060 — src/plugins/workflow-runtime.ts missing 'extractJsonFromOutput'" >&2; exit 1; }

echo "PASS: T060 — Implement src/plugins/workflow-runtime.ts"
