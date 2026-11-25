#!/usr/bin/env bash
set -euo pipefail
# AUTHORED against the approved production authentication contract.
# Missing tests deny completion before the behavioral commands run.
required_targets=(
  src/adapters/sqlite/auth-store.test.ts
  src/commands/auth.test.ts
  src/adapters/auth/credential-crypto.test.ts
  src/db/db.test.ts
  src/architecture.test.ts
)
for target in "${required_targets[@]}"; do
  if [[ ! -f "$target" ]]; then
    echo "FAIL: required behavioral test is missing: $target" >&2
    exit 1
  fi
done
vitest_targets=(
  src/adapters/auth/credential-crypto.test.ts
  src/adapters/sqlite/auth-store.test.ts
  src/commands/auth.test.ts
  src/db/db.test.ts
  src/architecture.test.ts
)
pnpm run build
pnpm exec vitest run "${vitest_targets[@]}"
