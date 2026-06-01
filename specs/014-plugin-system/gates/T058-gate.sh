#!/bin/bash
set -e

# T058-gate: Verify tests pass
# Assertion #1: Unit tests for enforcement skills pass
pnpm vitest run src/plugins/skill-runtime.test.ts

# Assertion #2: Biome check passes
pnpm biome check src/plugins/skill-runtime.ts src/plugins/manifest.ts src/utils/agent.ts

echo "✓ T058-gate passed"
