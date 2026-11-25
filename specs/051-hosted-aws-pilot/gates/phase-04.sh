#!/usr/bin/env bash
set -euo pipefail
# AUTHORED against the approved production authentication contract.
# Missing tests deny completion before the behavioral commands run.
required_targets=(
  src/server/auth-prehandler.test.ts
  src/server/auth-session.test.ts
  src/server/auth-api-keys.test.ts
  src/adapters/auth/browser-csrf.test.ts
  src/server/auth-guard.account-denial.test.ts
  src/server/routes/status.test.ts
  src/server/routes/dispatch.test.ts
  src/server/routes/notify.test.ts
  src/server/routes/health.test.ts
  src/architecture.test.ts
)
for target in "${required_targets[@]}"; do
  if [[ ! -f "$target" ]]; then
    echo "FAIL: required behavioral test is missing: $target" >&2
    exit 1
  fi
done
vitest_targets=(
  src/adapters/auth/browser-csrf.test.ts
  src/server/auth-guard.account-denial.test.ts
  src/server/auth-prehandler.test.ts
  src/server/auth-session.test.ts
  src/server/auth-api-keys.test.ts
  src/server/routes/status.test.ts
  src/server/routes/dispatch.test.ts
  src/server/routes/notify.test.ts
  src/server/routes/health.test.ts
  src/architecture.test.ts
)
pnpm run build
pnpm exec vitest run "${vitest_targets[@]}"
