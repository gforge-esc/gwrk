#!/usr/bin/env bash
# AUTHORED
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
pnpm exec vitest run src/domain/project-id.test.ts src/utils/project-id.test.ts src/db/runs.test.ts src/architecture.test.ts
