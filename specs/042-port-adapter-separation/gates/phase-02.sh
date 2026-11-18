#!/usr/bin/env bash
# AUTHORED
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
pnpm exec vitest run src/architecture.test.ts src/engine/issues.test.ts src/engine/harvest.test.ts src/cli.test.ts src/db/db.test.ts
