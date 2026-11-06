#!/usr/bin/env bash
set -euo pipefail
pnpm vitest run src/engine/readiness-scanner.test.ts src/engine/plan-store-init.test.ts src/engine/drift-detector.test.ts
