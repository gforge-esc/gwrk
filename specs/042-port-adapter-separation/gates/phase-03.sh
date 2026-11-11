#!/usr/bin/env bash
# AUTHORED
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
pnpm exec vitest run src/adapters/sqlite/store-isolation.test.ts src/db/db.test.ts src/db/compression.test.ts src/db/plan.test.ts src/db/scoping.test.ts src/engine/plan-store.test.ts src/engine/plan-store-scoping.test.ts src/architecture.test.ts
