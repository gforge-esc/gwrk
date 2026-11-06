#!/usr/bin/env bash
set -euo pipefail
pnpm vitest run src/utils/test-discovery.test.ts src/engine/test-runner.test.ts src/utils/gate-gen.test.ts src/utils/toolchain-mapper.test.ts
