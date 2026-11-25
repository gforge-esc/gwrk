#!/usr/bin/env bash
set -euo pipefail
# AUTHORED against the approved production authentication contract.
# Missing tests deny completion before the behavioral commands run.
required_targets=(
  tests/hosted-pilot/gateway-production.mjs
  tests/linux-runner/preflight-auth.test.ts
  tests/hosted-auth-proof/gateway-proof.mjs
  tests/hosted-pilot/tls-preflight.test.ts
  tests/hosted-pilot/gateway-startup.test.ts
  src/utils/agent.auth-env.test.ts
  tests/hosted-auth-proof/preflight.test.ts
  tests/hosted-auth-proof/production-bundle.test.ts
  tests/hosted-pilot/production-bundle.test.ts
  tests/hosted-pilot/native-evidence.test.ts
)
for target in "${required_targets[@]}"; do
  if [[ ! -f "$target" ]]; then
    echo "FAIL: required behavioral test is missing: $target" >&2
    exit 1
  fi
done
vitest_targets=(
  tests/hosted-pilot/tls-preflight.test.ts
  tests/hosted-pilot/gateway-startup.test.ts
  src/utils/agent.auth-env.test.ts
  tests/linux-runner/preflight-auth.test.ts
  tests/hosted-auth-proof/preflight.test.ts
  tests/hosted-auth-proof/production-bundle.test.ts
  tests/hosted-pilot/production-bundle.test.ts
  tests/hosted-pilot/native-evidence.test.ts
)
pnpm run build
pnpm exec vitest run "${vitest_targets[@]}"
node tests/hosted-pilot/gateway-production.mjs
