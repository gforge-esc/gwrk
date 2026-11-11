#!/usr/bin/env bash
# AUTHORED
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
pnpm exec vitest run src/adapters/cli/output-scope.test.ts src/utils/output.test.ts src/utils/signal.test.ts src/utils/agent-layer.test.ts src/commands/skill.test.ts src/cli.test.ts src/cli.consistency.test.ts src/cli.option-collisions.test.ts src/cli.ux.test.ts src/commands/gate.test.ts src/architecture.test.ts
