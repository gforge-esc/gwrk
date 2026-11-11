#!/usr/bin/env bash
# AUTHORED
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
pnpm exec vitest run src/domain/toolchain.test.ts src/utils/toolchain-mapper.test.ts src/architecture.test.ts src/application/architecture/context.test.ts
