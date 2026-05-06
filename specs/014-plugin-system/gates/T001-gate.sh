#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/manifest.ts
grep -q 'SkillManifestSchema' src/plugins/manifest.ts
grep -q 'AgentManifestSchema' src/plugins/manifest.ts
grep -q 'WorkflowManifestSchema' src/plugins/manifest.ts
grep -q 'AnyManifestSchema' src/plugins/manifest.ts

echo "PASS: T001 — Implement src/plugins/manifest.ts"
