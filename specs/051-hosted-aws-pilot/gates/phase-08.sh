#!/usr/bin/env bash
set -euo pipefail
# AUTHORED against the approved production authentication contract.
# Missing tests deny completion before the behavioral commands run.
if [[ ! -f tests/linux-runner/backup-restore-rollback.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: tests/linux-runner/backup-restore-rollback.test.ts' >&2
  exit 1
fi
if [[ ! -f tests/hosted-pilot/rollout-gates.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: tests/hosted-pilot/rollout-gates.test.ts' >&2
  exit 1
fi
if [[ ! -f tests/linux-runner/container-harness.mjs ]]; then
  echo 'FAIL: required behavioral test is missing: tests/linux-runner/container-harness.mjs' >&2
  exit 1
fi
if [[ ! -f src/architecture.test.ts ]]; then
  echo 'FAIL: required behavioral test is missing: src/architecture.test.ts' >&2
  exit 1
fi
pnpm run build
pnpm run lint
pnpm exec vitest run src/architecture.test.ts src/domain/auth-policy.test.ts src/adapters/auth/credential-crypto.test.ts src/adapters/sqlite/auth-store.test.ts src/commands/auth.test.ts src/adapters/auth/google-id-token.test.ts src/application/auth/authenticate-request.test.ts src/server/auth-prehandler.test.ts src/server/auth-session.test.ts src/server/auth-api-keys.test.ts src/server/auth-csrf.test.ts src/server/routes/health.auth.test.ts src/server/auth-route-policy.test.ts src/server/auth-bounds.test.ts src/server/auth-logging.test.ts src/server/github.test.ts src/adapters/auth/http-client-credential.test.ts src/commands/server.auth-startup.test.ts src/server/auth-continuity.test.ts src/commands/init.test.ts tests/linux-runner/preflight-auth.test.ts tests/linux-runner/backup-restore-rollback.test.ts tests/hosted-pilot/rollout-gates.test.ts
node dist/cli.js define adr --reindex --check
node dist/cli.js define adr --check
node tests/hosted-pilot/gateway-production.mjs
node tests/hosted-auth-proof/gateway-proof.mjs
node tests/linux-runner/container-harness.mjs
