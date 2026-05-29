#!/bin/bash
# AUTHORED
set -euo pipefail

# T059: Inject enforcement skills into dispatch context
grep -q "resolveEnforcementSkills" src/utils/agent.ts || {
  echo "FAIL: T059 — agent.ts doesn't call resolveEnforcementSkills" >&2
  exit 1
}

grep -q "code_quality" src/utils/agent.ts || {
  echo "FAIL: T059 — agent.ts missing code_quality section" >&2
  exit 1
}

echo "PASS: T059 — enforcement skills injected into dispatch context"
