#!/usr/bin/env bash
set -euo pipefail
# AUTHORED against the approved production authentication contract.
# Missing tests deny completion before the behavioral commands run.
required_targets=(
  src/server/auth-csrf.test.ts
  src/server/routes/health.auth.test.ts
  src/server/github.test.ts
  src/server/auth-bounds.test.ts
  src/server/auth-logging.test.ts
  src/server/auth-route-policy.test.ts
  src/architecture.test.ts
)
for target in "${required_targets[@]}"; do
  if [[ ! -f "$target" ]]; then
    echo "FAIL: required behavioral test is missing: $target" >&2
    exit 1
  fi
done
vitest_targets=(
  src/server/auth-csrf.test.ts
  src/server/routes/health.auth.test.ts
  src/server/auth-route-policy.test.ts
  src/server/auth-bounds.test.ts
  src/server/auth-logging.test.ts
  src/server/github.test.ts
  src/architecture.test.ts
)
pnpm run build
pnpm exec vitest run "${vitest_targets[@]}"
