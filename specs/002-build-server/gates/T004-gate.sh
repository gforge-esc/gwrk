#!/bin/bash
set -euo pipefail
pnpm vitest run src/commands/server-install.test.ts src/server/pid.test.ts src/commands/server.test.ts src/server/routes/health.test.ts --reporter=verbose 2>&1 | tail -5
