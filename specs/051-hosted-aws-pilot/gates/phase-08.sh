#!/usr/bin/env bash
set -euo pipefail
# AUTHORED against the approved production authentication contract.
# Missing tests deny completion before the behavioral commands run.
required_targets=(
  tests/linux-runner/backup-restore-rollback.test.ts
  tests/hosted-pilot/rollout-gates.test.ts
  tests/linux-runner/container-harness.mjs
  src/architecture.test.ts
  src/utils/config.auth.test.ts
  src/utils/config.test.ts
  src/domain/hosted-auth-config.test.ts
  src/adapters/auth/protected-hosted-auth-files.test.ts
  src/adapters/auth/hosted-auth-factory.test.ts
  src/commands/status.auth.test.ts
  src/commands/init.auth-purity.test.ts
  tests/hosted-pilot/tls-preflight.test.ts
  tests/hosted-pilot/gateway-startup.test.ts
  src/adapters/auth/browser-csrf.test.ts
  src/adapters/auth/proxy-logout.test.ts
  src/server/auth-guard.account-denial.test.ts
  src/utils/agent.auth-env.test.ts
  src/domain/auth-policy.test.ts
  src/adapters/auth/credential-crypto.test.ts
  src/adapters/sqlite/auth-store.test.ts
  src/commands/auth.test.ts
  src/adapters/auth/google-id-token.test.ts
  src/application/auth/authenticate-request.test.ts
  src/server/auth-prehandler.test.ts
  src/server/auth-session.test.ts
  src/server/auth-api-keys.test.ts
  src/server/auth-csrf.test.ts
  src/server/routes/health.auth.test.ts
  src/server/auth-route-policy.test.ts
  src/domain/auth-rate-policy.test.ts
  src/adapters/auth/rate-admission.test.ts
  src/server/auth-bounds.test.ts
  src/server/auth-logging.test.ts
  src/server/github.test.ts
  src/adapters/auth/http-client-credential.test.ts
  src/commands/server.auth-startup.test.ts
  src/server/auth-continuity.test.ts
  src/commands/init.test.ts
  tests/linux-runner/preflight-auth.test.ts
  tests/hosted-pilot/gate-completeness.test.mjs
  tests/hosted-pilot/gateway-production.mjs
  tests/hosted-auth-proof/gateway-proof.mjs
  tests/hosted-pilot/production-bundle.test.ts
  tests/hosted-pilot/native-evidence.test.ts
  tests/hosted-pilot/protected-auth-files-native.mjs
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
  tests/hosted-pilot/tls-preflight.test.ts
  tests/hosted-pilot/gateway-startup.test.ts
  src/adapters/auth/browser-csrf.test.ts
  src/adapters/auth/proxy-logout.test.ts
  src/server/auth-guard.account-denial.test.ts
  src/utils/agent.auth-env.test.ts
  src/architecture.test.ts
  src/domain/auth-policy.test.ts
  src/adapters/auth/credential-crypto.test.ts
  src/adapters/sqlite/auth-store.test.ts
  src/commands/auth.test.ts
  src/adapters/auth/google-id-token.test.ts
  src/application/auth/authenticate-request.test.ts
  src/server/auth-prehandler.test.ts
  src/server/auth-session.test.ts
  src/server/auth-api-keys.test.ts
  src/server/auth-csrf.test.ts
  src/server/routes/health.auth.test.ts
  src/server/auth-route-policy.test.ts
  src/domain/auth-rate-policy.test.ts
  src/adapters/auth/rate-admission.test.ts
  src/server/auth-bounds.test.ts
  src/server/auth-logging.test.ts
  src/server/github.test.ts
  src/adapters/auth/http-client-credential.test.ts
  src/commands/server.auth-startup.test.ts
  src/server/auth-continuity.test.ts
  src/commands/init.test.ts
  tests/linux-runner/preflight-auth.test.ts
  tests/linux-runner/backup-restore-rollback.test.ts
  tests/hosted-pilot/rollout-gates.test.ts
  tests/hosted-pilot/production-bundle.test.ts
  tests/hosted-pilot/native-evidence.test.ts
)
node tests/hosted-pilot/gate-completeness.test.mjs
pnpm run build
pnpm run lint
pnpm exec vitest run "${vitest_targets[@]}"
node dist/cli.js define adr --reindex --check
node dist/cli.js define adr --check
node tests/hosted-pilot/gateway-production.mjs
node tests/hosted-pilot/protected-auth-files-native.mjs
node tests/linux-runner/container-harness.mjs
