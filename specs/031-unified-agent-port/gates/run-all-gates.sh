#!/usr/bin/env bash
set -euo pipefail
pnpm vitest run src/plugins/builtins/agents/ src/engine/router.test.ts src/utils/agent.test.ts
