#!/usr/bin/env bash
set -euo pipefail
# AUTHORED against the approved production authentication contract.
# Missing tests deny completion before the behavioral commands run.
required_targets=(
  src/adapters/auth/http-client-credential.test.ts
  src/commands/server.auth-startup.test.ts
  src/server/auth-continuity.test.ts
  src/commands/init.auth-purity.test.ts
  src/utils/config.auth.test.ts
  src/utils/config.test.ts
  src/domain/hosted-auth-config.test.ts
  src/adapters/auth/protected-hosted-auth-files.test.ts
  src/adapters/auth/hosted-auth-factory.test.ts
  src/commands/status.auth.test.ts
  src/commands/init.test.ts
  src/commands/server.test.ts
  src/commands/status.test.ts
  src/architecture.test.ts
)
for target in "${required_targets[@]}"; do
  if [[ ! -f "$target" ]]; then
    echo "FAIL: required behavioral test is missing: $target" >&2
    exit 1
  fi
done
vitest_targets=(
  src/utils/config.auth.test.ts
  src/utils/config.test.ts
  src/domain/hosted-auth-config.test.ts
  src/adapters/auth/protected-hosted-auth-files.test.ts
  src/adapters/auth/hosted-auth-factory.test.ts
  src/commands/status.auth.test.ts
  src/commands/init.auth-purity.test.ts
  src/adapters/auth/http-client-credential.test.ts
  src/commands/server.auth-startup.test.ts
  src/server/auth-continuity.test.ts
  src/commands/init.test.ts
  src/commands/server.test.ts
  src/commands/status.test.ts
  src/architecture.test.ts
)
pnpm run build
pnpm exec vitest run "${vitest_targets[@]}"
