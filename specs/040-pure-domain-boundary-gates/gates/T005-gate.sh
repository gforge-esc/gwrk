#!/usr/bin/env bash
# AUTHORED
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
pnpm exec vitest run src/domain/agent-config.test.ts src/server/agent-registry.test.ts src/server/agent-registry.integration.test.ts src/utils/resolve-model.test.ts src/utils/resolve-agent.test.ts src/architecture.test.ts
