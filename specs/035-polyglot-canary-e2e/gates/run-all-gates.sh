#!/usr/bin/env bash
set -euo pipefail

echo "═══ Running 035-polyglot-canary-e2e gates ═══"
npx vitest run src/polyglot-canary.e2e.test.ts src/engine/test-runner.test.ts
echo "✅ 035-polyglot-canary-e2e gates passed."
