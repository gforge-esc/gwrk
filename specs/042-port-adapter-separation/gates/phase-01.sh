#!/usr/bin/env bash
# AUTHORED
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
pnpm exec vitest run src/utils/toolchain-mapper.test.ts src/utils/test-discovery.test.ts src/utils/gate-gen.test.ts src/commands/test-cmd.test.ts src/cli.test.ts src/db/db.test.ts
