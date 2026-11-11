#!/usr/bin/env bash
# AUTHORED
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
pnpm exec vitest run tests/hosted-auth-proof/production-bundle.test.ts tests/hosted-auth-proof/preflight.test.ts
